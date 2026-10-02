import type { WafCheck, WafFix, WafRec, WafServiceGuide } from "../types";

const AZURE_WAF = "https://learn.microsoft.com/azure/well-architected";

const FIX_PRIVATE: WafFix = {
  label: "Enable private endpoints and turn off public access",
  add: ["private-endpoints"],
  topology: { privateEndpoints: true, publicAccess: false },
};

const FIX_MONITORING: WafFix = {
  label: "Add Azure Monitor diagnostics",
  add: ["monitoring"],
};

const FIX_BUDGET: WafFix = {
  label: "Add a budget and cost alerts",
  add: ["budget"],
};

const hasAny = (ids: string[]) => (ctx: Parameters<WafCheck>[0]) => ids.some((id) => ctx.has(id));

const hasCompute = hasAny([
  "aks",
  "web-vmss",
  "vmss",
  "vm",
  "container-apps",
  "app-service",
  "functions",
]);

const sensitive = (ctx: Parameters<WafCheck>[0]) =>
  ctx.workload.data === "confidential" || ctx.workload.data === "regulated";

const missionOrProd = (ctx: Parameters<WafCheck>[0]) =>
  ctx.workload.criticality === "mission-critical" ||
  ctx.topology.environments.includes("production");

const rec = (
  service: string,
  id: string,
  pillar: WafRec["pillar"],
  title: string,
  why: string,
  learn: string,
  check?: WafCheck,
): WafRec => {
  const base = { id: `${service}.${id}`, pillar, title, why, learn };
  return check ? { ...base, check } : base;
};

const selectedCheck =
  (service: string, name: string, fixAdd = service): WafCheck =>
  (ctx) =>
    ctx.has(service)
      ? { result: "pass", detail: `${name} is included in the design.` }
      : {
          result: "fail",
          detail: `${name} is not selected.`,
          fix: { label: `Add ${name}`, add: [fixAdd] },
        };

const monitoringCheck: WafCheck = (ctx) =>
  ctx.has("monitoring")
    ? { result: "pass", detail: "Azure Monitor diagnostic collection is part of the platform." }
    : {
        result: "warn",
        detail: "Diagnostics and operational logs need a shared monitoring destination.",
        fix: FIX_MONITORING,
      };

const appInsightsCheck: WafCheck = (ctx) => {
  if (!hasCompute(ctx))
    return { result: "na", detail: "No application compute is selected for this workload." };
  return ctx.has("app-insights")
    ? { result: "pass", detail: "Application Insights is selected for application telemetry." }
    : {
        result: "warn",
        detail: "Application compute is selected without Application Insights.",
        fix: { label: "Add Application Insights", add: ["app-insights"] },
      };
};

const budgetCheck: WafCheck = (ctx) =>
  ctx.has("budget")
    ? { result: "pass", detail: "A budget and cost alerts are included." }
    : {
        result: "warn",
        detail: "The design has no budget resource for cost visibility.",
        fix: FIX_BUDGET,
      };

const privateEndpointCheck =
  (serviceName: string): WafCheck =>
  (ctx) => {
    if (ctx.topology.privateEndpoints && !ctx.topology.publicAccess)
      return { result: "pass", detail: `${serviceName} is aligned to private access guardrails.` };
    if (sensitive(ctx))
      return {
        result: "fail",
        detail: `${ctx.workload.data} data should not depend on public network access.`,
        fix: FIX_PRIVATE,
      };
    return ctx.topology.privateEndpoints
      ? { result: "pass", detail: "Private endpoints are enabled for supported services." }
      : {
          result: "warn",
          detail: `${serviceName} supports a private access posture for production designs.`,
          fix: FIX_PRIVATE,
        };
  };

const premiumTierCheck =
  (service: string, key: string, premiumValue: string, serviceName: string): WafCheck =>
  (ctx) => {
    const value = ctx.setting(service, key);
    if (value === premiumValue)
      return { result: "pass", detail: `${serviceName} uses ${premiumValue}.` };
    if (!value) return { result: "na", detail: `${serviceName} is not selected.` };
    const result = missionOrProd(ctx) ? "fail" : "warn";
    return {
      result,
      detail: `${serviceName} uses ${value}; production or critical flows should use the catalog's resilient tier.`,
      fix: { label: `Use ${premiumValue}`, settings: { [key]: premiumValue } },
    };
  };

const standardSkuCheck =
  (service: string, key: string, standardValue: string, serviceName: string): WafCheck =>
  (ctx) => {
    const value = ctx.setting(service, key);
    if (value === standardValue)
      return { result: "pass", detail: `${serviceName} uses ${standardValue}.` };
    if (!value) return { result: "na", detail: `${serviceName} is not selected.` };
    return {
      result: missionOrProd(ctx) ? "fail" : "warn",
      detail: `${serviceName} uses ${value}; production designs need the catalog's production tier.`,
      fix: { label: `Use ${standardValue}`, settings: { [key]: standardValue } },
    };
  };

const regionalCheck: WafCheck = (ctx) => {
  if (ctx.topology.regions.length > 1)
    return {
      result: "pass",
      detail: `The workload is offered in ${ctx.topology.regions.length} regions.`,
    };
  if (ctx.workload.criticality === "mission-critical")
    return {
      result: "fail",
      detail: "Mission-critical workloads need regional fault tolerance in the design.",
      fix: {
        label: "Offer a paired regional deployment",
        topology: { regions: ["eastus2", "centralus"] },
      },
    };
  return { result: "warn", detail: "A single-region design has regional recovery limits." };
};

const productionRingCheck: WafCheck = (ctx) => {
  const hasProd = ctx.topology.environments.includes("production");
  const hasPreProd = ctx.topology.environments.some((env) => env !== "production");
  if (hasProd && hasPreProd)
    return {
      result: "pass",
      detail: "Production has at least one non-production validation ring.",
    };
  return {
    result: "warn",
    detail: hasProd
      ? "Production changes have no pre-production environment in the offering."
      : "The offering does not include production.",
    fix: {
      label: "Offer development and production",
      topology: { environments: ["development", "production"] },
    },
  };
};

const retentionCheck: WafCheck = (ctx) => {
  const value = ctx.setting("monitoring", "retention");
  if (!value)
    return {
      result: "warn",
      detail: "Monitoring is missing, so retention cannot be evaluated.",
      fix: FIX_MONITORING,
    };
  if (ctx.workload.data === "regulated" && value === "90 days")
    return {
      result: "warn",
      detail:
        "Regulated workloads commonly need longer operational evidence retention than the shortest catalog option.",
      fix: { label: "Retain logs for 365 days", settings: { retention: "365 days" } },
    };
  return { result: "pass", detail: `Monitoring retention is ${value}.` };
};

const defenderPlanCheck: WafCheck = (ctx) => {
  const value = ctx.setting("defender", "plans");
  if (value === "Containers + Databases + Storage")
    return { result: "pass", detail: "Defender workload protection plans are enabled." };
  if (!value)
    return {
      result: sensitive(ctx) ? "fail" : "warn",
      detail: "Defender for Cloud is not selected.",
      fix: { label: "Add Defender for Cloud", add: ["defender"] },
    };
  return {
    result: sensitive(ctx) ? "fail" : "warn",
    detail: "CSPM-only coverage omits the catalog's workload protection plans.",
    fix: {
      label: "Use workload protection plans",
      settings: { plans: "Containers + Databases + Storage" },
    },
  };
};

const securityBaselineCheck: WafCheck = (ctx) => {
  const value = ctx.setting("security-baseline", "profile");
  if (value === "hardened" || value === "utility-critical")
    return { result: "pass", detail: `The ${value} security baseline is assigned.` };
  if (!value)
    return {
      result: "fail",
      detail: "The platform security baseline is missing.",
      fix: { label: "Add the policy pack", add: ["security-baseline"] },
    };
  return {
    result: sensitive(ctx) ? "fail" : "warn",
    detail:
      "The baseline profile is selected; sensitive or production workloads should use a hardened guardrail profile.",
    fix: { label: "Use the hardened profile", settings: { profile: "hardened" } },
  };
};

const managedIdentityCheck = selectedCheck("managed-identity", "Managed identity");

const keyVaultCheck: WafCheck = (ctx) => {
  const needsSecrets = ctx.has("app-gateway") || ctx.has("front-door") || hasCompute(ctx);
  if (!needsSecrets)
    return { result: "na", detail: "No certificate or application secret consumers are selected." };
  return ctx.has("key-vault")
    ? { result: "pass", detail: "Key Vault is available for secrets, certificates, and keys." }
    : {
        result: "fail",
        detail: "The design implies certificates or application secrets but has no Key Vault.",
        fix: { label: "Add Key Vault", add: ["key-vault"] },
      };
};

const cmkCheck: WafCheck = (ctx) => {
  const value = ctx.setting("key-vault", "keys");
  if (ctx.workload.data !== "regulated")
    return {
      result: "pass",
      detail: "Customer-managed keys are optional for this workload classification.",
    };
  if (value === "Customer-managed (HSM)")
    return { result: "pass", detail: "Regulated data uses the catalog's HSM-backed key option." };
  return {
    result: "warn",
    detail: "Regulated data often requires customer-managed key control and separation of duties.",
    fix: { label: "Use customer-managed HSM keys", settings: { keys: "Customer-managed (HSM)" } },
  };
};

const frontDoorOrWafCheck: WafCheck = (ctx) => {
  if (ctx.workload.audience === "internal")
    return { result: "na", detail: "The workload is internal-only." };
  if (ctx.has("front-door"))
    return { result: "pass", detail: "Front Door is selected for global edge protection." };
  const gatewaySku = ctx.setting("app-gateway", "sku");
  if (gatewaySku === "WAF_v2")
    return {
      result: "pass",
      detail: "Application Gateway WAF_v2 is selected for external ingress.",
    };
  return {
    result: "fail",
    detail: "External workloads need an edge entry point with web application firewall controls.",
    fix: { label: "Add Front Door", add: ["front-door"] },
  };
};

const eventBacklogCheck =
  (serviceName: string): WafCheck =>
  (ctx) =>
    ctx.has("monitoring")
      ? { result: "pass", detail: `${serviceName} can emit diagnostic signals into Azure Monitor.` }
      : {
          result: "warn",
          detail: `${serviceName} needs diagnostic settings and alerts for backlog, errors, and delivery failures.`,
          fix: FIX_MONITORING,
        };

const eventConsumerCheck: WafCheck = (ctx) =>
  hasAny(["functions", "container-apps", "aks", "app-service", "service-bus"])(ctx)
    ? {
        result: "pass",
        detail: "The design includes compute or messaging components that can process events.",
      }
    : {
        result: "warn",
        detail:
          "Event Grid needs an event handler and retry/dead-letter design outside the system topic.",
        fix: { label: "Add Azure Functions for event handling", add: ["functions"] },
      };

const serviceBusCompanionCheck: WafCheck = (ctx) =>
  ctx.has("service-bus")
    ? {
        result: "pass",
        detail: "Service Bus is available for commands and durable workflow messaging.",
      }
    : {
        result: "warn",
        detail:
          "Long-running or command workflows should use a brokered queue rather than raw event delivery.",
        fix: { label: "Add Service Bus", add: ["service-bus"] },
      };

const appConfigKeyVaultCheck: WafCheck = (ctx) =>
  ctx.has("key-vault")
    ? { result: "pass", detail: "App Configuration can reference Key Vault for secrets." }
    : {
        result: sensitive(ctx) ? "fail" : "warn",
        detail: "Configuration data should stay separate from secrets stored in Key Vault.",
        fix: { label: "Add Key Vault", add: ["key-vault"] },
      };

const appConfigIdentityCheck: WafCheck = (ctx) =>
  ctx.has("managed-identity")
    ? {
        result: "pass",
        detail: "Managed identity is available for application access to configuration.",
      }
    : {
        result: "fail",
        detail:
          "Applications should access App Configuration with managed identities instead of connection strings.",
        fix: { label: "Add Managed identity", add: ["managed-identity"] },
      };

const resourceGroupPlacementCheck: WafCheck = (ctx) => {
  if (ctx.workload.audience === "external" && ctx.topology.landingZone !== "online")
    return {
      result: "warn",
      detail: "External workloads usually belong in an Online landing-zone policy area.",
      fix: { label: "Place the install in Online", topology: { landingZone: "online" } },
    };
  if (ctx.workload.audience === "internal" && ctx.topology.landingZone === "online")
    return {
      result: "warn",
      detail: "Internal-only workloads usually belong in Corp or a customer hub.",
      fix: { label: "Place the install in Corp", topology: { landingZone: "corp" } },
    };
  return {
    result: "pass",
    detail: `The resource group lands in the ${ctx.topology.landingZone} policy area.`,
  };
};

const guides = {
  eventHubs: "https://learn.microsoft.com/azure/well-architected/service-guides/azure-event-hubs",
  serviceBus: "https://learn.microsoft.com/azure/well-architected/service-guides/azure-service-bus",
  eventGrid: "https://learn.microsoft.com/azure/well-architected/service-guides/azure-event-grid",
  managedIdentity:
    "https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview",
  keyVault: "https://learn.microsoft.com/azure/key-vault/general/secure-key-vault",
  defender: "https://learn.microsoft.com/azure/defender-for-cloud/defender-for-cloud-introduction",
  securityBaseline: "https://learn.microsoft.com/security/benchmark/azure/introduction",
  monitoring:
    "https://learn.microsoft.com/azure/well-architected/service-guides/azure-log-analytics",
  appInsights:
    "https://learn.microsoft.com/azure/well-architected/service-guides/application-insights",
  resourceGroup: "https://learn.microsoft.com/azure/azure-resource-manager/management/overview",
  appConfiguration: "https://learn.microsoft.com/azure/azure-app-configuration/overview",
  budget:
    "https://learn.microsoft.com/azure/cost-management-billing/costs/tutorial-acm-create-budgets",
} as const;

export const PLATFORM_GUIDES: WafServiceGuide[] = [
  {
    service: "event-hubs",
    learn: guides.eventHubs,
    summary:
      "Event Hubs is the telemetry ingestion front door. The main WAF decisions are tier isolation, regional resilience, private access, consumer observability, and partition-aware scaling.",
    recs: [
      rec(
        "event-hubs",
        "premium-tier",
        "reliability",
        "Use Premium for production ingestion.",
        "Premium isolates capacity for important ingestion flows and unlocks the catalog's production posture.",
        guides.eventHubs,
        premiumTierCheck("event-hubs", "tier", "Premium", "Event Hubs"),
      ),
      rec(
        "event-hubs",
        "private-access",
        "security",
        "Keep ingestion private for sensitive data.",
        "Private endpoints and disabled public access reduce exposure for telemetry containing sensitive operational data.",
        `${AZURE_WAF}/security/networking`,
        privateEndpointCheck("Event Hubs"),
      ),
      rec(
        "event-hubs",
        "cost-visibility",
        "cost",
        "Track ingestion spend with budgets.",
        "Event streaming cost follows throughput, retention, and consumer patterns, so alerts must catch unexpected growth.",
        `${AZURE_WAF}/cost-optimization/collect-review-cost-data`,
        budgetCheck,
      ),
      rec(
        "event-hubs",
        "diagnostics",
        "operations",
        "Alert on ingestion health and backlog signals.",
        "Operational teams need diagnostic logs and metrics before producers or consumers silently fall behind.",
        guides.eventHubs,
        eventBacklogCheck("Event Hubs"),
      ),
      rec(
        "event-hubs",
        "partition-scale",
        "performance",
        "Design partitioning and consumers for expected load.",
        "Partitioning, consumer groups, and downstream processing determine how efficiently Event Hubs scales.",
        guides.eventHubs,
      ),
    ],
  },
  {
    service: "service-bus",
    learn: guides.serviceBus,
    summary:
      "Service Bus provides brokered queues and topics for command and workflow messaging. WAF design choices focus on Premium isolation, duplicate/dead-letter handling, private access, observability, and cost control.",
    recs: [
      rec(
        "service-bus",
        "premium-tier",
        "reliability",
        "Use Premium for production workflows.",
        "Premium provides the catalog's isolated production tier for durable messaging workloads.",
        guides.serviceBus,
        premiumTierCheck("service-bus", "tier", "Premium", "Service Bus"),
      ),
      rec(
        "service-bus",
        "private-access",
        "security",
        "Keep broker access private for sensitive workloads.",
        "Private endpoints and no public access narrow who can reach queues and topics.",
        `${AZURE_WAF}/security/networking`,
        privateEndpointCheck("Service Bus"),
      ),
      rec(
        "service-bus",
        "cost-visibility",
        "cost",
        "Put workflow messaging under a budget.",
        "Queues and topics can grow with retries and backlog, so cost alerts are part of financial guardrails.",
        `${AZURE_WAF}/cost-optimization/collect-review-cost-data`,
        budgetCheck,
      ),
      rec(
        "service-bus",
        "diagnostics",
        "operations",
        "Monitor dead-letter, delivery, and backlog signals.",
        "Durable queues must be observed so poison messages and stalled consumers are handled quickly.",
        guides.serviceBus,
        eventBacklogCheck("Service Bus"),
      ),
      rec(
        "service-bus",
        "flow-control",
        "performance",
        "Use queues and topics to absorb bursts and protect dependencies.",
        "Brokered messaging protects downstream services from spikes and supports controlled scale-out.",
        guides.serviceBus,
      ),
    ],
  },
  {
    service: "event-grid",
    learn: guides.eventGrid,
    summary:
      "Event Grid routes cloud events from platform sources to handlers. WAF decisions center on resilient handlers, least-exposed delivery endpoints, monitoring delivery failures, and avoiding Event Grid for command workflows.",
    recs: [
      rec(
        "event-grid",
        "handlers",
        "reliability",
        "Pair Event Grid with resilient event handlers.",
        "Event Grid delivers events, but the workload still needs handlers that can retry, deduplicate, and recover.",
        guides.eventGrid,
        eventConsumerCheck,
      ),
      rec(
        "event-grid",
        "private-handlers",
        "security",
        "Prefer private handlers for sensitive event flows.",
        "Events for confidential or regulated workloads should be processed by privately reachable handlers when the topology requires private access.",
        `${AZURE_WAF}/security/networking`,
        privateEndpointCheck("Event Grid handlers"),
      ),
      rec(
        "event-grid",
        "cost-visibility",
        "cost",
        "Track event volume and delivery costs.",
        "Event-driven designs can hide cost growth behind fan-out and retries unless budgets are in place.",
        `${AZURE_WAF}/cost-optimization/collect-review-cost-data`,
        budgetCheck,
      ),
      rec(
        "event-grid",
        "delivery-diagnostics",
        "operations",
        "Monitor delivery failures and dead-letter paths.",
        "Teams need event delivery diagnostics to distinguish source issues, handler failures, and retry exhaustion.",
        guides.eventGrid,
        eventBacklogCheck("Event Grid"),
      ),
      rec(
        "event-grid",
        "broker-choice",
        "performance",
        "Use brokered messaging when commands need queues.",
        "Event Grid is optimized for event routing; queued commands and long-running workflows need a broker.",
        guides.serviceBus,
        serviceBusCompanionCheck,
      ),
    ],
  },
  {
    service: "managed-identity",
    learn: guides.managedIdentity,
    summary:
      "Managed identities remove credentials from application code and automation. WAF decisions focus on least privilege, private service access, workload identity consistency, monitoring access, and reducing secret-management toil.",
    recs: [
      rec(
        "managed-identity",
        "platform-required",
        "reliability",
        "Keep a managed identity in every install.",
        "Stable workload identity lets services reconnect and rotate credentials without redeploying secrets.",
        guides.managedIdentity,
        managedIdentityCheck,
      ),
      rec(
        "managed-identity",
        "least-privilege",
        "security",
        "Grant managed identities only required RBAC and data-plane roles.",
        "Managed identities are safer than secrets only when permissions are scoped and reviewed.",
        `${AZURE_WAF}/security/identity-access`,
      ),
      rec(
        "managed-identity",
        "secretless-cost",
        "cost",
        "Use managed identity to reduce secret rotation toil.",
        "Removing stored credentials lowers operational effort and avoids bespoke secret-distribution mechanisms.",
        guides.managedIdentity,
      ),
      rec(
        "managed-identity",
        "audit-access",
        "operations",
        "Monitor identity sign-ins and authorization failures.",
        "Access failures and suspicious identity use must feed operational and security response.",
        `${AZURE_WAF}/security/monitor-threats`,
        monitoringCheck,
      ),
      rec(
        "managed-identity",
        "token-caching",
        "performance",
        "Use platform SDK token caching rather than custom credential code.",
        "Managed identity clients should avoid unnecessary token requests and custom retry logic.",
        guides.managedIdentity,
      ),
    ],
  },
  {
    service: "key-vault",
    learn: guides.keyVault,
    summary:
      "Key Vault protects secrets, certificates, and keys. WAF choices include private network access, managed identity authorization, key ownership for regulated data, diagnostic logging, and separating configuration from secrets.",
    recs: [
      rec(
        "key-vault",
        "required-for-secrets",
        "reliability",
        "Use Key Vault when the design implies secrets or certificates.",
        "Central secret and certificate storage supports controlled rotation and recovery.",
        guides.keyVault,
        keyVaultCheck,
      ),
      rec(
        "key-vault",
        "private-access",
        "security",
        "Keep Key Vault private for sensitive workloads.",
        "Vaults commonly hold high-value secrets and keys, so public network exposure should be avoided.",
        guides.keyVault,
        privateEndpointCheck("Key Vault"),
      ),
      rec(
        "key-vault",
        "key-ownership",
        "cost",
        "Use HSM-backed customer-managed keys only when required.",
        "Customer-managed key control has operational and cost tradeoffs and should align to data classification.",
        `${AZURE_WAF}/cost-optimization/optimize-component-costs`,
        cmkCheck,
      ),
      rec(
        "key-vault",
        "diagnostics",
        "operations",
        "Audit secret, key, and certificate access.",
        "Vault diagnostics are needed for investigations, rotation assurance, and incident response.",
        guides.keyVault,
        monitoringCheck,
      ),
      rec(
        "key-vault",
        "identity-access",
        "performance",
        "Use managed identities and cache secrets appropriately.",
        "Platform identity and sane client caching avoid brittle startup paths and excessive vault calls.",
        guides.managedIdentity,
        managedIdentityCheck,
      ),
    ],
  },
  {
    service: "defender",
    learn: guides.defender,
    summary:
      "Defender for Cloud provides posture management and workload protection. WAF choices are plan coverage, secure-score response, alert routing, production scoping, and cost-aware enablement.",
    recs: [
      rec(
        "defender",
        "workload-protection",
        "reliability",
        "Enable Defender plans for production resources.",
        "Security alerts and hardening recommendations help prevent incidents that become reliability events.",
        guides.defender,
        defenderPlanCheck,
      ),
      rec(
        "defender",
        "threat-detection",
        "security",
        "Integrate Defender alerts into SecOps triage.",
        "Threat detection has value only when alerts reach accountable responders.",
        `${AZURE_WAF}/security/monitor-threats`,
        monitoringCheck,
      ),
      rec(
        "defender",
        "plan-cost",
        "cost",
        "Choose Defender plans deliberately.",
        "Plan coverage should match the workload's resources and data classification to avoid both gaps and waste.",
        `${AZURE_WAF}/cost-optimization/optimize-component-costs`,
        budgetCheck,
      ),
      rec(
        "defender",
        "recommendation-process",
        "operations",
        "Review and remediate Defender recommendations.",
        "Posture findings need ownership, exception handling, and continuous improvement.",
        guides.defender,
      ),
      rec(
        "defender",
        "coverage-scale",
        "performance",
        "Protect the services that carry the busiest flows.",
        "High-throughput compute, storage, and database tiers should not be left outside workload protection.",
        guides.defender,
        defenderPlanCheck,
      ),
    ],
  },
  {
    service: "security-baseline",
    learn: guides.securityBaseline,
    summary:
      "The policy pack represents the platform guardrails for the install scope. WAF choices focus on baseline strength, landing-zone compatibility, drift detection, exceptions, and keeping controls proportional to risk.",
    recs: [
      rec(
        "security-baseline",
        "assigned",
        "reliability",
        "Keep the security baseline assigned to every install.",
        "Consistent guardrails prevent configuration drift that can cause outages or unsafe changes.",
        guides.securityBaseline,
        securityBaselineCheck,
      ),
      rec(
        "security-baseline",
        "hardened",
        "security",
        "Use hardened policy for sensitive or production workloads.",
        "A hardened baseline enforces the expected security posture for higher-risk designs.",
        guides.securityBaseline,
        securityBaselineCheck,
      ),
      rec(
        "security-baseline",
        "guardrail-cost",
        "cost",
        "Use policy guardrails to prevent waste.",
        "Resource limits, allowed SKUs, and tagging policies support cost accountability.",
        `${AZURE_WAF}/cost-optimization/set-spending-guardrails`,
        securityBaselineCheck,
      ),
      rec(
        "security-baseline",
        "policy-drift",
        "operations",
        "Treat policy compliance as an operational signal.",
        "Baseline compliance should be reviewed continuously and exceptions should expire.",
        `${AZURE_WAF}/operational-excellence/observability`,
        monitoringCheck,
      ),
      rec(
        "security-baseline",
        "landing-zone-fit",
        "performance",
        "Match policy strictness to the landing zone.",
        "Policies should protect the workload without blocking required scale or regional placement.",
        `${AZURE_WAF}/performance-efficiency/select-services`,
        resourceGroupPlacementCheck,
      ),
    ],
  },
  {
    service: "monitoring",
    learn: guides.monitoring,
    summary:
      "Azure Monitor and Log Analytics collect platform telemetry and diagnostics. WAF choices include retention, alerting, coverage, cost control, and signal design for critical flows.",
    recs: [
      rec(
        "monitoring",
        "coverage",
        "reliability",
        "Monitor critical flows and dependencies.",
        "Health signals are required to detect, recover, and prove reliability targets.",
        `${AZURE_WAF}/reliability/monitoring`,
        monitoringCheck,
      ),
      rec(
        "monitoring",
        "retention",
        "security",
        "Set retention to match data classification and investigations.",
        "Regulated workloads need enough retained evidence for audit and incident response.",
        guides.monitoring,
        retentionCheck,
      ),
      rec(
        "monitoring",
        "cost",
        "cost",
        "Control telemetry volume and retention cost.",
        "Logs are valuable but should be governed by sampling, routing, and retention choices.",
        `${AZURE_WAF}/cost-optimization/optimize-data-costs`,
        budgetCheck,
      ),
      rec(
        "monitoring",
        "alerts",
        "operations",
        "Define actionable alerts with owners.",
        "Monitoring supports operations only when alerts are routed, tuned, and tied to response playbooks.",
        `${AZURE_WAF}/operational-excellence/observability`,
        monitoringCheck,
      ),
      rec(
        "monitoring",
        "performance-signals",
        "performance",
        "Collect performance baselines for scale decisions.",
        "Latency, saturation, and throughput signals guide scaling and bottleneck removal.",
        `${AZURE_WAF}/performance-efficiency/monitoring`,
        monitoringCheck,
      ),
    ],
  },
  {
    service: "app-insights",
    learn: guides.appInsights,
    summary:
      "Application Insights adds application telemetry, traces, dependencies, and live diagnostics. WAF choices include complete instrumentation, sampling, privacy, release correlation, and performance analysis.",
    recs: [
      rec(
        "app-insights",
        "instrument-apps",
        "reliability",
        "Instrument application compute with Application Insights.",
        "Application health and dependency telemetry are essential to detect flow failures.",
        guides.appInsights,
        appInsightsCheck,
      ),
      rec(
        "app-insights",
        "protect-telemetry",
        "security",
        "Avoid sensitive data in telemetry.",
        "Telemetry pipelines must not leak secrets, regulated data, or customer identifiers unnecessarily.",
        `${AZURE_WAF}/security/data-classification`,
      ),
      rec(
        "app-insights",
        "sampling-cost",
        "cost",
        "Use sampling and retention deliberately.",
        "Application telemetry can grow quickly, so collection must balance evidence and cost.",
        `${AZURE_WAF}/cost-optimization/optimize-data-costs`,
        budgetCheck,
      ),
      rec(
        "app-insights",
        "release-correlation",
        "operations",
        "Correlate telemetry with deployments.",
        "Deployment markers and trace correlation make incidents easier to diagnose and roll back.",
        guides.appInsights,
      ),
      rec(
        "app-insights",
        "dependency-performance",
        "performance",
        "Track dependencies and end-to-end latency.",
        "Dependency telemetry shows where critical flows spend time and where scale is needed.",
        `${AZURE_WAF}/performance-efficiency/monitoring`,
        appInsightsCheck,
      ),
    ],
  },
  {
    service: "resource-group",
    learn: guides.resourceGroup,
    summary:
      "The resource group is the management scope for an install. WAF decisions focus on landing-zone placement, RBAC inheritance, tagging, lifecycle boundaries, and cost reporting.",
    recs: [
      rec(
        "resource-group",
        "platform-required",
        "reliability",
        "Keep one managed resource group per install scope.",
        "A consistent scope makes deployment, rollback, policy, and cleanup repeatable.",
        guides.resourceGroup,
        selectedCheck("resource-group", "Resource group"),
      ),
      rec(
        "resource-group",
        "placement",
        "security",
        "Place the resource group in the correct landing-zone policy area.",
        "Corp, Online, Local, and Sandbox policy areas imply different exposure and connectivity guardrails.",
        guides.resourceGroup,
        resourceGroupPlacementCheck,
      ),
      rec(
        "resource-group",
        "cost-scope",
        "cost",
        "Use the install resource group as a cost reporting boundary.",
        "Grouping resources by install clarifies billing and chargeback.",
        `${AZURE_WAF}/cost-optimization/collect-review-cost-data`,
        budgetCheck,
      ),
      rec(
        "resource-group",
        "tags-locks-rbac",
        "operations",
        "Apply tags, RBAC, and lifecycle controls consistently.",
        "Management controls on the resource group keep operations predictable.",
        guides.resourceGroup,
      ),
      rec(
        "resource-group",
        "regional-footprint",
        "performance",
        "Keep region choices explicit for every install.",
        "The resource group scope should reflect the regions the architecture can actually run in.",
        `${AZURE_WAF}/design-guides/regions-availability-zones`,
        regionalCheck,
      ),
    ],
  },
  {
    service: "app-configuration",
    learn: guides.appConfiguration,
    summary:
      "Azure App Configuration centralizes settings and feature flags. WAF decisions include production tier, Key Vault references, managed identity access, private access, and safe rollout practices.",
    recs: [
      rec(
        "app-configuration",
        "standard-tier",
        "reliability",
        "Use Standard for production configuration.",
        "Production configuration stores need the catalog's production tier rather than the Free option.",
        guides.appConfiguration,
        standardSkuCheck("app-configuration", "sku", "standard", "App Configuration"),
      ),
      rec(
        "app-configuration",
        "key-vault-references",
        "security",
        "Keep secrets in Key Vault, not App Configuration.",
        "App Configuration complements Key Vault; secrets should remain in the vault.",
        guides.appConfiguration,
        appConfigKeyVaultCheck,
      ),
      rec(
        "app-configuration",
        "tier-cost",
        "cost",
        "Use Free only for non-production experiments.",
        "Configuration tier choice should match environment criticality and cost goals.",
        `${AZURE_WAF}/cost-optimization/optimize-environment-costs`,
        standardSkuCheck("app-configuration", "sku", "standard", "App Configuration"),
      ),
      rec(
        "app-configuration",
        "feature-flags",
        "operations",
        "Use feature flags as part of safe deployment practices.",
        "Central flags support progressive exposure and rollback without redeploying.",
        `${AZURE_WAF}/operational-excellence/safe-deployments`,
      ),
      rec(
        "app-configuration",
        "identity-access",
        "performance",
        "Access configuration with managed identities.",
        "Managed identity removes connection-string handling and supports efficient platform authentication.",
        guides.managedIdentity,
        appConfigIdentityCheck,
      ),
    ],
  },
  {
    service: "budget",
    learn: guides.budget,
    summary:
      "Budgets and cost alerts provide cost visibility at the install scope. WAF choices are alert ownership, environment-aware thresholds, anomaly review, and pairing cost signals with engineering decisions.",
    recs: [
      rec(
        "budget",
        "platform-required",
        "reliability",
        "Keep cost alerts for production installs.",
        "Unexpected spend can indicate runaway retries, logging, or scale events that threaten reliability.",
        guides.budget,
        budgetCheck,
      ),
      rec(
        "budget",
        "owner-routing",
        "security",
        "Route cost alerts to accountable owners.",
        "Cost alerts can reveal abuse or compromised workloads and should reach responders.",
        `${AZURE_WAF}/security/monitor-threats`,
      ),
      rec(
        "budget",
        "cost-data",
        "cost",
        "Collect and review cost data against the budget.",
        "The Cost Optimization checklist calls for regular cost review, trends, forecasts, and alerts.",
        `${AZURE_WAF}/cost-optimization/collect-review-cost-data`,
        budgetCheck,
      ),
      rec(
        "budget",
        "operations",
        "operations",
        "Treat budget alerts as operational events.",
        "Budget deviations should be triaged with deployment, telemetry, and incident context.",
        guides.budget,
        monitoringCheck,
      ),
      rec(
        "budget",
        "scale-feedback",
        "performance",
        "Use cost signals when evaluating scale choices.",
        "Scaling strategy should balance performance targets with efficient resource use.",
        `${AZURE_WAF}/performance-efficiency/scale-partition`,
        budgetCheck,
      ),
    ],
  },
];
