import type { Pillar, WafCheck, WafFix, WafRec, WafServiceGuide } from "../types";

const WAF = "https://learn.microsoft.com/azure/well-architected";
const PRIVATE_LINK = "https://learn.microsoft.com/azure/private-link/secure-private-link";
const FOUNDRY_DEPLOYMENTS =
  "https://learn.microsoft.com/azure/foundry/foundry-models/concepts/deployment-types";
const FOUNDRY_MODELS =
  "https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure";
const AI_SEARCH_RELIABILITY = "https://learn.microsoft.com/azure/reliability/reliability-ai-search";
const AI_SEARCH_SECURITY = "https://learn.microsoft.com/azure/search/search-security-built-in";
const AI_SEARCH_SKU = "https://learn.microsoft.com/azure/search/search-sku-tier";
const AI_SEARCH_PERF = "https://learn.microsoft.com/azure/search/search-performance-tips";
const DATA_EXPLORER_BC =
  "https://learn.microsoft.com/azure/data-explorer/business-continuity-overview";
const DATA_EXPLORER_SECURITY = "https://learn.microsoft.com/azure/data-explorer/security";
const IOT_RELIABILITY = "https://learn.microsoft.com/azure/reliability/reliability-iot-hub";
const IOT_SECURITY = "https://learn.microsoft.com/azure/iot-hub/authenticate-authorize-azure-ad";
const IOT_VNET = "https://learn.microsoft.com/azure/iot-hub/virtual-network-support";
const IOT_SCALE = "https://learn.microsoft.com/azure/iot-hub/iot-hub-scaling";
const FABRIC_WAF = `${WAF}/microsoft-fabric/`;
const FABRIC_SECURITY = `${WAF}/microsoft-fabric/security`;
const FABRIC_RELIABILITY = "https://learn.microsoft.com/fabric/security/reliability-fabric";
const FABRIC_CAPACITY = "https://learn.microsoft.com/fabric/enterprise/licenses";
const DATABRICKS = `${WAF}/service-guides/azure-databricks`;

const monitored: WafCheck = (ctx) =>
  ctx.has("monitoring")
    ? {
        result: "pass",
        detail:
          "monitoring is selected; Terraform emits diagnostic settings where the service supports them.",
      }
    : {
        result: "warn",
        detail: "monitoring is not selected, so platform diagnostics would be incomplete.",
        fix: { label: "Add Azure Monitor diagnostics", add: ["monitoring"] },
      };

const managedIdentity: WafCheck = (ctx) =>
  ctx.has("managed-identity")
    ? {
        result: "pass",
        detail: "managed-identity is locked into the design for keyless service access.",
      }
    : {
        result: "fail",
        detail: "managed-identity is missing; the workload would need keys or secrets.",
        fix: { label: "Add managed identity", add: ["managed-identity"] },
      };

const privateAccess =
  (serviceName: string): WafCheck =>
  (ctx) => {
    const sensitive = ctx.workload.data === "confidential" || ctx.workload.data === "regulated";
    const required = !ctx.topology.publicAccess || sensitive || ctx.topology.landingZone === "corp";
    if (ctx.topology.privateEndpoints) {
      return {
        result: "pass",
        detail: `${serviceName} uses privateEndpoints=true; publicAccess=${String(ctx.topology.publicAccess)}.`,
      };
    }
    const fix: WafFix = {
      label: "Turn on private endpoints and block public access",
      topology: { privateEndpoints: true, publicAccess: false },
    };
    return required
      ? {
          result: "fail",
          detail: `${serviceName} has privateEndpoints=false while data=${ctx.workload.data}, publicAccess=${String(ctx.topology.publicAccess)}, landingZone=${ctx.topology.landingZone}.`,
          fix,
        }
      : {
          result: "warn",
          detail: `${serviceName} has privateEndpoints=false; public endpoints are allowed by this topology but increase exposure.`,
          fix,
        };
  };

const setting = (ctx: Parameters<WafCheck>[0], key: string, fallback: string) =>
  ctx.svc?.settings[key] ?? fallback;

const productionOffered = (ctx: Parameters<WafCheck>[0]) =>
  ctx.topology.environments.includes("production");

const critical = (ctx: Parameters<WafCheck>[0]) => ctx.workload.criticality !== "standard";

const rec = (
  service: string,
  pillar: Pillar,
  slug: string,
  title: string,
  why: string,
  learn: string,
  check?: WafCheck,
): WafRec => {
  const out: WafRec = { id: `${service}.${slug}`, pillar, title, why, learn };
  if (check) out.check = check;
  return out;
};

const aiDeploymentResidency: WafCheck = (ctx) => {
  const deployment = setting(ctx, "deployment", "Data zone standard");
  if (ctx.workload.data === "regulated" && deployment === "Global standard") {
    return {
      result: "fail",
      detail: `deployment=${deployment}, data=${ctx.workload.data}; use a regional/data-zone option for data residency-sensitive workloads.`,
      fix: { label: "Use Data zone standard", settings: { deployment: "Data zone standard" } },
    };
  }
  if (critical(ctx) && deployment === "Standard") {
    return {
      result: "warn",
      detail: `deployment=${deployment}; ${ctx.workload.criticality} AI traffic may need data-zone or provisioned capacity planning.`,
      fix: { label: "Use Data zone standard", settings: { deployment: "Data zone standard" } },
    };
  }
  return {
    result: "pass",
    detail: `deployment=${deployment}; deployment type matches residency and criticality.`,
  };
};

const aiCapacity: WafCheck = (ctx) => {
  const deployment = setting(ctx, "deployment", "Data zone standard");
  const capacity = Number(setting(ctx, "capacity", "100"));
  if (ctx.workload.criticality === "mission-critical" && deployment !== "Provisioned (PTU)") {
    return {
      result: "warn",
      detail: `deployment=${deployment}, capacity=${capacity}; mission-critical AI should consider provisioned throughput.`,
      fix: {
        label: "Use provisioned throughput",
        settings: { deployment: "Provisioned (PTU)", capacity: "100" },
      },
    };
  }
  if (critical(ctx) && capacity < 100) {
    return {
      result: "warn",
      detail: `capacity=${capacity}; critical production workloads need deliberate token-per-minute headroom.`,
      fix: { label: "Use 100K token capacity", settings: { capacity: "100" } },
    };
  }
  return {
    result: "pass",
    detail: `deployment=${deployment}, capacity=${capacity}; capacity is deliberate for the workload.`,
  };
};

const aiCost: WafCheck = (ctx) => {
  const deployment = setting(ctx, "deployment", "Data zone standard");
  const capacity = Number(setting(ctx, "capacity", "100"));
  if (!productionOffered(ctx) && (deployment === "Provisioned (PTU)" || capacity > 50)) {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, deployment=${deployment}, capacity=${capacity}; dev/test should avoid reserved or large capacity.`,
      fix: {
        label: "Use smaller standard capacity",
        settings: { deployment: "Standard", capacity: "10" },
      },
    };
  }
  return {
    result: "pass",
    detail: `deployment=${deployment}, capacity=${capacity}; cost posture matches the offered environments.`,
  };
};

const aiEmbedding: WafCheck = (ctx) => {
  const embeddingModel = setting(ctx, "embeddingModel", "none");
  if (ctx.has("ai-search") && embeddingModel === "none") {
    return {
      result: "warn",
      detail:
        "ai-search is selected but embeddingModel=none; grounded retrieval usually needs embeddings.",
      fix: {
        label: "Add a small embedding deployment",
        settings: { embeddingModel: "text-embedding-3-small" },
      },
    };
  }
  return {
    result: "pass",
    detail: `embeddingModel=${embeddingModel}; retrieval model choice is explicit.`,
  };
};

const searchReliability: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "standard");
  if (critical(ctx) && sku === "basic") {
    return {
      result: "fail",
      detail: `sku=${sku}; the catalog deploys one replica for Basic, which is not enough for critical search availability.`,
      fix: { label: "Use Standard S1", settings: { sku: "standard" } },
    };
  }
  if (sku === "free") {
    return {
      result: "fail",
      detail: "sku=free; Free has no private endpoint support and is not a production tier.",
      fix: { label: "Use Standard S1", settings: { sku: "standard" } },
    };
  }
  return {
    result: sku === "basic" ? "warn" : "pass",
    detail: `sku=${sku}; ${sku === "basic" ? "Basic is suitable only for smaller or non-critical search." : "catalog deploys production replicas for this tier."}`,
  };
};

const searchCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "standard");
  if (!productionOffered(ctx) && sku !== "basic" && sku !== "free") {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}; Basic is often enough for dev/test indexes.`,
      fix: { label: "Use Basic for non-production", settings: { sku: "basic" } },
    };
  }
  return { result: "pass", detail: `sku=${sku}; cost posture matches the offered environments.` };
};

const searchPerformance: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "standard");
  if (ctx.workload.criticality === "mission-critical" && sku === "standard") {
    return {
      result: "warn",
      detail: `sku=${sku}; mission-critical vector or hybrid retrieval may need larger partitions and replicas.`,
      fix: { label: "Use Standard S2", settings: { sku: "standard2" } },
    };
  }
  return {
    result: sku === "basic" ? "warn" : "pass",
    detail: `sku=${sku}; search tier is the main performance setting in this catalog.`,
  };
};

const dataExplorerSku: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "Standard_E8ads_v5 × 2");
  if (productionOffered(ctx) && sku.startsWith("Dev(No SLA)")) {
    return {
      result: "fail",
      detail: `sku=${sku}; production analytics must not use the Dev(No SLA) cluster.`,
      fix: { label: "Use E8ads production cluster", settings: { sku: "Standard_E8ads_v5 × 2" } },
    };
  }
  return {
    result: sku.startsWith("Dev(No SLA)") ? "warn" : "pass",
    detail: `sku=${sku}; ${sku.startsWith("Dev(No SLA)") ? "dev/test only" : "production cluster tier"}.`,
  };
};

const dataExplorerCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "Standard_E8ads_v5 × 2");
  if (!productionOffered(ctx) && !sku.startsWith("Dev(No SLA)")) {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}; Dev(No SLA) is the low-cost test option.`,
      fix: {
        label: "Use Dev(No SLA) for non-production",
        settings: { sku: "Dev(No SLA)_Standard_E2a_v4 × 1" },
      },
    };
  }
  return { result: "pass", detail: `sku=${sku}; cost posture matches the offered environments.` };
};

const dataExplorerPerformance: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "Standard_E8ads_v5 × 2");
  if (ctx.workload.criticality === "mission-critical" && sku === "Standard_E2ads_v5 × 2") {
    return {
      result: "warn",
      detail: `sku=${sku}; mission-critical telemetry often needs more CPU/cache headroom.`,
      fix: { label: "Use E16ads production cluster", settings: { sku: "Standard_E16ads_v5 × 2" } },
    };
  }
  return {
    result: sku.startsWith("Dev(No SLA)") ? "warn" : "pass",
    detail: `sku=${sku}; cluster size is explicit.`,
  };
};

const iotTier: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "S2");
  if (critical(ctx) && sku.startsWith("B")) {
    return {
      result: "fail",
      detail: `sku=${sku}; Basic IoT Hub tiers omit cloud-to-device features and are not suitable for critical bidirectional device workloads.`,
      fix: { label: "Use Standard S2", settings: { sku: "S2" } },
    };
  }
  if (sku === "F1") {
    return {
      result: "fail",
      detail: "sku=F1; Free is a trial tier and lacks private endpoint support.",
      fix: { label: "Use Standard S1", settings: { sku: "S1" } },
    };
  }
  return {
    result: sku.startsWith("B") ? "warn" : "pass",
    detail: `sku=${sku}; ${sku.startsWith("S") ? "Standard device features selected" : "Basic tier selected"}.`,
  };
};

const iotCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "S2");
  if (!productionOffered(ctx) && sku === "S3") {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}; S3 is rarely needed for dev/test telemetry.`,
      fix: { label: "Use Standard S1 for non-production", settings: { sku: "S1" } },
    };
  }
  return { result: "pass", detail: `sku=${sku}; cost posture matches the offered environments.` };
};

const iotPerformance: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "S2");
  if (ctx.workload.criticality === "mission-critical" && sku !== "S3") {
    return {
      result: "warn",
      detail: `sku=${sku}; mission-critical or very high-volume fleets should validate S3 capacity.`,
      fix: { label: "Use Standard S3", settings: { sku: "S3" } },
    };
  }
  return {
    result: "pass",
    detail: `sku=${sku}; tier choice is explicit for expected message volume.`,
  };
};

const fabricCapacity: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "F2");
  if (productionOffered(ctx) && critical(ctx) && ["F2", "F4"].includes(sku)) {
    return {
      result: "warn",
      detail: `sku=${sku}; critical Fabric workloads should validate a larger capacity and isolation plan.`,
      fix: { label: "Use F8 capacity", settings: { sku: "F8" } },
    };
  }
  return { result: "pass", detail: `sku=${sku}; Fabric capacity choice is explicit.` };
};

const fabricCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "F2");
  if (!productionOffered(ctx) && sku === "F64") {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}; F64 is usually excessive outside production.`,
      fix: { label: "Use F2 for non-production", settings: { sku: "F2" } },
    };
  }
  return { result: "pass", detail: `sku=${sku}; cost posture matches the offered environments.` };
};

const databricksSku: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "premium");
  if ((ctx.workload.data === "regulated" || critical(ctx)) && sku !== "premium") {
    return {
      result: "warn",
      detail: `sku=${sku}, data=${ctx.workload.data}, criticality=${ctx.workload.criticality}; Premium is the safer baseline for governance-sensitive workspaces.`,
      fix: { label: "Use Premium", settings: { sku: "premium" } },
    };
  }
  return { result: "pass", detail: `sku=${sku}; workspace tier matches governance needs.` };
};

const databricksCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "premium");
  if (!productionOffered(ctx) && sku === "premium" && ctx.workload.data === "public") {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}, data=public; Standard can lower test workspace cost.`,
      fix: {
        label: "Use Standard for non-sensitive non-production",
        settings: { sku: "standard" },
      },
    };
  }
  return {
    result: "pass",
    detail: `sku=${sku}; cost posture matches data sensitivity and environments.`,
  };
};

export const AI_GUIDES: WafServiceGuide[] = [
  {
    service: "ai-foundry",
    learn: FOUNDRY_DEPLOYMENTS,
    summary:
      "Azure AI Foundry deploys an AI Services account with local auth disabled, managed identity, private endpoint support, diagnostics and model deployments whose type and capacity are catalog choices.",
    recs: [
      rec(
        "ai-foundry",
        "reliability",
        "deployment-type",
        "Choose deployment type for resiliency and residency",
        "Global, data-zone, standard and provisioned deployments have different routing, quota and residency tradeoffs.",
        FOUNDRY_DEPLOYMENTS,
        aiDeploymentResidency,
      ),
      rec(
        "ai-foundry",
        "security",
        "private-access",
        "Keep model endpoints private for sensitive workloads",
        "Private endpoints and disabled local auth reduce prompt and response exposure.",
        PRIVATE_LINK,
        privateAccess("AI Foundry"),
      ),
      rec(
        "ai-foundry",
        "security",
        "managed-identity",
        "Use managed identity instead of keys",
        "The deployment disables local auth and assigns Cognitive Services OpenAI User to the workload identity.",
        FOUNDRY_MODELS,
        managedIdentity,
      ),
      rec(
        "ai-foundry",
        "cost",
        "capacity",
        "Keep non-production model capacity small",
        "Large or provisioned deployments reserve expensive capacity that dev/test rarely needs.",
        FOUNDRY_DEPLOYMENTS,
        aiCost,
      ),
      rec(
        "ai-foundry",
        "operations",
        "diagnostics",
        "Export AI service diagnostics",
        "Operational logs and metrics are needed for quota, throttling and abuse investigations.",
        FOUNDRY_MODELS,
        monitored,
      ),
      rec(
        "ai-foundry",
        "performance",
        "capacity",
        "Set token capacity from workload criticality",
        "Insufficient tokens-per-minute or missing PTU planning causes throttling under peak use.",
        FOUNDRY_DEPLOYMENTS,
        aiCapacity,
      ),
      rec(
        "ai-foundry",
        "performance",
        "embeddings",
        "Deploy an embedding model when AI Search is selected",
        "Grounded answers need a matching vectorization path for retrieval.",
        FOUNDRY_MODELS,
        aiEmbedding,
      ),
    ],
  },
  {
    service: "ai-search",
    learn: AI_SEARCH_RELIABILITY,
    summary:
      "Azure AI Search is deployed keyless with managed identity, diagnostics, private endpoint support where the tier permits it, and replica count derived from the selected SKU.",
    recs: [
      rec(
        "ai-search",
        "reliability",
        "replicas",
        "Use a production Search tier for critical retrieval",
        "The catalog deploys more replicas for Standard tiers; Basic is a smaller non-critical option.",
        AI_SEARCH_RELIABILITY,
        searchReliability,
      ),
      rec(
        "ai-search",
        "security",
        "private-access",
        "Use Private Link for confidential search indexes",
        "Indexes can contain sensitive source data and embeddings, so network exposure matters.",
        AI_SEARCH_SECURITY,
        privateAccess("AI Search"),
      ),
      rec(
        "ai-search",
        "security",
        "local-auth",
        "Disable local authentication and use RBAC",
        "The deployed service disables local authentication and grants the workload identity data-plane access.",
        AI_SEARCH_SECURITY,
        managedIdentity,
      ),
      rec(
        "ai-search",
        "cost",
        "sku",
        "Use Basic only where availability and scale needs are modest",
        "Search SKUs drive fixed capacity cost; dev/test can often run lower than production.",
        AI_SEARCH_SKU,
        searchCost,
      ),
      rec(
        "ai-search",
        "operations",
        "diagnostics",
        "Export Search diagnostics",
        "Query latency, throttling and indexing errors need to be visible in operations dashboards.",
        AI_SEARCH_SECURITY,
        monitored,
      ),
      rec(
        "ai-search",
        "performance",
        "tier",
        "Scale tier for vector and hybrid query load",
        "Larger tiers provide more capacity per partition for demanding retrieval workloads.",
        AI_SEARCH_PERF,
        searchPerformance,
      ),
    ],
  },
  {
    service: "data-explorer",
    learn: DATA_EXPLORER_BC,
    summary:
      "Azure Data Explorer clusters are deployed with private endpoint support, diagnostics, managed identity, streaming ingestion, disk encryption and production zones when using non-Dev SKUs.",
    recs: [
      rec(
        "data-explorer",
        "reliability",
        "production-sku",
        "Avoid Dev(No SLA) clusters for production telemetry",
        "Production telemetry analytics needs a resilient cluster shape and tested continuity plan.",
        DATA_EXPLORER_BC,
        dataExplorerSku,
      ),
      rec(
        "data-explorer",
        "security",
        "private-access",
        "Keep Kusto endpoints private",
        "Private Link limits cluster, ingestion and dependent storage endpoints to the workload network.",
        DATA_EXPLORER_SECURITY,
        privateAccess("Data Explorer"),
      ),
      rec(
        "data-explorer",
        "security",
        "managed-identity",
        "Use managed identity and database roles",
        "The deployment assigns the workload identity to the database instead of embedding credentials.",
        DATA_EXPLORER_SECURITY,
        managedIdentity,
      ),
      rec(
        "data-explorer",
        "cost",
        "dev-sku",
        "Use Dev(No SLA) only outside production",
        "Auto-stop plus Dev SKUs reduce test-cluster cost but should not carry customer production telemetry.",
        DATA_EXPLORER_BC,
        dataExplorerCost,
      ),
      rec(
        "data-explorer",
        "operations",
        "diagnostics",
        "Export Data Explorer diagnostics",
        "Cluster metrics and logs are necessary to troubleshoot ingestion lag and query failures.",
        DATA_EXPLORER_SECURITY,
        monitored,
      ),
      rec(
        "data-explorer",
        "performance",
        "cluster-size",
        "Size cluster CPU and cache for telemetry query load",
        "Undersized clusters slow dashboards and can fall behind streaming ingestion.",
        DATA_EXPLORER_BC,
        dataExplorerPerformance,
      ),
    ],
  },
  {
    service: "iot-hub",
    learn: IOT_RELIABILITY,
    summary:
      "IoT Hub is deployed with TLS 1.2, managed identity, diagnostics, public device ingress and optional private endpoints for service-side access; SKU controls features and message scale.",
    recs: [
      rec(
        "iot-hub",
        "reliability",
        "standard-tier",
        "Use Standard IoT Hub for bidirectional or critical device workloads",
        "Basic tiers omit important cloud-to-device capabilities used by operational IoT solutions.",
        IOT_RELIABILITY,
        iotTier,
      ),
      rec(
        "iot-hub",
        "security",
        "private-service-access",
        "Use private endpoints for back-end service access",
        "Devices may connect over the internet, but internal services should use the private endpoint path.",
        IOT_VNET,
        privateAccess("IoT Hub service traffic"),
      ),
      rec(
        "iot-hub",
        "security",
        "entra",
        "Use Microsoft Entra ID for service authorization",
        "Managed identity and RBAC avoid shared access policies in application code.",
        IOT_SECURITY,
        managedIdentity,
      ),
      rec(
        "iot-hub",
        "cost",
        "tier",
        "Pick IoT Hub tier from message volume and environment",
        "S3 is costly for test fleets, while Free and Basic are not production baselines for full-featured IoT.",
        IOT_SCALE,
        iotCost,
      ),
      rec(
        "iot-hub",
        "operations",
        "diagnostics",
        "Export IoT Hub metrics and logs",
        "Operations need visibility into connection, throttling and routing failures.",
        IOT_RELIABILITY,
        monitored,
      ),
      rec(
        "iot-hub",
        "performance",
        "scale",
        "Size IoT Hub for expected fleet throughput",
        "The tier must match message volume, command patterns and burst behavior.",
        IOT_SCALE,
        iotPerformance,
      ),
    ],
  },
  {
    service: "fabric",
    learn: FABRIC_WAF,
    summary:
      "Microsoft Fabric capacity is a managed analytics platform choice; the catalog controls capacity SKU while reliability, security and governance are mostly tenant, workspace and capacity administration practices.",
    recs: [
      rec(
        "fabric",
        "reliability",
        "capacity-isolation",
        "Isolate critical Fabric workloads on deliberate capacity",
        "Capacity isolation limits noisy-neighbor impact and clarifies failover ownership for analytics workloads.",
        FABRIC_RELIABILITY,
        fabricCapacity,
      ),
      rec(
        "fabric",
        "security",
        "workspace-governance",
        "Use least-privilege workspaces and tenant controls",
        "Fabric security is primarily Entra ID, workspace roles, item permissions and tenant governance rather than this catalog SKU.",
        FABRIC_SECURITY,
      ),
      rec(
        "fabric",
        "security",
        "private-access",
        "Plan private connectivity for sensitive Fabric access",
        "Private Link and tenant network controls should be evaluated for regulated analytics access.",
        FABRIC_SECURITY,
      ),
      rec(
        "fabric",
        "cost",
        "capacity",
        "Right-size Fabric capacity by environment",
        "Capacity SKUs are fixed commitments, so non-production should start small and scale with measured demand.",
        FABRIC_CAPACITY,
        fabricCost,
      ),
      rec(
        "fabric",
        "operations",
        "monitoring",
        "Monitor capacity utilization and throttling",
        "Fabric operations depend on tracking capacity saturation, refresh failures and workspace ownership.",
        FABRIC_WAF,
      ),
      rec(
        "fabric",
        "performance",
        "sku",
        "Scale Fabric SKU for concurrent analytics demand",
        "Interactive analytics, notebooks and Power BI workloads compete for capacity units.",
        FABRIC_CAPACITY,
        fabricCapacity,
      ),
    ],
  },
  {
    service: "databricks",
    learn: DATABRICKS,
    summary:
      "Azure Databricks is a catalog workspace choice with SKU and private endpoint topology; governance, networking, cluster policy and cost controls must be configured around the workspace.",
    recs: [
      rec(
        "databricks",
        "reliability",
        "tier",
        "Use Premium for critical governed data platforms",
        "Premium is the safer workspace baseline when reliability and governance controls matter.",
        DATABRICKS,
        databricksSku,
      ),
      rec(
        "databricks",
        "security",
        "private-access",
        "Keep Databricks workspace traffic private",
        "Private endpoints reduce exposure for notebooks and jobs that touch confidential datasets.",
        DATABRICKS,
        privateAccess("Databricks"),
      ),
      rec(
        "databricks",
        "security",
        "governance",
        "Use identity-based access and governed workspaces",
        "Workspace access should use Entra groups, least privilege and governance features rather than shared credentials.",
        DATABRICKS,
        databricksSku,
      ),
      rec(
        "databricks",
        "cost",
        "sku",
        "Use Standard only for low-risk non-production",
        "Premium governance costs more, but Standard may be acceptable for public-data test workspaces.",
        DATABRICKS,
        databricksCost,
      ),
      rec(
        "databricks",
        "operations",
        "diagnostics",
        "Export workspace diagnostics",
        "Jobs, clusters and notebook activity need auditability and operational triage.",
        DATABRICKS,
      ),
      rec(
        "databricks",
        "performance",
        "cluster-policy",
        "Use cluster policies and autoscaling for workload efficiency",
        "Workspace SKU is only the baseline; cluster sizing and policies control Spark performance and waste.",
        DATABRICKS,
      ),
    ],
  },
];
