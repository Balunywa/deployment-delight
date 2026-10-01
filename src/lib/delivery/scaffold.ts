/*
 * What vending puts in each unit repository. Unit repositories hold configuration and pins; the code that is the same
 * for everyone (pipeline templates, Terraform generators, modules) is referenced at a pinned version, never copied.
 *
 *   lz-<tenant>     landing-zone.yaml + terraform/ rendered by the console (reviewed as a diff) + caller workflows
 *   sol-<product>   solution.yaml + offerings/<model>/{manifest.json, terraform/, sandbox.tfvars.json}
 *   cust-<code>     customer.yaml + environments/<env>.yaml (offering version + inputs), nothing else
 */
import {
  type Platform,
  type UnitSpec,
  ENV_SHORT,
  UNIT_META,
  slugify,
  sortEnvironments,
} from "./model";

export type ScaffoldFile = { path: string; content: string };

/** Minimal YAML for plain data: objects, arrays, strings, numbers, booleans and null. */
export function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  const scalar = (v: unknown) =>
    v === null || v === undefined
      ? "null"
      : typeof v === "string"
        ? /^[A-Za-z0-9_./@:+-][A-Za-z0-9_ ./@:+-]*$/.test(v) &&
          !/^(true|false|null|yes|no|on|off|~|[-+]?\d[\d.]*)$/i.test(v) &&
          !v.includes(": ") &&
          !v.endsWith(":")
          ? v
          : JSON.stringify(v)
        : String(v);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((v) =>
        v && typeof v === "object"
          ? `${pad}- ${toYaml(v, indent + 2).trimStart()}`
          : `${pad}- ${scalar(v)}`,
      )
      .join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (!entries.length) return "{}";
    return entries
      .map(([k, v]) => {
        const key = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? k : JSON.stringify(k);
        if (v && typeof v === "object" && (Array.isArray(v) ? v.length : Object.keys(v).length))
          return `${pad}${key}:\n${toYaml(v, indent + 2)}`;
        return `${pad}${key}: ${Array.isArray(v) ? "[]" : v && typeof v === "object" ? "{}" : scalar(v)}`;
      })
      .join("\n");
  }
  return `${pad}${scalar(value)}`;
}

const header = (path: string, spec: UnitSpec, note: string) =>
  `# ${path} · ${spec.repository.owner}/${spec.repository.name}\n# ${note}\n`;

const team = (spec: UnitSpec, t: string) => `@${spec.repository.owner}/${t}`;

const templateRef = (spec: UnitSpec, p: Platform, file: string) =>
  `${p.org}/${p.templatesRepo}/.github/workflows/${file}@${p.templatesRef}`;

function readme(spec: UnitSpec, p: Platform, extra: string[] = []): ScaffoldFile {
  const meta = UNIT_META[spec.kind];
  return {
    path: "README.md",
    content: [
      `# ${spec.repository.name}`,
      "",
      `${meta.label}: **${spec.name}**. ${meta.purpose}`,
      "",
      `- **Branching:** ${spec.branching}`,
      `- **Promotion:** ${spec.promotion}`,
      `- **Pipeline:** \`${spec.pipeline.template ? templateRef(spec, p, spec.pipeline.template) : "none"}\``,
      "",
      "## Environments",
      "",
      "| Environment | Purpose | Required reviewers | Wait | Deploys from |",
      "|---|---|---|---|---|",
      ...spec.environments.map(
        (e) =>
          `| \`${e.name}\` | ${e.purpose} | ${e.reviewers.map((r) => `@${spec.repository.owner}/${r}`).join(", ") || "—"} | ${e.waitMinutes ? `${e.waitMinutes} min` : "—"} | ${e.deploymentRefs.map((r) => `\`${r}\``).join(", ")} |`,
      ),
      "",
      "## Cloud identities",
      "",
      "Each identity trusts one environment of this repository, and only when it runs the pinned template.",
      "",
      "| Identity | Environment | Scope | Roles |",
      "|---|---|---|---|",
      ...spec.identities.map(
        (i) => `| \`${i.name}\` | \`${i.environment}\` | \`${i.scope}\` | ${i.roles.join(", ")} |`,
      ),
      "",
      "## Terraform state",
      "",
      "| Environment | Where | Account / container / key |",
      "|---|---|---|",
      ...spec.state.map(
        (s) =>
          `| \`${s.environment}\` | ${s.location === "customer" ? "customer's subscription" : s.location === "tenant" ? "this tenant's management subscription" : "ISV state account"} | \`${s.storageAccount}/${s.container}/${s.key}\` |`,
      ),
      ...extra,
      "",
      "Created by Cloud Delivery vending. Settings, environments and identities are managed through `cd-vending`;",
      "don't change them here.",
      "",
    ].join("\n"),
  };
}

const BACKEND = `terraform {
  # State lives in this unit's own backend; the pipeline passes account, container and key.
  backend "azurerm" {}
}
`;

export type LandingZoneScaffold = {
  tenantId: string | null;
  managementGroupId: string;
  libraryRef: string;
  answers: unknown;
  terraform: { path: string; content: string }[];
};

export function landingZoneRepo(
  spec: UnitSpec,
  p: Platform,
  lz: LandingZoneScaffold,
): ScaffoldFile[] {
  return [
    readme(spec, p),
    {
      path: "landing-zone.yaml",
      content:
        header(
          "landing-zone.yaml",
          spec,
          "Design answers. The console renders terraform/ from these and opens a pull request with both.",
        ) +
        toYaml({
          tenant: lz.tenantId,
          intermediateRoot: lz.managementGroupId,
          alzLibrary: lz.libraryRef,
          answers: lz.answers,
        }) +
        "\n",
    },
    ...lz.terraform.map((f) => ({ path: `terraform/${f.path}`, content: f.content })),
    { path: "terraform/backend.tf", content: BACKEND },
    {
      path: ".github/workflows/landing-zone.yml",
      content: `name: landing-zone
run-name: >-
  \${{ github.event_name == 'pull_request' && format('Plan · #{0} {1}', github.event.pull_request.number, github.event.pull_request.title)
  || github.event_name == 'workflow_dispatch' && format('{0} · run by {1}', inputs.action, github.actor)
  || format('Apply · {0}', github.event.head_commit.message) }}
on:
  pull_request:
  push:
    branches: [main]
    paths: ["terraform/**", ".github/workflows/landing-zone.yml"]
  workflow_dispatch:
    inputs:
      action:
        description: plan only, plan and apply main, or destroy everything in state
        type: choice
        options: [plan, apply, destroy]
        default: plan
permissions: {}
concurrency:
  group: landing-zone-\${{ github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}
jobs:
  landing-zone:
    uses: ${templateRef(spec, p, "lz.yml")}
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    with:
      apply: \${{ github.event_name == 'push' || inputs.action == 'apply' || inputs.action == 'destroy' }}
      destroy: \${{ inputs.action == 'destroy' }}
`,
    },
    driftCaller(spec, p, ["plan"], "terraform"),
    {
      path: ".github/CODEOWNERS",
      content: [
        `* ${team(spec, p.teams.platform)}`,
        `/terraform/ ${team(spec, p.teams.platform)}`,
        `/landing-zone.yaml ${team(spec, p.teams.platform)} ${team(spec, p.teams.security)}`,
        `/.github/ ${team(spec, p.teams.platform)} ${team(spec, p.teams.security)}`,
        "",
      ].join("\n"),
    },
  ];
}

export type SolutionScaffold = {
  owners: { name: string; email: string; role: string }[];
  industry: string | null;
  tags: string[];
  source: { repository: string; revision?: string } | null;
  offerings: {
    slug: string;
    name: string;
    version: string;
    manifest: unknown;
    terraform: { path: string; content: string }[];
    sandbox: Record<string, unknown>;
  }[];
};

export function solutionRepo(spec: UnitSpec, p: Platform, s: SolutionScaffold): ScaffoldFile[] {
  return [
    readme(spec, p, [
      "",
      "## Releasing an offering",
      "",
      "Tag `<offering>/vX.Y.Z` on main. The pipeline builds `offerings/<offering>/` once, attests it, test deploys",
      "it to the sandbox, and publishes the release the control plane registers as an immutable version.",
      "To patch an old version, cherry-pick the fix from main to `release/<offering>/vX.Y` and tag there.",
    ]),
    {
      path: "solution.yaml",
      content:
        header("solution.yaml", spec, "Catalog metadata: shown in the Solution catalog.") +
        toYaml({
          name: spec.name,
          industry: s.industry,
          tags: s.tags,
          owners: s.owners,
          source: s.source,
          offerings: s.offerings.map((o) => ({ slug: o.slug, name: o.name, latest: o.version })),
        }) +
        "\n",
    },
    ...s.offerings.flatMap((o) => [
      {
        path: `offerings/${o.slug}/manifest.json`,
        content: `${JSON.stringify(o.manifest, null, 2)}\n`,
      },
      ...o.terraform.map((f) => ({
        path: `offerings/${o.slug}/terraform/${f.path}`,
        content: f.content,
      })),
      { path: `offerings/${o.slug}/terraform/backend.tf`, content: BACKEND },
      {
        path: `offerings/${o.slug}/sandbox.tfvars.json`,
        content: `${JSON.stringify(o.sandbox, null, 2)}\n`,
      },
    ]),
    {
      path: ".github/workflows/solution.yml",
      content: `name: solution
on:
  pull_request:
  push:
    tags: ["*/v*"]
permissions: {}
jobs:
  solution:
    uses: ${templateRef(spec, p, "solution.yml")}
    permissions:
      contents: write
      id-token: write
      attestations: write
`,
    },
    {
      path: ".github/CODEOWNERS",
      content: [
        `* ${team(spec, spec.repository.customProperties["cd-owner-team"]!)}`,
        `/offerings/*/terraform/ ${team(spec, spec.repository.customProperties["cd-owner-team"]!)} ${team(spec, p.teams.platform)}`,
        `/.github/ ${team(spec, p.teams.platform)} ${team(spec, p.teams.security)}`,
        "",
      ].join("\n"),
    },
  ];
}

export type CustomerEnvironment = {
  env: string;
  solution: string;
  offering: string;
  version: string;
  digest: string | null;
  region: string;
  target: string;
  subscriptionId: string | null;
  subscriptionName: string;
  resourceGroup: string;
  managementGroup: string | null;
  variables: Record<string, unknown>;
};

export type CustomerScaffold = {
  code: string;
  tenantId: string | null;
  hosted: boolean;
  connection: string;
  environments: CustomerEnvironment[];
};

/** The install file stem: one per offering the customer runs, e.g. grid-analytics-enterprise-private. */
export const installStem = (e: Pick<CustomerEnvironment, "solution" | "offering">) =>
  slugify(`${e.solution}-${e.offering}`);

/** One install's pin in one environment: the only thing promotion pull requests change. */
export function environmentFile(spec: UnitSpec, e: CustomerEnvironment): ScaffoldFile {
  const short = ENV_SHORT[e.env] ?? e.env;
  const path = `environments/${short}/${installStem(e)}.yaml`;
  return {
    path,
    content:
      header(
        path,
        spec,
        "Changed by promotion pull requests from the control plane. The digest must match the attested release.",
      ) +
      toYaml({
        environment: e.env,
        offering: {
          solution: e.solution,
          model: e.offering,
          version: e.version,
          digest: e.digest ?? "sha256:<recorded when the solution released this version>",
        },
        region: e.region,
        target: e.target,
        subscription: e.subscriptionId ?? `<vend:${e.subscriptionName}>`,
        resourceGroup: e.resourceGroup,
        managementGroup: e.managementGroup,
        inputs: e.variables,
      }) +
      "\n",
  };
}

export function customerRepo(spec: UnitSpec, p: Platform, c: CustomerScaffold): ScaffoldFile[] {
  const envs = sortEnvironments([...new Set(c.environments.map((e) => e.env))]);
  const shorts = envs.map((e) => ENV_SHORT[e] ?? e);
  const installs = [...new Set(c.environments.map(installStem))];
  const regulated = spec.repository.customProperties["cd-criticality"] === "regulated";
  const permissions = `    permissions:
      id-token: write
      contents: read
      attestations: read
      issues: write`;
  const call = (short: string, install: string, apply: string, needs?: string) =>
    `  ${install}-${short}:
${needs ? `    needs: ${needs}\n` : ""}    uses: ${templateRef(spec, p, "install.yml")}
    secrets: inherit
${permissions}
    with:
      environment: ${short}
      install: ${install}
      apply: ${apply}`;
  // Ring order inside the customer: each install's environment waits for its previous environment.
  const pairs = installs.flatMap((install) =>
    c.environments
      .filter((e) => installStem(e) === install)
      .map((e) => ENV_SHORT[e.env] ?? e.env)
      .sort((a, b) => shorts.indexOf(a) - shorts.indexOf(b))
      .map((short, i, list) => ({ install, short, prev: list[i - 1] })),
  );
  const jobs = pairs
    .map((x) =>
      call(
        x.short,
        x.install,
        "${{ github.event_name != 'pull_request' }}",
        x.prev ? `${x.install}-${x.prev}` : undefined,
      ),
    )
    .join("\n");
  return [
    readme(spec, p, [
      "",
      "## How a version reaches this customer",
      "",
      "The control plane opens a pull request changing `offering.version` and `offering.digest` in",
      "`environments/<env>/<install>.yaml`, one ring at a time. The pull request plans every changed install;",
      "merging applies them environment by environment, and production waits for its reviewers and bake time.",
    ]),
    {
      path: "customer.yaml",
      content:
        header(
          "customer.yaml",
          spec,
          "Who this customer is and how Cloud Delivery reaches their Azure.",
        ) +
        toYaml({
          customer: c.code,
          name: spec.name,
          tenant: c.tenantId,
          hostedBy: c.hosted ? "isv" : "customer",
          connection: c.connection,
          environments: shorts,
          installs,
        }) +
        "\n",
    },
    ...c.environments.map((e) => environmentFile(spec, e)),
    {
      path: ".github/workflows/install.yml",
      content: `name: install
on:
  pull_request:
    paths: ["environments/**"]
  push:
    branches: [main]
    paths: ["environments/**"]
  workflow_dispatch: {}
permissions: {}
jobs:
${jobs}
`,
    },
    {
      // Customers have no Terraform in the repository; drift is the install plan, run nightly without apply.
      path: ".github/workflows/drift.yml",
      content: `name: drift
on:
  schedule:
    - cron: "0 5 * * *"
  workflow_dispatch: {}
permissions: {}
jobs:
${pairs.map((x) => call(x.short, x.install, "false")).join("\n")}
`,
    },
    {
      path: ".github/CODEOWNERS",
      content: [
        `* ${team(spec, p.teams.delivery)}`,
        ...(shorts.includes("prod")
          ? [
              `/environments/prod/ ${team(spec, p.teams.delivery)}${regulated ? ` ${team(spec, p.teams.security)}` : ""}`,
            ]
          : []),
        `/.github/ ${team(spec, p.teams.platform)} ${team(spec, p.teams.security)}`,
        "",
      ].join("\n"),
    },
  ];
}

function driftCaller(
  spec: UnitSpec,
  p: Platform,
  environments: string[],
  directory: string,
): ScaffoldFile {
  return {
    path: ".github/workflows/drift.yml",
    content: `name: drift
on:
  schedule:
    - cron: "0 5 * * *"
  workflow_dispatch: {}
permissions: {}
jobs:
${environments
  .map(
    (e) => `  ${e.replace(/[^a-z0-9-]/g, "-")}:
    uses: ${templateRef(spec, p, "drift.yml")}
    permissions:
      id-token: write
      contents: read
      issues: write
    with:
      environment: ${e}
      directory: ${directory}`,
  )
  .join("\n")}
`,
  };
}
