/*
 * Read models for the UI. Each server function returns one JSON document built in SQL,
 * shaped exactly like the nested objects the screens consume. Nothing reaches the database
 * from the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Database, Json, Tables } from "@/lib/db-types";

type Row<T extends keyof Database["public"]["Tables"]> = Tables<T>;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { query } = await import("@/lib/db.server");
  return (await query<{ r: T }>(sql, params)).map((x) => x.r);
}

async function single<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(sql, params))[0] ?? null;
}

const version = (col: string, extra = "") =>
  `(select jsonb_build_object('id', v.id, 'version', v.version${extra}) from public.offering_versions v where v.id = ${col})`;
const agg = (inner: string) => `coalesce((${inner}), '[]'::jsonb)`;

type Ver = { id: string; version: string } | null;

export const getOrganization = createServerFn({ method: "GET" }).handler(async () =>
  single<Row<"organizations">>(
    `select to_jsonb(o) as r from public.organizations o order by created_at limit 1`,
  ),
);

export const listProducts = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"products"> & {
      offerings: Pick<
        Row<"offerings">,
        | "id"
        | "name"
        | "offering_type"
        | "status"
        | "estimated_monthly_cost_low"
        | "estimated_monthly_cost_high"
      >[];
    }
  >(`select to_jsonb(p) || jsonb_build_object('offerings', ${agg(`select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'offering_type', o.offering_type, 'status', o.status,
        'estimated_monthly_cost_low', o.estimated_monthly_cost_low, 'estimated_monthly_cost_high', o.estimated_monthly_cost_high) order by o.name)
      from public.offerings o where o.product_id = p.id`)}) as r
    from public.products p order by p.name`),
);

export type OfferingVersionRow = Pick<
  Row<"offering_versions">,
  | "id"
  | "version"
  | "status"
  | "release_notes"
  | "published_at"
  | "manifest_json"
  | "ai_generated"
  | "created_by"
  | "created_at"
>;

export const listOfferings = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"offerings"> & {
      products: { name: string } | null;
      offering_versions: OfferingVersionRow[];
      environments: { id: string }[];
    }
  >(
    `select to_jsonb(o) || jsonb_build_object(
       'products', (select jsonb_build_object('name', p.name) from public.products p where p.id = o.product_id),
       'offering_versions', ${agg(`select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status, 'release_notes', v.release_notes,
           'published_at', v.published_at, 'manifest_json', v.manifest_json, 'ai_generated', v.ai_generated, 'created_by', v.created_by, 'created_at', v.created_at))
         from public.offering_versions v where v.offering_id = o.id`)},
       'environments', ${agg(`select jsonb_agg(jsonb_build_object('id', e.id)) from public.environments e where e.offering_id = o.id`)}) as r
     from public.offerings o order by o.name`,
  ),
);

export const listModules = createServerFn({ method: "GET" }).handler(async () =>
  rows<Row<"infrastructure_modules">>(
    `select to_jsonb(m) as r from public.infrastructure_modules m order by m.name`,
  ),
);

export const listPolicyPacks = createServerFn({ method: "GET" }).handler(async () =>
  rows<Row<"policy_packs">>(`select to_jsonb(p) as r from public.policy_packs p order by p.name`),
);

export const listEstate = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"environments"> & {
      customers: Pick<
        Row<"customers">,
        "id" | "name" | "customer_code" | "azure_model" | "industry"
      > | null;
      offerings: Pick<Row<"offerings">, "id" | "name" | "offering_type"> | null;
      desired: Ver;
      actual: Ver;
      drift_findings: Pick<Row<"drift_findings">, "id" | "severity" | "status">[];
    }
  >(
    `select to_jsonb(e) || jsonb_build_object(
       'customers', (select jsonb_build_object('id', c.id, 'name', c.name, 'customer_code', c.customer_code, 'azure_model', c.azure_model, 'industry', c.industry)
                     from public.customers c where c.id = e.customer_id),
       'offerings', (select jsonb_build_object('id', o.id, 'name', o.name, 'offering_type', o.offering_type) from public.offerings o where o.id = e.offering_id),
       'desired', ${version("e.desired_offering_version_id")},
       'actual', ${version("e.actual_offering_version_id")},
       'drift_findings', ${agg(`select jsonb_agg(jsonb_build_object('id', f.id, 'severity', f.severity, 'status', f.status)) from public.drift_findings f where f.environment_id = e.id`)}) as r
     from public.environments e order by e.name`,
  ),
);

export const listCustomers = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"customers"> & {
      environments: (Pick<
        Row<"environments">,
        | "id"
        | "name"
        | "environment_type"
        | "status"
        | "compliance_score"
        | "monthly_cost_estimate"
        | "offering_id"
        | "region"
        | "configuration_json"
      > & {
        drift_findings: { status: string; category: string }[];
        actual: { version: string } | null;
        desired: { version: string } | null;
        offerings: { name: string } | null;
      })[];
      customer_connections: Pick<
        Row<"customer_connections">,
        "id" | "connection_type" | "subscription_id" | "status" | "last_validated_at"
      >[];
    }
  >(
    `select to_jsonb(c) || jsonb_build_object(
       'environments', ${agg(`select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'environment_type', e.environment_type, 'status', e.status,
           'compliance_score', e.compliance_score, 'monthly_cost_estimate', e.monthly_cost_estimate, 'offering_id', e.offering_id, 'region', e.region,
           'configuration_json', e.configuration_json,
           'drift_findings', ${agg(`select jsonb_agg(jsonb_build_object('status', f.status, 'category', f.category)) from public.drift_findings f where f.environment_id = e.id`)},
           'actual', (select jsonb_build_object('version', v.version) from public.offering_versions v where v.id = e.actual_offering_version_id),
           'desired', (select jsonb_build_object('version', v.version) from public.offering_versions v where v.id = e.desired_offering_version_id),
           'offerings', (select jsonb_build_object('name', o.name) from public.offerings o where o.id = e.offering_id)))
         from public.environments e where e.customer_id = c.id`)},
       'customer_connections', ${agg(`select jsonb_agg(jsonb_build_object('id', k.id, 'connection_type', k.connection_type, 'subscription_id', k.subscription_id,
           'status', k.status, 'last_validated_at', k.last_validated_at) order by k.created_at desc)
         from public.customer_connections k where k.customer_id = c.id`)}) as r
     from public.customers c order by c.name`,
  ),
);

export const getCustomer = createServerFn({ method: "GET" })
  .inputValidator((d: { customerId: string }) =>
    z.object({ customerId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) =>
    single<
      Row<"customers"> & {
        customer_connections: Row<"customer_connections">[];
        environments: (Row<"environments"> & {
          offerings: Row<"offerings"> | null;
          desired: { id: string; version: string; manifest_json: Json } | null;
          actual: Ver;
          drift_findings: Row<"drift_findings">[];
          compliance_checks: Row<"compliance_checks">[];
          deployments: (Row<"deployments"> & { approvals: Row<"approvals">[] })[];
        })[];
      }
    >(
      `select to_jsonb(c) || jsonb_build_object(
         'customer_connections', ${agg(`select jsonb_agg(to_jsonb(k) order by k.created_at desc) from public.customer_connections k where k.customer_id = c.id`)},
         'environments', ${agg(`select jsonb_agg(to_jsonb(e) || jsonb_build_object(
             'offerings', (select to_jsonb(o) from public.offerings o where o.id = e.offering_id),
             'desired', ${version("e.desired_offering_version_id", ", 'manifest_json', v.manifest_json")},
             'actual', ${version("e.actual_offering_version_id")},
             'drift_findings', ${agg(`select jsonb_agg(to_jsonb(f)) from public.drift_findings f where f.environment_id = e.id`)},
             'compliance_checks', ${agg(`select jsonb_agg(to_jsonb(k) order by k.control_key) from public.compliance_checks k where k.environment_id = e.id`)},
             'deployments', ${agg(`select jsonb_agg(to_jsonb(d) || jsonb_build_object('approvals', ${agg(`select jsonb_agg(to_jsonb(a)) from public.approvals a where a.deployment_id = d.id`)}))
                from public.deployments d where d.environment_id = e.id`)}))
           from public.environments e where e.customer_id = c.id`)}) as r
       from public.customers c where c.id = $1`,
      [data.customerId],
    ),
  );

const envCustomer = `(select jsonb_build_object('id', c.id, 'name', c.name, 'customer_code', c.customer_code) from public.customers c where c.id = e.customer_id)`;

export const listDeployments = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"deployments"> & {
      approvals: Row<"approvals">[];
      environments: {
        id: string;
        name: string;
        environment_type: string;
        customers: { id: string; name: string; customer_code: string } | null;
      } | null;
    }
  >(
    `select to_jsonb(d) || jsonb_build_object(
       'approvals', ${agg(`select jsonb_agg(to_jsonb(a)) from public.approvals a where a.deployment_id = d.id`)},
       'environments', (select jsonb_build_object('id', e.id, 'name', e.name, 'environment_type', e.environment_type, 'customers', ${envCustomer})
                        from public.environments e where e.id = d.environment_id)) as r
     from public.deployments d order by d.requested_at desc limit 200`,
  ),
);

export const getDeployment = createServerFn({ method: "GET" })
  .inputValidator((d: { deploymentId: string }) =>
    z.object({ deploymentId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) =>
    single<
      Row<"deployments"> & {
        approvals: Row<"approvals">[];
        deployment_steps: Row<"deployment_steps">[];
        environments: Json;
      }
    >(
      `select to_jsonb(d) || jsonb_build_object(
         'approvals', ${agg(`select jsonb_agg(to_jsonb(a)) from public.approvals a where a.deployment_id = d.id`)},
         'deployment_steps', ${agg(`select jsonb_agg(to_jsonb(s) order by s.sequence) from public.deployment_steps s where s.deployment_id = d.id`)},
         'environments', (select to_jsonb(e) || jsonb_build_object(
             'customers', ${envCustomer},
             'offerings', (select jsonb_build_object('name', o.name, 'offering_type', o.offering_type, 'network_profile', o.network_profile) from public.offerings o where o.id = e.offering_id),
             'desired', (select jsonb_build_object('version', v.version, 'manifest_json', v.manifest_json) from public.offering_versions v where v.id = e.desired_offering_version_id))
           from public.environments e where e.id = d.environment_id)) as r
       from public.deployments d where d.id = $1`,
      [data.deploymentId],
    ),
  );

const envWithCustomer = `(select jsonb_build_object('id', e.id, 'name', e.name, 'environment_type', e.environment_type,
    'customers', (select jsonb_build_object('id', c.id, 'name', c.name) from public.customers c where c.id = e.customer_id))
  from public.environments e where e.id = x.environment_id)`;

export const listCompliance = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"compliance_checks"> & {
      environments: {
        id: string;
        name: string;
        environment_type: string;
        customers: { id: string; name: string } | null;
      } | null;
    }
  >(
    `select to_jsonb(x) || jsonb_build_object('environments', ${envWithCustomer}) as r
     from public.compliance_checks x order by x.control_name limit 2000`,
  ),
);

export const listDrift = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"drift_findings"> & {
      environments: {
        id: string;
        name: string;
        customers: { id: string; name: string } | null;
      } | null;
    }
  >(
    `select to_jsonb(x) || jsonb_build_object('environments', ${envWithCustomer}) as r
     from public.drift_findings x order by x.detected_at desc`,
  ),
);

export const listAudit = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"audit_events"> & {
      customers: { name: string } | null;
      environments: { name: string } | null;
    }
  >(
    `select to_jsonb(a) || jsonb_build_object(
       'customers', (select jsonb_build_object('name', c.name) from public.customers c where c.id = a.customer_id),
       'environments', (select jsonb_build_object('name', e.name) from public.environments e where e.id = a.environment_id)) as r
     from public.audit_events a order by a.timestamp desc limit 300`,
  ),
);

export const listWaves = createServerFn({ method: "GET" }).handler(async () =>
  rows<
    Row<"upgrade_waves"> & {
      offering_versions: { version: string; offerings: { name: string } | null } | null;
    }
  >(
    `select to_jsonb(w) || jsonb_build_object('offering_versions', (select jsonb_build_object('version', v.version,
         'offerings', (select jsonb_build_object('name', o.name) from public.offerings o where o.id = v.offering_id))
       from public.offering_versions v where v.id = w.offering_version_id)) as r
     from public.upgrade_waves w order by w.created_at desc`,
  ),
);
