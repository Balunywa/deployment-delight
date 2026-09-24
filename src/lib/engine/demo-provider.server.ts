import type {
  DeploymentPlan,
  DriftFinding,
  InfrastructureProvider,
  PipelineProvider,
  PreflightResult,
  ProviderContext,
  StepOutcome,
  ValidationCheck,
} from "./types";

const MODULE_STEPS = [
  { name: "Resource Group", module: "resource-group" },
  { name: "Network integration", module: "network-spoke" },
  { name: "Key Vault", module: "key-vault" },
  { name: "PostgreSQL", module: "postgres" },
  { name: "AKS", module: "aks" },
  { name: "Event Hubs", module: "event-hubs" },
  { name: "Monitoring", module: "monitoring" },
  { name: "Policy validation", module: "security-baseline" },
];

function manifestModules(manifest: Record<string, unknown>) {
  const modules = (manifest["modules"] as { name: string; version: string }[] | undefined) ?? [];
  return modules.length ? modules : MODULE_STEPS.map((s) => ({ name: s.module, version: "n/a" }));
}

/**
 * Demo adapter: deterministic, realistic state transitions and logs.
 * Makes ZERO Azure calls. Every artifact it produces is tagged mode: "demo".
 */
export const demoProvider: InfrastructureProvider = {
  id: "demo",
  mode: "demo",

  async validate({ environment, connection, manifest }: ProviderContext): Promise<PreflightResult> {
    const cfg = environment.configuration_json ?? {};
    const network = (cfg["network"] as Record<string, unknown> | undefined) ?? {};
    const isProd = environment.environment_type === "production";

    const checks: ValidationCheck[] = [
      {
        key: "azure_auth",
        name: "Azure authentication",
        level: connection ? "PASS" : "BLOCKING",
        detail: connection
          ? `Federated identity resolved for ${connection.subscription_id ?? "target scope"}.`
          : "No validated Azure connection on this customer.",
      },
      {
        key: "rbac",
        name: "Required RBAC at deployment scope",
        level: "PASS",
        detail: "Contributor + User Access Administrator present at subscription scope.",
      },
      { key: "subscription_state", name: "Subscription state", level: "PASS", detail: "Subscription is Enabled." },
      {
        key: "mg_access",
        name: "Management group access",
        level: connection?.management_group_id ? "PASS" : "WARNING",
        detail: connection?.management_group_id
          ? `Scope resolved under ${connection.management_group_id}.`
          : "No management group scope supplied; tenant-level operations will be skipped.",
      },
      {
        key: "region",
        name: "Region availability",
        level: "PASS",
        detail: `All required services available in ${environment.region}.`,
      },
      {
        key: "providers",
        name: "Resource provider registration",
        level: "PASS",
        detail: "Microsoft.ContainerService, Microsoft.DBforPostgreSQL, Microsoft.EventHub registered.",
      },
      {
        key: "policy",
        name: "Azure Policy conflicts",
        level: "PASS",
        detail: "No deny assignments conflict with the offering module set.",
      },
      { key: "quota", name: "Resource quotas", level: "PASS", detail: "vCPU and public IP quota sufficient." },
      {
        key: "cidr",
        name: "Network CIDR conflicts",
        level: network["mode"] === "existing-customer-hub" ? "WARNING" : "PASS",
        detail:
          network["mode"] === "existing-customer-hub"
            ? "Customer-supplied spoke range overlaps a reserved range by 1 subnet; confirm with the network approver."
            : "Dedicated spoke range is free.",
      },
      {
        key: "dns",
        name: "Private DNS requirements",
        level: network["mode"] === "existing-customer-hub" ? "WARNING" : "PASS",
        detail:
          network["mode"] === "existing-customer-hub"
            ? "Private DNS zones are managed by the customer; zone links must be approved by their network owner."
            : "Private DNS zones resolvable via the deployed resolver.",
      },
      {
        key: "private_endpoints",
        name: "Private endpoint requirements",
        level: network["privateEndpoints"] === false ? "WARNING" : "PASS",
        detail:
          network["privateEndpoints"] === false
            ? "Offering expects private endpoints; environment configuration disables them."
            : "Private endpoint subnet has capacity for 9 endpoints.",
      },
      { key: "hub", name: "Customer hub connectivity", level: "PASS", detail: "Peering and route propagation verified." },
      { key: "naming", name: "Naming constraints", level: "PASS", detail: "Generated names satisfy Azure length rules." },
      {
        key: "existing_resources",
        name: "Required existing resources",
        level: "PASS",
        detail: "Log Analytics workspace and Key Vault policy located.",
      },
      {
        key: "budget",
        name: "Budget configuration",
        level: isProd ? "PASS" : "WARNING",
        detail: isProd ? "Budget and action group configured." : "No budget configured for non-production environment.",
      },
      { key: "skus", name: "Supported SKUs", level: "PASS", detail: "All requested SKUs are available." },
      {
        key: "identity_objects",
        name: "Entra identity objects",
        level: "PASS",
        detail: "Managed identities and Entra groups required by the blueprint resolve in the customer tenant.",
      },
      {
        key: "offering_compat",
        name: "Offering compatibility",
        level: "PASS",
        detail: `Manifest ${String(manifest["version"] ?? "")} is compatible with the target boundary.`,
      },
      { key: "diagnostics", name: "Diagnostic settings target", level: "PASS", detail: "Customer workspace accepts diagnostics." },
    ];

    const pass = checks.filter((c) => c.level === "PASS").length;
    const warning = checks.filter((c) => c.level === "WARNING").length;
    const blocking = checks.filter((c) => c.level === "BLOCKING").length;
    return { checks, pass, warning, blocking, deployable: blocking === 0 };
  },

  async plan({ environment, manifest, deploymentType }: ProviderContext): Promise<DeploymentPlan> {
    const modules = manifestModules(manifest);
    const cost = environment.monthly_cost_estimate ?? 14200;
    const upgrade = deploymentType === "upgrade";

    return {
      correlationId: crypto.randomUUID(),
      modules,
      resources: [
        { action: upgrade ? "update" : "create", type: "Microsoft.DBforPostgreSQL/flexibleServers", name: `pg-${environment.name.toLowerCase()}`, module: "postgres" },
        { action: "create", type: "Microsoft.Network/privateEndpoints", name: "pe-postgres", module: "private-endpoints" },
        { action: upgrade ? "update" : "create", type: "Microsoft.EventHub/namespaces", name: "evhns-grid", module: "event-hubs" },
        { action: upgrade ? "update" : "create", type: "Microsoft.ContainerService/managedClusters", name: "aks-grid", module: "aks" },
        { action: "create", type: "Microsoft.KeyVault/vaults", name: "kv-grid", module: "key-vault" },
        { action: "create", type: "Microsoft.Storage/storageAccounts", name: "stgrid", module: "storage" },
        { action: "use_existing", type: "Microsoft.Network/virtualNetworks", name: "customer hub VNet" },
        { action: "use_existing", type: "Microsoft.OperationalInsights/workspaces", name: "customer Log Analytics workspace" },
        { action: "use_existing", type: "Microsoft.Network/dnsResolvers", name: "customer private DNS resolver" },
      ],
      policyAssignments: 12,
      roleAssignments: 4,
      estimatedMonthlyCost: { low: Math.round(cost), high: Math.round(cost * 1.26) },
      warnings: [
        "Customer-supplied spoke range overlaps a reserved range by 1 subnet.",
        environment.environment_type === "production"
          ? "Zone-redundant PostgreSQL increases cost by roughly 18%."
          : "No budget configured for this environment.",
      ],
      blockers: [],
    };
  },

  async apply({ manifest }: ProviderContext & { plan: DeploymentPlan }): Promise<StepOutcome[]> {
    const modules = manifestModules(manifest).map((m) => m.name);
    return MODULE_STEPS.filter((s) => modules.includes(s.module) || s.module === "security-baseline").map(
      (step, index) => ({
        sequence: index + 1,
        name: step.name,
        module: step.module,
        status: "succeeded" as const,
        log: `[demo] ${step.name} applied via ${step.module}. No Azure API calls were made.`,
      }),
    );
  },

  async getOutputs({ environment }: ProviderContext) {
    return {
      resourceGroup: `rg-grid-${environment.name.toLowerCase()}`,
      aksFqdn: `aks-grid-${environment.name.toLowerCase()}.privatelink.${environment.region}.azmk8s.io`,
      postgresHost: `pg-grid-${environment.name.toLowerCase()}.postgres.database.azure.com`,
    };
  },

  async detectDrift({ environment }: ProviderContext): Promise<DriftFinding[]> {
    return [
      {
        resourceId: `/subscriptions/demo/resourceGroups/rg-grid-${environment.name.toLowerCase()}/providers/Microsoft.Storage/storageAccounts/stgrid`,
        category: "observability",
        expected: { diagnosticSettings: ["send-to-customer-law"] },
        actual: { diagnosticSettings: [] },
        severity: "medium",
        recommendedRemediation: "Re-apply monitoring@4.2 to restore required diagnostic settings.",
      },
    ];
  },

  async destroy(): Promise<StepOutcome[]> {
    return [
      { sequence: 1, name: "Decommission workloads", module: "aks", status: "succeeded", log: "[demo] workloads drained." },
      { sequence: 2, name: "Delete resource group", module: "resource-group", status: "succeeded", log: "[demo] scope removed." },
    ];
  },
};

export const demoPipelineProvider: PipelineProvider = {
  id: "demo",
  async dispatch({ correlationId }) {
    return { runUrl: `demo://pipeline-run/${correlationId}` };
  },
};

/** Real Azure adapters register here; demo mode remains the default. */
export function getInfrastructureProvider(mode: string): InfrastructureProvider {
  if (mode === "azure") {
    throw new Error(
      "Real Azure mode is not enabled for this deployment. Configure an Azure connection with federated credentials to enable it.",
    );
  }
  return demoProvider;
}
