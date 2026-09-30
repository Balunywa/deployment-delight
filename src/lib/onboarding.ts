/*
 * Customer onboarding and delivery model, shared by the onboarding wizard, the offering review and the
 * server. Each customer is delivered from its own repository (cust-<code>) holding configuration only: one file
 * per install per environment pinning an offering version. Its workflows call the shared, pinned templates, and
 * its cloud identities trust only that repository, environment and template (src/lib/delivery).
 */
import { DEFAULT_PLATFORM, oidcSubject, repoName, resolveUnit } from "./delivery/model";
import { customerRepo, installStem } from "./delivery/scaffold";
import { sizing } from "./skus";
import {
  type Answers,
  DEFAULT_ANSWERS,
  hierarchy,
  includedGroups,
  LIBRARIES,
  libraryFor,
  withDefaults as answersWithDefaults,
} from "@/lib/alz/engine";
import { SERVICE_BY_ID, type Selected, type Topology } from "@/lib/catalog";
import { AZURE_REGIONS, UNAVAILABLE } from "@/lib/regions";

export const ENV_KEYS = ["development", "test", "qa", "uat", "staging", "production"] as const;
export type EnvKey = (typeof ENV_KEYS)[number];
export const ENV_META: Record<EnvKey, { label: string; short: string; prod: boolean }> = {
  development: { label: "Development", short: "dev", prod: false },
  test: { label: "Test", short: "test", prod: false },
  qa: { label: "QA", short: "qa", prod: false },
  uat: { label: "UAT", short: "uat", prod: false },
  staging: { label: "Staging", short: "stg", prod: false },
  production: { label: "Production", short: "prod", prod: true },
};
export const envName = (e: string) => ENV_META[e as EnvKey]?.short.toUpperCase() ?? e.toUpperCase();
export const sortEnvs = <T extends string>(envs: T[]) =>
  [...envs].sort((a, b) => ENV_KEYS.indexOf(a as EnvKey) - ENV_KEYS.indexOf(b as EnvKey));

export type TargetMode = "new_subscription" | "existing_subscription" | "existing_resource_group";
export const TARGET_META: Record<TargetMode, { title: string; body: string }> = {
  new_subscription: {
    title: "New subscription",
    body: "Vended for this environment and placed in the landing zone group. Cleanest isolation and cost tracking.",
  },
  existing_subscription: {
    title: "Existing subscription",
    body: "The customer already has a subscription for this. The install creates its own resource group in it.",
  },
  existing_resource_group: {
    title: "Existing resource group",
    body: "Least access: the install only gets rights on one resource group the customer created.",
  },
};

export type EnvPlan = {
  env: EnvKey;
  region: string;
  target: TargetMode;
  subscriptionId: string;
  resourceGroup: string;
};

export type DeliveryTool = "github-actions" | "azure-devops";
export type Delivery = {
  tool: DeliveryTool;
  /** GitHub organization (or Azure DevOps organization) that owns the customer's cust-<code> repository. */
  org: string;
  /** Before per-customer repositories: one shared "owner/repo". Read for older records only. */
  repo?: string;
  /** Non-production environments deploy as soon as their plan is clean. */
  autoDeployNonProd: boolean;
  prodApprovers: string;
  /** Minutes production waits after the previous ring succeeds (GitHub wait timer / ADO delay). */
  prodWaitMinutes: number;
  driftSchedule: boolean;
};

export const DEFAULT_DELIVERY: Delivery = {
  tool: "github-actions",
  org: DEFAULT_PLATFORM.org,
  autoDeployNonProd: true,
  prodApprovers: "platform-approvers",
  prodWaitMinutes: 0,
  driftSchedule: true,
};

export const TOOL_META: Record<DeliveryTool, { title: string; body: string }> = {
  "github-actions": {
    title: "GitHub Actions",
    body: "A repository per customer, GitHub environments per customer environment, OIDC pinned to the approved template — no secrets.",
  },
  "azure-devops": {
    title: "Azure Pipelines",
    body: "Same flow on Azure DevOps: a repository per customer, required templates, environments with approvals and checks, workload identity federation.",
  },
};

export const regionLabel = (name: string) =>
  AZURE_REGIONS.find((r) => r.name === name)?.display ?? name;

/** Services in the architecture that Azure doesn't offer in a region. */
export function unsupportedIn(selected: Selected[], region: string) {
  return selected
    .map((s) => SERVICE_BY_ID.get(s.id))
    .filter(
      (d): d is NonNullable<typeof d> => !!d && !!UNAVAILABLE[d.resourceType]?.includes(region),
    )
    .map((d) => d.name);
}

/** Regions where every service in the architecture is available. */
export const regionsSupporting = (selected: Selected[]) =>
  AZURE_REGIONS.filter((r) => !unsupportedIn(selected, r.name).length).map((r) => r.name);

export type Names = {
  install: string;
  subscription: string;
  resourceGroup: string;
  environment: string;
  oidcSubject: string;
};

/** The delivery organization, also for records saved when every customer shared one "owner/repo". */
export const orgOf = (d: Pick<Delivery, "org" | "repo">) =>
  d.org || d.repo?.split("/")[0] || DEFAULT_PLATFORM.org;

/** Each customer is delivered from its own repository: <org>/cust-<code>. */
export const customerRepoOf = (code: string, d: Pick<Delivery, "org" | "repo">) =>
  `${orgOf(d)}/${repoName("customer", code)}`;

export function namesFor(code: string, p: EnvPlan, d: Delivery): Names {
  const short = ENV_META[p.env].short;
  const install = `${code}-${short}`;
  // Environments live inside the customer's own repository, so the name needs no customer prefix.
  const environment = short;
  const repo = repoName("customer", code);
  return {
    install,
    subscription: `sub-${install}`,
    resourceGroup:
      p.target === "existing_resource_group" && p.resourceGroup ? p.resourceGroup : `rg-${install}`,
    environment,
    oidcSubject:
      d.tool === "github-actions"
        ? oidcSubject({ ...DEFAULT_PLATFORM, org: orgOf(d) }, repo, environment, "install.yml")
        : `sc://${orgOf(d)}/${repo}/${environment}`,
  };
}

export type PlacementNode = { id: string; name: string };

/**
 * Management group path an install lands in. Hosted installs use the ISV's hosting tenant design; customers
 * that are new to Azure get a landing zone built from Microsoft's defaults; existing landing zones are
 * plugged into at the group the customer's admin grants.
 */
export function placementFor(opts: {
  landing: Topology["landing"];
  landingZone: string;
  hostingAnswers: unknown;
  customerName: string;
  customerCode: string;
  grantedGroup: string;
  /** The landing zone design the subscriptions are vended into, when one was picked. */
  answers?: unknown;
  source?: string | undefined;
}): { path: PlacementNode[]; exists: boolean; source: string } {
  if (opts.landing === "existing-customer-hub")
    return {
      path: [
        { id: "root", name: "Tenant root group" },
        {
          id: opts.grantedGroup || "granted",
          name: opts.grantedGroup || "Granted by the customer",
        },
      ],
      exists: true,
      source: "Customer's existing landing zone",
    };
  const answers: Answers = opts.answers
    ? answersWithDefaults(opts.answers)
    : opts.landing === "isv-hosted"
      ? answersWithDefaults(opts.hostingAnswers)
      : {
          ...DEFAULT_ANSWERS,
          intermediateRootId: opts.customerCode.slice(0, 10) || "cust",
          intermediateRootName: opts.customerName || "Customer",
        };
  const lib = libraryFor(LIBRARIES[0]!.ref);
  const tree = hierarchy(lib, answers);
  const exists = includedGroups(lib, answers).some((g) => g.id === opts.landingZone);
  const path: PlacementNode[] = [{ id: "root", name: "Tenant root group" }];
  let node = tree.find((n) => n.libraryId === opts.landingZone);
  const chain: PlacementNode[] = [];
  while (node) {
    chain.unshift({ id: node.id, name: node.displayName });
    const parent: string | null = node.parentId;
    node = tree.find((n) => n.id === parent);
  }
  return {
    path: [...path, ...chain],
    exists,
    source:
      opts.source ??
      (opts.landing === "isv-hosted"
        ? "Your hosting tenant's landing zone design"
        : "New landing zone built from Microsoft's defaults"),
  };
}

export type Level = "pass" | "warn" | "fail";
export type Check = { id: string; area: string; level: Level; title: string; detail: string };

export function onboardingChecks(opts: {
  selected: Selected[];
  topology: Topology;
  plans: EnvPlan[];
  delivery: Delivery;
  placementExists: boolean;
  hostingAnswers: unknown;
  viaLink: boolean;
  customerTenant: boolean;
}): Check[] {
  const { selected, topology, plans, delivery } = opts;
  const out: Check[] = [];
  for (const p of plans) {
    const missing = unsupportedIn(selected, p.region);
    const label = ENV_META[p.env].label;
    if (!topology.regions.includes(p.region))
      out.push({
        id: `region-offered-${p.env}`,
        area: "Region",
        level: "fail",
        title: `${label}: ${regionLabel(p.region)} is not an approved region for this offering`,
        detail: `Approved: ${topology.regions.map(regionLabel).join(", ")}. Add the region to the offering (it goes through architecture review) or pick an approved one.`,
      });
    else if (missing.length)
      out.push({
        id: `region-services-${p.env}`,
        area: "Region",
        level: "fail",
        title: `${label}: ${missing.join(", ")} not available in ${regionLabel(p.region)}`,
        detail: "From Azure's resource provider region list. Pick another region.",
      });
  }
  if (!out.some((c) => c.area === "Region"))
    out.push({
      id: "region",
      area: "Region",
      level: "pass",
      title: "Every service is available in the chosen regions",
      detail: `${selected.length} services checked against Azure's resource provider regions.`,
    });

  out.push(
    opts.placementExists
      ? {
          id: "placement",
          area: "Landing zone",
          level: "pass",
          title: "The landing zone group exists",
          detail: `Environments go to the ${topology.landingZone} group, one subscription per environment — Microsoft's Cloud Adoption Framework keeps dev, test and prod in the same group rather than separate management groups.`,
        }
      : {
          id: "placement",
          area: "Landing zone",
          level: "fail",
          title: `The ${topology.landingZone} group was left out of the landing zone design`,
          detail: "Add it back in Landing zones, or change the offering's landing zone.",
        },
  );

  const overrides = answersWithDefaults(opts.hostingAnswers).policyOverrides;
  const relaxed = (a: string) => topology.landing === "isv-hosted" && !!overrides[`corp/${a}`];
  if (topology.landingZone === "corp" && topology.publicAccess && !relaxed("Deny-Public-Endpoints"))
    out.push({
      id: "policy-public",
      area: "Policy",
      level: "fail",
      title: "Corp denies public endpoints",
      detail:
        "The ALZ Corp policy set assigns Deny-Public-Endpoints, and this offering allows public network access. Move the offering to Online, or turn off public access.",
    });
  else if (topology.landingZone === "sandbox" && topology.landing === "existing-customer-hub")
    out.push({
      id: "policy-sandbox",
      area: "Policy",
      level: "fail",
      title: "Sandbox blocks peering to the hub",
      detail:
        "Enforce-ALZ-Sandbox denies cross-subscription peering and VPN/ExpressRoute gateways; an offering that plugs into the customer's hub can't land there.",
    });
  else
    out.push({
      id: "policy",
      area: "Policy",
      level: "pass",
      title: `Compatible with the ${topology.landingZone} policy set`,
      detail: topology.privateEndpoints
        ? "Data services use private endpoints, as the landing zone policies expect."
        : "Public network access is off.",
    });

  if (!opts.viaLink) {
    const bad = plans.filter(
      (p) =>
        p.target !== "new_subscription" &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.subscriptionId),
    );
    const noRg = plans.filter(
      (p) => p.target === "existing_resource_group" && !p.resourceGroup.trim(),
    );
    out.push(
      bad.length || noRg.length
        ? {
            id: "targets",
            area: "Targets",
            level: "fail",
            title: "Some environments are missing their target",
            detail: [
              ...bad.map((p) => `${ENV_META[p.env].label}: subscription ID must be a GUID`),
              ...noRg.map((p) => `${ENV_META[p.env].label}: resource group name is required`),
            ].join(" · "),
          }
        : {
            id: "targets",
            area: "Targets",
            level: "pass",
            title: "Every environment has a target",
            detail: plans
              .map((p) => `${ENV_META[p.env].label}: ${TARGET_META[p.target].title.toLowerCase()}`)
              .join(" · "),
          },
    );
  }
  const vended = plans.filter((p) => p.target === "new_subscription");
  if (opts.customerTenant && vended.length)
    out.push({
      id: "billing",
      area: "Targets",
      level: "warn",
      title: `${vended.length} new subscription${vended.length === 1 ? "" : "s"} in the customer's tenant`,
      detail:
        "Creating subscriptions needs the customer's billing account: Subscription Creator on an EA enrollment account, or Azure subscription creator on an MCA invoice section. The install link asks their admin for it.",
    });
  const prod = plans.find((p) => p.env === "production");
  const shared =
    prod &&
    prod.target !== "new_subscription" &&
    plans.some(
      (p) =>
        p.env !== "production" &&
        p.target !== "new_subscription" &&
        p.subscriptionId === prod.subscriptionId,
    );
  if (shared)
    out.push({
      id: "isolation",
      area: "Targets",
      level: "warn",
      title: "Production shares a subscription with non-production",
      detail:
        "Microsoft recommends a separate subscription per environment so access, quotas and cost stay isolated.",
    });

  out.push(
    prod && !delivery.prodApprovers.trim()
      ? {
          id: "approval",
          area: "Delivery",
          level: "warn",
          title: "Production has no required reviewers",
          detail: "Anyone who can run the workflow can deploy to production.",
        }
      : {
          id: "approval",
          area: "Delivery",
          level: "pass",
          title: prod
            ? `Production waits for ${delivery.prodApprovers}`
            : "No production environment",
          detail:
            delivery.tool === "github-actions"
              ? "GitHub environment protection rule: required reviewers."
              : "Azure Pipelines environment check: approvals.",
        },
  );
  if (!plans.some((p) => !ENV_META[p.env].prod) && prod)
    out.push({
      id: "rings",
      area: "Delivery",
      level: "warn",
      title: "Production is the first environment",
      detail: "Without a non-production ring, every upgrade lands in production first.",
    });
  return out;
}

export type Ring = { id: string; name: string; envs: EnvKey[]; gate: string | null };

/** Promotion rings: non-production environments in order, then production behind its approval. */
export function ringsFor(plans: EnvPlan[], d: Delivery): Ring[] {
  const envs = sortEnvs(plans.map((p) => p.env));
  return envs.map((e) => ({
    id: e,
    name: ENV_META[e].label,
    envs: [e],
    gate: ENV_META[e].prod
      ? `${d.prodApprovers || "any reviewer"}${d.prodWaitMinutes ? ` · ${d.prodWaitMinutes} min` : ""}`
      : d.autoDeployNonProd
        ? null
        : "Plan approval",
  }));
}

export type Trigger = { event: string; when: string; runs: string };

export function triggersFor(d: Delivery, code: string): Trigger[] {
  const gh = d.tool === "github-actions";
  const repo = repoName("customer", code);
  return [
    {
      event: gh ? "pull_request" : "PR build validation",
      when: `Onboarding opens the first pull request on ${repo}: one environments/<env>/<install>.yaml per environment`,
      runs: "Plan every environment with its read-only identity; results posted on the pull request",
    },
    {
      event: gh ? "push → main" : "CI trigger · main",
      when: "The pull request is merged",
      runs: "Apply environment by environment; production waits for its reviewers and bake time",
    },
    {
      event: "Promotion pull request",
      when: "A new offering version is released and this customer's wave comes up",
      runs: "The control plane bumps the pinned version and digest; the same plan → approve → apply flow runs",
    },
    ...(d.driftSchedule
      ? [
          {
            event: gh ? "schedule · 0 5 * * *" : "Scheduled trigger · daily",
            when: "Every night",
            runs: "Drift check (terraform plan -detailed-exitcode) per install; opens an issue when something changed",
          },
        ]
      : []),
    {
      event: gh ? "workflow_dispatch" : "Manual run",
      when: "Someone runs it by hand",
      runs: "Re-plan and redeploy this customer's installs",
    },
  ];
}

export type InstallContext = {
  code: string;
  name: string;
  /** Solution and delivery model slugs, e.g. grid-analytics / enterprise-private. */
  solution: string;
  offering: string;
  version: string;
  placement: PlacementNode[];
  plans: EnvPlan[];
  delivery: Delivery;
  inputs: Record<string, string>;
  tenantId: string;
  hosted: boolean;
  regulated?: boolean;
};

/** The customer's repository as onboarding creates it: spec (for vending) and its first pull request's files. */
export function customerDelivery(o: InstallContext) {
  const platform = { ...DEFAULT_PLATFORM, org: orgOf(o.delivery) };
  const install = installStem({ solution: o.solution, offering: o.offering });
  const plans = sortEnvs(o.plans.map((x) => x.env)).map((e) => o.plans.find((x) => x.env === e)!);
  const spec = resolveUnit(
    {
      kind: "customer",
      slug: o.code,
      name: o.name,
      tenantId: o.tenantId || null,
      hosted: o.hosted,
      criticality: o.regulated ? "regulated" : "standard",
      environments: plans.map((p) => ({
        env: p.env,
        subscriptionId: p.target === "new_subscription" ? null : p.subscriptionId || null,
        subscriptionName: namesFor(o.code, p, o.delivery).subscription,
        installs: [install],
      })),
      offerings: [install],
    },
    platform,
  );
  const variables = Object.fromEntries(
    Object.entries(o.inputs)
      .filter(([k, v]) => v && k !== "subscriptionId")
      .map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), v]),
  );
  const files = customerRepo(spec, platform, {
    code: o.code,
    tenantId: o.tenantId || null,
    hosted: o.hosted,
    connection: o.hosted ? "isv_hosted" : "federated_identity",
    environments: plans.map((p) => {
      const n = namesFor(o.code, p, o.delivery);
      return {
        env: p.env,
        solution: o.solution,
        offering: o.offering,
        version: o.version,
        digest: null,
        region: p.region,
        target: p.target,
        subscriptionId: p.target === "new_subscription" ? null : p.subscriptionId || null,
        subscriptionName: n.subscription,
        resourceGroup: n.resourceGroup,
        managementGroup: o.placement.at(-1)?.id ?? null,
        variables: {
          install_name: n.install,
          environment: ENV_META[p.env].short,
          location: p.region,
          ...variables,
        },
      };
    }),
  });
  return { spec, files, install };
}

/** The environment files onboarding adds to the customer's repository, shown together. */
export function installFile(o: InstallContext) {
  return customerDelivery(o)
    .files.filter((f) => f.path.startsWith("environments/"))
    .map((f) => f.content.trimEnd())
    .join("\n---\n");
}

/** The customer repository's workflow: one job per environment, in ring order, calling the pinned template. */
export function deliveryWorkflow(o: InstallContext) {
  const { spec, files } = customerDelivery(o);
  if (o.delivery.tool === "azure-devops") {
    const envs = spec.environments.filter((e) => !e.name.endsWith("-plan"));
    return [
      `# azure-pipelines/install.yml · ${orgOf(o.delivery)}/${spec.repository.name}`,
      `trigger:`,
      `  branches: { include: [main] }`,
      `  paths: { include: [environments/*] }`,
      `pr:`,
      `  paths: { include: [environments/*] }`,
      `resources:`,
      `  repositories:`,
      `    - repository: templates  # required template check on every environment`,
      `      type: git`,
      `      name: ${orgOf(o.delivery)}/cd-delivery-templates`,
      `      ref: refs/tags/${DEFAULT_PLATFORM.templatesRef}`,
      `extends:`,
      `  template: install.yml@templates`,
      `  parameters:`,
      `    environments: [${envs.map((e) => e.name).join(", ")}]  # ring order`,
      `    # Each environment has its own workload identity federation service connection, scoped to one`,
      `    # subscription; production carries the approval check (${o.delivery.prodApprovers || "none"}).`,
    ].join("\n");
  }
  return files.find((f) => f.path === ".github/workflows/install.yml")?.content ?? "";
}

/**
 * Architecture review an offering version must pass before it can be published: every offered region
 * supports every service, the landing zone group exists and its policies allow the architecture, and the
 * guardrails every customer install relies on are in place.
 */
export function reviewOffering(opts: {
  selected: Selected[];
  topology: Topology;
  hostingAnswers: unknown;
}): Check[] {
  const { selected, topology } = opts;
  const out: Check[] = [];
  const gaps = topology.regions
    .map((r) => ({ r, missing: unsupportedIn(selected, r) }))
    .filter((x) => x.missing.length);
  out.push(
    gaps.length
      ? {
          id: "regions",
          area: "Regions",
          level: "fail",
          title: `${gaps.length} offered region${gaps.length === 1 ? "" : "s"} can't run this architecture`,
          detail: gaps.map((g) => `${regionLabel(g.r)}: no ${g.missing.join(", ")}`).join(" · "),
        }
      : {
          id: "regions",
          area: "Regions",
          level: "pass",
          title: `All ${topology.regions.length} offered regions support every service`,
          detail: `${selected.length} services checked against Azure's resource provider regions (${regionsSupporting(selected).length} regions could run it).`,
        },
  );
  out.push(...skuChecks(selected, topology));
  const placement = placementFor({
    landing: topology.landing,
    landingZone: topology.landingZone,
    hostingAnswers: opts.hostingAnswers,
    customerName: "Customer",
    customerCode: "customer",
    grantedGroup: "",
  });
  out.push(
    placement.exists
      ? {
          id: "placement",
          area: "Landing zone",
          level: "pass",
          title: `Installs land in ${placement.path.map((p) => p.name).join(" › ")}`,
          detail: `${placement.source}. One subscription per customer environment, all in this group.`,
        }
      : {
          id: "placement",
          area: "Landing zone",
          level: "fail",
          title: `The ${topology.landingZone} group isn't in your hosting tenant's landing zone design`,
          detail: "Add it in Landing zones, or pick another landing zone for the offering.",
        },
  );
  const overrides = answersWithDefaults(opts.hostingAnswers).policyOverrides;
  if (
    topology.landingZone === "corp" &&
    topology.publicAccess &&
    !(topology.landing === "isv-hosted" && overrides["corp/Deny-Public-Endpoints"])
  )
    out.push({
      id: "policy",
      area: "Policy",
      level: "fail",
      title: "Corp denies public endpoints",
      detail:
        "The ALZ Corp policy set assigns Deny-Public-Endpoints and this architecture allows public network access. Move to Online or turn public access off.",
    });
  else if (topology.landingZone === "sandbox" && topology.landing === "existing-customer-hub")
    out.push({
      id: "policy",
      area: "Policy",
      level: "fail",
      title: "Sandbox blocks peering to the hub",
      detail:
        "Enforce-ALZ-Sandbox denies cross-subscription peering and VPN/ExpressRoute gateways.",
    });
  else
    out.push({
      id: "policy",
      area: "Policy",
      level: "pass",
      title: `Compatible with the ${topology.landingZone} policy set`,
      detail:
        topology.landingZone === "corp"
          ? "No public endpoints; private DNS zones are deployed by the platform (Deploy-Private-DNS-Zones)."
          : "Landing zone guardrails (Enforce-GR-*) apply to every install.",
    });
  const privateLink = selected.filter((s) => SERVICE_BY_ID.get(s.id)?.privateLink);
  out.push(
    privateLink.length && !topology.privateEndpoints
      ? {
          id: "private",
          area: "Guardrails",
          level: "fail",
          title: "Data services are reachable publicly",
          detail: `${privateLink.length} services support Private Link; turn on private endpoints.`,
        }
      : {
          id: "private",
          area: "Guardrails",
          level: "pass",
          title: "Private endpoints, managed identity and diagnostics are on",
          detail: `${privateLink.length} service${privateLink.length === 1 ? "" : "s"} behind private endpoints.`,
        },
  );
  for (const [id, name, level] of [
    ["security-baseline", "security baseline", "fail"],
    ["monitoring", "monitoring", "warn"],
  ] as const)
    if (!selected.some((s) => s.id === id))
      out.push({
        id,
        area: "Guardrails",
        level,
        title: `The ${name} module is missing`,
        detail: "Every install needs it; add it on the architecture canvas.",
      });
  const envs = topology.environments;
  out.push(
    !envs.includes("production")
      ? {
          id: "envs",
          area: "Environments",
          level: "warn",
          title: "No production environment offered",
          detail: "Customers can only onboard non-production installs.",
        }
      : envs.length === 1
        ? {
            id: "envs",
            area: "Environments",
            level: "warn",
            title: "Production only",
            detail: "Upgrades will reach production without a non-production ring first.",
          }
        : {
            id: "envs",
            area: "Environments",
            level: "pass",
            title: `${envs.length} environments: ${sortEnvs(envs)
              .map((e) => ENV_META[e as EnvKey]?.label ?? e)
              .join(" → ")}`,
            detail:
              "Each is its own subscription in the same landing zone group; production is gated.",
          },
  );
  return out;
}

export const verdict = (checks: Check[]) =>
  checks.some((c) => c.level === "fail")
    ? "fail"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "pass";

/** What the chosen SKUs mean for the guardrails: private endpoints, SLAs and high availability. */
export function skuChecks(selected: Selected[], topology: Topology): Check[] {
  const out: Check[] = [];
  const noPe: string[] = [];
  const noSla: string[] = [];
  for (const s of selected) {
    const name = SERVICE_BY_ID.get(s.id)?.name ?? s.id;
    for (const x of sizing(s.id, s.settings)) {
      for (const [env, sku] of [
        ["production", x.prod],
        ["dev/test", x.dev],
      ] as const)
        if (topology.privateEndpoints && sku.pe === false && s.id !== "apim")
          noPe.push(`${name} ${sku.value} (${env})`);
      if (/Free|Dev\(No SLA\)|^free$|^F1$/.test(x.prod.value))
        noSla.push(`${name} ${x.prod.label.split(" · ")[0]}`);
    }
    if (
      s.id === "postgres" &&
      s.settings["ha"] !== "Disabled" &&
      !sizing(s.id, s.settings)[0]?.prod.ha
    )
      out.push({
        id: "sku-postgres-ha",
        area: "Sizing",
        level: "warn",
        title: "PostgreSQL high availability needs General Purpose or Memory Optimized",
        detail:
          "Burstable servers run without a standby. Pick a General Purpose SKU for production to get zone-redundant HA.",
      });
  }
  if (noPe.length)
    out.push({
      id: "sku-private",
      area: "Sizing",
      level: topology.landingZone === "corp" ? "warn" : "pass",
      title: `${noPe.length} SKU${noPe.length === 1 ? " has" : "s have"} no private endpoint`,
      detail: `${noPe.join(", ")} stay on their public endpoint (keyless, Entra ID only).${topology.landingZone === "corp" ? " Corp's Deny-Public-Endpoints policy may refuse them — choose a tier with private endpoints." : ""}`,
    });
  if (noSla.length)
    out.push({
      id: "sku-sla",
      area: "Sizing",
      level: "warn",
      title: "Production uses tiers without an SLA",
      detail: `${noSla.join(", ")}. Fine for trials; choose a higher tier for customer production.`,
    });
  if (!noPe.length && !noSla.length && !out.length)
    out.push({
      id: "sku",
      area: "Sizing",
      level: "pass",
      title: "Every SKU fits the guardrails",
      detail:
        "Production and dev/test tiers support private endpoints where the architecture needs them, with an SLA in production.",
    });
  return out;
}
