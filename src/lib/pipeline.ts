/*
 * Generators that turn an architecture selection into the artifacts an ISV would otherwise
 * hand-write per customer: the CI/CD pipeline graph and its YAML (the Terraform itself is in
 * src/lib/offering/terraform.ts).
 */
import { SERVICE_BY_ID, type Selected, type Topology } from "@/lib/catalog";
import {
  DEFAULT_PLATFORM,
  ENV_SHORT,
  repoName,
  slugify,
  sortEnvironments,
} from "@/lib/delivery/model";

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
      detail: `${def.id}.tf · ${def.resourceType}`,
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
          id: "tf-validate",
          name: "Terraform fmt & validate",
          detail: "terraform fmt -check · terraform validate",
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
        id: `plan-${e}`,
        name: `Plan · ${e}`,
        detail: "terraform plan -out=tfplan",
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
        ...(selected.some((s) => s.id === "sre-agent")
          ? [
              {
                id: "sre-brief",
                name: "Brief the SRE Agent",
                detail: "sre-agent/brief.sh · design knowledge, drift and target checks",
              },
            ]
          : []),
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

/**
 * How an offering is delivered: its solution repository (sol-<solution>) releases it with the pinned solution
 * template — build once, attest, sandbox deploy, publish — and customers receive it through promotion pull
 * requests on their own cust-<code> repositories, environment by environment.
 */
export function workflowFor(
  solution: string,
  offering: string,
  topology: Topology,
  flavour: "github-actions" | "azure-devops",
) {
  const p = DEFAULT_PLATFORM;
  const repo = repoName("solution", solution);
  const envs = sortEnvironments(topology.environments).map((e) => ENV_SHORT[e] ?? e);
  const install = `${slugify(solution)}-${slugify(offering)}`;
  const footer = [
    ``,
    `# Release ${offering}: tag ${offering}/vX.Y.Z on main.`,
    `#   validate → build offerings/${offering}/ once → attest → sandbox deploy → publish the release`,
    `# The control plane registers the release as an immutable version with its digest, then rolls it out in`,
    `# waves: a promotion pull request per customer repository changes`,
    `#   cust-<code>/environments/<env>/${install}.yaml  (${envs.join(" → ")})`,
    `# and each customer's own pipeline plans, waits for approval where required, and applies.`,
  ];
  if (flavour === "azure-devops")
    return [
      `# ${repo}/azure-pipelines/solution.yml — extends the required template`,
      `trigger:`,
      `  tags: { include: ["*/v*"] }`,
      `pr:`,
      `  branches: { include: [main] }`,
      `resources:`,
      `  repositories:`,
      `    - repository: templates`,
      `      type: git`,
      `      name: ${p.org}/${p.templatesRepo}`,
      `      ref: refs/tags/${p.templatesRef}`,
      `extends:`,
      `  template: solution.yml@templates  # environments: sandbox (service connection), release (approval)`,
      ...footer,
    ].join("\n");
  return [
    `# ${repo}/.github/workflows/solution.yml — calls the pinned template`,
    `name: solution`,
    `on:`,
    `  pull_request:`,
    `  push:`,
    `    tags: ["*/v*"]`,
    `permissions: {}`,
    `jobs:`,
    `  solution:`,
    `    uses: ${p.org}/${p.templatesRepo}/.github/workflows/solution.yml@${p.templatesRef}`,
    `    permissions:`,
    `      contents: write`,
    `      id-token: write`,
    `      attestations: write`,
    ...footer,
  ].join("\n");
}
