/*
 * Delivery units: everything Cloud Delivery deploys is a unit with its own repository, pipeline, cloud identities
 * and Terraform state, and approvals attach to the unit's environments (docs/delivery-isolation-strategy.md).
 *
 *   landing-zone  lz-<tenant>     platform landing zone, one per Entra tenant
 *   solution      sol-<product>   a solution/product and its offerings (delivery models)
 *   customer      cust-<code>     configuration only: which offering version each environment runs
 *   modules / templates / vending / control-plane — the shared platform repositories
 *
 * Pure: resolves a unit into the spec that vending applies and reviewers approve. No I/O.
 */

export type UnitKind =
  "control-plane" | "templates" | "modules" | "vending" | "landing-zone" | "solution" | "customer";

export const PLATFORM_KINDS = ["control-plane", "templates", "modules", "vending"] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];
export const UNIT_KINDS: UnitKind[] = [
  "landing-zone",
  "solution",
  "customer",
  "modules",
  "templates",
  "vending",
  "control-plane",
];

export type Platform = {
  /** GitHub organization that owns every unit repository. */
  org: string;
  templatesRepo: string;
  /** Release of cd-delivery-templates every unit calls; identities trust only this ref. */
  templatesRef: string;
  /** The ISV's own Entra tenant: hosted installs, solution sandboxes and the platform itself. */
  isvTenantId: string;
  /** State account for units whose state lives with the ISV (hosted customers, sandboxes, vending). */
  stateAccount: string;
  stateResourceGroup: string;
  stateSubscriptionId: string;
  sandboxSubscriptionId: string;
  teams: { platform: string; security: string; delivery: string; catalog: string; admins: string };
};

export const DEFAULT_PLATFORM: Platform = {
  org: "gridworks",
  templatesRepo: "cd-delivery-templates",
  templatesRef: "v1",
  isvTenantId: "<isv-tenant-id>",
  stateAccount: "stcdstate",
  stateResourceGroup: "rg-cd-state",
  stateSubscriptionId: "<platform-management-subscription-id>",
  sandboxSubscriptionId: "<solution-sandbox-subscription-id>",
  teams: {
    platform: "platform-approvers",
    security: "security-approvers",
    delivery: "delivery-approvers",
    catalog: "catalog-reviewers",
    admins: "org-admins",
  },
};

export const ENV_SHORT: Record<string, string> = {
  development: "dev",
  test: "test",
  qa: "qa",
  uat: "uat",
  staging: "stg",
  production: "prod",
  disaster_recovery: "dr",
};
const ENV_ORDER = [
  "development",
  "test",
  "qa",
  "uat",
  "staging",
  "production",
  "disaster_recovery",
];
export const sortEnvironments = <T extends string>(envs: T[]) =>
  [...envs].sort((a, b) => ENV_ORDER.indexOf(a) - ENV_ORDER.indexOf(b));

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const REPO_PREFIX: Partial<Record<UnitKind, string>> = {
  "landing-zone": "lz-",
  solution: "sol-",
  customer: "cust-",
};
const PLATFORM_REPO: Record<PlatformKind, string> = {
  "control-plane": "cd-control-plane",
  templates: "cd-delivery-templates",
  modules: "cd-modules",
  vending: "cd-vending",
};

export const isPlatformKind = (kind: UnitKind): kind is PlatformKind => kind in PLATFORM_REPO;

export const repoName = (kind: UnitKind, slug: string) =>
  isPlatformKind(kind) ? PLATFORM_REPO[kind] : `${REPO_PREFIX[kind]}${slugify(slug)}`;

/** Pipeline template in cd-delivery-templates each kind calls. */
export const TEMPLATE_WORKFLOW: Partial<Record<UnitKind, string>> = {
  "landing-zone": "lz.yml",
  solution: "solution.yml",
  customer: "install.yml",
  "control-plane": "release.yml",
  vending: "vend.yml",
};

export const UNIT_META: Record<
  UnitKind,
  { label: string; plural: string; purpose: string; branching: string; promotion: string }
> = {
  "landing-zone": {
    label: "Landing zone",
    plural: "Landing zones",
    purpose: "Platform landing zone for one Entra tenant: management groups, policy, connectivity.",
    branching:
      "Trunk (main) with short-lived branches. Plan on every pull request, apply on merge.",
    promotion:
      "Changes reach the canary landing zone first; each tenant then gets a pull request bumping its pinned library and module versions.",
  },
  solution: {
    label: "Solution",
    plural: "Solutions",
    purpose: "A solution and its delivery models (offerings): manifests and optional source IaC.",
    branching:
      "Trunk (main). A tag per offering release (<offering>/vX.Y.Z); release/<offering>/vX.Y branches only to service old versions.",
    promotion:
      "Tag → build once → sandbox deploy → attest → register an immutable version → roll out to customers in waves.",
  },
  customer: {
    label: "Customer",
    plural: "Customers",
    purpose:
      "One customer's installs. Configuration only: the offering version each environment runs, and its inputs.",
    branching: "Trunk (main). Changes arrive as promotion pull requests from the control plane.",
    promotion:
      "Promotion pull requests bump the pinned version per environment, non-production first; production waits for approval and bake time.",
  },
  modules: {
    label: "Modules",
    plural: "Modules",
    purpose: "Shared service modules and policy packs.",
    branching: "Trunk (main). SemVer tag per module: modules/<name>/vX.Y.Z.",
    promotion: "Consumers pin exact versions; upgrades arrive as pull requests.",
  },
  templates: {
    label: "Pipeline templates",
    plural: "Pipeline templates",
    purpose:
      "Reusable workflows every unit calls. Cloud identities trust only these, at a pinned tag.",
    branching: "Trunk (main). Release tags vX.Y.Z; units pin a tag.",
    promotion:
      "A new tag is adopted unit by unit; each identity's federated subject is updated with it.",
  },
  vending: {
    label: "Vending",
    plural: "Vending",
    purpose:
      "One request file per unit. Creates the repository, environments, identities and state storage.",
    branching: "Trunk (main). Each request is a pull request; merging applies it after approval.",
    promotion: "Two-person approval on the vend environment.",
  },
  "control-plane": {
    label: "Control plane",
    plural: "Control plane",
    purpose:
      "The Cloud Delivery console. Orchestrates units through pull requests; holds no estate rights.",
    branching: "Trunk (main) with merge queue. Release tags vX.Y.Z.",
    promotion: "Build once per tag, attest, then staging → production.",
  },
};

export type UnitEnvironment = {
  name: string;
  purpose: string;
  reviewers: string[];
  preventSelfReview: boolean;
  waitMinutes: number;
  /** Refs allowed to deploy to this environment. */
  deploymentRefs: string[];
  /** Environment variables vending sets (identity client IDs are added once the identity exists). */
  variables: Record<string, string>;
};

export type UnitIdentity = {
  name: string;
  environment: string;
  role: "plan" | "apply";
  /** Where the identity lives: the ISV's tenant, or the customer's (created when their admin connects). */
  home: "isv" | "customer";
  tenantId: string | null;
  scope: string;
  roles: string[];
  subject: string;
  createdBy: "vending" | "customer-connect";
};

export type UnitState = {
  environment: string;
  location: "isv" | "customer" | "tenant";
  storageAccount: string;
  container: string;
  key: string;
  readers: string[];
};

export type UnitSpec = {
  apiVersion: "cd.delivery/v1";
  kind: UnitKind;
  slug: string;
  name: string;
  repository: {
    owner: string;
    name: string;
    visibility: "private";
    defaultBranch: "main";
    customProperties: Record<string, string>;
    teams: { team: string; permission: "admin" | "maintain" | "push" | "triage" | "pull" }[];
  };
  branching: string;
  promotion: string;
  pipeline: { template: string | null; ref: string };
  environments: UnitEnvironment[];
  identities: UnitIdentity[];
  state: UnitState[];
};

export type UnitInput =
  | {
      kind: "landing-zone";
      slug: string;
      name: string;
      tenantId: string | null;
      /** The landing zone's intermediate root management group. */
      managementGroupId: string;
      /** Hosted in the ISV's own tenant, or in a customer's tenant. */
      isv: boolean;
      ownerTeam?: string;
      criticality?: "standard" | "regulated";
    }
  | { kind: "solution"; slug: string; name: string; ownerTeam?: string; offerings: string[] }
  | {
      kind: "customer";
      slug: string;
      name: string;
      tenantId: string | null;
      hosted: boolean;
      /** One entry per install per environment; installs are <solution>-<model> stems. */
      environments: {
        env: string;
        subscriptionId: string | null;
        subscriptionName: string;
        installs?: string[];
      }[];
      offerings: string[];
      ownerTeam?: string;
      criticality?: "standard" | "regulated";
    }
  | { kind: PlatformKind; slug?: string; name?: string };

/**
 * GitHub OIDC subject pinning repository, environment and the calling template at its release tag
 * (repository OIDC customization: include_claim_keys = repo, context, job_workflow_ref).
 */
export const oidcSubject = (p: Platform, repo: string, environment: string, workflow: string) =>
  `repo:${p.org}/${repo}:environment:${environment}:job_workflow_ref:${p.org}/${p.templatesRepo}/.github/workflows/${workflow}@refs/tags/${p.templatesRef}`;

const storageName = (...parts: string[]) =>
  `stcd${parts.join("").replace(/[^a-z0-9]/g, "")}`.slice(0, 24);

const mgScope = (id: string) => `/providers/Microsoft.Management/managementGroups/${id}`;
const subScope = (id: string | null, vendName: string) =>
  `/subscriptions/${id || `<vend:${vendName}>`}`;

/** Can grant only Reader and the data-plane roles a workload needs; never Owner, Contributor or another admin role. */
export const RBAC_ADMIN_CONDITIONED =
  "Role Based Access Control Administrator (condition: Reader and data-plane roles only)";

function env(
  name: string,
  purpose: string,
  reviewers: string[],
  waitMinutes = 0,
  deploymentRefs = ["refs/heads/main"],
): UnitEnvironment {
  const plan = name === "plan" || name.endsWith("-plan");
  return {
    name,
    purpose,
    reviewers,
    preventSelfReview: reviewers.length > 0,
    waitMinutes,
    // Plans run on pull requests from any branch; they carry a read-only identity.
    deploymentRefs: plan ? ["*"] : deploymentRefs,
    variables: {},
  };
}

/** Sets what each environment's jobs need: tenant, subscription and where its Terraform state lives. */
function withVariables(spec: UnitSpec) {
  for (const e of spec.environments) {
    const apply = e.name.endsWith("-plan")
      ? e.name.slice(0, -5)
      : e.name === "plan"
        ? "apply"
        : e.name;
    const id = spec.identities.find((i) => i.environment === e.name);
    const states = spec.state.filter((s) => s.environment === apply || s.environment === e.name);
    const sub = id?.scope.match(/^\/subscriptions\/([0-9a-f-]{36})/i)?.[1];
    e.variables = {
      ...(id?.tenantId && !id.tenantId.startsWith("<") ? { AZURE_TENANT_ID: id.tenantId } : {}),
      ...(sub ? { AZURE_SUBSCRIPTION_ID: sub } : {}),
      ...(states[0]
        ? {
            TF_STATE_ACCOUNT: states[0].storageAccount,
            TF_STATE_CONTAINER: states[0].container,
            ...(states.length === 1 ? { TF_STATE_KEY: states[0].key } : {}),
          }
        : {}),
    };
  }
  return spec;
}

/** Resolves a unit into the spec vending creates and approvers review. */
export function resolveUnit(input: UnitInput, p: Platform = DEFAULT_PLATFORM): UnitSpec {
  const kind = input.kind;
  const slug = slugify(input.slug ?? kind);
  const repo = repoName(kind, slug);
  const workflow = TEMPLATE_WORKFLOW[kind] ?? null;
  const ownerTeam =
    ("ownerTeam" in input && input.ownerTeam) ||
    (kind === "customer"
      ? p.teams.delivery
      : kind === "solution"
        ? `${repo}-owners`
        : p.teams.platform);
  const criticality = ("criticality" in input && input.criticality) || "standard";
  const tenant =
    input.kind === "landing-zone" || input.kind === "customer"
      ? (input.tenantId ?? p.isvTenantId)
      : p.isvTenantId;

  const spec: UnitSpec = {
    apiVersion: "cd.delivery/v1",
    kind,
    slug,
    name: input.name ?? UNIT_META[kind].label,
    repository: {
      owner: p.org,
      name: repo,
      visibility: "private",
      defaultBranch: "main",
      customProperties: {
        "cd-unit": kind,
        "cd-tenant": tenant,
        "cd-owner-team": ownerTeam,
        "cd-criticality": criticality,
      },
      teams: [
        { team: ownerTeam, permission: "push" },
        ...(ownerTeam === p.teams.platform
          ? []
          : [{ team: p.teams.platform, permission: "triage" as const }]),
        { team: p.teams.admins, permission: "admin" },
      ],
    },
    branching: UNIT_META[kind].branching,
    promotion: UNIT_META[kind].promotion,
    pipeline: { template: workflow, ref: p.templatesRef },
    environments: [],
    identities: [],
    state: [],
  };

  const identity = (
    environment: string,
    role: "plan" | "apply",
    scope: string,
    roles: string[],
    home: "isv" | "customer",
    tenantId: string | null,
  ): UnitIdentity => ({
    name: `id-${repo}-${environment}`,
    environment,
    role,
    home,
    tenantId,
    scope,
    roles,
    subject: oidcSubject(p, repo, environment, workflow ?? "unit.yml"),
    createdBy: home === "isv" ? "vending" : "customer-connect",
  });

  if (input.kind === "landing-zone") {
    const home = input.isv ? "isv" : "customer";
    const scope = mgScope(input.managementGroupId);
    const regulated = criticality === "regulated";
    spec.environments = [
      env("plan", "Read-only plan on every pull request", []),
      env(
        "apply",
        "Applies merged changes to the landing zone",
        regulated ? [p.teams.platform, p.teams.security] : [p.teams.platform],
        regulated ? 60 : 0,
      ),
    ];
    spec.identities = [
      identity("plan", "plan", scope, ["Reader"], home, tenant),
      identity(
        "apply",
        "apply",
        scope,
        [
          "Owner (ALZ default; narrow to Contributor + Resource Policy Contributor + conditioned RBAC admin)",
        ],
        home,
        tenant,
      ),
    ];
    spec.state = [
      {
        environment: "apply",
        location: "tenant",
        storageAccount: storageName("lz", slug),
        container: "tfstate",
        key: `lz/${slug}.tfstate`,
        readers: spec.identities.map((i) => i.name),
      },
    ];
  } else if (input.kind === "solution") {
    const scope = subScope(null, `sub-${repo}-sandbox`);
    spec.environments = [
      env("sandbox-plan", "Plan against the solution's sandbox subscription", []),
      env("sandbox", "Test deploy in the solution's sandbox before release", [], 0, [
        "refs/tags/*/v*",
      ]),
      env(
        "release",
        "Registers an immutable offering version with the control plane",
        [ownerTeam],
        0,
        ["refs/tags/*/v*"],
      ),
    ];
    spec.identities = [
      identity("sandbox-plan", "plan", scope, ["Reader"], "isv", p.isvTenantId),
      identity(
        "sandbox",
        "apply",
        scope,
        ["Contributor", RBAC_ADMIN_CONDITIONED],
        "isv",
        p.isvTenantId,
      ),
    ];
    spec.state = (input.offerings.length ? input.offerings : ["default"]).map((o) => ({
      environment: "sandbox",
      location: "isv",
      storageAccount: p.stateAccount,
      container: repo,
      key: `${slugify(o)}/sandbox.tfstate`,
      readers: spec.identities.map((i) => i.name),
    }));
  } else if (input.kind === "customer") {
    const home = input.hosted ? "isv" : "customer";
    // One identity pair per environment; each install in it gets its own state key.
    for (const e of sortEnvironments([...new Set(input.environments.map((x) => x.env))])) {
      const short = ENV_SHORT[e] ?? e;
      const target = input.environments.find((x) => x.env === e)!;
      const scope = subScope(target.subscriptionId, target.subscriptionName);
      const prod = e === "production" || e === "disaster_recovery";
      const regulated = criticality === "regulated";
      spec.environments.push(
        env(`${short}-plan`, `Read-only plan for ${e}`, []),
        env(
          short,
          prod ? "Production: approval, then bake time before the wave continues" : `Deploys ${e}`,
          prod ? (regulated ? [p.teams.delivery, p.teams.security] : [p.teams.delivery]) : [],
          prod ? (regulated ? 120 : 30) : 0,
        ),
      );
      const plan = identity(`${short}-plan`, "plan", scope, ["Reader"], home, tenant);
      const apply = identity(
        short,
        "apply",
        scope,
        ["Contributor", RBAC_ADMIN_CONDITIONED],
        home,
        tenant,
      );
      spec.identities.push(plan, apply);
      const installs = [
        ...new Set(
          input.environments
            .filter((x) => x.env === e)
            .flatMap((x) => x.installs ?? input.offerings),
        ),
      ];
      for (const o of installs.length ? installs : ["install"])
        spec.state.push(
          input.hosted
            ? {
                environment: short,
                location: "isv",
                storageAccount: p.stateAccount,
                container: `${repo}-${short}`,
                key: `${slugify(o)}.tfstate`,
                readers: [plan.name, apply.name],
              }
            : {
                environment: short,
                location: "customer",
                storageAccount: storageName(slug, short),
                container: "tfstate",
                key: `${slugify(o)}.tfstate`,
                readers: [plan.name, apply.name],
              },
        );
    }
  } else if (input.kind === "control-plane") {
    spec.environments = [
      env("staging", "Pre-production console", [], 0, ["refs/tags/v*"]),
      env("production", "Production console", [p.teams.platform], 30, ["refs/tags/v*"]),
    ];
    spec.identities = ["staging", "production"].map((e) =>
      identity(
        e,
        "apply",
        `/subscriptions/${p.stateSubscriptionId}/resourceGroups/rg-cd-control-plane-${e}`,
        ["Website Contributor"],
        "isv",
        p.isvTenantId,
      ),
    );
  } else if (input.kind === "vending") {
    spec.environments = [
      env("vend-plan", "Plans every request on its pull request", []),
      env(
        "vend",
        "Creates repositories, environments, identities and state for approved requests",
        [p.teams.platform, p.teams.security],
      ),
    ];
    spec.identities = [
      identity(
        "vend-plan",
        "plan",
        `/subscriptions/${p.stateSubscriptionId}`,
        ["Reader", "Storage Blob Data Contributor (state container only)"],
        "isv",
        p.isvTenantId,
      ),
      identity(
        "vend",
        "apply",
        `/subscriptions/${p.stateSubscriptionId}`,
        ["Managed Identity Contributor", RBAC_ADMIN_CONDITIONED, "Storage Account Contributor"],
        "isv",
        p.isvTenantId,
      ),
    ];
    spec.state = [
      {
        environment: "vend",
        location: "isv",
        storageAccount: p.stateAccount,
        container: "cd-vending",
        key: "vending.tfstate",
        readers: spec.identities.map((i) => i.name),
      },
    ];
  }
  return withVariables(spec);
}

/** The isolation rules the strategy commits to. Empty when the spec is sound. */
export function isolationFindings(spec: UnitSpec): string[] {
  const out: string[] = [];
  for (const id of spec.identities) {
    if (!id.subject.includes(`:environment:${id.environment}:`))
      out.push(`${id.name} isn't pinned to its environment.`);
    if (!id.subject.includes(":job_workflow_ref:"))
      out.push(`${id.name} isn't pinned to an approved template workflow.`);
  }
  if (spec.kind === "customer") {
    const byScope = new Map<string, string[]>();
    for (const id of spec.identities.filter((i) => i.role === "apply"))
      byScope.set(id.scope, [...(byScope.get(id.scope) ?? []), id.environment]);
    for (const [scope, envs] of byScope)
      if (envs.length > 1)
        out.push(
          `Environments ${envs.join(", ")} share ${scope}; each needs its own subscription.`,
        );
  }
  for (const e of spec.environments)
    if (/^(prod|dr|apply|release|vend|production)$/.test(e.name) && !e.reviewers.length)
      out.push(`${e.name} has no required reviewers.`);
  const keys = spec.state.map((s) => `${s.storageAccount}/${s.container}/${s.key}`);
  if (new Set(keys).size !== keys.length) out.push("Two environments share a state file.");
  return out;
}
