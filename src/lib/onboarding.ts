/*
 * Customer onboarding and delivery model, shared by the onboarding wizard, the offering review and the
 * server. Onboarding a customer is configuration: one install file per customer, committed to the ISV's
 * delivery repository, picked up by the same GitHub Actions (or Azure Pipelines) workflow for every customer.
 */
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
  repo: string;
  /** Non-production environments deploy as soon as their plan is clean. */
  autoDeployNonProd: boolean;
  prodApprovers: string;
  /** Minutes production waits after the previous ring succeeds (GitHub wait timer / ADO delay). */
  prodWaitMinutes: number;
  driftSchedule: boolean;
};

export const DEFAULT_DELIVERY: Delivery = {
  tool: "github-actions",
  repo: "gridworks/cloud-delivery",
  autoDeployNonProd: true,
  prodApprovers: "platform-approvers",
  prodWaitMinutes: 0,
  driftSchedule: true,
};

export const TOOL_META: Record<DeliveryTool, { title: string; body: string }> = {
  "github-actions": {
    title: "GitHub Actions",
    body: "Pull request per onboarding, GitHub environments per customer environment, OIDC to Azure — no secrets.",
  },
  "azure-devops": {
    title: "Azure Pipelines",
    body: "Same flow on Azure DevOps: build validation on the pull request, environments with approvals and checks, workload identity federation.",
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

export function namesFor(code: string, p: EnvPlan, d: Delivery): Names {
  const short = ENV_META[p.env].short;
  const install = `${code}-${short}`;
  const environment = install;
  return {
    install,
    subscription: `sub-${install}`,
    resourceGroup:
      p.target === "existing_resource_group" && p.resourceGroup ? p.resourceGroup : `rg-${install}`,
    environment,
    oidcSubject:
      d.tool === "github-actions"
        ? `repo:${d.repo}:environment:${environment}`
        : `sc://${d.repo.split("/")[0]}/${d.repo.split("/")[1] ?? "delivery"}/${install}`,
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
  const answers: Answers =
    opts.landing === "isv-hosted"
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
      opts.landing === "isv-hosted"
        ? "Your hosting tenant's landing zone design"
        : "New landing zone built from Microsoft's defaults",
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
  return [
    {
      event: gh ? "pull_request" : "PR build validation",
      when: `Onboarding opens a pull request adding installs/${code}.yaml`,
      runs: "Validate and plan (what-if) every environment; results posted on the pull request",
    },
    {
      event: gh ? "push → main" : "CI trigger · main",
      when: "The pull request is merged",
      runs: "Deploy ring by ring; production waits for its reviewers",
    },
    {
      event: gh ? "repository_dispatch · release" : "Pipeline resource · release",
      when: "A new offering version is published",
      runs: "Upgrade every install on the offering, in waves",
    },
    ...(d.driftSchedule
      ? [
          {
            event: gh ? "schedule · 0 5 * * *" : "Scheduled trigger · daily",
            when: "Every night",
            runs: "Drift check (what-if) on every install; opens an issue when something changed",
          },
        ]
      : []),
    {
      event: gh ? "workflow_dispatch" : "Manual run",
      when: "Someone runs it by hand",
      runs: "Redeploy or repair one install",
    },
  ];
}

/** The customer's install file: the only thing onboarding adds to the repository. */
export function installFile(o: {
  code: string;
  name: string;
  offering: string;
  version: string;
  landingZone: string;
  placement: PlacementNode[];
  plans: EnvPlan[];
  delivery: Delivery;
  inputs: Record<string, string>;
  tenantId: string;
}) {
  const lines = [
    `# installs/${o.code}.yaml — added by Cloud Delivery. One file per customer; no per-customer code.`,
    `customer: ${o.code}`,
    `name: ${JSON.stringify(o.name)}`,
    `offering: ${o.offering}`,
    `version: ${o.version}`,
    ...(o.tenantId ? [`tenant: ${o.tenantId}`] : []),
    `placement: ${o.placement.map((p) => p.id).join(" / ")}`,
    `environments:`,
  ];
  for (const p of sortEnvs(o.plans.map((x) => x.env)).map((e) =>
    o.plans.find((x) => x.env === e)!,
  )) {
    const n = namesFor(o.code, p, o.delivery);
    lines.push(
      `  ${ENV_META[p.env].short}:`,
      `    region: ${p.region}`,
      `    target: ${p.target}`,
      ...(p.target === "new_subscription"
        ? [
            `    subscription: { vend: ${n.subscription}, managementGroup: ${o.placement.at(-1)?.id} }`,
          ]
        : [`    subscription: ${p.subscriptionId || "<from install link>"}`]),
      `    resourceGroup: ${n.resourceGroup}`,
      `    ${o.delivery.tool === "github-actions" ? "githubEnvironment" : "adoEnvironment"}: ${n.environment}`,
    );
  }
  const keys = Object.entries(o.inputs).filter(([k, v]) => v && k !== "subscriptionId");
  if (keys.length) {
    lines.push(`inputs:`);
    for (const [k, v] of keys) lines.push(`  ${k}: ${JSON.stringify(v)}`);
  }
  return lines.join("\n");
}

/** The single delivery workflow every customer install runs through. */
export function deliveryWorkflow(slug: string, d: Delivery) {
  if (d.tool === "azure-devops")
    return [
      `# azure-pipelines/deliver.yml — one pipeline for every customer install`,
      `trigger:`,
      `  branches: { include: [main] }`,
      `  paths: { include: [installs/*] }`,
      `pr:`,
      `  paths: { include: [installs/*] }`,
      ...(d.driftSchedule
        ? [
            `schedules:`,
            `  - cron: "0 5 * * *"`,
            `    displayName: Nightly drift check`,
            `    always: true`,
          ]
        : []),
      `resources:`,
      `  pipelines:`,
      `    - pipeline: release`,
      `      source: ${slug}-release  # a published offering version upgrades every install`,
      `stages:`,
      `  - stage: validate`,
      `    jobs: [{ template: templates/validate.yml }]  # bicep build, PSRule, policy + quota preflight`,
      `  - stage: plan`,
      `    jobs: [{ template: templates/whatif.yml }]  # az deployment what-if per environment`,
      `  - template: templates/rings.yml  # one deployment job per environment, in order`,
      `    parameters:`,
      `      environments: \${{ split(variables.installEnvironments, ',') }}`,
      `      # Environment "<customer>-prod" carries the approval check (${d.prodApprovers || "none"})`,
      `      # and workload identity federation to the customer's subscription.`,
    ].join("\n");
  return [
    `# .github/workflows/deliver.yml — one workflow for every customer install`,
    `name: deliver`,
    `on:`,
    `  pull_request: { paths: ["installs/**"] }`,
    `  push: { branches: [main], paths: ["installs/**"] }`,
    `  repository_dispatch: { types: [release-published] }  # new offering version`,
    ...(d.driftSchedule ? [`  schedule: [{ cron: "0 5 * * *" }]  # nightly drift check`] : []),
    `  workflow_dispatch:`,
    `    inputs: { install: { required: true, description: "e.g. metro-energy-prod" } }`,
    `permissions: { id-token: write, contents: read, pull-requests: write }`,
    `jobs:`,
    `  changed:`,
    `    runs-on: ubuntu-latest`,
    `    outputs: { installs: \${{ steps.list.outputs.installs }} }`,
    `    steps:`,
    `      - uses: actions/checkout@v4`,
    `      - id: list  # installs × environments touched by this event`,
    `        run: ./delivery/list-installs.sh "\${{ github.event_name }}" >> "$GITHUB_OUTPUT"`,
    `  plan:`,
    `    needs: changed`,
    `    strategy: { matrix: { install: \${{ fromJson(needs.changed.outputs.installs) }} } }`,
    `    runs-on: ubuntu-latest`,
    `    environment: \${{ matrix.install }}-plan  # read-only identity`,
    `    steps:`,
    `      - uses: actions/checkout@v4`,
    `      - uses: azure/login@v2  # OIDC: federated credential per GitHub environment`,
    `        with: { client-id: \${{ vars.AZURE_CLIENT_ID }}, tenant-id: \${{ vars.AZURE_TENANT_ID }}, subscription-id: \${{ vars.AZURE_SUBSCRIPTION_ID }} }`,
    `      - run: ./delivery/validate.sh \${{ matrix.install }}   # bicep build, PSRule, policy + quota preflight`,
    `      - run: ./delivery/whatif.sh \${{ matrix.install }}     # posts the plan on the pull request`,
    `  deploy:`,
    `    if: github.event_name != 'pull_request'`,
    `    needs: [changed, plan]`,
    `    strategy: { max-parallel: 1, matrix: { install: \${{ fromJson(needs.changed.outputs.installs) }} } }  # ring order: dev → … → prod`,
    `    runs-on: ubuntu-latest`,
    `    environment: \${{ matrix.install }}  # prod: required reviewers (${d.prodApprovers || "none"})${d.prodWaitMinutes ? `, wait timer ${d.prodWaitMinutes} min` : ""}`,
    `    steps:`,
    `      - uses: actions/checkout@v4`,
    `      - uses: azure/login@v2`,
    `        with: { client-id: \${{ vars.AZURE_CLIENT_ID }}, tenant-id: \${{ vars.AZURE_TENANT_ID }}, subscription-id: \${{ vars.AZURE_SUBSCRIPTION_ID }} }`,
    `      - run: ./delivery/deploy.sh \${{ matrix.install }}     # az deployment sub create, then policy + smoke tests`,
  ].join("\n");
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
