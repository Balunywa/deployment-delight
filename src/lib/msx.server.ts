/*
 * The link between Cloud Delivery and MSX. MSX is the system of record for accounts and opportunities; this keeps
 * only the keys (the customer's TPID, the engagement's opportunity) and Cloud Delivery's own context. Used by the app
 * and by the MCP endpoint, so Copilot with msx-mcp beside it can pull from MSX and record here in one conversation.
 */
import { type Engagement, measuresOf, milestoneUpdate } from "./engagements";
import { type MsxSnapshot, snapshotText } from "./msx-connector";

export const ORG_ID = "11111111-1111-1111-1111-111111111111";

/** A TPID (MSX top parent ID) is numeric. */
export const TPID = /^\d{3,12}$/;
/** An MSX opportunity number (e.g. 7-ABC123XYZ) or record ID. */
export const OPPORTUNITY = /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/;

export type ContextEntry = {
  id: string;
  source: "msx" | "notes" | "email" | "transcript" | "prompt" | "other";
  title: string;
  text: string;
  by: string;
  at: string;
  /** Set on the snapshot pulled through the MSX connector; there is at most one. */
  msx?: MsxSnapshot;
  /** What changed in MSX since the previous snapshot. */
  changes?: string[];
};

export type CustomerProfile = {
  id: string;
  name: string;
  customer_code: string;
  tpid: string | null;
  msx_account_name: string | null;
  industry: string | null;
  context: ContextEntry[];
  /** The SE's marks on the brief, and items they added (see workspace.ts). */
  evidence: import("./workspace").EvidenceStore | null;
  engagements: number;
};

export type LinkedEngagement = {
  id: string;
  name: string;
  stage: string;
  origin: "opportunity" | "proactive";
  msx_opportunity_id: string | null;
  msx_opportunity_name: string | null;
  customer_id: string | null;
  updated_at: string;
};

const PROFILE = `select c.id, c.name, c.customer_code, c.tpid, c.msx_account_name, c.industry, c.context, c.evidence,
  (select count(*)::int from public.engagements e where e.customer_id = c.id) as engagements
  from public.customers c`;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "customer";

async function db() {
  return import("./db.server");
}

export async function findCustomers(opts: {
  tpid?: string | undefined;
  query?: string | undefined;
}) {
  const d = await db();
  if (opts.tpid)
    return d.query<CustomerProfile>(`${PROFILE} where c.organization_id = $1 and c.tpid = $2`, [
      ORG_ID,
      opts.tpid,
    ]);
  const q = `%${(opts.query ?? "").trim()}%`;
  return d.query<CustomerProfile>(
    `${PROFILE} where c.organization_id = $1 and (c.name ilike $2 or coalesce(c.msx_account_name, '') ilike $2
       or coalesce(c.tpid, '') ilike $2) order by c.name limit 20`,
    [ORG_ID, q],
  );
}

export async function getCustomer(id: string) {
  const d = await db();
  const c = await d.maybeOne<CustomerProfile>(
    `${PROFILE} where c.organization_id = $1 and c.id = $2`,
    [ORG_ID, id],
  );
  if (!c) throw new Error("Customer not found.");
  return c;
}

async function audit(
  event: string,
  resource: { type: string; id: string },
  customerId: string | null,
  by: string,
  value: Record<string, unknown>,
) {
  const d = await db();
  await d.insert("audit_events", {
    organization_id: ORG_ID,
    customer_id: customerId,
    actor_name: by,
    event_type: event,
    resource_type: resource.type,
    resource_id: resource.id,
    new_value: value as never,
    result: "success",
    metadata_json: {} as never,
  });
}

/** Finds the customer by TPID, or creates its profile. Never overwrites a name the team has set. */
export async function upsertCustomer(opts: {
  tpid: string;
  name: string;
  industry?: string | undefined;
  accountName?: string | undefined;
  by: string;
}): Promise<{ customer: CustomerProfile; created: boolean }> {
  if (!TPID.test(opts.tpid)) throw new Error("A TPID is 3 to 12 digits.");
  const d = await db();
  const [existing] = await findCustomers({ tpid: opts.tpid });
  if (existing) {
    if (opts.accountName && !existing.msx_account_name)
      await d.query("update public.customers set msx_account_name = $1 where id = $2", [
        opts.accountName,
        existing.id,
      ]);
    return { customer: await getCustomer(existing.id), created: false };
  }
  const base = slug(opts.name);
  let code = base;
  for (
    let i = 2;
    await d.maybeOne(
      "select 1 from public.customers where organization_id = $1 and customer_code = $2",
      [ORG_ID, code],
    );
    i++
  )
    code = `${base}-${i}`;
  const row = await d.insert<{ id: string }>("customers", {
    organization_id: ORG_ID,
    name: opts.name.trim(),
    customer_code: code,
    tpid: opts.tpid,
    msx_account_name: opts.accountName?.trim() || null,
    industry: opts.industry?.trim() || null,
    status: "active",
  } as never);
  await audit("customer.created", { type: "customer", id: row.id }, row.id, opts.by, {
    tpid: opts.tpid,
    name: opts.name,
  });
  return { customer: await getCustomer(row.id), created: true };
}

/** Sets or clears a customer's TPID. */
export async function setTpid(customerId: string, tpid: string | null, by: string) {
  if (tpid !== null && !TPID.test(tpid)) throw new Error("A TPID is 3 to 12 digits.");
  const d = await db();
  if (tpid) {
    const [other] = await findCustomers({ tpid });
    if (other && other.id !== customerId)
      throw new Error(`TPID ${tpid} already belongs to ${other.name}.`);
  }
  await d.query("update public.customers set tpid = $1 where id = $2 and organization_id = $3", [
    tpid,
    customerId,
    ORG_ID,
  ]);
  await audit("customer.tpid_set", { type: "customer", id: customerId }, customerId, by, { tpid });
  return getCustomer(customerId);
}

/** Adds what MSX doesn't hold: meeting notes, emails, transcripts, a plain-language brief. */
export async function addContext(opts: {
  customerId: string;
  source: ContextEntry["source"];
  title: string;
  text: string;
  by: string;
}) {
  const d = await db();
  const entry: ContextEntry = {
    id: crypto.randomUUID(),
    source: opts.source,
    title: opts.title.trim().slice(0, 160),
    text: opts.text.trim().slice(0, 20000),
    by: opts.by,
    at: new Date().toISOString(),
  };
  await d.query(
    `update public.customers set context = coalesce(context, '[]'::jsonb) || $1::jsonb
     where id = $2 and organization_id = $3`,
    [JSON.stringify([entry]), opts.customerId, ORG_ID],
  );
  await audit(
    "customer.context_added",
    { type: "customer", id: opts.customerId },
    opts.customerId,
    opts.by,
    {
      source: entry.source,
      title: entry.title,
    },
  );
  return entry;
}

export async function removeContext(customerId: string, entryId: string) {
  const d = await db();
  await d.query(
    `update public.customers set context = coalesce((select jsonb_agg(x) from jsonb_array_elements(context) x
       where x ->> 'id' <> $1), '[]'::jsonb) where id = $2 and organization_id = $3`,
    [entryId, customerId, ORG_ID],
  );
}

/**
 * Keeps what MSX said at the last look-up as the customer's MSX context, replacing the previous snapshot. MSX stays
 * the record: this is a dated copy of the account name and open opportunities, for prep.
 */
export async function saveSnapshot(customerId: string, snapshot: MsxSnapshot, by: string) {
  const d = await db();
  const c = await getCustomer(customerId);
  if (c.tpid && c.tpid !== snapshot.tpid)
    throw new Error(`This customer's TPID is ${c.tpid}, not ${snapshot.tpid}.`);
  if (!c.tpid) await setTpid(customerId, snapshot.tpid, by);
  const { snapshotChanges } = await import("./workspace");
  const previous = [...(c.context ?? [])].reverse().find((x) => x.msx)?.msx ?? null;
  const entry: ContextEntry = {
    id: crypto.randomUUID(),
    source: "msx",
    title: `MSX: ${snapshot.account?.name ?? `TPID ${snapshot.tpid}`}, ${snapshot.fetchedAt.slice(0, 10)}`,
    text: snapshotText(snapshot).slice(0, 20000),
    by,
    at: new Date().toISOString(),
    msx: snapshot,
    changes: snapshotChanges(previous, snapshot),
  };
  await d.query(
    `update public.customers set
       context = coalesce((select jsonb_agg(x) from jsonb_array_elements(context) x where not (x ? 'msx')), '[]'::jsonb)
         || $1::jsonb,
       msx_account_name = coalesce($2, msx_account_name)
     where id = $3 and organization_id = $4`,
    [JSON.stringify([entry]), snapshot.account?.name ?? null, customerId, ORG_ID],
  );
  await audit("customer.msx_snapshot", { type: "customer", id: customerId }, customerId, by, {
    tpid: snapshot.tpid,
    opportunities: snapshot.opportunities.length,
  });
  return getCustomer(customerId);
}

/** Other customers' context and engagements, to find similar work by peers. */
export async function peers(customerId: string) {
  const d = await db();
  const rows = await d.query<{
    id: string;
    name: string;
    context: ContextEntry[] | null;
    engagements: { id: string; name: string; stage: string; words: string | null }[] | null;
  }>(
    `select c.id, c.name, c.context,
       (select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'stage', e.stage, 'words', e.brief ->> 'words')
          order by e.updated_at desc)
        from public.engagements e where e.customer_id = c.id) as engagements
     from public.customers c where c.organization_id = $1 and c.id <> $2`,
    [ORG_ID, customerId],
  );
  return rows
    .map((r) => ({
      customerId: r.id,
      customerName: r.name,
      engagements: (r.engagements ?? []).map(({ id, name, stage }) => ({ id, name, stage })),
      text: [
        ...(r.context ?? []).map((x) => x.text),
        ...(r.engagements ?? []).flatMap((e) => [e.name, e.words ?? ""]),
      ].join("\n"),
    }))
    .filter((p) => p.text.trim());
}

const ENGAGEMENT = `select id, name, stage, origin, msx_opportunity_id, msx_opportunity_name, customer_id, updated_at
  from public.engagements`;

export async function engagementsFor(customerId?: string) {
  const d = await db();
  return customerId
    ? d.query<LinkedEngagement>(
        `${ENGAGEMENT} where organization_id = $1 and customer_id = $2 order by updated_at desc`,
        [ORG_ID, customerId],
      )
    : d.query<LinkedEngagement>(
        `${ENGAGEMENT} where organization_id = $1 order by updated_at desc limit 50`,
        [ORG_ID],
      );
}

/**
 * Starts an engagement under an MSX opportunity, or proactively when there isn't one yet. Starting one for an
 * opportunity that already has an engagement returns that engagement instead of a duplicate.
 */
export async function startEngagement(opts: {
  name: string;
  customerId: string | null;
  opportunityId?: string | undefined;
  opportunityName?: string | undefined;
  problem?: string | undefined;
  by: string;
}): Promise<{ engagement: LinkedEngagement; created: boolean }> {
  const d = await db();
  const opp = opts.opportunityId?.trim() || null;
  if (opp && !OPPORTUNITY.test(opp))
    throw new Error("That doesn't look like an MSX opportunity ID.");
  if (opp) {
    const existing = await d.maybeOne<LinkedEngagement>(
      `${ENGAGEMENT} where organization_id = $1 and msx_opportunity_id = $2`,
      [ORG_ID, opp],
    );
    if (existing) return { engagement: existing, created: false };
  }
  const row = await d.insert<{ id: string }>("engagements", {
    organization_id: ORG_ID,
    customer_id: opts.customerId,
    name: opts.name.trim(),
    owner_name: opts.by,
    stage: "understand",
    origin: opp ? "opportunity" : "proactive",
    msx_opportunity_id: opp,
    msx_opportunity_name: opts.opportunityName?.trim() || null,
    brief: { signals: [], words: opts.problem?.trim() ?? "" },
    sessions: JSON.stringify([
      { id: "s1", title: "First conversation", at: new Date().toISOString(), attendees: "" },
    ]) as never,
  } as never);
  await audit("engagement.started", { type: "engagement", id: row.id }, opts.customerId, opts.by, {
    name: opts.name,
    origin: opp ? "opportunity" : "proactive",
    ...(opp ? { opportunity: opp } : {}),
  });
  const engagement = await d.one<LinkedEngagement>(`${ENGAGEMENT} where id = $1`, [row.id]);
  return { engagement, created: true };
}

/** Links an engagement to an MSX opportunity, or makes it proactive again (null). */
export async function linkOpportunity(opts: {
  engagementId: string;
  opportunityId: string | null;
  opportunityName?: string | undefined;
  by: string;
}) {
  const d = await db();
  const opp = opts.opportunityId?.trim() || null;
  if (opp && !OPPORTUNITY.test(opp))
    throw new Error("That doesn't look like an MSX opportunity ID.");
  if (opp) {
    const other = await d.maybeOne<{ id: string; name: string }>(
      "select id, name from public.engagements where organization_id = $1 and msx_opportunity_id = $2 and id <> $3",
      [ORG_ID, opp, opts.engagementId],
    );
    if (other) throw new Error(`Opportunity ${opp} is already linked to "${other.name}".`);
  }
  const row = await d.maybeOne<{ customer_id: string | null }>(
    `update public.engagements set msx_opportunity_id = $1, msx_opportunity_name = $2,
       origin = case when $1::text is null then 'proactive' else 'opportunity' end, updated_at = now()
     where id = $3 and organization_id = $4 returning customer_id`,
    [opp, opp ? opts.opportunityName?.trim() || null : null, opts.engagementId, ORG_ID],
  );
  if (!row) throw new Error("Engagement not found.");
  await audit(
    opp ? "engagement.opportunity_linked" : "engagement.opportunity_unlinked",
    { type: "engagement", id: opts.engagementId },
    row.customer_id,
    opts.by,
    { opportunity: opp },
  );
  return d.one<LinkedEngagement>(`${ENGAGEMENT} where id = $1`, [opts.engagementId]);
}

/** The milestone update for MSX, the same text the Realize value step shows, with the keys to post it under. */
export async function msxUpdate(engagementId: string) {
  const d = await db();
  const e = await d.maybeOne<Engagement & LinkedEngagement & { tpid: string | null }>(
    `select e.*, c.name as customer_name, c.tpid from public.engagements e
     left join public.customers c on c.id = e.customer_id where e.id = $1 and e.organization_id = $2`,
    [engagementId, ORG_ID],
  );
  if (!e) throw new Error("Engagement not found.");
  // Same rule as the Realize value step: production installs of the solutions this engagement chose.
  const chosen = [...new Set((e.solution_map ?? []).flatMap((m) => m.products))];
  const running = e.customer_id
    ? (
        await d.query<{
          product_id: string;
          name: string;
          version: string | null;
          created_at: string;
        }>(
          `select o.product_id, en.name, v.version, en.created_at from public.environments en
           join public.offerings o on o.id = en.offering_id
           left join public.offering_versions v on v.id = en.actual_offering_version_id
           where en.customer_id = $1 and en.environment_type = 'production'
           order by en.created_at desc`,
          [e.customer_id],
        )
      ).filter((r) => chosen.includes(r.product_id))
    : [];
  const products = await d.query<{ id: string; name: string }>(
    "select id, name from public.products",
  );
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? "Solution";
  return {
    engagement: { id: e.id, name: e.name, stage: e.stage },
    tpid: e.tpid,
    opportunity: e.msx_opportunity_id
      ? { id: e.msx_opportunity_id, name: e.msx_opportunity_name }
      : null,
    milestones: e.realization?.msx?.milestones ?? [],
    update: milestoneUpdate(e, name, running, measuresOf(e)),
  };
}
