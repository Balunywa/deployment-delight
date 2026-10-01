/*
 * The bundled solution catalog: real Microsoft energy (oil and gas) solutions, imported the same way the console's
 * "Submit a solution" does: each repository is inspected at a pinned commit, its Azure services mapped from the
 * infrastructure code, and its checks recorded. Curated here: names, descriptions and caveats verified against
 * each repository's README and code.
 *
 *   bun scripts/gen-energy-catalog.ts
 *
 * Writes db/seed/0005_product_catalog.sql (fresh databases) and the inserts in
 * db/migrations/0009_energy_catalog.sql (existing ones, after the sample catalog is removed).
 */
import { readFileSync, writeFileSync } from "node:fs";

import { slugOf, toManifest, type BlueprintSource } from "../src/lib/architecture";
import { type ImportCheck, inspectUncached } from "../src/lib/catalog-import.functions";
import { type Topology, normalise, withDefaults } from "../src/lib/catalog";

const ORG = "11111111-1111-1111-1111-111111111111";

type Entry = {
  url: string;
  name: string;
  category: string;
  description: string;
  audience: string;
  outcome: string;
  tags: string[];
  /** Release tag to version from; otherwise the commit date. */
  release?: string;
  /** The release before it, imported too, so there's a real upgrade path. */
  previous?: string;
  /** Self-contained platforms can also run in your own Azure, one subscription per customer. */
  hosted?: boolean;
  supportUrl?: string;
  /** Services the code consumes rather than creates (e.g. an existing ADME instance). */
  consumes?: string[];
  caveats?: ImportCheck[];
  publish: boolean;
};

const ENTRIES: Entry[] = [
  {
    url: "https://github.com/Azure/osdu-developer",
    name: "OSDU Developer Platform",
    category: "Upstream & Resources",
    description:
      "A personal OSDU data platform on AKS for building and testing subsurface applications against well, wellbore, log and seismic data. Cosmos DB, Storage and Key Vault sit behind private endpoints, and Flux deploys the OSDU services.",
    audience: "Subsurface application developers and energy data platform teams",
    outcome:
      "A working OSDU instance to build against, without a full Data Manager for Energy rollout",
    tags: ["osdu", "subsurface", "aks", "gitops"],
    release: "v0.47.0",
    previous: "v0.46.0",
    hosted: true,
    supportUrl: "https://azure.github.io/osdu-developer/",
    caveats: [
      {
        id: "aks-preview",
        level: "warning",
        title: "Uses AKS preview features",
        detail:
          "The README lists the Azure Container Service preview features it needs; register them in the target subscription before deploying.",
      },
    ],
    publish: true,
  },
  {
    url: "https://github.com/microsoft/azure-data-manager-for-energy-experience-lab",
    name: "ADME Experience Lab",
    category: "Upstream & Resources",
    description:
      "Creates an Azure Data Manager for Energy developer-tier instance loaded with the TNO open well and wellbore dataset, with a web portal and Power BI reports to explore it. Built for demos, training and evaluation.",
    audience: "Energy data teams evaluating Azure Data Manager for Energy",
    outcome: "A loaded Data Manager for Energy instance to evaluate with real well data",
    tags: ["adme", "osdu", "tno", "training"],
    hosted: true,
    caveats: [
      {
        id: "non-production",
        level: "warning",
        title: "For non-production use",
        detail: "The README recommends the Experience Lab only for non-production use cases.",
      },
    ],
    publish: true,
  },
  {
    url: "https://github.com/Azure/osdu-spi-stack",
    name: "OSDU on AKS Automatic",
    category: "Upstream & Resources",
    description:
      "Runs OSDU on AKS Automatic with Azure-native services (Cosmos DB, Service Bus, Storage and Key Vault), workload identity, Flux GitOps and multiple data partitions.",
    audience: "Platform teams that operate OSDU themselves",
    outcome: "Azure-native OSDU on managed Kubernetes, with partitions per business unit",
    tags: ["osdu", "aks-automatic", "gitops", "multi-partition"],
    release: "v0.23.0",
    previous: "v0.22.0",
    hosted: true,
    caveats: [
      {
        id: "non-production",
        level: "warning",
        title: "Not intended for production deployments",
        detail:
          "Stated in the README. Its spi CLI installs the stack end to end in about 45 to 50 minutes.",
      },
    ],
    publish: true,
  },
  {
    url: "https://github.com/Azure/ADME-Solution-Accelerators/tree/main/artifacts/adminui",
    name: "OSDU Admin UI for ADME",
    category: "Upstream & Resources",
    description:
      "A web console for administering an Azure Data Manager for Energy instance (users and entitlements, legal tags, schemas and data partitions), running privately on Container Apps.",
    audience: "Data Manager for Energy administrators and data managers",
    outcome: "Day-to-day OSDU administration without hand-written REST calls",
    tags: ["adme", "osdu", "administration"],
    supportUrl:
      "https://learn.microsoft.com/azure/energy-data-services/how-to-deploy-osdu-admin-ui",
    consumes: ["adme-connection"],
    publish: true,
  },
  {
    url: "https://github.com/Azure/osdu-data-load-tno",
    name: "OSDU TNO Data Loader",
    category: "Upstream & Resources",
    description:
      "Loads the TNO open subsurface dataset (wells, wellbores, logs and their files) into an OSDU or Azure Data Manager for Energy instance as a Container Apps job, creating legal tags and manifests in dependency order.",
    audience: "Teams standing up OSDU for testing, training and demos",
    outcome: "A populated OSDU instance with reference well data",
    tags: ["osdu", "adme", "tno", "data-load"],
    consumes: ["adme-connection"],
    publish: true,
  },
  {
    url: "https://github.com/Azure-Samples/azure-data-manager-for-energy-openai-demo",
    name: "Well Data Chat with Azure OpenAI",
    category: "Upstream & Resources",
    description:
      "Chat over fields, wells, wellbores, logs and trajectories held in Azure Data Manager for Energy. Databricks prepares the data, Azure AI Search indexes it, and Azure OpenAI answers questions with sources.",
    audience: "Geoscientists and engineers exploring well data",
    outcome: "Answers about wells in plain language, grounded in ADME data",
    tags: ["adme", "generative-ai", "openai", "search"],
    consumes: ["adme-connection"],
    caveats: [
      {
        id: "retired-models",
        level: "blocking",
        title: "Default models are retired",
        detail:
          "infra/main.bicep defaults to text-davinci-003 and gpt-35-turbo, which Azure OpenAI no longer deploys. Set current models before it can be published.",
      },
    ],
    publish: false,
  },
];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const id = (kind: number, n: number) =>
  `33333333-3333-4333-8333-${kind}${String(n).padStart(11, "0")}`;

async function commitDate(owner: string, repo: string, sha: string) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "cloud-delivery" },
  });
  const c = (await r.json()) as { commit?: { committer?: { date?: string } } };
  return c.commit?.committer?.date ?? new Date().toISOString();
}

const blocks: string[] = [];
for (const [i, e] of ENTRIES.entries()) {
  const n = i + 1;
  const releases = [
    ...(e.previous ? [{ tag: e.previous, url: `${e.url}/tree/${e.previous}` }] : []),
    { tag: e.release, url: e.release ? `${e.url}/tree/${e.release}` : e.url },
  ];
  const models = [
    {
      key: "customer",
      name: "Customer Hosted",
      type: "customer_hosted",
      landing: "dedicated-spoke",
    },
    ...(e.hosted
      ? [{ key: "hosted", name: "Hosted", type: "saas_connected", landing: "isv-hosted" }]
      : []),
  ] as const;
  const guard = `where exists (select 1 from public.organizations where id = ${q(ORG)})`;
  const owners = [
    {
      name: "Microsoft",
      email: "",
      role: "Product team",
      team: `github.com/${e.url.split("/")[3]}`,
    },
  ];
  const sql: string[] = [];
  let publish = e.publish;
  let latestVersion = "";
  let repoUrl = "";
  let latestRepo = { revision: "", owner: "", name: "" };
  const inspected = [];
  for (const r of releases) {
    const inspection = await inspectUncached(r.url);
    const repo = inspection.repository;
    const changed = await commitDate(repo.owner, repo.name, repo.revision);
    inspected.push({ r, inspection, changed });
  }
  for (const [m, model] of models.entries()) {
    sql.push(`insert into public.offerings (id, product_id, name, description, offering_type, deployment_boundary, network_profile, security_profile, supported_regions, status)
select ${q(id(2, n * 10 + m))}, ${q(id(1, n))}, ${q(`${e.name} · ${model.name}`)}, ${q(model.landing === "isv-hosted" ? "A dedicated subscription per customer in your Azure. The customer needs no Azure of their own." : "Deployed into the customer's own subscription.")}, ${q(model.type)}, ${q(model.landing === "isv-hosted" ? "subscription" : "resource-group")}, ${q(model.landing)}, 'imported-reviewed', '{eastus2}'::text[], 'active'
${guard}
on conflict (id) do nothing;`);
    for (const [k, { r, inspection, changed }] of inspected.entries()) {
      const repo = inspection.repository;
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
      const ageMonths = (Date.now() - Date.parse(changed)) / (30 * 24 * 3600_000);
      const latest = k === inspected.length - 1;
      const checks: ImportCheck[] = [
        ...inspection.checks,
        ...(e.caveats ?? []),
        // A release tag dates the release, not the repository; only a branch pin says how fresh the code is.
        ...(latest && !r.tag && ageMonths > 9
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
        repository: repo.url,
        revision: repo.revision,
        ref: repo.ref,
        path: repo.path,
        iac: inspection.implementation.driver,
        pipeline: inspection.implementation.pipeline,
        entrypoints: inspection.implementation.entrypoints,
        ...(inspection.implementation.orchestrator
          ? { orchestrator: inspection.implementation.orchestrator }
          : {}),
        imported: true,
        license: {
          status: "detected",
          ...(repo.license ? { identifier: repo.license } : {}),
          redistributionAllowed: !!repo.license,
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
      if (latest) {
        publish = ok;
        latestVersion = version;
        repoUrl = repo.url;
        latestRepo = { revision: repo.revision, owner: repo.owner, name: repo.name };
      }
      sql.push(`insert into public.offering_versions (id, offering_id, version, status, manifest_json, release_notes, published_at, created_by)
select ${q(id(3, n * 100 + m * 10 + k))}, ${q(id(2, n * 10 + m))}, ${q(version)}, ${q(ok ? "published" : "draft")}, ${json(manifest)}, ${q(`${r.tag ? `Release ${r.tag}` : "Imported"} from ${repo.url} at ${repo.revision}.`)}, ${ok ? `${q(changed)}::timestamptz` : "null"}, 'Cloud Delivery catalog'
${guard}
on conflict (id) do nothing;`);
    }
  }
  blocks.push(
    [
      `-- ${e.name}: ${e.url} @ ${latestRepo.revision.slice(0, 12)}`,
      `insert into public.products (id, organization_id, name, description, category, audience, outcome, tags, owners, maturity, source_url, support_url, license_attested, submitted_by, owner_confirmed_at, validated_at)
select ${q(id(1, n))}, ${q(ORG)}, ${q(e.name)}, ${q(e.description)}, ${q(e.category)}, ${q(e.audience)}, ${q(e.outcome)}, ${q(`{${e.tags.join(",")}}`)}::text[], ${json(owners)}, ${q(publish ? "validated" : "community")}, ${q(repoUrl)}, ${e.supportUrl ? q(e.supportUrl) : "null"}, false, 'Cloud Delivery catalog', now(), ${publish ? "now()" : "null"}
${guard}
on conflict (id) do nothing;`,
      ...sql,
    ].join("\n"),
  );
  console.log(
    `${publish ? "published" : "draft    "} ${e.name} v${latestVersion} · ${models.map((m) => m.name).join(" + ")} · ${releases.length} release(s)`,
  );
}

const header = `-- Generated by scripts/gen-energy-catalog.ts. Do not edit by hand.
-- Real Microsoft energy (oil and gas) solutions, each imported from its repository at a pinned commit.
`;
const inserts = blocks.join("\n\n");
writeFileSync("db/seed/0005_product_catalog.sql", `${header}\n${inserts}\n`);

const migration = "db/migrations/0009_energy_catalog.sql";
const purge = readFileSync(migration, "utf8").split("-- BEGIN GENERATED CATALOG")[0]!;
writeFileSync(migration, `${purge}-- BEGIN GENERATED CATALOG\n${inserts}\n`);
