import type { WafCheck, WafRec } from "./types";

const WAF = "https://learn.microsoft.com/azure/well-architected";

const hasAny = (ids: string[]) => (ctx: Parameters<WafCheck>[0]) => ids.some((id) => ctx.has(id));

const hasAppCompute = hasAny([
  "aks",
  "web-vmss",
  "vmss",
  "vm",
  "container-apps",
  "app-service",
  "functions",
]);

const sensitiveData = (ctx: Parameters<WafCheck>[0]) =>
  ctx.workload.data === "confidential" || ctx.workload.data === "regulated";

const rec = (
  id: string,
  pillar: WafRec["pillar"],
  title: string,
  why: string,
  learn: string,
  check: WafCheck,
): WafRec => ({ id: `workload.${id}`, pillar, title, why, learn, check });

const multiRegionMissionCritical: WafCheck = (ctx) => {
  if (ctx.topology.regions.length > 1)
    return {
      result: "pass",
      detail: `The design is offered in ${ctx.topology.regions.length} regions.`,
    };
  if (ctx.workload.criticality === "mission-critical")
    return {
      result: "fail",
      detail:
        "Mission-critical guidance emphasizes active/active deployment across multiple Availability Zones and Azure regions where possible.",
      fix: {
        label: "Offer a second region",
        topology: { regions: ["eastus2", "centralus"] },
      },
    };
  if (ctx.workload.rtoMinutes <= 60)
    return {
      result: "warn",
      detail: "A short recovery target is difficult to prove with a single-region design.",
      fix: {
        label: "Offer a second region",
        topology: { regions: ["eastus2", "centralus"] },
      },
    };
  return {
    result: "warn",
    detail: "Single-region designs need explicit disaster recovery acceptance and testing.",
  };
};

const productionAndPreProduction: WafCheck = (ctx) => {
  const hasProd = ctx.topology.environments.includes("production");
  const preProd = ctx.topology.environments.filter((env) => env !== "production");
  if (hasProd && preProd.length)
    return {
      result: "pass",
      detail: `Production is preceded by ${preProd.join(", ")}.`,
    };
  return {
    result: "warn",
    detail: hasProd
      ? "Production changes have no non-production validation ring."
      : "The offering does not include a production environment.",
    fix: {
      label: "Offer development and production",
      topology: { environments: ["development", "production"] },
    },
  };
};

const privateAccessForSensitiveData: WafCheck = (ctx) => {
  if (!sensitiveData(ctx))
    return {
      result: "pass",
      detail: "The workload data classification does not require private-only access by default.",
    };
  if (ctx.topology.privateEndpoints && !ctx.topology.publicAccess)
    return {
      result: "pass",
      detail: `${ctx.workload.data} data is aligned to private endpoints and no public access.`,
    };
  return {
    result: "fail",
    detail: `${ctx.workload.data} data should use private endpoints and avoid public resource exposure.`,
    fix: {
      label: "Enable private access",
      add: ["private-endpoints"],
      topology: { privateEndpoints: true, publicAccess: false },
    },
  };
};

const landingZoneForAudience: WafCheck = (ctx) => {
  if (ctx.workload.audience !== "internal" && ctx.topology.landingZone !== "online")
    return {
      result: "warn",
      detail: `External audiences usually fit the Online landing-zone policy area, not ${ctx.topology.landingZone}.`,
      fix: { label: "Use Online placement", topology: { landingZone: "online" } },
    };
  if (ctx.workload.audience === "internal" && ctx.topology.landingZone === "online")
    return {
      result: "warn",
      detail: "Internal-only workloads usually fit Corp or an existing customer hub policy area.",
      fix: { label: "Use Corp placement", topology: { landingZone: "corp" } },
    };
  return {
    result: "pass",
    detail: `The ${ctx.topology.landingZone} placement matches the stated audience.`,
  };
};

const budgetForVisibility: WafCheck = (ctx) =>
  ctx.has("budget")
    ? { result: "pass", detail: "Budget and cost alerts are included." }
    : {
        result: "warn",
        detail: "There is no budget resource for workload cost visibility.",
        fix: { label: "Add budget alerts", add: ["budget"] },
      };

const appInsightsForCompute: WafCheck = (ctx) => {
  if (!hasAppCompute(ctx))
    return {
      result: "na",
      detail: "No application compute is selected.",
    };
  return ctx.has("app-insights")
    ? { result: "pass", detail: "Application Insights is included for app telemetry." }
    : {
        result: "fail",
        detail: "Application compute is selected without application telemetry.",
        fix: { label: "Add Application Insights", add: ["app-insights"] },
      };
};

const keyVaultForSecrets: WafCheck = (ctx) => {
  const needsSecrets = hasAppCompute(ctx) || ctx.has("app-gateway") || ctx.has("front-door");
  if (!needsSecrets)
    return {
      result: "na",
      detail: "The design does not imply application secrets or ingress certificates.",
    };
  return ctx.has("key-vault")
    ? { result: "pass", detail: "Key Vault is included for secrets, certificates, and keys." }
    : {
        result: "fail",
        detail: "The design implies secrets or certificates but does not include Key Vault.",
        fix: { label: "Add Key Vault", add: ["key-vault"] },
      };
};

const externalEdgeProtection: WafCheck = (ctx) => {
  if (ctx.workload.audience === "internal")
    return {
      result: "na",
      detail: "The workload is internal-only.",
    };
  if (ctx.has("front-door"))
    return {
      result: "pass",
      detail: "Front Door is included for global external entry.",
    };
  if (ctx.setting("app-gateway", "sku") === "WAF_v2")
    return {
      result: "pass",
      detail: "Application Gateway WAF_v2 is included for external ingress.",
    };
  return {
    result: "fail",
    detail: "External workloads need an edge entry point with WAF controls.",
    fix: { label: "Add Front Door", add: ["front-door"] },
  };
};

const defenderPlans: WafCheck = (ctx) => {
  const plans = ctx.setting("defender", "plans");
  if (plans === "Containers + Databases + Storage")
    return {
      result: "pass",
      detail: "Defender for Cloud workload protection plans are selected.",
    };
  if (!plans)
    return {
      result: sensitiveData(ctx) ? "fail" : "warn",
      detail: "Defender for Cloud is not included.",
      fix: { label: "Add Defender for Cloud", add: ["defender"] },
    };
  return {
    result: sensitiveData(ctx) ? "fail" : "warn",
    detail: "CSPM-only coverage omits the catalog workload protection plans.",
    fix: { label: "Use Defender workload protection plans" },
  };
};

const regulatedMonitoringRetention: WafCheck = (ctx) => {
  const retention = ctx.setting("monitoring", "retention");
  if (!retention)
    return {
      result: "fail",
      detail: "Monitoring is missing, so evidence retention cannot be evaluated.",
      fix: { label: "Add Azure Monitor", add: ["monitoring"] },
    };
  if (ctx.workload.data === "regulated" && retention === "90 days")
    return {
      result: "warn",
      detail:
        "Regulated workloads should review whether the shortest retention option is sufficient for audit and incident response.",
      fix: { label: "Use longer monitoring retention" },
    };
  return {
    result: "pass",
    detail: `Monitoring retention is ${retention}.`,
  };
};

export const WORKLOAD_RECS: WafRec[] = [
  rec(
    "multi-region-mission-critical",
    "reliability",
    "Use more than one region for mission-critical workloads.",
    "Mission-critical design guidance calls for regional fault tolerance and active/active deployment where possible.",
    "https://learn.microsoft.com/azure/well-architected/mission-critical/mission-critical-design-principles",
    multiRegionMissionCritical,
  ),
  rec(
    "production-preproduction",
    "operations",
    "Offer production with at least one pre-production ring.",
    "Safe deployment practices depend on validating changes before production exposure.",
    `${WAF}/operational-excellence/safe-deployments`,
    productionAndPreProduction,
  ),
  rec(
    "private-access-sensitive-data",
    "security",
    "Use private access for confidential or regulated data.",
    "Network isolation and private endpoints reduce exposure for sensitive workloads.",
    `${WAF}/security/networking`,
    privateAccessForSensitiveData,
  ),
  rec(
    "landing-zone-audience",
    "security",
    "Place the workload in a landing-zone area that matches its audience.",
    "Corp and Online policy areas carry different assumptions about public exposure and enterprise connectivity.",
    "https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/design-area/resource-org-management-groups",
    landingZoneForAudience,
  ),
  rec(
    "budget-cost-visibility",
    "cost",
    "Include a budget for cost visibility.",
    "Cost Optimization guidance calls for collecting, reviewing, and alerting on cost data.",
    `${WAF}/cost-optimization/collect-review-cost-data`,
    budgetForVisibility,
  ),
  rec(
    "app-insights-app-telemetry",
    "operations",
    "Use Application Insights when the design includes app compute.",
    "Application traces, dependency telemetry, and availability signals are needed to operate application flows.",
    "https://learn.microsoft.com/azure/well-architected/service-guides/application-insights",
    appInsightsForCompute,
  ),
  rec(
    "key-vault-secrets",
    "security",
    "Use Key Vault when secrets or certificates are implied.",
    "Ingress certificates, application settings, and service credentials need managed secret storage and auditing.",
    "https://learn.microsoft.com/azure/key-vault/general/secure-key-vault",
    keyVaultForSecrets,
  ),
  rec(
    "external-edge-waf",
    "security",
    "Use a front door or WAF-protected gateway for external audiences.",
    "External entry points need filtering, TLS termination, and edge protection before application services.",
    `${WAF}/security/networking`,
    externalEdgeProtection,
  ),
  rec(
    "defender-workload-protection",
    "security",
    "Enable Defender for Cloud workload protection plans.",
    "Threat detection and hardening recommendations help protect compute, databases, and storage used by the workload.",
    "https://learn.microsoft.com/azure/defender-for-cloud/defender-for-cloud-introduction",
    defenderPlans,
  ),
  rec(
    "monitoring-retention-data",
    "operations",
    "Set monitoring retention to match the workload data classification.",
    "Security investigations and regulated operations need telemetry retained long enough to support response and evidence needs.",
    "https://learn.microsoft.com/azure/well-architected/service-guides/azure-log-analytics",
    regulatedMonitoringRetention,
  ),
];
