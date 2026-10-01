import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { slugOf, toManifest, type BlueprintSource } from "./architecture";
import { SERVICE_BY_ID, normalise, withDefaults, type Topology } from "./catalog";
import { ownerSchema, withSubmitter } from "./solutions";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const MAX_SOURCE_FILES = 40;
const MAX_SOURCE_BYTES = 1_500_000;

export type ImportCheck = {
  id: string;
  level: "pass" | "warning" | "blocking";
  title: string;
  detail: string;
};

export type CatalogInspection = {
  repository: {
    url: string;
    owner: string;
    name: string;
    description: string;
    revision: string;
    /** When the pinned commit was made. */
    committedAt: string | null;
    ref: string;
    path: string;
    license: string | null;
  };
  implementation: {
    driver: BlueprintSource["iac"];
    entrypoints: string[];
    orchestrator: string | null;
    pipeline: BlueprintSource["pipeline"];
  };
  architecture: {
    services: { id: string; name: string; evidence: string[] }[];
    azureResourceTypes: string[];
    unmappedResourceTypes: string[];
  };
  checks: ImportCheck[];
  counts: { files: number; inspectedFiles: number };
};

type GitHubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  license: { spdx_id: string | null; name: string } | null;
};
type GitHubTree = {
  truncated: boolean;
  tree: { path: string; type: "blob" | "tree"; size?: number; url: string }[];
};
type GitHubCommit = { sha: string; commit?: { committer?: { date?: string } } };
type GitHubBlob = { encoding: string; content: string; size: number };

const importInput = z.object({
  repositoryUrl: z.string().url().max(500),
});

function parseRepositoryUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com")
    throw new Error("Use an HTTPS github.com repository URL.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("The repository URL must include an owner and repository.");
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo))
    throw new Error("The GitHub owner or repository name is invalid.");
  const tree = parts[2] === "tree";
  return {
    owner,
    repo,
    ref: tree ? parts[3] || undefined : undefined,
    path: tree ? parts.slice(4).join("/") : "",
  };
}

async function githubFetch(path: string, token: string | undefined) {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "cloud-delivery-catalog-importer",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

async function github<T>(path: string): Promise<T> {
  const token = process.env["GITHUB_TOKEN"];
  let response = await githubFetch(path, token);
  // A token can be refused where anonymous access works, e.g. a public repository in an organization that
  // enforces SAML single sign-on the token isn't authorized for. Public sources shouldn't depend on it.
  let tokenRefused = "";
  if (token && (response.status === 401 || response.status === 403)) {
    tokenRefused = await response
      .clone()
      .json()
      .then((b: { message?: string }) => b.message ?? "")
      .catch(() => "");
    response = await githubFetch(path, undefined);
  }
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const detail = await response
      .json()
      .then((b: { message?: string }) => b.message ?? "")
      .catch(() => "");
    const reason =
      response.status === 404
        ? "Repository or revision not found, or the repository is private."
        : response.status === 403 && remaining === "0"
          ? tokenRefused
            ? `GitHub refused the configured token (${tokenRefused.replace(/\.+$/, "")}) and the anonymous rate limit is used up. Authorize the token for this organization, or try again later.`
            : "GitHub API rate limit reached. Configure GITHUB_TOKEN and try again."
          : `GitHub returned ${response.status}${detail ? `: ${detail}` : ""}.`;
    throw new Error(reason);
  }
  return (await response.json()) as T;
}

const sourceFileScore = (path: string) => {
  const p = path.toLowerCase();
  if (/(^|\/)(main|azuredeploy|maintemplate)\.(bicep|json|tf)$/.test(p)) return 100;
  if (/\.(bicep|tf)$/.test(p)) return 80;
  if (/deploy[^/]*\.ps1$/.test(p)) return 70;
  // Setup scripts often create the core resource (e.g. an az CLI call), so they're architecture evidence too.
  if (/\.(sh|ps1)$/.test(p)) return 40;
  if (/dockerfile$|compose.*\.ya?ml$/.test(p)) return 60;
  if (/(^|\/)readme\.md$/.test(p)) return 50;
  if (/package\.json$|requirements.*\.txt$|pyproject\.toml$/.test(p)) return 30;
  if (/\.github\/workflows\/.*\.ya?ml$/.test(p)) return 20;
  return 0;
};

/**
 * Reads the most architecture-relevant files at the pinned commit. Contents come from raw.githubusercontent.com,
 * which isn't subject to the REST API's rate limit, so a large repository can be inspected in depth.
 */
async function readSourceFiles(
  files: GitHubTree["tree"],
  at: { owner: string; repo: string; sha: string },
) {
  const candidates = files
    .filter((f) => f.type === "blob" && (f.size ?? 0) <= MAX_SOURCE_BYTES)
    .map((f) => ({ ...f, score: sourceFileScore(f.path) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || (a.size ?? 0) - (b.size ?? 0))
    .slice(0, MAX_SOURCE_FILES);
  const loaded = await Promise.all(
    candidates.map(async (file) => {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${at.owner}/${at.repo}/${at.sha}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
        { signal: AbortSignal.timeout(20_000) },
      ).catch(() => null);
      if (raw?.ok) return { path: file.path, content: await raw.text() };
      const blob = await github<GitHubBlob>(new URL(file.url).pathname);
      if (blob.encoding !== "base64")
        throw new Error(`Unsupported GitHub blob encoding: ${blob.encoding}`);
      return {
        path: file.path,
        content: Buffer.from(blob.content.replace(/\s/g, ""), "base64").toString("utf8"),
      };
    }),
  );
  return loaded;
}

const TERRAFORM_SERVICES: Record<string, string> = {
  azurerm_kubernetes_cluster: "aks",
  azurerm_linux_web_app: "app-service",
  azurerm_windows_web_app: "app-service",
  azurerm_container_app_environment: "container-apps",
  azurerm_postgresql_flexible_server: "postgres",
  azurerm_mssql_server: "sql",
  azurerm_cosmosdb_account: "cosmos",
  azurerm_storage_account: "storage",
  azurerm_redis_enterprise_cluster: "redis",
  azurerm_cognitive_account: "ai-foundry",
  azurerm_search_service: "ai-search",
  azurerm_kusto_cluster: "data-explorer",
  azurerm_iothub: "iot-hub",
  azurerm_eventhub_namespace: "event-hubs",
  azurerm_servicebus_namespace: "service-bus",
  azurerm_api_management: "apim",
  azurerm_application_gateway: "app-gateway",
  azurerm_cdn_frontdoor_profile: "front-door",
  azurerm_key_vault: "key-vault",
  azurerm_application_insights: "app-insights",
};

// Resource types that are part of a catalog service without being its primary resource type.
const ARM_ALIASES: Record<string, string> = {
  "microsoft.app/jobs": "container-apps",
  "microsoft.app/containerapps": "container-apps",
  "microsoft.web/serverfarms": "app-service",
  "microsoft.operationalinsights/workspaces": "monitoring",
  "microsoft.insights/actiongroups": "monitoring",
  "microsoft.insights/metricalerts": "monitoring",
  "microsoft.insights/scheduledqueryrules": "monitoring",
  "microsoft.insights/datacollectionrules": "monitoring",
  "microsoft.portal/dashboards": "monitoring",
  "microsoft.app/environments": "container-apps",
  "microsoft.kubernetesconfiguration/extensions": "aks",
  "microsoft.kubernetesconfiguration/fluxconfigurations": "aks",
  "microsoft.network/privatednszones": "private-endpoints",
  "microsoft.network/privatednszones/virtualnetworklinks": "private-endpoints",
  "microsoft.network/networksecuritygroups": "network-spoke",
  "microsoft.network/natgateways": "network-spoke",
  "microsoft.network/publicipaddresses": "network-spoke",
  "microsoft.network/dnszones": "network-spoke",
  "microsoft.databricks/accessconnectors": "databricks",
  "microsoft.insights/workbooks": "monitoring",
  "microsoft.eventgrid/topics": "event-grid",
  "microsoft.eventgrid/namespaces": "event-grid",
};

const IGNORED_ARM_TYPES = [
  "microsoft.resources/deployments",
  "microsoft.resources/deploymentscripts",
  "microsoft.authorization/roleassignments",
  "microsoft.authorization/roledefinitions",
  "microsoft.managedidentity/userassignedidentities",
  "microsoft.network/virtualnetworks",
  "microsoft.network/privateendpoints",
  "microsoft.insights/diagnosticsettings",
  "microsoft.authorization/locks",
  "microsoft.network/availabledelegations",
  "microsoft.resources/templatespecs",
  "microsoft.resources/tags",
  // Not resource types: "Microsoft.Template/..." appears in deployment links and metadata.
  "microsoft.template/",
];

function analyzeArchitecture(sources: { path: string; content: string }[]) {
  const evidence = new Map<string, Set<string>>();
  const armTypes = new Set<string>();
  const add = (id: string, path: string) => {
    if (!SERVICE_BY_ID.has(id)) return;
    const paths = evidence.get(id) ?? new Set<string>();
    paths.add(path);
    evidence.set(id, paths);
  };
  for (const source of sources) {
    for (const match of source.content.matchAll(/Microsoft\.[A-Za-z0-9.]+\/[A-Za-z0-9./-]+/g)) {
      const type = match[0]!.split("@")[0]!.replace(/[./-]+$/, "");
      armTypes.add(type);
      const lower = type.toLowerCase();
      const exact = [...SERVICE_BY_ID.values()].find((service) => {
        const resourceType = service.resourceType.toLowerCase();
        return lower === resourceType || lower.startsWith(`${resourceType}/`);
      });
      if (exact) add(exact.id, source.path);
      else if (ARM_ALIASES[lower]) add(ARM_ALIASES[lower]!, source.path);
    }
    for (const [terraformType, serviceId] of Object.entries(TERRAFORM_SERVICES))
      if (source.content.includes(terraformType)) add(serviceId, source.path);
    // Azure Verified Modules name the resource by module path (br/public:avm/res/fabric/capacity:0.1.0)
    // rather than by resource type.
    for (const service of SERVICE_BY_ID.values())
      if (service.avm.startsWith("avm/res/") && source.content.includes(`${service.avm}:`))
        add(service.id, source.path);
  }
  const mappedArmTypes = [...SERVICE_BY_ID.values()].map((service) =>
    service.resourceType.toLowerCase(),
  );
  const unmapped = [...armTypes].filter((type) => {
    const lower = type.toLowerCase();
    return (
      !mappedArmTypes.some((mapped) => lower === mapped || lower.startsWith(`${mapped}/`)) &&
      !ARM_ALIASES[lower] &&
      !IGNORED_ARM_TYPES.some((ignored) => lower.startsWith(ignored))
    );
  });
  return {
    services: [...evidence.entries()].map(([id, paths]) => ({
      id,
      name: SERVICE_BY_ID.get(id)!.name,
      evidence: [...paths].slice(0, 3),
    })),
    azureResourceTypes: [...armTypes].sort(),
    unmappedResourceTypes: unmapped.sort(),
  };
}

// Inspecting reads up to ~20 GitHub API calls; the wizard's Inspect and Submit steps share one result.
const INSPECTION_TTL_MS = 10 * 60_000;
const inspections = new Map<string, { at: number; value: Promise<CatalogInspection> }>();

function inspect(repositoryUrl: string): Promise<CatalogInspection> {
  const key = repositoryUrl.trim().replace(/\/+$/, "").toLowerCase();
  const hit = inspections.get(key);
  if (hit && Date.now() - hit.at < INSPECTION_TTL_MS) return hit.value;
  const value = inspectUncached(repositoryUrl);
  inspections.set(key, { at: Date.now(), value });
  value.catch(() => inspections.delete(key));
  for (const [k, v] of inspections)
    if (Date.now() - v.at >= INSPECTION_TTL_MS) inspections.delete(k);
  return value;
}

export async function inspectUncached(repositoryUrl: string): Promise<CatalogInspection> {
  const parsed = parseRepositoryUrl(repositoryUrl);
  const repo = await github<GitHubRepo>(`/repos/${parsed.owner}/${parsed.repo}`);
  const ref = parsed.ref ?? repo.default_branch;
  const [commit, tree] = await Promise.all([
    github<GitHubCommit>(
      `/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(ref)}`,
    ),
    github<GitHubTree>(
      `/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    ),
  ]);
  const prefix = parsed.path ? `${parsed.path.replace(/\/+$/, "")}/` : "";
  const scoped = tree.tree.filter((file) => !prefix || file.path.startsWith(prefix));
  if (!scoped.length)
    throw new Error(`No files were found under ${parsed.path || "the repository"}.`);
  const sources = await readSourceFiles(scoped, {
    owner: parsed.owner,
    repo: parsed.repo,
    sha: commit.sha,
  });
  const paths = scoped.map((file) => file.path);
  const lowerPaths = paths.map((path) => path.toLowerCase());
  const bicep = paths.filter((path) => path.toLowerCase().endsWith(".bicep"));
  const arm = paths.filter((path) => /(^|\/)(azuredeploy|maintemplate).*\.json$/i.test(path));
  const terraform = paths.filter((path) => path.toLowerCase().endsWith(".tf"));
  const containers = paths.filter((path) =>
    /(^|\/)dockerfile$|(^|\/)(docker-)?compose.*\.ya?ml$/i.test(path),
  );
  const driver: BlueprintSource["iac"] = terraform.length
    ? "terraform"
    : bicep.length
      ? "bicep"
      : arm.length
        ? "arm"
        : containers.length
          ? "container"
          : "application";
  const entrypoints = (
    driver === "terraform"
      ? terraform
      : driver === "bicep"
        ? bicep
        : driver === "arm"
          ? arm
          : containers
  )
    .sort((a, b) => sourceFileScore(b) - sourceFileScore(a))
    .slice(0, 8);
  const orchestrator =
    paths.find((path) => /(^|\/)deploy[^/]*\.ps1$/i.test(path)) ??
    paths.find((path) => /(^|\/)deploy[^/]*\.(sh|py)$/i.test(path)) ??
    null;
  const pipeline: BlueprintSource["pipeline"] = lowerPaths.some((path) =>
    path.startsWith(".github/workflows/"),
  )
    ? "github-actions"
    : lowerPaths.some((path) => /(^|\/)azure-pipelines.*\.ya?ml$/.test(path))
      ? "azure-devops"
      : "external";
  const architecture = analyzeArchitecture(sources);
  const sourceText = sources.map((source) => source.content).join("\n");
  const license =
    repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : null;
  // Only what runs when it deploys: validation, test, docs and CI helpers don't ship to a customer.
  const deployText = sources
    .filter(
      (source) =>
        !/(^|\/)(tests?|docs?|\.github)\/|(^|\/)[^/]*(validate|lint|test)[^/]*\.(sh|ps1|py)$/i.test(
          source.path,
        ),
    )
    .map((source) => source.content)
    .join("\n");
  const mutableRefs = [
    ...deployText.matchAll(
      /releases\/download\/(?:latest|app-latest)\b[^\s"']*|raw\.githubusercontent\.com\/[^\s"']+?\/(?:refs\/heads\/)?main\/[^\s"']*/gi,
    ),
  ].map((m) => m[0]);
  // The catalog pins this repository's commit; its own main-branch links are a pinning gap to fix, not an
  // untrusted artifact. Anything from elsewhere stays blocking.
  const own = new RegExp(`raw\\.githubusercontent\\.com/${parsed.owner}/${parsed.repo}/`, "i");
  const selfRefs = mutableRefs.filter((r) => own.test(r));
  const mutableArtifact = mutableRefs.length > selfRefs.length;
  const checks: ImportCheck[] = [
    {
      id: "source",
      level: "pass",
      title: "Repository and revision resolved",
      detail: `${repo.full_name} at ${commit.sha.slice(0, 12)}; imports always pin the full commit.`,
    },
    entrypoints.length
      ? {
          id: "implementation",
          level: "pass",
          title: `${driver} implementation detected`,
          detail: entrypoints.slice(0, 3).join(", "),
        }
      : {
          id: "implementation",
          level: "blocking",
          title: "No deployable implementation detected",
          detail: "Add Terraform, Bicep, an ARM template, or a container definition.",
        },
    architecture.services.length
      ? {
          id: "architecture",
          level: "pass",
          title: `${architecture.services.length} platform services mapped`,
          detail: architecture.services.map((service) => service.name).join(", "),
        }
      : {
          id: "architecture",
          level: "blocking",
          title: "No platform services could be mapped",
          detail: "The asset needs an architecture mapping before it can be published.",
        },
    architecture.unmappedResourceTypes.length
      ? {
          id: "coverage",
          level: "blocking",
          title: `${architecture.unmappedResourceTypes.length} Azure resource types are not in the platform catalog`,
          detail: architecture.unmappedResourceTypes.slice(0, 6).join(", "),
        }
      : {
          id: "coverage",
          level: "pass",
          title: "Every detected Azure resource type is mapped",
          detail: `${architecture.azureResourceTypes.length} resource types inspected.`,
        },
    license
      ? {
          id: "license",
          level: "pass",
          title: `${license} license detected`,
          detail: "Distribution still requires the catalog owner to confirm the license terms.",
        }
      : {
          id: "license",
          level: "blocking",
          title: "Distribution license is unresolved",
          detail:
            "A public repository does not grant redistribution rights. Owner authorization is required.",
        },
    mutableArtifact
      ? {
          id: "immutability",
          level: "blocking",
          title: "A mutable deployment artifact is referenced",
          detail: `${mutableRefs.find((r) => !own.test(r))?.slice(0, 160)}. Replace latest/main artifact references with immutable versions and digests.`,
        }
      : selfRefs.length
        ? {
            id: "immutability",
            level: "warning",
            title: `Fetches ${selfRefs.length === 1 ? "a file" : `${selfRefs.length} files`} from its own main branch at deploy time`,
            detail: `${[...new Set(selfRefs)].slice(0, 2).join(", ")}. Pin ${selfRefs.length === 1 ? "it" : "them"} to ${commit.sha.slice(0, 12)} before production use.`,
          }
        : {
            id: "immutability",
            level: "pass",
            title: "No mutable deployment artifact reference detected",
            detail: `The catalog source is pinned to ${commit.sha.slice(0, 12)}.`,
          },
    pipeline === "external"
      ? {
          id: "automation",
          level: "warning",
          title: "No supported delivery pipeline detected",
          detail:
            "The platform can generate its standard delivery workflow after architecture review.",
        }
      : {
          id: "automation",
          level: "pass",
          title: `${pipeline === "github-actions" ? "GitHub Actions" : "Azure Pipelines"} detected`,
          detail:
            "Existing automation remains source evidence; customer delivery uses the platform pipeline.",
        },
    tree.truncated
      ? {
          id: "tree",
          level: "warning",
          title: "GitHub truncated the repository tree",
          detail: "Review the source manually because some files may not have been inspected.",
        }
      : {
          id: "tree",
          level: "pass",
          title: "Repository tree inspected",
          detail: `${scoped.length} files found; ${sources.length} architecture-relevant files analyzed.`,
        },
  ];
  return {
    repository: {
      url: repo.html_url,
      owner: parsed.owner,
      name: repo.name,
      description: repo.description ?? "",
      revision: commit.sha,
      committedAt: commit.commit?.committer?.date ?? null,
      ref,
      path: parsed.path,
      license,
    },
    implementation: { driver, entrypoints, orchestrator, pipeline },
    architecture,
    checks,
    counts: { files: scoped.length, inspectedFiles: sources.length },
  };
}

export const inspectCatalogSource = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => importInput.parse(data))
  .handler(({ data }) => inspect(data.repositoryUrl));

const submitInput = importInput.extend({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(1000),
  category: z.string().trim().min(2).max(120),
  audience: z.string().trim().max(200).default(""),
  outcome: z.string().trim().max(200).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  supportUrl: z.union([z.literal(""), z.string().trim().url().max(500)]).default(""),
  deliveryModel: z.enum(["saas_connected", "customer_hosted", "enterprise_private"]),
  owners: z.array(ownerSchema).max(10).default([]),
  /** The submitter confirms they have the right to distribute this source through the catalog. */
  licenseAttested: z.boolean().default(false),
});

/** Submits a solution: pins and inspects the source, then records it as a Community draft with its owners. */
export const importCatalogSource = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => submitInput.parse(data))
  .handler(async ({ data }) => {
    const user = (await import("./identity.server")).currentUser();
    const inspection = await inspect(data.repositoryUrl);
    const db = await import("./db.server");
    // One repository can hold several solutions in different folders; the source is repository + folder.
    const duplicate = await db.maybeOne<{ name: string }>(
      `select p.name from public.offering_versions v
         join public.offerings o on o.id = v.offering_id
         join public.products p on p.id = o.product_id
       where v.manifest_json #>> '{source,repository}' = $1
         and coalesce(v.manifest_json #>> '{source,path}', '') = $2 limit 1`,
      [inspection.repository.url, inspection.repository.path],
    );
    if (duplicate)
      throw new Error(
        `This ${inspection.repository.path ? "folder" : "repository"} is already in the catalog as "${duplicate.name}".`,
      );
    const sameName = await db.maybeOne(
      "select 1 from public.products where organization_id = $1 and lower(name) = lower($2)",
      [ORG_ID, data.name],
    );
    if (sameName) throw new Error(`A solution named "${data.name}" already exists.`);

    const owners = withSubmitter(data.owners, user);
    const tags = [...new Set(data.tags.map((t) => t.toLowerCase()))];
    const landing: Topology["landing"] =
      data.deliveryModel === "saas_connected"
        ? "isv-hosted"
        : data.deliveryModel === "enterprise_private"
          ? "existing-customer-hub"
          : "dedicated-spoke";
    const topology: Topology = {
      landing,
      landingZone: landing === "existing-customer-hub" ? "corp" : "online",
      // Private by default: the ISV architecture policy blocks publishing anything with public access.
      publicAccess: false,
      privateEndpoints: true,
      regions: ["eastus2"],
      environments: ["development", "test", "production"],
    };
    const selected = normalise(
      inspection.architecture.services.map((service) => withDefaults(service.id)),
      topology,
    );
    const permissive =
      !!inspection.repository.license &&
      /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0)$/i.test(inspection.repository.license);
    const redistributionAllowed = permissive || data.licenseAttested;
    const source: BlueprintSource = {
      repository: inspection.repository.url,
      revision: inspection.repository.revision,
      ref: inspection.repository.ref,
      path: inspection.repository.path,
      iac: inspection.implementation.driver,
      pipeline: inspection.implementation.pipeline,
      entrypoints: inspection.implementation.entrypoints,
      ...(inspection.implementation.orchestrator
        ? { orchestrator: inspection.implementation.orchestrator }
        : {}),
      imported: true,
      license: {
        status: data.licenseAttested
          ? "attested"
          : inspection.repository.license
            ? "detected"
            : "unresolved",
        ...(inspection.repository.license ? { identifier: inspection.repository.license } : {}),
        redistributionAllowed,
        ...(data.licenseAttested
          ? { attestedBy: user.name, attestedAt: new Date().toISOString() }
          : {}),
      },
    };
    // The owner's attestation settles the license check; every other check stands as inspected.
    const checks: ImportCheck[] = inspection.checks.map((check) =>
      check.id === "license" && redistributionAllowed && check.level !== "pass"
        ? {
            ...check,
            level: "pass",
            title: "Distribution rights attested by the owner",
            detail: `${user.name} confirmed the right to distribute this source through the catalog.`,
          }
        : check,
    );
    const slug = slugOf(data.name);
    const manifest = {
      ...toManifest(slug, "0.1.0", { selected, topology }, source),
      catalogImport: {
        schemaVersion: "1.0",
        inspectedAt: new Date().toISOString(),
        checks,
        azureResourceTypes: inspection.architecture.azureResourceTypes,
        unmappedResourceTypes: inspection.architecture.unmappedResourceTypes,
      },
    };
    const modelName =
      data.deliveryModel === "saas_connected"
        ? "Hosted"
        : data.deliveryModel === "enterprise_private"
          ? "Enterprise Private"
          : "Customer Hosted";
    const pool = await db.db();
    const client = await pool.connect();
    let result: { productId: string; offeringId: string; versionId: string; checks: ImportCheck[] };
    try {
      await client.query("begin");
      const product = await client.query<{ id: string }>(
        `insert into public.products
           (organization_id, name, description, category, audience, outcome, tags, owners, maturity,
            source_url, support_url, license_attested, submitted_by, owner_confirmed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'community', $9, $10, $11, $12, now())
         returning id`,
        [
          ORG_ID,
          data.name,
          data.description,
          data.category,
          data.audience || null,
          data.outcome || null,
          tags,
          JSON.stringify(owners),
          inspection.repository.url,
          data.supportUrl || null,
          data.licenseAttested,
          user.name,
        ],
      );
      const productId = product.rows[0]!.id;
      const offering = await client.query<{ id: string }>(
        `insert into public.offerings
           (product_id, name, description, offering_type, deployment_boundary, network_profile,
            security_profile, supported_regions, status)
         values ($1, $2, $3, $4, 'resource-group', $5, 'imported-unreviewed', $6, 'active')
         returning id`,
        [
          productId,
          `${data.name} · ${modelName}`,
          `Imported from ${inspection.repository.owner}/${inspection.repository.name}; architecture review required.`,
          data.deliveryModel,
          landing === "existing-customer-hub"
            ? "customer-hub"
            : landing === "isv-hosted"
              ? "isv-hosted"
              : "dedicated-spoke",
          topology.regions,
        ],
      );
      const offeringId = offering.rows[0]!.id;
      const version = await client.query<{ id: string }>(
        `insert into public.offering_versions
           (offering_id, version, status, manifest_json, release_notes, ai_generated, created_by)
         values ($1, '0.1.0', 'draft', $2::jsonb, $3, false, $4)
         returning id`,
        [
          offeringId,
          JSON.stringify(manifest),
          `Imported from ${inspection.repository.url} at ${inspection.repository.revision}.`,
          user.name,
        ],
      );
      await client.query(
        `insert into public.audit_events
           (organization_id, actor_name, event_type, resource_type, resource_id, new_value, metadata_json)
         values ($1, $2, 'product.submitted', 'product', $3, $4::jsonb, $5::jsonb)`,
        [
          ORG_ID,
          user.name,
          productId,
          JSON.stringify({
            repository: inspection.repository.url,
            revision: inspection.repository.revision,
            owners: owners.map((o) => o.name),
            offeringId,
            versionId: version.rows[0]!.id,
          }),
          JSON.stringify({
            blockingChecks: checks.filter((check) => check.level === "blocking").length,
            licenseAttested: data.licenseAttested,
          }),
        ],
      );
      await client.query("commit");
      result = { productId, offeringId, versionId: version.rows[0]!.id, checks };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    // The solution gets its own repository, sandbox identities and state: file its vending request.
    const { ensureAndRequest } = await import("./delivery/units.server");
    const vending = await ensureAndRequest(db, { product_id: result.productId }, user.name);
    return {
      ...result,
      repository: vending?.unit.repository ?? null,
      vendingUrl: vending?.requested ? (vending.url ?? null) : null,
    };
  });
