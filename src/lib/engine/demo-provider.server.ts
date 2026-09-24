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

import { fromManifest } from "@/lib/architecture";
import { CUSTOMER_PLATFORM, SERVICE_BY_ID, monthlyEstimate } from "@/lib/catalog";
import { deploySteps } from "@/lib/pipeline";

/** The environment's network mode wins over the blueprint default when both are present. */
function architectureOf(
  environment: ProviderContext["environment"],
  manifest: Record<string, unknown>,
) {
  const mode = ((environment.configuration_json ?? {})["network"] as { mode?: string } | undefined)
    ?.mode;
  const arch = fromManifest(
    {
      network_profile:
        mode === "existing-customer-hub"
          ? "customer-hub"
          : mode === "dedicated-spoke"
            ? "dedicated-spoke"
            : null,
    },
    manifest,
  );
  if (mode === "existing-customer-hub" || mode === "dedicated-spoke" || mode === "isv-hosted")
    arch.topology.landing = mode;
  return arch;
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
        level: connection?.status === "validated" ? "PASS" : "BLOCKING",
        detail:
          connection?.status === "validated"
            ? `Federated identity resolved for ${connection.subscription_id ?? "target scope"}.`
            : connection
              ? "The customer has not granted access yet — waiting on their install link."
              : "No validated Azure connection on this customer.",
      },
      {
        key: "rbac",
        name: "Required RBAC at deployment scope",
        level: "PASS",
        detail: "Contributor + User Access Administrator present at subscription scope.",
      },
      {
        key: "subscription_state",
        name: "Subscription state",
        level: "PASS",
        detail: "Subscription is Enabled.",
      },
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
        detail:
          "Microsoft.ContainerService, Microsoft.DBforPostgreSQL, Microsoft.EventHub registered.",
      },
      {
        key: "policy",
        name: "Azure Policy conflicts",
        level: "PASS",
        detail: "No deny assignments conflict with the offering module set.",
      },
      {
        key: "quota",
        name: "Resource quotas",
        level: "PASS",
        detail: "vCPU and public IP quota sufficient.",
      },
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
      {
        key: "hub",
        name: "Customer hub connectivity",
        level: "PASS",
        detail: "Peering and route propagation verified.",
      },
      {
        key: "naming",
        name: "Naming constraints",
        level: "PASS",
        detail: "Generated names satisfy Azure length rules.",
      },
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
        detail: isProd
          ? "Budget and action group configured."
          : "No budget configured for non-production environment.",
      },
      {
        key: "skus",
        name: "Supported SKUs",
        level: "PASS",
        detail: "All requested SKUs are available.",
      },
      {
        key: "identity_objects",
        name: "Entra identity objects",
        level: "PASS",
        detail:
          "Managed identities and Entra groups required by the blueprint resolve in the customer tenant.",
      },
      {
        key: "offering_compat",
        name: "Offering compatibility",
        level: "PASS",
        detail: `Manifest ${String(manifest["version"] ?? "")} is compatible with the target boundary.`,
      },
      {
        key: "diagnostics",
        name: "Diagnostic settings target",
        level: "PASS",
        detail: "Customer workspace accepts diagnostics.",
      },
    ];

    const pass = checks.filter((c) => c.level === "PASS").length;
    const warning = checks.filter((c) => c.level === "WARNING").length;
    const blocking = checks.filter((c) => c.level === "BLOCKING").length;
    return { checks, pass, warning, blocking, deployable: blocking === 0 };
  },

  async plan({ environment, manifest, deploymentType }: ProviderContext): Promise<DeploymentPlan> {
    const arch = architectureOf(environment, manifest);
    const cost = environment.monthly_cost_estimate ?? monthlyEstimate(arch.selected);
    const upgrade = deploymentType === "upgrade";
    const env = environment.name.toLowerCase();
    const hub = arch.topology.landing === "existing-customer-hub";

    const resources: DeploymentPlan["resources"] = [];
    if (arch.topology.landing === "isv-hosted")
      resources.push({
        action: "create",
        type: "Microsoft.Subscription/aliases",
        name: `sub-hosted-${env}`,
      });
    for (const s of arch.selected) {
      const def = SERVICE_BY_ID.get(s.id);
      if (!def || s.id === "private-endpoints") continue;
      if (s.id === "network-spoke" && hub) {
        resources.push({
          action: upgrade ? "update" : "create",
          type: "Microsoft.Network/virtualNetworks/virtualNetworkPeerings",
          name: `peer-spoke-to-hub-${env}`,
          module: s.id,
        });
      }
      resources.push({
        action: upgrade ? "update" : "create",
        type: def.resourceType,
        name: `${def.id}-${env}`,
        module: s.id,
      });
      if (def.privateLink && arch.topology.privateEndpoints)
        resources.push({
          action: "create",
          type: "Microsoft.Network/privateEndpoints",
          name: `pe-${def.id}-${env}`,
          module: "private-endpoints",
        });
    }
    if (hub)
      for (const p of CUSTOMER_PLATFORM)
        resources.push({
          action: "use_existing",
          type: p.type,
          name: `customer ${p.name.toLowerCase()}`,
        });

    return {
      correlationId: crypto.randomUUID(),
      modules: arch.selected.map((s) => ({
        name: s.id,
        version: SERVICE_BY_ID.get(s.id)?.version ?? "n/a",
      })),
      resources,
      policyAssignments: 12,
      roleAssignments:
        arch.selected.filter((s) => SERVICE_BY_ID.get(s.id)?.zone === "app").length * 2 + 2,
      estimatedMonthlyCost: { low: Math.round(cost), high: Math.round(cost * 1.26) },
      warnings: [
        ...(hub ? ["Customer-supplied spoke range overlaps a reserved range by 1 subnet."] : []),
        environment.environment_type === "production"
          ? "Zone-redundant data services increase cost by roughly 18%."
          : "No budget configured for this environment.",
      ],
      blockers: [],
    };
  },

  async apply({
    environment,
    manifest,
  }: ProviderContext & { plan: DeploymentPlan }): Promise<StepOutcome[]> {
    const arch = architectureOf(environment, manifest);
    return deploySteps(arch.selected, arch.topology).map((step, index) => ({
      sequence: index + 1,
      name: step.name,
      module: step.module,
      status: "succeeded" as const,
      log: `[demo] ${step.name} applied via ${SERVICE_BY_ID.get(step.module)?.avm ?? step.module}. No Azure API calls were made.`,
    }));
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
      {
        sequence: 1,
        name: "Decommission workloads",
        module: "aks",
        status: "succeeded",
        log: "[demo] workloads drained.",
      },
      {
        sequence: 2,
        name: "Delete resource group",
        module: "resource-group",
        status: "succeeded",
        log: "[demo] scope removed.",
      },
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
