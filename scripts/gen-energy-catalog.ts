/*
 * The bundled solution catalog: real Microsoft solutions for energy and oil and gas, imported the same way the
 * console's "Submit a solution" does: each repository is inspected at a pinned commit, its Azure services mapped
 * from the infrastructure code, and its checks recorded. Curated content lives in energy-catalog.entries.ts.
 *
 *   bun scripts/gen-energy-catalog.ts [db/migrations/NNNN_name.sql]
 *
 * Writes db/seed/0005_product_catalog.sql (fresh databases) and, given a migration path, that migration (existing
 * databases). Rows are upserts keyed on fixed ids, so a new migration brings an existing catalog up to date.
 * Inspections are cached in scripts/.catalog-cache/ (gitignored) to spare GitHub's anonymous rate limit; delete it
 * to re-inspect.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { slugOf, toManifest, type BlueprintSource } from "../src/lib/architecture";
import {
  type CatalogInspection,
  type ImportCheck,
  inspectUncached,
} from "../src/lib/catalog-import.functions";
import { type Topology, normalise, withDefaults } from "../src/lib/catalog";
import type { CuratedStory } from "../src/lib/solution-story";
import { ENTRIES } from "./energy-catalog.entries";

const ORG = "11111111-1111-1111-1111-111111111111";
const CACHE = "scripts/.catalog-cache";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const id = (kind: number, n: number) =>
  `33333333-3333-4333-8333-${kind}${String(n).padStart(11, "0")}`;
const guard = `where exists (select 1 from public.organizations where id = ${q(ORG)})`;

async function inspect(url: string): Promise<CatalogInspection> {
  const file = `${CACHE}/${url.replace(/[^a-z0-9]+/gi, "_")}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as CatalogInspection;
  const inspection = await inspectUncached(url);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(inspection));
  return inspection;
}

/** Repository-relative links in a story, resolved to the imported commit so they never drift. */
const pinned = (repo: CatalogInspection["repository"], path: string, raw: boolean) =>
  /^https?:\/\//.test(path)
    ? path
    : raw
      ? `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.revision}/${path}`
      : `https://github.com/${repo.owner}/${repo.name}/blob/${repo.revision}/${path}`;

const blocks: string[] = [];
if (new Set(ENTRIES.map((e) => e.n)).size !== ENTRIES.length)
  throw new Error("Entry numbers must be unique.");
for (const e of ENTRIES) {
  const n = e.n;
  const releases = [
    ...(e.previous ? [{ tag: e.previous, url: `${e.url}/tree/${e.previous}` }] : []),
    { tag: e.release, url: e.release ? `${e.url}/tree/${e.release}` : e.url },
  ];
  const models = [
    {
      name: "Customer Hosted",
      type: "customer_hosted",
      landing: "dedicated-spoke" as const,
      description: "Deployed into the customer's own subscription.",
    },
    ...(e.hosted
      ? [
          {
            name: "Hosted",
            type: "saas_connected",
            landing: "isv-hosted" as const,
            description:
              "A dedicated subscription per customer in your Azure. The customer needs no Azure of their own.",
          },
        ]
      : []),
  ];
  const inspected = [];
  for (const r of releases) inspected.push({ r, inspection: await inspect(r.url) });
  const latest = inspected.at(-1)!;
  const repo = latest.inspection.repository;
  const sql: string[] = [];
  let publish = false;
  let latestVersion = "";

  for (const [m, model] of models.entries()) {
    sql.push(`insert into public.offerings (id, product_id, name, description, offering_type, deployment_boundary, network_profile, security_profile, supported_regions, status)
select ${q(id(2, n * 10 + m))}, ${q(id(1, n))}, ${q(`${e.name} · ${model.name}`)}, ${q(model.description)}, ${q(model.type)}, ${q(model.landing === "isv-hosted" ? "subscription" : "resource-group")}, ${q(model.landing)}, 'imported-reviewed', '{eastus2}'::text[], 'active'
${guard}
on conflict (id) do update set name = excluded.name, description = excluded.description;`);
    for (const [k, { r, inspection }] of inspected.entries()) {
      const at = inspection.repository;
      const changed = at.committedAt ?? new Date().toISOString();
      const version = r.tag
        ? r.tag.replace(/^v/, "")
        : `${changed.slice(0, 4)}.${Number(changed.slice(5, 7))}.${Number(changed.slice(8, 10))}`;
      const topology: Topology = {
        landing: model.landing,
        landingZone: "online",
        publicAccess: false,
        privateEndpoints: true,
        regions: ["eastus2"],
        environments: ["development", "test", "production"],
      };
      const selected = normalise(
        [...inspection.architecture.services.map((x) => x.id), ...(e.consumes ?? [])].map((x) =>
          withDefaults(x),
        ),
        topology,
      );
      const isLatest = k === inspected.length - 1;
      const ageMonths = (Date.now() - Date.parse(changed)) / (30 * 24 * 3600_000);
      const checks: ImportCheck[] = [
        ...inspection.checks,
        ...(e.caveats ?? []),
        // A release tag dates the release, not the repository; only a branch pin says how fresh the code is.
        ...(isLatest && !r.tag && ageMonths > 9
          ? [
              {
                id: "activity",
                level: "warning" as const,
                title: `Last changed ${changed.slice(0, 10)}`,
                detail:
                  "Check the repository is still maintained before relying on it in production.",
              },
            ]
          : []),
      ];
      const source: BlueprintSource = {
        repository: at.url,
        revision: at.revision,
        ref: at.ref,
        path: at.path,
        iac: inspection.implementation.driver,
        pipeline: inspection.implementation.pipeline,
        entrypoints: inspection.implementation.entrypoints,
        ...(inspection.implementation.orchestrator
          ? { orchestrator: inspection.implementation.orchestrator }
          : {}),
        imported: true,
        license: {
          status: "detected",
          ...(at.license ? { identifier: at.license } : {}),
          redistributionAllowed: !!at.license,
        },
      };
      const manifest = {
        ...toManifest(slugOf(`${e.name} ${model.name}`), version, { selected, topology }, source),
        catalogImport: {
          schemaVersion: "1.0",
          inspectedAt: new Date().toISOString(),
          checks,
          azureResourceTypes: inspection.architecture.azureResourceTypes,
          unmappedResourceTypes: inspection.architecture.unmappedResourceTypes,
        },
      };
      const ok = e.publish && !checks.some((c) => c.level === "blocking");
      if (isLatest) {
        publish = ok;
        latestVersion = version;
      }
      sql.push(`insert into public.offering_versions (id, offering_id, version, status, manifest_json, release_notes, published_at, created_by)
select ${q(id(3, n * 100 + m * 10 + k))}, ${q(id(2, n * 10 + m))}, ${q(version)}, ${q(ok ? "published" : "draft")}, ${json(manifest)}, ${q(`${r.tag ? `Release ${r.tag}` : "Imported"} from ${at.url} at ${at.revision}.`)}, ${ok ? `${q(changed)}::timestamptz` : "null"}, 'Cloud Delivery catalog'
${guard}
on conflict (id) do update set manifest_json = excluded.manifest_json, release_notes = excluded.release_notes,
  status = case when offering_versions.status = 'draft' then excluded.status else offering_versions.status end,
  published_at = coalesce(offering_versions.published_at, excluded.published_at);`);
    }
  }

  const story: CuratedStory | null = e.story
    ? {
        ...e.story,
        diagrams: (e.story.diagrams ?? []).map((d) => ({
          title: d.title,
          url: pinned(repo, d.path, true),
          ...(d.caption ? { caption: d.caption } : {}),
        })),
        ...(e.story.deploy
          ? {
              deploy: {
                ...e.story.deploy,
                ...(e.story.deploy.guide
                  ? { guide: pinned(repo, e.story.deploy.guide, false) }
                  : {}),
              },
            }
          : {}),
      }
    : null;
  const maturity = !publish ? "community" : e.featured ? "featured" : "validated";
  const owners = [
    { name: "Microsoft", email: "", role: "Product team", team: `github.com/${repo.owner}` },
  ];
  blocks.push(
    [
      `-- ${e.name}: ${e.url} @ ${repo.revision.slice(0, 12)}`,
      `insert into public.products (id, organization_id, name, description, category, audience, outcome, tags, owners, maturity, source_url, support_url, story, license_attested, submitted_by, owner_confirmed_at, validated_at)
select ${q(id(1, n))}, ${q(ORG)}, ${q(e.name)}, ${q(e.description)}, ${q(e.category)}, ${q(e.audience)}, ${q(e.outcome)}, ${q(`{${e.tags.join(",")}}`)}::text[], ${json(owners)}, ${q(maturity)}, ${q(repo.url)}, ${e.supportUrl ? q(e.supportUrl) : "null"}, ${story ? json(story) : "null"}, false, 'Cloud Delivery catalog', now(), ${publish ? "now()" : "null"}
${guard}
on conflict (id) do update set name = excluded.name, description = excluded.description, category = excluded.category,
  audience = excluded.audience, outcome = excluded.outcome, tags = excluded.tags, source_url = excluded.source_url,
  support_url = excluded.support_url, story = excluded.story,
  maturity = case when products.maturity = 'featured' then products.maturity else excluded.maturity end,
  validated_at = coalesce(products.validated_at, excluded.validated_at);`,
      ...sql,
    ].join("\n"),
  );
  console.log(
    `${maturity.padEnd(9)} ${e.name} v${latestVersion} · ${models.map((m) => m.name).join(" + ")} · ${releases.length} release(s) · ${latest.inspection.architecture.services.length} services${latest.inspection.architecture.unmappedResourceTypes.length ? ` · unmapped: ${latest.inspection.architecture.unmappedResourceTypes.join(", ")}` : ""}`,
  );
}

const header = `-- Generated by scripts/gen-energy-catalog.ts. Do not edit by hand.
-- Real Microsoft solutions for energy and oil and gas, each imported from its repository at a pinned commit.
`;
const inserts = blocks.join("\n\n");
writeFileSync("db/seed/0005_product_catalog.sql", `${header}\n${inserts}\n`);

const migration = process.argv[2];
if (migration) {
  const before = existsSync(migration)
    ? readFileSync(migration, "utf8").split("-- BEGIN GENERATED CATALOG")[0]!
    : "";
  writeFileSync(migration, `${before}-- BEGIN GENERATED CATALOG\n${inserts}\n`);
}
