import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Engagement } from "./engagements";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

const SELECT = `select e.id, e.name, e.stage, e.owner_name, e.customer_id, c.name as customer_name, e.brief,
  e.readiness, e.solution_map, e.results, e.decision, e.created_at, e.updated_at
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
};

export const getEngagement = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const e = await db.maybeOne<Engagement>(
      `${SELECT} where e.id = $1 and e.organization_id = $2`,
      [data.id, ORG_ID],
    );
    if (!e) throw new Error("Engagement not found.");
    // What the customer already runs, so Prove can show the PoC once it's deployed.
    const installs = e.customer_id
      ? await db.query<EngagementInstall>(
          `select en.id, en.name, en.environment_type, en.status, o.product_id, o.name as offering_name, v.version
           from public.environments en join public.offerings o on o.id = en.offering_id
           left join public.offering_versions v on v.id = en.actual_offering_version_id
           where en.customer_id = $1 order by en.created_at desc`,
          [e.customer_id],
        )
      : [];
    return { engagement: e, installs };
  });

const metric = z.object({
  metric: z.string().max(200),
  value: z.string().max(60),
  unit: z.string().max(30),
});
const patchSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  stage: z.enum(["listen", "assess", "map", "propose", "prove", "decided"]).optional(),
  brief: z
    .object({
      problem: z.string().max(2000).optional(),
      workflow: z.string().max(200).optional(),
      outcome: z.string().max(1000).optional(),
      whyNow: z.string().max(1000).optional(),
      owner: z.string().max(200).optional(),
      constraints: z.string().max(1000).optional(),
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
  readiness: z
    .record(
      z.enum(["workflows", "context", "modernize", "data", "governance", "ownership"]),
      z.object({
        status: z.enum(["ready", "partial", "blocker", "not-needed", "unknown"]),
        note: z.string().max(500),
      }),
    )
    .optional(),
  solution_map: z
    .array(
      z.object({
        concept: z.enum(["workflows", "context", "modernize", "data", "governance", "ownership"]),
        products: z.array(z.string().uuid()).max(8),
        note: z.string().max(500),
      }),
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
});

export const createEngagement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(3).max(160),
        customerId: z.string().uuid().nullable(),
        workflow: z.string().trim().max(200).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const user = (await import("./identity.server")).currentUser();
    const row = await db.insert<{ id: string }>("engagements", {
      organization_id: ORG_ID,
      customer_id: data.customerId,
      name: data.name,
      owner_name: user.name,
      brief: { workflow: data.workflow, baseline: [{ metric: "", value: "", unit: "" }] },
    });
    await db.insert("audit_events", {
      organization_id: ORG_ID,
      customer_id: data.customerId,
      actor_name: user.name,
      event_type: "engagement.started",
      resource_type: "engagement",
      resource_id: row.id,
      new_value: { name: data.name } as never,
      result: "success",
      metadata_json: {} as never,
    });
    return { id: row.id };
  });

export const saveEngagement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), patch: patchSchema }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const user = (await import("./identity.server")).currentUser();
    const before = await db.one<{ stage: string; customer_id: string | null }>(
      "select stage, customer_id from public.engagements where id = $1 and organization_id = $2",
      [data.id, ORG_ID],
    );
    const { decision, ...rest } = data.patch;
    const values: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
    // Arrays would otherwise be sent as Postgres arrays; these columns are jsonb.
    for (const k of ["solution_map", "results"] as const)
      if (rest[k] !== undefined) values[k] = JSON.stringify(rest[k]);
    if (decision !== undefined) {
      values["decision"] = decision
        ? { ...decision, by: user.name, at: new Date().toISOString() }
        : null;
      if (decision) values["stage"] = "decided";
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
