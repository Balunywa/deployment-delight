import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { CARDS, CARD_BY_ID, productNumber } from "./conversation";
import { type Engagement, latestOf, measuresOf } from "./engagements";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

const SELECT = `select e.id, e.name, e.stage, e.owner_name, e.customer_id, c.name as customer_name, e.brief,
  e.readiness, e.solution_map, e.results, e.decision, e.sessions, e.trail, e.findings, e.actions,
  e.realization, e.origin, e.msx_opportunity_id, e.msx_opportunity_name, c.tpid as customer_tpid,
  e.created_at, e.updated_at
  from public.engagements e left join public.customers c on c.id = e.customer_id`;

export const listEngagements = createServerFn({ method: "GET" }).handler(async () => {
  const db = await import("./db.server");
  return db.query<Engagement>(`${SELECT} where e.organization_id = $1 order by e.updated_at desc`, [
    ORG_ID,
  ]);
});

export type EngagementInstall = {
  id: string;
  name: string;
  environment_type: string;
  status: string;
  product_id: string;
  offering_name: string;
  version: string | null;
  monthly_cost_estimate: number | null;
  created_at: string;
  /** The latest run for this environment, if any. */
  deployment_id: string | null;
  deployment_status: string | null;
};

/** What Cloud Delivery already knows about the account, for meeting prep. */
export type AccountContext = {
  industry: string | null;
  azure_model: string | null;
  foundation: { name: string; status: string; mode: string } | null;
  connections: number;
  others: { id: string; name: string; stage: string }[];
};

async function loadEngagement(id: string) {
  const db = await import("./db.server");
  const e = await db.maybeOne<Engagement>(`${SELECT} where e.id = $1 and e.organization_id = $2`, [
    id,
    ORG_ID,
  ]);
  if (!e) throw new Error("Engagement not found.");
  return e;
}

export const getEngagement = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const e = await loadEngagement(data.id);
    if (!e.customer_id)
      return {
        engagement: e,
        installs: [] as EngagementInstall[],
        account: null as AccountContext | null,
      };
    const [installs, customer, foundation, connections, others] = await Promise.all([
      db.query<EngagementInstall>(
        `select en.id, en.name, en.environment_type, en.status, o.product_id, o.name as offering_name, v.version,
           en.monthly_cost_estimate::float8 as monthly_cost_estimate, en.created_at,
           d.id as deployment_id, d.status as deployment_status
         from public.environments en join public.offerings o on o.id = en.offering_id
         left join public.offering_versions v on v.id = en.actual_offering_version_id
         left join lateral (select id, status from public.deployments where environment_id = en.id
           order by requested_at desc nulls last limit 1) d on true
         where en.customer_id = $1 order by en.created_at desc`,
        [e.customer_id],
      ),
      db.one<{ industry: string | null; azure_model: string | null }>(
        "select industry, azure_model from public.customers where id = $1",
        [e.customer_id],
      ),
      db.maybeOne<{ name: string; status: string; mode: string }>(
        "select name, status, mode from public.foundations where customer_id = $1",
        [e.customer_id],
      ),
      db.one<{ n: number }>(
        "select count(*)::int as n from public.customer_connections where customer_id = $1",
        [e.customer_id],
      ),
      db.query<{ id: string; name: string; stage: string }>(
        "select id, name, stage from public.engagements where customer_id = $1 and id <> $2 order by updated_at desc",
        [e.customer_id, e.id],
      ),
    ]);
    const account: AccountContext = {
      ...customer,
      foundation,
      connections: connections.n,
      others,
    };
    return { engagement: e, installs, account };
  });

/**
 * What the customer may see: their outcome in their words, what they confirmed, open questions, agreed actions and
 * the examples shown. Hypotheses, presenter notes, fit scoring and internal notes are never sent to this view.
 */
export type Recap = {
  name: string;
  customer: string | null;
  owner: string | null;
  words: string;
  outcome: string;
  workflow: string;
  whyNow: string;
  success: string;
  confirmed: { text: string; quote?: string }[];
  open: string[];
  actions: { text: string; owner: string; due: string; done: boolean }[];
  shown: { id: string; name: string; outcome: string | null }[];
  sessions: { title: string; at: string }[];
  /** The customer's own measures: baseline, target and the latest value. */
  results: {
    metric: string;
    unit: string;
    baseline: string;
    target: string;
    latest: string;
    when: string;
  }[];
  /** Chosen solutions running in the customer's production. */
  production: string[];
  valueConfirmed: { by: string; note: string; at: string } | null;
};

export const getRecap = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<Recap> => {
    const db = await import("./db.server");
    const e = await loadEngagement(data.id);
    const shownIds = e.trail
      .filter((t) => t.card.startsWith("show:"))
      .map((t) => Number(t.card.slice(5)))
      .filter((n) => Number.isInteger(n))
      .map((n) => `33333333-3333-4333-8333-1${String(n).padStart(11, "0")}`);
    const shown = shownIds.length
      ? await db.query<{ id: string; name: string; outcome: string | null }>(
          "select id, name, outcome from public.products where id = any($1::uuid[])",
          [shownIds],
        )
      : [];
    const chosen = [...new Set(e.solution_map.flatMap((m) => m.products))];
    const production = chosen.length
      ? await db.query<{ name: string }>(
          `select distinct p.name from public.environments en
           join public.offerings o on o.id = en.offering_id join public.products p on p.id = o.product_id
           where en.customer_id = $1 and en.environment_type = 'production' and o.product_id = any($2::uuid[])`,
          [e.customer_id, chosen],
        )
      : [];
    const b = e.brief;
    const c = e.realization.confirmed;
    return {
      results: measuresOf(e)
        .filter((m) => m.metric.trim())
        .map((m) => {
          const l = latestOf(m);
          return {
            metric: m.metric,
            unit: m.unit,
            baseline: m.baseline,
            target: m.target,
            latest: l?.value ?? "",
            when: l?.when ?? "",
          };
        }),
      production: production.map((p) => p.name),
      valueConfirmed: c ? { by: c.by, note: c.note, at: c.at } : null,
      name: e.name,
      customer: e.customer_name,
      owner: b.owner ?? null,
      words: b.words ?? "",
      outcome: b.outcome ?? "",
      workflow: b.workflow ?? "",
      whyNow: b.whyNow ?? "",
      success: b.success ?? "",
      confirmed: e.findings
        .filter((f) => f.kind === "confirmed")
        .map((f) => ({ text: f.text, ...(f.quote ? { quote: f.quote } : {}) })),
      open: e.findings.filter((f) => f.kind === "unknown").map((f) => f.text),
      actions: e.actions.map(({ text, owner, due, done }) => ({ text, owner, due, done })),
      shown,
      sessions: e.sessions.map(({ title, at }) => ({ title, at })),
    };
  });

const metric = z.object({
  metric: z.string().max(200),
  value: z.string().max(60),
  unit: z.string().max(30),
});
const concept = z.enum(["workflows", "context", "modernize", "data", "governance", "ownership"]);
const iso = z.string().max(40);
const patchSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  customer_id: z.string().uuid().optional(),
  stage: z
    .enum(["understand", "explore", "illustrate", "validate", "agree", "prove", "decided"])
    .optional(),
  brief: z
    .object({
      signals: z
        .array(z.enum(["pilots", "answers", "legacy", "data", "explore"]))
        .max(5)
        .optional(),
      words: z.string().max(2000).optional(),
      problem: z.string().max(2000).optional(),
      workflow: z.string().max(1000).optional(),
      outcome: z.string().max(1000).optional(),
      whyNow: z.string().max(1000).optional(),
      owner: z.string().max(200).optional(),
      success: z.string().max(1000).optional(),
      constraints: z.string().max(1000).optional(),
      internal: z.string().max(4000).optional(),
      team: z
        .object({
          se: z.string().max(120).optional(),
          csa: z.string().max(120).optional(),
          ssp: z.string().max(120).optional(),
        })
        .optional(),
      stakeholders: z
        .array(
          z.object({
            name: z.string().max(120),
            role: z.string().max(120),
            audience: z.enum(["executive", "technical", "internal"]),
          }),
        )
        .max(20)
        .optional(),
      baseline: z.array(metric).max(12).optional(),
    })
    .optional(),
  solution_map: z
    .array(
      z.object({ concept, products: z.array(z.string().uuid()).max(8), note: z.string().max(500) }),
    )
    .max(12)
    .optional(),
  results: z
    .array(
      z.object({
        metric: z.string().max(200),
        baseline: z.string().max(60),
        target: z.string().max(60),
        measured: z.string().max(60),
        unit: z.string().max(30),
      }),
    )
    .max(12)
    .optional(),
  decision: z
    .object({ choice: z.enum(["scale", "iterate", "stop"]), note: z.string().max(1000) })
    .nullable()
    .optional(),
  sessions: z
    .array(
      z.object({
        id: z.string().max(60),
        title: z.string().max(160),
        at: iso,
        attendees: z.string().max(500),
      }),
    )
    .max(40)
    .optional(),
  trail: z
    .array(
      z.object({
        card: z.string().max(60),
        answers: z.array(z.string().max(40)).max(10),
        note: z.string().max(2000),
        session: z.string().max(60),
        at: iso,
        parked: z.boolean().optional(),
      }),
    )
    .max(200)
    .optional(),
  findings: z
    .array(
      z.object({
        id: z.string().max(60),
        text: z.string().trim().min(1).max(500),
        kind: z.enum(["confirmed", "hypothesis", "unknown", "ruled-out"]),
        source: z.enum(["customer", "presenter", "ai"]),
        quote: z.string().max(2000).optional(),
        card: z.string().max(60).optional(),
        edited: z.boolean().optional(),
        at: iso,
      }),
    )
    .max(200)
    .optional(),
  realization: z
    .object({
      measures: z
        .array(
          z.object({
            metric: z.string().max(200),
            unit: z.string().max(30),
            baseline: z.string().max(60),
            target: z.string().max(60),
            proof: z.string().max(60),
            d30: z.string().max(60),
            d60: z.string().max(60),
            d90: z.string().max(60),
          }),
        )
        .max(12)
        .optional(),
      adoption: z.string().max(1000).optional(),
      msx: z
        .object({
          // Only https links are stored, so nothing else can end up in an href.
          opportunity: z
            .union([z.literal(""), z.string().url().startsWith("https://").max(600)])
            .optional(),
          milestones: z
            .array(
              z.object({
                title: z.string().trim().min(1).max(200),
                url: z.string().url().startsWith("https://").max(600),
              }),
            )
            .max(20)
            .optional(),
        })
        .optional(),
    })
    .optional(),
  actions: z
    .array(
      z.object({
        id: z.string().max(60),
        text: z.string().trim().min(1).max(500),
        owner: z.string().max(120),
        due: z.string().max(20),
        done: z.boolean(),
      }),
    )
    .max(60)
    .optional(),
});

export const createEngagement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(3).max(160),
        customerId: z.string().uuid().nullable(),
        signals: z.array(z.enum(["pilots", "answers", "legacy", "data", "explore"])).max(5),
        words: z.string().trim().max(2000).default(""),
        /** The MSX opportunity it's tracked under; absent for a proactive engagement. */
        opportunityId: z.string().trim().max(64).optional(),
        opportunityName: z.string().trim().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const user = (await import("./identity.server")).currentUser();
    const { startEngagement } = await import("./msx.server");
    const r = await startEngagement({
      name: data.name,
      customerId: data.customerId,
      opportunityId: data.opportunityId,
      opportunityName: data.opportunityName,
      problem: data.words,
      by: user.name,
    });
    if (r.created && data.signals.length)
      await db.query("update public.engagements set brief = brief || $1::jsonb where id = $2", [
        JSON.stringify({ signals: data.signals }),
        r.engagement.id,
      ]);
    return { id: r.engagement.id, created: r.created };
  });

export const saveEngagement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), patch: patchSchema }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const user = (await import("./identity.server")).currentUser();
    const before = await db.one<{
      stage: string;
      customer_id: string | null;
      realization: Engagement["realization"];
    }>(
      "select stage, customer_id, realization from public.engagements where id = $1 and organization_id = $2",
      [data.id, ORG_ID],
    );
    const { decision, realization, ...rest } = data.patch;
    // The handoff is only ever recorded by handOff.
    if (rest.brief) {
      const current = await db.one<{ brief: Engagement["brief"] }>(
        "select brief from public.engagements where id = $1",
        [data.id],
      );
      rest.brief = {
        ...rest.brief,
        ...(current.brief.handoff ? { handoff: current.brief.handoff } : {}),
      };
    }
    if (rest.customer_id && before.customer_id && rest.customer_id !== before.customer_id)
      throw new Error("This engagement is already linked to a customer.");
    const values: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
    // The owner's confirmation is only ever set by confirmValue; edits never overwrite it.
    if (realization)
      values["realization"] = {
        ...before.realization,
        ...realization,
        confirmed: before.realization.confirmed ?? null,
      };
    // Arrays would otherwise be sent as Postgres arrays; these columns are jsonb.
    for (const k of [
      "solution_map",
      "results",
      "sessions",
      "trail",
      "findings",
      "actions",
    ] as const)
      if (rest[k] !== undefined) values[k] = JSON.stringify(rest[k]);
    if (decision !== undefined) {
      values["decision"] = decision
        ? { ...decision, by: user.name, at: new Date().toISOString() }
        : null;
      // Scaling it moves the engagement on to realizing the value; anything else ends here.
      if (decision) values["stage"] = decision.choice === "scale" ? "realize" : "decided";
    }
    await db.update("engagements", values as never, { id: data.id });
    const stage = (values["stage"] as string | undefined) ?? before.stage;
    if (stage !== before.stage || decision)
      await db.insert("audit_events", {
        organization_id: ORG_ID,
        customer_id: before.customer_id,
        actor_name: user.name,
        event_type: decision ? "engagement.decided" : "engagement.stage_changed",
        resource_type: "engagement",
        resource_id: data.id,
        new_value: (decision ? { decision: decision.choice } : { stage }) as never,
        result: "success",
        metadata_json: {} as never,
      });
    return { ok: true };
  });

/** The business owner confirms the value was realized. Recorded by the presenter, with both names, and audited. */
export const confirmValue = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        by: z.string().trim().min(2).max(200),
        note: z.string().trim().max(1000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const user = (await import("./identity.server")).currentUser();
    const e = await loadEngagement(data.id);
    if (e.stage !== "realize")
      throw new Error("Value is confirmed after the proof is scaled to production.");
    const confirmed = {
      by: data.by,
      note: data.note,
      at: new Date().toISOString(),
      recordedBy: user.name,
    };
    await db.update(
      "engagements",
      {
        realization: { ...e.realization, confirmed },
        stage: "decided",
        updated_at: confirmed.at,
      } as never,
      { id: e.id },
    );
    await db.insert("audit_events", {
      organization_id: ORG_ID,
      customer_id: e.customer_id,
      actor_name: user.name,
      event_type: "engagement.value_confirmed",
      resource_type: "engagement",
      resource_id: e.id,
      new_value: { by: data.by } as never,
      result: "success",
      metadata_json: {} as never,
    });
    return { ok: true };
  });

/** The SE hands the engagement to the CSA who takes it to production. Recorded and audited. */
export const handOff = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        to: z.string().trim().min(2).max(120),
        note: z.string().trim().max(1000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const user = (await import("./identity.server")).currentUser();
    const e = await loadEngagement(data.id);
    const handoff = { to: data.to, by: user.name, at: new Date().toISOString(), note: data.note };
    await db.update(
      "engagements",
      {
        brief: { ...e.brief, team: { ...e.brief.team, csa: data.to }, handoff },
        updated_at: handoff.at,
      } as never,
      { id: e.id },
    );
    await db.insert("audit_events", {
      organization_id: ORG_ID,
      customer_id: e.customer_id,
      actor_name: user.name,
      event_type: "engagement.handed_off",
      resource_type: "engagement",
      resource_id: e.id,
      new_value: { to: data.to } as never,
      result: "success",
      metadata_json: {} as never,
    });
    return { ok: true };
  });

/** Something waiting on the seller or the CSA, across every engagement. */
export type WorkItem = {
  key: string;
  kind: "action" | "run" | "checkpoint" | "handoff" | "untested";
  title: string;
  detail: string;
  engagementId: string;
  engagement: string;
  tab: "conversation" | "prove" | "handoff" | "realize";
  deploymentId?: string;
  /** ISO date it's due, when it has one. */
  due?: string;
  overdue: boolean;
};

const RUN_WAITING: Record<string, string> = {
  AWAITING_PLAN_APPROVAL: "Plan waiting for review",
  AWAITING_APPROVAL: "Waiting for security approval",
  QUEUED: "Approved, ready to run",
  VALIDATION_FAILED: "Preflight failed",
  FAILED: "Run failed",
};

export const listWork = createServerFn({ method: "GET" }).handler(async (): Promise<WorkItem[]> => {
  const db = await import("./db.server");
  const all = await db.query<Engagement>(
    `${SELECT} where e.organization_id = $1 and e.stage <> 'decided'`,
    [ORG_ID],
  );
  const runs = await db.query<{
    engagement_id: string;
    env_name: string;
    customer: string;
    deployment_id: string;
    status: string;
    environment_type: string;
  }>(
    `select en.configuration_json->'engagement'->>'id' as engagement_id, en.name as env_name, c.name as customer,
       d.id as deployment_id, d.status, en.environment_type
     from public.environments en join public.customers c on c.id = en.customer_id
     join lateral (select id, status from public.deployments where environment_id = en.id
       order by requested_at desc nulls last limit 1) d on true
     where en.configuration_json ? 'engagement'`,
  );
  const prod = await db.query<{ customer_id: string; product_id: string; created_at: string }>(
    `select en.customer_id, o.product_id, min(en.created_at) as created_at from public.environments en
     join public.offerings o on o.id = en.offering_id
     where en.environment_type = 'production' and en.actual_offering_version_id is not null
     group by 1, 2`,
  );
  const now = Date.now();
  const soon = now + 7 * 864e5;
  const items: WorkItem[] = [];
  for (const e of all) {
    const base = { engagementId: e.id, engagement: e.name };
    for (const a of e.actions) {
      if (a.done || !a.due) continue;
      const t = new Date(a.due).getTime();
      if (t > soon) continue;
      items.push({
        ...base,
        key: `a-${a.id}`,
        kind: "action",
        title: a.text,
        detail: `${a.owner || "No owner"} · ${e.customer_name ?? "No customer"}`,
        tab: "conversation",
        due: a.due,
        overdue: t < now - 864e5,
      });
    }
    for (const r of runs.filter((x) => x.engagement_id === e.id && RUN_WAITING[x.status]))
      items.push({
        ...base,
        key: `r-${r.deployment_id}`,
        kind: "run",
        title: `${RUN_WAITING[r.status]}: ${r.env_name} for ${r.customer}`,
        detail: r.environment_type === "production" ? "Production" : "Proof",
        tab: r.environment_type === "production" ? "realize" : "prove",
        deploymentId: r.deployment_id,
        overdue: r.status === "FAILED" || r.status === "VALIDATION_FAILED",
      });
    if (e.stage === "prove" && !e.decision) {
      const open = e.findings.filter((f) => f.kind === "hypothesis").length;
      if (open)
        items.push({
          ...base,
          key: `u-${e.id}`,
          kind: "untested",
          title: `${open} ${open === 1 ? "hypothesis" : "hypotheses"} not yet tested with the customer`,
          detail: "Test them before the proof decision",
          tab: "conversation",
          overdue: false,
        });
    }
    if (e.decision?.choice === "scale" && !e.brief.handoff)
      items.push({
        ...base,
        key: `h-${e.id}`,
        kind: "handoff",
        title: "Scaling with no CSA handoff recorded",
        detail: e.brief.team?.csa
          ? `Hand it to ${e.brief.team.csa}`
          : "Name the CSA and hand it off",
        tab: "handoff",
        overdue: false,
      });
    if (e.stage === "realize" && e.customer_id) {
      const chosen = new Set(e.solution_map.flatMap((m) => m.products));
      const since = prod
        .filter((p) => p.customer_id === e.customer_id && chosen.has(p.product_id))
        .map((p) => new Date(p.created_at).getTime())
        .sort()[0];
      if (since) {
        const measures = measuresOf(e);
        for (const [k, label, days] of [
          ["d30", "30-day", 30],
          ["d60", "60-day", 60],
          ["d90", "90-day", 90],
        ] as const) {
          const due = since + days * 864e5;
          if (due > soon) break;
          if (measures.some((m) => m[k].trim())) continue;
          items.push({
            ...base,
            key: `c-${e.id}-${k}`,
            kind: "checkpoint",
            title: `${label} value measures due`,
            detail: `${e.customer_name ?? ""} · ask the owner for their numbers`,
            tab: "realize",
            due: new Date(due).toISOString().slice(0, 10),
            overdue: due < now,
          });
          break;
        }
      }
    }
  }
  return items.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999"),
  );
});

/* ------------------------------------------------------------------------------------ Foundry assist */

export const getAssistStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { advisorConfigured } = await import("./azure.server");
  return {
    configured: advisorConfigured(),
    model: process.env["AZURE_OPENAI_DEPLOYMENT"] || "gpt-4.1",
  };
});

const ASSIST_SYSTEM = `You are the Engagement Copilot, assisting a Microsoft solution engineer or cloud solution architect during a customer conversation. You talk only to the presenter, never to the customer.

You are given CONTEXT JSON: the engagement (what the customer said, the questions asked and their answers, findings labelled confirmed / hypothesis / unknown / ruled-out), the question CARDS available (id, stage, question, answers), and the CATALOG of accelerators.

Rules:
- Never state anything about the customer as fact unless it is a confirmed finding. Anything you infer is a hypothesis.
- Never invent numbers, ROI, prices, customer names, commitments or funding.
- Keep data availability (can it reach the data), business meaning (does it know what the data means) and action (can it act safely) separate; they need different fixes.
- Don't recommend a platform replacement when a smaller step would test the hypothesis.
- Suggest only card ids that exist in CARDS and haven't been asked.
- Plain, short sentences.`;

const assistSchema = z.object({
  suggestions: z
    .array(z.object({ card: z.string(), because: z.string().max(300) }))
    .max(5)
    .default([]),
  hypotheses: z
    .array(z.object({ text: z.string().max(240), because: z.string().max(300) }))
    .max(4)
    .default([]),
  listenFor: z.string().max(400).default(""),
  recap: z.string().max(6000).default(""),
});
export type Assist = z.infer<typeof assistSchema> & { model: string };

export const assistEngagement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        mode: z.enum(["next", "recap"]),
        notes: z.string().max(4000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<Assist> => {
    const db = await import("./db.server");
    const { chat } = await import("./azure.server");
    const e = await loadEngagement(data.id);
    const catalog = await db.query<{ id: string; name: string; outcome: string | null }>(
      "select id, name, outcome from public.products where organization_id = $1 and status = 'active'",
      [ORG_ID],
    );
    const asked = new Set(e.trail.map((t) => t.card));
    const recap = data.mode === "recap";
    const { internal: _internal, ...brief } = e.brief;
    const context = {
      engagement: {
        name: e.name,
        customer: e.customer_name,
        brief: recap
          ? { outcome: brief.outcome, workflow: brief.workflow, owner: brief.owner }
          : brief,
        asked: e.trail
          .filter((t) => !t.parked)
          .map((t) => {
            const card = CARD_BY_ID.get(t.card);
            return {
              card: t.card,
              question: card?.question ?? t.card,
              answers: t.answers.map((a) => card?.answers.find((x) => x.id === a)?.label ?? a),
              customerWords: t.note,
            };
          }),
        findings: e.findings
          .filter((f) => !recap || f.kind === "confirmed" || f.kind === "unknown")
          .map((f) => ({ kind: f.kind, text: f.text, quote: f.quote })),
        actions: e.actions.map(({ text, owner, due }) => ({ text, owner, due })),
        // The customer's own measures in production, and the owner's confirmation. No commercial data.
        value: {
          measures: measuresOf(e).filter((m) => m.metric.trim()),
          adoption: e.realization.adoption ?? "",
          confirmedBy: e.realization.confirmed?.by ?? null,
          ownerSaid: e.realization.confirmed?.note ?? null,
        },
      },
      cards: recap
        ? []
        : CARDS.filter((c) => !asked.has(c.id)).map((c) => ({
            id: c.id,
            stage: c.stage,
            question: c.question,
            answers: c.answers.map((a) => a.label),
          })),
      catalog: catalog.map((p) => ({
        number: productNumber(p.id),
        name: p.name,
        outcome: p.outcome,
      })),
      presenterNotes: data.notes,
    };
    const task = recap
      ? `Draft a short follow-up email from the presenter to the customer. Use ONLY confirmed findings (as "what we heard"), unknown findings (as "what we still need to find out") and the agreed actions with owners and dates. If engagement.value has measures with values at 30, 60 or 90 days, lead with what it is delivering against the baseline, using exactly those numbers and units, and the owner's confirmation if present. No hypotheses, no internal notes, no MSX, cost or consumption, no product pitch, no numbers that aren't in the context. Return JSON {"recap": "..."}.`
      : `From the presenter's notes and the conversation so far, suggest what to ask next and what might be going on. Return JSON {"suggestions":[{"card":"<card id>","because":"..."}], "hypotheses":[{"text":"...","because":"..."}], "listenFor":"one sentence on what to listen for next"}. At most 3 suggestions and 3 hypotheses. Hypotheses must not repeat existing findings.`;
    const raw = await chat(
      [
        { role: "system", content: ASSIST_SYSTEM },
        { role: "user", content: `CONTEXT:\n${JSON.stringify(context)}\n\nTASK: ${task}` },
      ],
      { json: true },
    );
    let parsed: z.infer<typeof assistSchema>;
    try {
      parsed = assistSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error("The model's reply wasn't in the expected shape. Try again.");
    }
    return {
      ...parsed,
      // Only real, unasked questions: the model never invents a card.
      suggestions: parsed.suggestions.filter((s) => CARD_BY_ID.has(s.card) && !asked.has(s.card)),
      model: process.env["AZURE_OPENAI_DEPLOYMENT"] || "gpt-4.1",
    };
  });
