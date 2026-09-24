/*
 * Generators that turn an architecture selection into the artifacts an ISV would otherwise
 * hand-write per customer: the Bicep entry point, the CI/CD pipeline graph and its YAML.
 */
import { SERVICE_BY_ID, type Selected, type Topology, inputsFor } from "@/lib/catalog";

export type Job = { id: string; name: string; module?: string; detail: string; gate?: boolean };
export type Stage = { id: string; name: string; jobs: Job[] };

const WAVE_NAME = [
  "Foundation",
  "Network & shared services",
  "Data & messaging",
  "Compute",
  "Ingress & private link",
  "Protection",
];

/** Stages → jobs, in the order the central pipeline runs them for every customer install. */
export function pipelineFor(selected: Selected[], topology: Topology): Stage[] {
  const deployable = selected.filter((s) => s.id !== "security-baseline");
  const waves = new Map<number, Job[]>();
  for (const s of deployable) {
    const def = SERVICE_BY_ID.get(s.id);
    if (!def) continue;
    const jobs = waves.get(def.wave) ?? [];
    jobs.push({
      id: `deploy-${def.id}`,
      name: def.short,
      module: def.id,
      detail: `${def.avm}:${def.version}`,
    });
    waves.set(def.wave, jobs);
  }
  const envs = topology.environments.length ? topology.environments : ["production"];

  return [
    {
      id: "validate",
      name: "Validate",
      jobs: [
        {
          id: "bicep-build",
          name: "Bicep build & lint",
          detail: "az bicep build · PSRule for Azure",
        },
        {
          id: "policy-whatif",
          name: "Customer policy check",
          detail: "Evaluate the customer's Azure Policy assignments",
        },
        {
          id: "preflight",
          name: "Landing-zone preflight",
          detail: "RBAC, quotas, CIDR, DNS, providers",
        },
      ],
    },
    {
      id: "plan",
      name: "Plan",
      jobs: envs.map((e) => ({
        id: `whatif-${e}`,
        name: `What-if · ${e}`,
        detail: "az deployment sub what-if",
      })),
    },
    {
      id: "approve",
      name: "Approve",
      jobs: [
        {
          id: "approval",
          name: "Production approval",
          detail: "Security approver · environment protection rule",
          gate: true,
        },
      ],
    },
    ...[...waves.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wave, jobs]) => ({
        id: `deploy-${wave}`,
        name: `Deploy · ${WAVE_NAME[wave] ?? `Wave ${wave}`}`,
        jobs,
      })),
    {
      id: "verify",
      name: "Verify",
      jobs: [
        {
          id: "verify-policy",
          name: "Policy validation",
          module: "security-baseline",
          detail: "Compliance scan of the install scope",
        },
        { id: "smoke", name: "Smoke tests", detail: "Health probes through private ingress" },
        { id: "baseline", name: "Record desired state", detail: "Snapshot for drift detection" },
      ],
    },
  ];
}

/** Deployment steps executed by the engine, in pipeline order. */
export function deploySteps(selected: Selected[], topology: Topology) {
  const stages = pipelineFor(selected, topology);
  return stages
    .filter((s) => s.id.startsWith("deploy-") || s.id === "verify")
    .flatMap((s) => s.jobs.filter((j) => j.module))
    .map((j) => ({ name: j.name, module: j.module as string }));
}

const camel = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export function bicepFor(productSlug: string, selected: Selected[], topology: Topology) {
  const inputs = inputsFor(selected, topology);
  const lines: string[] = [
    `// Generated from the ${productSlug} product definition. Do not edit per customer —`,
    `// customer differences are parameters, not forks.`,
    `targetScope = 'subscription'`,
    ``,
    `@description('Install name, e.g. metro-energy-prod')`,
    `param installName string`,
    `@allowed([${topology.regions.map((r) => `'${r}'`).join(", ")}])`,
    `param location string`,
    ...inputs
      .filter((i) => i.key !== "subscriptionId")
      .flatMap((i) => [
        `@description('${i.label} — supplied by ${i.source === "customer" ? "the customer" : "your team"}')`,
        `param ${i.key} string`,
      ]),
    ``,
  ];
  for (const s of selected) {
    const def = SERVICE_BY_ID.get(s.id);
    if (!def) continue;
    const params = Object.entries(s.settings).map(([k, v]) => `    ${k}: '${v}'`);
    if (def.privateLink && topology.privateEndpoints)
      params.push(`    publicNetworkAccess: 'Disabled'`);
    lines.push(
      `module ${camel(def.id)} 'br/public:${def.avm}:${def.version}' = {`,
      def.id === "resource-group"
        ? `  name: '\${installName}-rg'`
        : `  scope: resourceGroup('rg-\${installName}')`,
      `  params: {`,
      `    name: '${def.id}-\${installName}'`,
      ...(def.id === "resource-group" ? [] : [`    location: location`]),
      ...params,
      `  }`,
      `}`,
      ``,
    );
  }
  return lines.join("\n");
}

export function workflowFor(
  productSlug: string,
  selected: Selected[],
  topology: Topology,
  flavour: "github-actions" | "azure-devops",
) {
  const stages = pipelineFor(selected, topology);
  if (flavour === "azure-devops") {
    return [
      `# azure-pipelines/deliver-${productSlug}.yml — one pipeline for every customer install`,
      `parameters:`,
      `  - name: install`,
      `    type: string`,
      `extends:`,
      `  template: templates/isv-delivery.yml@platform`,
      `  parameters:`,
      `    install: \${{ parameters.install }}`,
      `    stages:`,
      ...stages.flatMap((s) => [
        `      - stage: ${s.id.replace(/-/g, "_")}`,
        `        displayName: ${s.name}`,
        ...(s.jobs.some((j) => j.gate)
          ? [`        environment: customer-production  # approval check`]
          : []),
        `        jobs:`,
        ...s.jobs.map((j) => `          - job: ${j.id.replace(/-/g, "_")}  # ${j.name}`),
      ]),
    ].join("\n");
  }
  return [
    `# .github/workflows/deliver-${productSlug}.yml — one workflow for every customer install`,
    `name: deliver-${productSlug}`,
    `on:`,
    `  workflow_dispatch:`,
    `    inputs:`,
    `      install: { required: true, description: "Customer install, e.g. metro-energy-prod" }`,
    `permissions: { id-token: write, contents: read }  # OIDC federation, no secrets`,
    `jobs:`,
    ...stages.flatMap((s, i) => [
      `  ${s.id}:`,
      `    name: ${s.name}`,
      ...(i > 0 ? [`    needs: ${stages[i - 1]?.id}`] : []),
      ...(s.jobs.some((j) => j.gate)
        ? [`    environment: customer-production  # required reviewers`]
        : []),
      `    uses: ./.github/workflows/isv-stage.yml`,
      `    with:`,
      `      install: \${{ inputs.install }}`,
      `      steps: ${JSON.stringify(s.jobs.map((j) => j.id))}`,
    ]),
  ].join("\n");
}
