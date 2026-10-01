/*
 * Solution catalog actions: who is signed in, owners confirming and editing their solutions, reviewers
 * featuring validated ones, and the detail read model. Ownership rules are enforced here, not in the UI.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "./db-types";
import { asMaturity, isOwner, isSameOwner, ownerSchema, ownersOf } from "./solutions";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

async function me() {
  return (await import("./identity.server")).currentUser();
}

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => me());

async function audit(
  db: typeof import("./db.server"),
  event_type: string,
  productId: string,
  value: Record<string, unknown>,
) {
  await db.insert("audit_events", {
    organization_id: ORG_ID,
    actor_name: (await me()).name,
    event_type,
    resource_type: "product",
    resource_id: productId,
    new_value: value as Json,
    result: "success",
    metadata_json: {} as Json,
  });
}

async function loadProduct(db: typeof import("./db.server"), productId: string) {
  const product = await db.maybeOne<{
    id: string;
    name: string;
    owners: Json;
    maturity: string;
  }>("select id, name, owners, maturity from public.products where id = $1", [productId]);
  if (!product) throw new Error("Solution not found.");
  return { ...product, owners: ownersOf(product.owners), maturity: asMaturity(product.maturity) };
}

export const confirmOwnership = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const product = await loadProduct(db, data.productId);
    if (!isOwner(product.owners, await me()))
      throw new Error("Only an owner of this solution can confirm it.");
    await db.update(
      "products",
      { owner_confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: product.id },
    );
    await audit(db, "product.ownership_confirmed", product.id, { by: (await me()).name });
    return { ok: true };
  });

export const updateOwners = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ productId: z.string().uuid(), owners: z.array(ownerSchema).min(1).max(10) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const product = await loadProduct(db, data.productId);
    const user = await me();
    // Orphaned solutions (no owners on record) can be adopted by anyone; otherwise only owners edit.
    if (product.owners.length && !isOwner(product.owners, user))
      throw new Error("Only an owner of this solution can change its owners.");
    const owners = data.owners.filter(
      (o, i) => data.owners.findIndex((x) => isSameOwner(x, o)) === i,
    );
    await db.query(
      `update public.products set owners = $1::jsonb, owner_confirmed_at = now(), updated_at = now()
       where id = $2`,
      // Serialized explicitly: the query helper sends plain arrays as Postgres arrays, not JSON.
      [JSON.stringify(owners), product.id],
    );
    await audit(db, "product.owners_changed", product.id, {
      previous: product.owners.map((o) => o.name),
      owners: owners.map((o) => o.name),
    });
    return { owners };
  });

/** Reviewers feature a validated solution, or take a featured one back to validated. */
export const setFeatured = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ productId: z.string().uuid(), featured: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("./db.server");
    const product = await loadProduct(db, data.productId);
    if (isOwner(product.owners, await me()))
      throw new Error("Owners can't feature their own solution. Ask another reviewer.");
    if (data.featured && product.maturity === "community")
      throw new Error("Only validated solutions can be featured.");
    const maturity = data.featured ? "featured" : "validated";
    await db.update(
      "products",
      { maturity, updated_at: new Date().toISOString() },
      { id: product.id },
    );
    await audit(db, data.featured ? "product.featured" : "product.unfeatured", product.id, {
      from: product.maturity,
      to: maturity,
    });
    return { maturity };
  });

export type SolutionDetail = {
  product: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    maturity: string;
    owners: Json;
    tags: string[];
    audience: string | null;
    outcome: string | null;
    source_url: string | null;
    support_url: string | null;
    license_attested: boolean;
    submitted_by: string | null;
    owner_confirmed_at: string | null;
    validated_at: string | null;
    created_at: string;
  };
  offerings: {
    id: string;
    name: string;
    offering_type: string;
    network_profile: string | null;
    deployment_boundary: string | null;
    supported_regions: string[] | null;
    installs: number;
    customers: number;
    versions: {
      id: string;
      version: string;
      status: string;
      published_at: string | null;
      created_at: string;
      manifest_json: Json;
    }[];
  }[];
  activity: { event_type: string; actor_name: string; timestamp: string; new_value: Json }[];
};

export const getSolution = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { query } = await import("./db.server");
    const [row] = await query<{ r: SolutionDetail }>(
      `select jsonb_build_object(
         'product', to_jsonb(p),
         'offerings', coalesce((select jsonb_agg(jsonb_build_object(
             'id', o.id, 'name', o.name, 'offering_type', o.offering_type,
             'network_profile', o.network_profile, 'deployment_boundary', o.deployment_boundary,
             'supported_regions', o.supported_regions,
             'installs', (select count(*) from public.environments e where e.offering_id = o.id),
             'customers', (select count(distinct e.customer_id) from public.environments e where e.offering_id = o.id),
             'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status,
                 'published_at', v.published_at, 'created_at', v.created_at, 'manifest_json', v.manifest_json)
               order by v.created_at desc) from public.offering_versions v where v.offering_id = o.id), '[]'::jsonb))
             order by o.name) from public.offerings o where o.product_id = p.id), '[]'::jsonb),
         'activity', coalesce((select jsonb_agg(x order by x->>'timestamp' desc) from (
             select jsonb_build_object('event_type', a.event_type, 'actor_name', a.actor_name,
               'timestamp', a.timestamp, 'new_value', a.new_value) as x
             from public.audit_events a
             where a.resource_type = 'product' and a.resource_id = p.id::text
             order by a.timestamp desc limit 20) t), '[]'::jsonb)
       ) as r
       from public.products p where p.id = $1`,
      [data.productId],
    );
    if (!row) throw new Error("Solution not found.");
    return row.r;
  });
