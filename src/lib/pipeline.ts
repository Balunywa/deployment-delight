/*
 * Generators that turn an architecture selection into the artifacts an ISV would otherwise
 * hand-write per customer: the CI/CD pipeline graph and its YAML (the Terraform itself is in
 * src/lib/offering/terraform.ts).
 */
import { SERVICE_BY_ID, type Selected, type Topology } from "@/lib/catalog";

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

const ENV_SHORT: Record<string, string> = {
  development: "dev",
  test: "test",
  qa: "qa",
  uat: "uat",
  staging: "stg",
  production: "prod",
};
const ENV_ORDER = ["development", "test", "qa", "uat", "staging", "production"];

/**
 * The CI/CD workflow every customer install runs: validate once, then plan and apply each environment in
 * ring order with its own Terraform state; production waits for the environment's required reviewers.
 */
export function workflowFor(
  productSlug: string,
  _selected: Selected[],
  topology: Topology,
  flavour: "github-actions" | "azure-devops",
) {
  const envs = ENV_ORDER.filter((e) => topology.environments.includes(e)).map(
    (e) => ENV_SHORT[e] ?? e,
  );
  const dir = `offerings/${productSlug}`;
  if (flavour === "azure-devops") {
    return [
      `# azure-pipelines/deliver-${productSlug}.yml — one pipeline for every customer install`,
      `parameters:`,
      `  - name: install`,
      `    displayName: Customer code, e.g. metro-energy`,
      `    type: string`,
      `trigger: none`,
      `pool: { vmImage: ubuntu-latest }`,
      `stages:`,
      `  - stage: land`,
      `    displayName: Land`,
      `    jobs:`,
      `      - job: validate`,
      `        steps:`,
      `          - task: TerraformInstaller@1`,
      `          - script: terraform -chdir=${dir} fmt -check && terraform -chdir=${dir} init -backend=false && terraform -chdir=${dir} validate`,
      ...envs.flatMap((e, i) => [
        `  - stage: ${e}`,
        `    dependsOn: ${i === 0 ? "land" : envs[i - 1]}`,
        `    jobs:`,
        `      - deployment: deploy_${e}`,
        `        environment: \${{ parameters.install }}-${e}  # approvals and checks live on the environment`,
        `        strategy:`,
        `          runOnce:`,
        `            deploy:`,
        `              steps:`,
        `                - checkout: self`,
        `                - task: TerraformInstaller@1`,
        `                - task: AzureCLI@2  # workload identity federation, no secrets`,
        `                  inputs:`,
        `                    azureSubscription: \${{ parameters.install }}-${e}`,
        `                    scriptType: bash`,
        `                    addSpnToEnvironment: true`,
        `                    inlineScript: |`,
        `                      export ARM_USE_OIDC=true ARM_OIDC_TOKEN=$idToken ARM_CLIENT_ID=$servicePrincipalId ARM_TENANT_ID=$tenantId`,
        `                      terraform -chdir=${dir} init -backend-config=key=\${{ parameters.install }}-${e}.tfstate`,
        `                      terraform -chdir=${dir} plan -var-file=../../installs/\${{ parameters.install }}/${e}.tfvars.json -out=tfplan`,
        `                      terraform -chdir=${dir} apply tfplan`,
        `                      terraform -chdir=${dir} output -json`,
      ]),
    ].join("\n");
  }
  return [
    `# .github/workflows/deliver-${productSlug}.yml — one workflow for every customer install`,
    `name: deliver-${productSlug}`,
    `on:`,
    `  workflow_dispatch:`,
    `    inputs:`,
    `      install: { required: true, description: "Customer code, e.g. metro-energy" }`,
    `permissions: { id-token: write, contents: read }  # OIDC federation, no secrets`,
    `env:`,
    `  TF_IN_AUTOMATION: "1"`,
    `jobs:`,
    `  land:`,
    `    name: Land`,
    `    runs-on: ubuntu-latest`,
    `    steps:`,
    `      - uses: actions/checkout@v4`,
    `      - uses: hashicorp/setup-terraform@v3`,
    `      - run: terraform -chdir=${dir} fmt -check`,
    `      - run: terraform -chdir=${dir} init -backend=false && terraform -chdir=${dir} validate`,
    ...envs.flatMap((e, i) => [
      `  ${e}:`,
      `    name: ${e}`,
      `    needs: ${i === 0 ? "land" : envs[i - 1]}`,
      `    runs-on: ubuntu-latest`,
      `    environment: \${{ inputs.install }}-${e}  # ${e === "prod" ? "required reviewers" : "per-environment credentials"}`,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      `      - uses: hashicorp/setup-terraform@v3`,
      `      - uses: azure/login@v2`,
      `        with:`,
      `          client-id: \${{ vars.AZURE_CLIENT_ID }}`,
      `          tenant-id: \${{ vars.AZURE_TENANT_ID }}`,
      `          subscription-id: \${{ vars.AZURE_SUBSCRIPTION_ID }}`,
      `      - name: terraform plan`,
      `        env: { ARM_USE_OIDC: "true", ARM_CLIENT_ID: "\${{ vars.AZURE_CLIENT_ID }}", ARM_TENANT_ID: "\${{ vars.AZURE_TENANT_ID }}" }`,
      `        run: |`,
      `          terraform -chdir=${dir} init -backend-config=key=\${{ inputs.install }}-${e}.tfstate`,
      `          terraform -chdir=${dir} plan -var-file=../../installs/\${{ inputs.install }}/${e}.tfvars.json -out=tfplan`,
      `      - name: terraform apply`,
      `        env: { ARM_USE_OIDC: "true", ARM_CLIENT_ID: "\${{ vars.AZURE_CLIENT_ID }}", ARM_TENANT_ID: "\${{ vars.AZURE_TENANT_ID }}" }`,
      `        run: terraform -chdir=${dir} apply tfplan && terraform -chdir=${dir} output -json`,
    ]),
  ].join("\n");
}
