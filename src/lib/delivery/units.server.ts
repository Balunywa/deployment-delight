/*
 * Server-only: derives delivery units from what the console already knows (managed landing zones, solutions,
 * customers), keeps their resolved specs in delivery_units, renders each unit repository's content, and writes
 * vending requests — as a pull request on cd-vending when a GitHub App token is configured.
 */
import { modelOf } from "../product-catalog";
import {
  DEFAULT_PLATFORM,
  ENV_SHORT,
  PLATFORM_KINDS,
  type Platform,
  type UnitInput,
  type UnitKind,
  type UnitSpec,
  isPlatformKind,
  resolveUnit,
  slugify,
} from "./model";
import {
  type CustomerEnvironment,
  type ScaffoldFile,
  customerRepo,
  installStem,
  landingZoneRepo,
  solutionRepo,
} from "./scaffold";
import { deliveryTemplates } from "./templates";
import { requestFile, requestPath, vendingRepo } from "./vending";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
type Db = typeof import("../db.server");

/** Platform settings: CD_GITHUB_ORG, CD_TEMPLATES_REF, CD_ISV_TENANT_ID, CD_STATE_* and CD_SANDBOX_SUBSCRIPTION_ID. */
export function platformFromEnv(): Platform {
  const e = (k: string) => process.env[k]?.trim() || undefined;
  return {
    ...DEFAULT_PLATFORM,
    org: e("CD_GITHUB_ORG") ?? DEFAULT_PLATFORM.org,
    templatesRef: e("CD_TEMPLATES_REF") ?? DEFAULT_PLATFORM.templatesRef,
    isvTenantId: e("CD_ISV_TENANT_ID") ?? DEFAULT_PLATFORM.isvTenantId,
    stateAccount: e("CD_STATE_ACCOUNT") ?? DEFAULT_PLATFORM.stateAccount,
    stateResourceGroup: e("CD_STATE_RESOURCE_GROUP") ?? DEFAULT_PLATFORM.stateResourceGroup,
    stateSubscriptionId: e("CD_STATE_SUBSCRIPTION_ID") ?? DEFAULT_PLATFORM.stateSubscriptionId,
    sandboxSubscriptionId:
      e("CD_SANDBOX_SUBSCRIPTION_ID") ?? DEFAULT_PLATFORM.sandboxSubscriptionId,
  };
}

export type UnitRow = {
  id: string;
  kind: UnitKind;
  slug: string;
  name: string;
  repository: string;
  product_id: string | null;
  customer_id: string | null;
  foundation_id: string | null;
  status: string;
  spec: UnitSpec;
  request_path: string | null;
  request_url: string | null;
  requested_by: string | null;
  requested_at: string | null;
  created_at: string;
  updated_at: string;
};

type Links = { product_id?: string; customer_id?: string; foundation_id?: string };
type Source = { input: UnitInput; links: Links };

const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

async function solutionSources(db: Db, productId?: string): Promise<Source[]> {
  const rows = await db.query<{ id: string; name: string; offerings: string[] }>(
    `select p.id, p.name, coalesce(array_agg(o.name order by o.name) filter (where o.id is not null), '{}') as offerings
     from public.products p left join public.offerings o on o.product_id = p.id
     where p.organization_id = $1 and ($2::uuid is null or p.id = $2)
     group by p.id`,
    [ORG_ID, productId ?? null],
  );
  return rows.map((p) => ({
    input: {
      kind: "solution",
      slug: slugify(p.name),
      name: p.name,
      offerings: p.offerings.map((o) => slugify(modelOf(o))),
    },
    links: { product_id: p.id },
  }));
}

type CustomerEnvRow = {
  type: string;
  region: string;
  config: unknown;
  offering: string;
  offering_type: string;
  product: string;
  version: string | null;
};

async function customerRows(db: Db, customerId?: string) {
  return db.query<{
    id: string;
    name: string;
    customer_code: string;
    tenant_id: string | null;
    azure_model: string;
    envs: CustomerEnvRow[];
  }>(
    `select c.id, c.name, c.customer_code, c.tenant_id, c.azure_model,
       coalesce(jsonb_agg(jsonb_build_object('type', e.environment_type, 'region', e.region,
         'config', e.configuration_json, 'offering', o.name, 'offering_type', o.offering_type, 'product', p.name,
         'version', v.version) order by e.environment_type) filter (where e.id is not null), '[]'::jsonb) as envs
     from public.customers c
       left join public.environments e on e.customer_id = c.id
       left join public.offerings o on o.id = e.offering_id
       left join public.products p on p.id = o.product_id
       left join public.offering_versions v on v.id = e.desired_offering_version_id
     where c.organization_id = $1 and ($2::uuid is null or c.id = $2)
     group by c.id`,
    [ORG_ID, customerId ?? null],
  );
}

const installOf = (e: CustomerEnvRow) => ({
  solution: slugify(e.product ?? e.offering),
  offering: slugify(modelOf(e.offering)),
});

async function customerSources(db: Db, customerId?: string): Promise<Source[]> {
  return (await customerRows(db, customerId)).map((c) => ({
    input: {
      kind: "customer",
      slug: c.customer_code,
      name: c.name,
      tenantId: c.tenant_id,
      hosted: c.azure_model === "isv_hosted",
      criticality: c.envs.some((e) => e.offering_type === "regulated") ? "regulated" : "standard",
      environments: c.envs.map((e) => {
        const target = rec(rec(e.config)["target"]);
        const short = ENV_SHORT[e.type] ?? e.type;
        return {
          env: e.type,
          subscriptionId:
            str(target["subscriptionId"]) ?? str(rec(rec(e.config)["inputs"])["subscriptionId"]),
          subscriptionName: str(target["subscription"]) ?? `sub-${c.customer_code}-${short}`,
          installs: [installStem(installOf(e))],
        };
      }),
      offerings: [...new Set(c.envs.map((e) => installStem(installOf(e))))],
    },
    links: { customer_id: c.id },
  }));
}

async function landingZoneSources(db: Db, foundationId?: string): Promise<Source[]> {
  const rows = await db.query<{
    id: string;
    name: string;
    customer_id: string | null;
    customer_code: string | null;
    tenant_id: string | null;
    answers: unknown;
  }>(
    `select f.id, f.name, f.customer_id, c.customer_code, f.tenant_id, f.answers
     from public.foundations f left join public.customers c on c.id = f.customer_id
     where f.organization_id = $1 and f.mode = 'managed' and ($2::uuid is null or f.id = $2)`,
    [ORG_ID, foundationId ?? null],
  );
  return rows.map((f) => {
    const root = str(rec(f.answers)["intermediateRootId"]) ?? slugify(f.name);
    return {
      input: {
        kind: "landing-zone",
        // lz-<tenant>: the customer's code for a customer's tenant, the intermediate root for the ISV's own.
        slug: f.customer_code ?? root,
        name: f.name,
        tenantId: f.tenant_id,
        managementGroupId: root,
        isv: !f.customer_id,
      },
      links: { foundation_id: f.id },
    };
  });
}

async function upsert(db: Db, p: Platform, s: Source): Promise<UnitRow> {
  const spec = resolveUnit(s.input, p);
  const [row] = await db.query<UnitRow>(
    `insert into public.delivery_units
       (organization_id, kind, slug, name, repository, product_id, customer_id, foundation_id, spec)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     on conflict (organization_id, repository) do update set
       name = excluded.name, spec = excluded.spec,
       product_id = coalesce(excluded.product_id, delivery_units.product_id),
       customer_id = coalesce(excluded.customer_id, delivery_units.customer_id),
       foundation_id = coalesce(excluded.foundation_id, delivery_units.foundation_id),
       updated_at = case when delivery_units.spec = excluded.spec then delivery_units.updated_at else now() end
     returning *`,
    [
      ORG_ID,
      spec.kind,
      spec.slug,
      spec.name,
      spec.repository.name,
      s.links.product_id ?? null,
      s.links.customer_id ?? null,
      s.links.foundation_id ?? null,
      JSON.stringify(spec),
    ],
  );
  return row!;
}

/** Brings every unit's spec up to date with the console's data. Idempotent; keeps request status. */
export async function syncUnits(db: Db) {
  const p = platformFromEnv();
  const sources: Source[] = [
    ...PLATFORM_KINDS.map((kind) => ({ input: { kind } as UnitInput, links: {} })),
    ...(await landingZoneSources(db)),
    ...(await solutionSources(db)),
    ...(await customerSources(db)),
  ];
  for (const s of sources) await upsert(db, p, s);
}

/** The unit for one product, customer or managed landing zone, created or refreshed. */
export async function ensureUnit(db: Db, link: Links): Promise<UnitRow | null> {
  const p = platformFromEnv();
  const [s] = link.product_id
    ? await solutionSources(db, link.product_id)
    : link.customer_id
      ? await customerSources(db, link.customer_id)
      : link.foundation_id
        ? await landingZoneSources(db, link.foundation_id)
        : [];
  return s ? upsert(db, p, s) : null;
}

/** What the unit's repository contains once vending has created it and its first pull request is merged. */
export async function unitFiles(db: Db, row: UnitRow): Promise<ScaffoldFile[]> {
  const p = platformFromEnv();
  const spec = row.spec;
  if (spec.kind === "templates") return deliveryTemplates(p);
  if (spec.kind === "vending") {
    const units = await db.query<UnitRow>(
      "select * from public.delivery_units where organization_id = $1 and status <> 'planned' order by kind, slug",
      [ORG_ID],
    );
    return vendingRepo(
      p,
      units
        .filter((u) => !isPlatformKind(u.kind))
        .map((u) =>
          requestFile(u.spec, {
            requestedBy: u.requested_by ?? "control plane",
            reason: "vending request",
            links: {},
          }),
        ),
    );
  }
  if (spec.kind === "landing-zone" && row.foundation_id) {
    const f = await db.one<{ answers: unknown; library_ref: string; tenant_id: string | null }>(
      "select answers, library_ref, tenant_id from public.foundations where id = $1",
      [row.foundation_id],
    );
    const alz = await import("../alz/engine");
    const answers = alz.withDefaults(f.answers);
    return landingZoneRepo(spec, p, {
      tenantId: f.tenant_id,
      managementGroupId: answers.intermediateRootId,
      libraryRef: f.library_ref,
      answers,
      terraform: alz.terraformFor(f.library_ref, answers),
    });
  }
  if (spec.kind === "solution" && row.product_id) {
    const product = await db.one<{
      name: string;
      category: string | null;
      tags: string[];
      owners: unknown;
      source_url: string | null;
    }>("select name, category, tags, owners, source_url from public.products where id = $1", [
      row.product_id,
    ]);
    const offerings = await db.query<{
      id: string;
      name: string;
      network_profile: string | null;
      supported_regions: string[];
      versions: { version: string; status: string; manifest_json: unknown }[];
    }>(
      `select o.id, o.name, o.network_profile, o.supported_regions,
         coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'status', v.status, 'manifest_json', v.manifest_json)
           order by (v.status = 'published') desc, v.created_at desc) from public.offering_versions v where v.offering_id = o.id), '[]'::jsonb) as versions
       from public.offerings o where o.product_id = $1 order by o.name`,
      [row.product_id],
    );
    const { fromManifest } = await import("../architecture");
    const { offeringTerraform } = await import("../offering/terraform");
    const { ownersOf } = await import("../solutions");
    return solutionRepo(spec, p, {
      owners: ownersOf(product.owners).map((o) => ({ name: o.name, email: o.email, role: o.role })),
      industry: product.category,
      tags: product.tags ?? [],
      source: product.source_url ? { repository: product.source_url } : null,
      offerings: offerings.map((o) => {
        const v = o.versions[0];
        const arch = fromManifest(o, v?.manifest_json ?? {});
        const slug = slugify(modelOf(o.name));
        return {
          slug,
          name: modelOf(o.name),
          version: v?.version ?? "0.0.0",
          manifest: v?.manifest_json ?? {},
          terraform: offeringTerraform({ product: product.name, ...arch }),
          sandbox: {
            location: arch.topology.regions[0] ?? "eastus2",
            install_name: `${spec.slug}-${slug}`.slice(0, 36).replace(/-+$/, ""),
            environment: "dev",
          },
        };
      }),
    });
  }
  if (spec.kind === "customer" && row.customer_id) {
    const [c] = await customerRows(db, row.customer_id);
    if (!c) return [];
    const envs: CustomerEnvironment[] = c.envs.map((e) => {
      const config = rec(e.config);
      const target = rec(config["target"]);
      const short = ENV_SHORT[e.type] ?? e.type;
      const inputs = rec(config["inputs"]);
      return {
        env: e.type,
        ...installOf(e),
        version: e.version ?? "0.0.0",
        digest: null,
        region: e.region,
        target:
          str(target["target"]) ??
          (c.azure_model === "isv_hosted" ? "new_subscription" : "existing_subscription"),
        subscriptionId: str(target["subscriptionId"]) ?? str(inputs["subscriptionId"]),
        subscriptionName: str(target["subscription"]) ?? `sub-${c.customer_code}-${short}`,
        resourceGroup: str(target["resourceGroup"]) ?? `rg-${c.customer_code}-${short}`,
        managementGroup: str(target["managementGroup"]),
        variables: {
          install_name: `${c.customer_code}-${short}`,
          environment: short,
          location: e.region,
          ...Object.fromEntries(
            Object.entries(inputs)
              .filter(([k, v]) => k !== "subscriptionId" && v !== "" && v !== null)
              .map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), v]),
          ),
        },
      };
    });
    return customerRepo(spec, p, {
      code: c.customer_code,
      tenantId: c.tenant_id,
      hosted: c.azure_model === "isv_hosted",
      connection: c.azure_model === "isv_hosted" ? "isv_hosted" : "federated_identity",
      environments: envs,
    });
  }
  if (spec.kind === "modules")
    return [
      {
        path: "README.md",
        content: `# cd-modules\n\nShared service modules and policy packs. Each module is released with a SemVer tag\n(\`modules/<name>/vX.Y.Z\`, Azure Verified Modules rules) and consumers pin exact versions.\n`,
      },
    ];
  return [
    {
      path: "README.md",
      content: `# cd-control-plane\n\nThe Cloud Delivery console: this repository. It releases on vX.Y.Z tags (built once, attested)\nand holds no rights in any landing zone or customer estate; it acts through pull requests.\n`,
    },
  ];
}

async function github<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = process.env["CD_GITHUB_TOKEN"];
  const res = await fetch(`https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "cloud-delivery-vending",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok)
    throw new Error(
      `GitHub ${init.method ?? "GET"} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  return (await res.json()) as T;
}

export const vendingConfigured = () => !!process.env["CD_GITHUB_TOKEN"];

/**
 * Writes the unit's vending request. With CD_GITHUB_TOKEN (a GitHub App installation token with contents and
 * pull-request write on cd-vending) it opens the pull request; otherwise the request is recorded for someone to
 * commit, and nothing outside the console changes.
 */
export async function requestVending(
  db: Db,
  row: UnitRow,
  requestedBy: string,
): Promise<{ status: string; url: string | null; path: string; content: string }> {
  const p = platformFromEnv();
  const file = requestFile(row.spec, {
    requestedBy,
    reason: `${row.spec.name} (${row.kind}) needs its own repository, environments, identities and state.`,
    links: Object.fromEntries(
      Object.entries({
        product: row.product_id,
        customer: row.customer_id,
        foundation: row.foundation_id,
      }).filter(([, v]) => v),
    ) as Record<string, string>,
  });
  let url: string | null = null;
  if (vendingConfigured()) {
    const repo = `${p.org}/${process.env["CD_VENDING_REPO"] ?? "cd-vending"}`;
    const meta = await github<{ default_branch: string }>(`/repos/${repo}`);
    const base = await github<{ object: { sha: string } }>(
      `/repos/${repo}/git/ref/heads/${meta.default_branch}`,
    );
    const branch = `vend/${row.kind}-${row.slug}-${Date.now().toString(36)}`;
    await github(`/repos/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
    });
    const existing = await github<{ sha: string }>(
      `/repos/${repo}/contents/${file.path}?ref=${meta.default_branch}`,
    ).catch(() => null);
    await github(`/repos/${repo}/contents/${file.path}`, {
      method: "PUT",
      body: {
        message: `Vend ${row.repository}`,
        content: Buffer.from(file.content).toString("base64"),
        branch,
        ...(existing ? { sha: existing.sha } : {}),
      },
    });
    const pr = await github<{ html_url: string }>(`/repos/${repo}/pulls`, {
      method: "POST",
      body: {
        title: `Vend ${row.repository}`,
        head: branch,
        base: meta.default_branch,
        body: `Requested by ${requestedBy} from Cloud Delivery.\n\nCreates \`${p.org}/${row.repository}\` with ${row.spec.environments.length} environments, ${row.spec.identities.length} identities and ${row.spec.state.length} state keys. Review the request file: it is exactly what vending applies.`,
      },
    });
    url = pr.html_url;
  }
  const status = url ? "vending" : "requested";
  await db.query(
    `update public.delivery_units set status = $2, request_path = $3, request_url = $4, requested_by = $5,
       requested_at = now(), updated_at = now() where id = $1`,
    [row.id, status, requestPath(row.spec), url, requestedBy],
  );
  await db.insert("audit_events", {
    organization_id: ORG_ID,
    actor_name: requestedBy,
    event_type: "delivery_unit.vending_requested",
    resource_type: "delivery_unit",
    resource_id: row.repository,
    new_value: { status, request: requestPath(row.spec), url } as never,
    result: "success",
    metadata_json: {} as never,
  });
  return { status, url, path: file.path, content: file.content };
}

/**
 * Called when the console creates a solution, customer or landing zone: record the unit and file its vending
 * request. Never fails the caller: a unit that breaks the isolation rules, or a GitHub error, stays "planned"
 * with the reason logged, and can be requested again from Delivery units.
 */
export async function ensureAndRequest(db: Db, link: Links, requestedBy: string) {
  try {
    const row = await ensureUnit(db, link);
    if (!row) return null;
    const { isolationFindings } = await import("./model");
    const findings = isolationFindings(row.spec);
    if (findings.length) {
      console.warn(`[delivery] ${row.repository} not requested: ${findings.join(" ")}`);
      return { unit: row, requested: false as const, reason: findings.join(" ") };
    }
    const r = await requestVending(db, row, requestedBy);
    return { unit: row, requested: true as const, url: r.url };
  } catch (e) {
    console.error("[delivery] vending request failed:", (e as Error).message);
    return null;
  }
}
