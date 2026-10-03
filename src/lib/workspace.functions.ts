/*
 * The engagement workspace on the server: load everything an SE needs in one call, save the workspace (keeping the
 * point of view's history), mark evidence, start or resume a draft, create the engagement from it, and record an
 * accepted handoff. Nothing here writes to MSX, commits a milestone or deploys anything.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Engagement } from "./engagements";
import type { CustomerProfile } from "./msx.server";
import { PLAYBOOK_VERSION } from "./playbook";
import type { Prep } from "./prep";
import type { BriefItem, EvidenceStore, Workspace, WorkspaceEngagement } from "./workspace";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const me = async () => (await import("./identity.server")).currentUser().name;

/* --------------------------------------------------------------------------------------- validation */

const s = (n: number) => z.string().max(n);
const id = s(60);
const iso = s(40);
const status = z.enum(["confirmed", "needs-validation", "contradicted", "unknown"]);
const kind = z.enum(["fact", "interpretation", "hypothesis"]);
const section = z.enum(["priorities", "relationship", "technical", "stakeholders", "risks"]);

const pov = z.object({
  pressure: s(1500),
  stakeholders: s(1500),
  consequence: s(1500),
  technical: s(1500),
  evidence: z.array(id).max(40),
  assumptions: z
    .array(
      z.object({
        id,
        text: s(500),
        status: z.enum(["open", "confirmed", "revised", "rejected"]),
        quote: s(2000).optional(),
        revisedTo: s(500).optional(),
        meeting: id.optional(),
      }),
    )
    .max(20),
  disprove: s(1000),
  invite: s(500),
  opening: s(2000),
  paths: z
    .array(
      z.object({
        id,
        title: s(200),
        outcome: s(800),
        prerequisites: s(800),
        implications: s(800),
        risks: s(800),
        evidenceNeeded: s(800),
        current: z.boolean().optional(),
      }),
    )
    .max(5),
});

const purpose = z.enum(["discovery", "architecture", "workshop", "demo", "poc", "kickoff"]);
const plan = z.object({
  id,
  title: s(200),
  purpose,
  duration: z.number().int().min(15).max(480),
  date: s(20),
  outcome: s(800),
  audience: z
    .array(z.object({ id, name: s(120), role: s(120), priorities: s(500), inferred: z.boolean() }))
    .max(20),
  opening: s(2000),
  questions: z
    .array(
      z.object({
        id,
        text: s(500),
        why: s(300),
        source: z.enum(["pov", "assumption", "playbook", "area", "own"]),
        assumption: id.optional(),
      }),
    )
    .max(20),
  followUps: z.array(z.object({ text: s(500), because: s(300) })).max(20),
  listenFor: z.array(s(300)).max(20),
  objections: z.array(z.object({ text: s(300), explore: s(500) })).max(10),
  constraints: z.array(s(500)).max(10),
  nextStep: s(500),
  participants: s(500),
  agenda: z.array(z.object({ minutes: z.number().int().min(0).max(480), item: s(200) })).max(12),
  notes: s(20000),
  answers: z.record(id, s(2000)),
  agreedNext: s(500),
  held: z.object({ at: iso }).nullable(),
  review: z
    .object({
      need: s(1500),
      options: z.array(z.object({ id, text: s(500), tradeoff: s(500) })).max(10),
      decisions: z
        .array(z.object({ id, text: s(500), status: z.enum(["decided", "open"]) }))
        .max(20),
      missing: s(1000),
      at: iso,
      by: s(120),
    })
    .nullable(),
});

const charter = z.object({
  outcome: s(1000),
  objective: s(1000),
  scope: s(1500),
  exclusions: s(1500),
  type: z.enum([
    "discovery",
    "architecture",
    "workshop",
    "demo",
    "assessment",
    "poc",
    "pilot",
    "delivery",
  ]),
  owner: s(120),
  roles: z.object({ se: s(120), csa: s(120), ssp: s(120), other: s(300) }),
  sponsor: s(200),
  technicalContact: s(200),
  success: z.array(z.object({ id, criterion: s(500), evidence: s(500) })).max(12),
  targetDate: s(20),
  dependencies: s(1500),
  risks: s(1500),
  resources: s(1500),
  firstActivity: s(500),
  nextDecision: z.object({ what: s(500), when: s(20) }),
  milestone: s(300),
});

const poc = z.object({
  decision: s(800),
  hypotheses: z.array(s(500)).max(12),
  passFail: z.array(z.object({ id, criterion: s(500), threshold: s(200) })).max(12),
  environment: s(1000),
  data: s(1000),
  duration: s(120),
  resources: s(1000),
  production: s(1000),
  exitDecision: s(800),
  nextOwner: s(200),
});

const handoff = z.object({
  routing: z.enum(["", "unified", "non-unified"]),
  discussed: z.object({ at: iso, note: s(1500) }).nullable(),
  criteria: z.record(s(40), z.boolean()),
  receivingOwner: s(200),
  receivingTeam: s(200),
  transferred: z.object({ architecture: z.boolean(), risks: z.boolean() }),
  notes: s(3000),
  accepted: z.unknown().optional(),
});

const tcp = z.object({
  on: z.boolean(),
  milestone: s(300),
  productionDate: s(20),
  workload: s(500),
  architecture: s(1500),
  deploymentPath: s(1000),
  supportModel: s(1000),
  acceptance: s(1500),
  risks: z.array(z.object({ id, text: s(500), owner: s(120), mitigation: s(500) })).max(20),
  updatedAt: s(40),
});

const workspacePatch = z.object({
  pov: pov.optional(),
  plans: z.array(plan).max(30).optional(),
  charter: charter.optional(),
  poc: poc.optional(),
  handoff: handoff.optional(),
  tcp: tcp.optional(),
});

/* ------------------------------------------------------------------------------------------- reads */

const SELECT = `select e.id, e.name, e.stage, e.owner_name, e.customer_id, c.name as customer_name, e.brief,
  e.readiness, e.solution_map, e.results, e.decision, e.sessions, e.trail, e.findings, e.actions,
  e.realization, e.origin, e.msx_opportunity_id, e.msx_opportunity_name, c.tpid as customer_tpid,
  e.status, e.workspace, e.created_at, e.updated_at
  from public.engagements e left join public.customers c on c.id = e.customer_id`;

export type WorkspaceData = {
  engagement: WorkspaceEngagement;
  customer: CustomerProfile | null;
  prep: Prep | null;
  items: BriefItem[];
  /** What changed in MSX at the last refresh. */
  changes: string[];
  team: { name: string; role: string | null }[] | null;
  others: { id: string; name: string; stage: string; status: string }[];
  playbook: string;
};

async function loadWorkspace(engagementId: string): Promise<WorkspaceData> {
  const db = await import("./db.server");
  const e = await db.maybeOne<WorkspaceEngagement>(
    `${SELECT} where e.id = $1 and e.organization_id = $2`,
    [engagementId, ORG_ID],
  );
  if (!e) throw new Error("Engagement not found.");
  e.workspace ??= {};
  if (!e.customer_id)
    return {
      engagement: e,
      customer: null,
      prep: null,
      items: [],
      changes: [],
      team: null,
      others: [],
      playbook: PLAYBOOK_VERSION,
    };
  const m = await import("./msx.server");
  const { buildPrep, focusOn } = await import("./prep");
  const { briefItems } = await import("./workspace");
  const [customer, peers, others, installs, foundation] = await Promise.all([
    m.getCustomer(e.customer_id),
    m.peers(e.customer_id),
    db.query<{ id: string; name: string; stage: string; status: string }>(
      `select id, name, stage, status from public.engagements
       where customer_id = $1 and id <> $2 order by updated_at desc`,
      [e.customer_id, e.id],
    ),
    db.query<{ name: string; environment_type: string; offering_name: string }>(
      `select en.name, en.environment_type, o.name as offering_name from public.environments en
       join public.offerings o on o.id = en.offering_id where en.customer_id = $1`,
      [e.customer_id],
    ),
    db.maybeOne<{ name: string; status: string }>(
      "select name, status from public.foundations where customer_id = $1",
      [e.customer_id],
    ),
  ]);
  const snap = [...(customer.context ?? [])].reverse().find((x) => x.msx);
  const opp =
    e.msx_opportunity_id && snap?.msx
      ? (snap.msx.opportunities.find(
          (o) => o.number === e.msx_opportunity_id || o.id === e.msx_opportunity_id,
        ) ?? null)
      : null;
  const prep = focusOn(
    buildPrep({ customer, context: customer.context ?? [], peers }),
    opp
      ? {
          name: opp.name,
          text: [opp.name, opp.description, opp.forecastComments].filter(Boolean).join("\n"),
        }
      : null,
  );
  return {
    engagement: e,
    customer,
    prep,
    items: briefItems({
      prep,
      evidence: customer.evidence ?? {},
      engagements: others,
      installs,
      foundation,
    }),
    changes: snap?.changes ?? [],
    team: snap?.msx?.team ?? null,
    others,
    playbook: PLAYBOOK_VERSION,
  };
}

export const getWorkspace = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => loadWorkspace(data.id));

/** A customer's engagements, newest first, with whether each is still a draft. */
export const listCustomerEngagements = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ customerId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    return db.query<{
      id: string;
      name: string;
      stage: string;
      status: "draft" | "active";
      msx_opportunity_id: string | null;
      msx_opportunity_name: string | null;
      updated_at: string;
    }>(
      `select id, name, stage, status, msx_opportunity_id, msx_opportunity_name, updated_at
       from public.engagements where organization_id = $1 and customer_id = $2 order by updated_at desc`,
      [ORG_ID, data.customerId],
    );
  });

/* ------------------------------------------------------------------------------------------ writes */

async function audit(
  event: string,
  engagementId: string,
  customerId: string | null,
  value: Record<string, unknown>,
) {
  const db = await import("./db.server");
  await db.insert("audit_events", {
    organization_id: ORG_ID,
    customer_id: customerId,
    actor_name: await me(),
    event_type: event,
    resource_type: "engagement",
    resource_id: engagementId,
    new_value: value as never,
    result: "success",
    metadata_json: {} as never,
  });
}

/**
 * Saves parts of the workspace. A changed point of view keeps the previous version in its history, with who changed
 * it and why. The handoff's acceptance is never set here (only by acceptHandoff).
 */
export const saveWorkspace = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ id: z.string().uuid(), patch: workspacePatch, reason: s(200).default("Edited") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const by = await me();
    const row = await db.maybeOne<{ workspace: Workspace }>(
      "select workspace from public.engagements where id = $1 and organization_id = $2",
      [data.id, ORG_ID],
    );
    if (!row) throw new Error("Engagement not found.");
    const current = row.workspace ?? {};
    const next: Workspace = {
      ...current,
      ...(data.patch as Workspace),
      playbook: PLAYBOOK_VERSION,
    };
    if (data.patch.handoff)
      next.handoff = { ...next.handoff!, accepted: current.handoff?.accepted ?? null };
    if (
      data.patch.pov &&
      current.pov &&
      JSON.stringify(current.pov) !== JSON.stringify(data.patch.pov)
    ) {
      const last = current.povHistory?.at(-1);
      // Typing saves often; keep one revision per person per reason every ten minutes.
      const recent =
        last &&
        last.by === by &&
        last.reason === data.reason &&
        Date.now() - new Date(last.at).getTime() < 10 * 60_000;
      next.povHistory = recent
        ? (current.povHistory ?? [])
        : [
            ...(current.povHistory ?? []),
            { at: new Date().toISOString(), by, reason: data.reason, pov: current.pov },
          ].slice(-50);
    }
    const at = new Date().toISOString();
    await db.query(
      "update public.engagements set workspace = $1::jsonb, updated_at = $2 where id = $3",
      [JSON.stringify(next), at, data.id],
    );
    return { ok: true, at };
  });

/** Sets how far the customer has confirmed a brief item, keeping the history of its status. */
export const markEvidence = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        itemId: id,
        status,
        note: s(1000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const by = await me();
    const row = await db.one<{ evidence: EvidenceStore | null }>(
      "select evidence from public.customers where id = $1 and organization_id = $2",
      [data.customerId, ORG_ID],
    );
    const ev: EvidenceStore = row.evidence ?? {};
    const prev = ev.marks?.[data.itemId];
    const at = new Date().toISOString();
    const mark = {
      status: data.status,
      ...(data.note ? { note: data.note } : {}),
      by,
      at,
      history: [
        ...(prev?.history ?? []),
        ...(prev ? [{ status: prev.status, note: prev.note, by: prev.by, at: prev.at }] : []),
      ].slice(-20),
    };
    const next: EvidenceStore = { ...ev, marks: { ...(ev.marks ?? {}), [data.itemId]: mark } };
    await db.query("update public.customers set evidence = $1::jsonb where id = $2", [
      JSON.stringify(next),
      data.customerId,
    ]);
    return mark;
  });

/** Adds a brief item the SE knows that no source holds. */
export const addEvidence = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        section,
        text: z.string().trim().min(3).max(800),
        kind,
        status,
        source: s(200).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const row = await db.one<{ evidence: EvidenceStore | null }>(
      "select evidence from public.customers where id = $1 and organization_id = $2",
      [data.customerId, ORG_ID],
    );
    const ev = row.evidence ?? {};
    const item = {
      id: `own-${crypto.randomUUID().slice(0, 8)}`,
      section: data.section,
      text: data.text,
      kind: data.kind,
      status: data.status,
      source: data.source,
      by: await me(),
      at: new Date().toISOString(),
    };
    await db.query("update public.customers set evidence = $1::jsonb where id = $2", [
      JSON.stringify({ ...ev, items: [...(ev.items ?? []), item].slice(-200) }),
      data.customerId,
    ]);
    return item;
  });

/**
 * Opens the workspace for a new engagement with this customer, as a draft: under an MSX opportunity (one engagement
 * per opportunity, so an existing one is returned) or proactive (an open proactive draft is resumed).
 */
export const startDraft = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        opportunityId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/)
          .optional(),
        opportunityName: s(200).optional(),
        name: s(160).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const by = await me();
    const customer = await db.one<{ name: string }>(
      "select name from public.customers where id = $1 and organization_id = $2",
      [data.customerId, ORG_ID],
    );
    const existing = data.opportunityId
      ? await db.maybeOne<{ id: string; status: string }>(
          "select id, status from public.engagements where organization_id = $1 and msx_opportunity_id = $2",
          [ORG_ID, data.opportunityId],
        )
      : await db.maybeOne<{ id: string; status: string }>(
          `select id, status from public.engagements where organization_id = $1 and customer_id = $2
           and status = 'draft' and msx_opportunity_id is null order by updated_at desc limit 1`,
          [ORG_ID, data.customerId],
        );
    if (existing) return { id: existing.id, created: false, status: existing.status };
    const name =
      data.name?.trim() || data.opportunityName?.trim() || `${customer.name}: first conversation`;
    const row = await db.insert<{ id: string }>("engagements", {
      organization_id: ORG_ID,
      customer_id: data.customerId,
      name: name.slice(0, 160),
      owner_name: by,
      stage: "understand",
      status: "draft",
      origin: data.opportunityId ? "opportunity" : "proactive",
      msx_opportunity_id: data.opportunityId ?? null,
      msx_opportunity_name: data.opportunityName?.trim() || null,
      brief: { signals: [], words: "" },
      workspace: { playbook: PLAYBOOK_VERSION },
    } as never);
    await audit("engagement.draft_started", row.id, data.customerId, {
      name,
      ...(data.opportunityId ? { opportunity: data.opportunityId } : {}),
    });
    return { id: row.id, created: true, status: "draft" };
  });

/**
 * Creates the engagement from its draft: the reviewed charter becomes the engagement's brief (outcome, success,
 * owner, team). It doesn't change MSX, commit a milestone, transfer ownership or deploy anything.
 */
export const createFromDraft = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), name: z.string().trim().min(3).max(160), charter }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const e = await db.maybeOne<WorkspaceEngagement>(
      `${SELECT} where e.id = $1 and e.organization_id = $2`,
      [data.id, ORG_ID],
    );
    if (!e) throw new Error("Engagement not found.");
    if (e.status !== "draft") throw new Error("This engagement already exists.");
    const c = data.charter;
    const held = (e.workspace?.plans ?? []).some((p) => p.held);
    const success = c.success
      .map((x) => x.criterion)
      .filter(Boolean)
      .join("; ");
    const brief: Engagement["brief"] = {
      ...e.brief,
      ...(c.outcome ? { outcome: c.outcome } : {}),
      ...(success ? { success } : {}),
      ...(c.sponsor ? { owner: c.sponsor } : {}),
      ...(c.exclusions ? { constraints: `Out of scope: ${c.exclusions}` } : {}),
      team: {
        ...e.brief.team,
        ...(c.roles.se ? { se: c.roles.se } : {}),
        ...(c.roles.csa ? { csa: c.roles.csa } : {}),
        ...(c.roles.ssp ? { ssp: c.roles.ssp } : {}),
      },
    };
    const at = new Date().toISOString();
    await db.query(
      `update public.engagements set status = 'active', name = $1, brief = $2::jsonb,
         workspace = $3::jsonb, stage = $4, updated_at = $5 where id = $6`,
      [
        data.name,
        JSON.stringify(brief),
        JSON.stringify({ ...e.workspace, charter: c, playbook: PLAYBOOK_VERSION }),
        held && e.stage === "understand" ? "explore" : e.stage,
        at,
        e.id,
      ],
    );
    await audit("engagement.created", e.id, e.customer_id, { name: data.name, type: c.type });
    return { ok: true };
  });

/**
 * The receiving owner accepted ownership, after reviewing the handoff with the SE. Recorded with both names and
 * audited. Needs the handoff discussion and a receiving owner first.
 */
export const acceptHandoff = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        by: z.string().trim().min(2).max(200),
        note: s(1500).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const recordedBy = await me();
    const e = await db.maybeOne<WorkspaceEngagement>(
      `${SELECT} where e.id = $1 and e.organization_id = $2`,
      [data.id, ORG_ID],
    );
    if (!e) throw new Error("Engagement not found.");
    const h = e.workspace?.handoff;
    if (!h?.discussed) throw new Error("Record the handoff discussion first.");
    if (!h.receivingOwner.trim()) throw new Error("Name the receiving owner first.");
    const at = new Date().toISOString();
    const workspace: Workspace = {
      ...e.workspace,
      handoff: { ...h, accepted: { by: data.by, recordedBy, at, note: data.note } },
    };
    // Kept in the brief too, where the CSA name and the older handoff record live.
    const brief = {
      ...e.brief,
      team: { ...e.brief.team, csa: h.receivingOwner },
      handoff: { to: h.receivingOwner, by: recordedBy, at, note: data.note || h.notes },
    };
    await db.query(
      "update public.engagements set workspace = $1::jsonb, brief = $2::jsonb, updated_at = $3 where id = $4",
      [JSON.stringify(workspace), JSON.stringify(brief), at, e.id],
    );
    await audit("engagement.handoff_accepted", e.id, e.customer_id, {
      to: h.receivingOwner,
      acceptedBy: data.by,
    });
    return { ok: true };
  });
