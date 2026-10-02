import type { Pillar, WafCheck, WafFix, WafRec, WafServiceGuide } from "../types";

const WAF = "https://learn.microsoft.com/azure/well-architected";
const POSTGRES = `${WAF}/service-guides/postgresql`;
const SQL = `${WAF}/service-guides/azure-sql-database`;
const COSMOS = `${WAF}/service-guides/cosmos-db`;
const STORAGE = `${WAF}/service-guides/azure-blob-storage`;
const REDIS = `${WAF}/service-guides/azure-managed-redis`;
const ADME =
  "https://learn.microsoft.com/azure/energy-data-services/reliability-energy-data-services";
const ADME_PRIVATE =
  "https://learn.microsoft.com/azure/energy-data-services/how-to-set-up-private-links";
const ADME_APIM = "https://learn.microsoft.com/azure/energy-data-services/how-to-secure-apis";

const monitored: WafCheck = (ctx) =>
  ctx.has("monitoring")
    ? { result: "pass", detail: "monitoring is selected; Terraform emits diagnostic settings." }
    : {
        result: "warn",
        detail: "monitoring is not selected, so diagnostics would not be exported.",
        fix: { label: "Add Azure Monitor diagnostics", add: ["monitoring"] },
      };

const managedIdentity: WafCheck = (ctx) =>
  ctx.has("managed-identity")
    ? { result: "pass", detail: "managed-identity is locked into the design for keyless access." }
    : {
        result: "fail",
        detail: "managed-identity is missing; data-plane access would need secrets.",
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

const postgresHa: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "GP_Standard_D4ds_v5");
  const ha = setting(ctx, "ha", "Zone redundant");
  const burstable = sku.startsWith("B_");
  if (ha === "Zone redundant" && !burstable) {
    return { result: "pass", detail: `sku=${sku}, ha=${ha}; production gets zone-redundant HA.` };
  }
  const fix = {
    label: "Use General Purpose with zone-redundant HA",
    settings: { sku: "GP_Standard_D4ds_v5", ha: "Zone redundant" },
  };
  if (critical(ctx)) {
    return {
      result: "fail",
      detail: `sku=${sku}, ha=${ha}; ${ctx.workload.criticality} PostgreSQL needs a standby across zones.`,
      fix,
    };
  }
  return {
    result: "warn",
    detail: `sku=${sku}, ha=${ha}; standard workloads can accept this, but failover resilience is lower.`,
    fix,
  };
};

const postgresCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "GP_Standard_D4ds_v5");
  if (!productionOffered(ctx) && !sku.startsWith("B_")) {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}; non-production can usually use burstable compute.`,
      fix: {
        label: "Use burstable compute for non-production",
        settings: { sku: "B_Standard_B2ms", ha: "Disabled" },
      },
    };
  }
  if (productionOffered(ctx) && sku.startsWith("B_") && critical(ctx)) {
    return {
      result: "fail",
      detail: `production is offered and sku=${sku}; burstable is not a production HA shape for ${ctx.workload.criticality}.`,
      fix: {
        label: "Use General Purpose in production",
        settings: { sku: "GP_Standard_D4ds_v5", ha: "Zone redundant" },
      },
    };
  }
  return { result: "pass", detail: `sku=${sku} matches the offered environments.` };
};

const postgresVersion: WafCheck = (ctx) => {
  const version = setting(ctx, "version", "16");
  if (["18", "17", "16"].includes(version)) {
    return { result: "pass", detail: `version=${version}; current engine family selected.` };
  }
  return {
    result: "warn",
    detail: `version=${version}; older engine versions need a deliberate lifecycle and performance plan.`,
    fix: { label: "Use the catalog default PostgreSQL version", settings: { version: "16" } },
  };
};

const sqlTier: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "GP_Gen5_4");
  const serverless = sku.includes("_S_");
  const lowTier = /^(Basic|S\d|P1)$/.test(sku);
  if (critical(ctx) && (serverless || lowTier || sku.startsWith("GP_"))) {
    return {
      result: "warn",
      detail: `sku=${sku}; ${ctx.workload.criticality} databases often need Business Critical or Hyperscale characteristics.`,
      fix: { label: "Use Business Critical", settings: { sku: "BC_Gen5_4" } },
    };
  }
  if (lowTier) {
    return {
      result: "warn",
      detail: `sku=${sku}; low DTU tiers are suitable only for small or non-critical databases.`,
      fix: { label: "Use General Purpose", settings: { sku: "GP_Gen5_4" } },
    };
  }
  return { result: "pass", detail: `sku=${sku}; production-capable Azure SQL tier selected.` };
};

const sqlCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "GP_Gen5_4");
  if (!productionOffered(ctx) && !sku.includes("_S_")) {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}; serverless is a better default for dev/test cost control.`,
      fix: { label: "Use serverless for non-production", settings: { sku: "GP_S_Gen5_1" } },
    };
  }
  if (productionOffered(ctx) && critical(ctx) && sku.includes("_S_")) {
    return {
      result: "warn",
      detail: `production is offered and sku=${sku}; auto-pause/serverless capacity can conflict with critical SLOs.`,
      fix: { label: "Use provisioned General Purpose", settings: { sku: "GP_Gen5_4" } },
    };
  }
  return { result: "pass", detail: `sku=${sku} is reasonable for the offered environments.` };
};

const cosmosCapacity: WafCheck = (ctx) => {
  const mode = setting(ctx, "mode", "Autoscale 4000 RU/s");
  if (critical(ctx) && mode === "Serverless") {
    return {
      result: "fail",
      detail: `mode=${mode}; ${ctx.workload.criticality} workloads need provisioned/autoscale capacity planning.`,
      fix: { label: "Use autoscale throughput", settings: { mode: "Autoscale 4000 RU/s" } },
    };
  }
  if (critical(ctx) && mode === "Provisioned 400 RU/s") {
    return {
      result: "warn",
      detail: `mode=${mode}; fixed low throughput risks throttling during failover or bursts.`,
      fix: { label: "Use autoscale throughput", settings: { mode: "Autoscale 4000 RU/s" } },
    };
  }
  return {
    result: "pass",
    detail: `mode=${mode}; capacity model is aligned with workload criticality.`,
  };
};

const cosmosCost: WafCheck = (ctx) => {
  const mode = setting(ctx, "mode", "Autoscale 4000 RU/s");
  if (!productionOffered(ctx) && mode !== "Serverless" && mode !== "Free tier") {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, mode=${mode}; dev/test can usually start serverless.`,
      fix: { label: "Use serverless for non-production", settings: { mode: "Serverless" } },
    };
  }
  return { result: "pass", detail: `mode=${mode} matches the offered environments.` };
};

/** Regional disaster recovery: a paired-region copy when the workload spans regions or is mission-critical. */
const storageReplication: WafCheck = (ctx) => {
  const replication = setting(ctx, "replication", "ZRS");
  const geo = ["GRS", "RAGRS", "GZRS", "RAGZRS"].includes(replication);
  const multiRegion = ctx.topology.regions.length > 1;
  const missionCritical = ctx.workload.criticality === "mission-critical";
  if (geo)
    return {
      result: "pass",
      detail: `replication=${replication}; a paired-region copy covers a regional outage.`,
    };
  if (multiRegion)
    return {
      result: "fail",
      detail: `replication=${replication} with ${ctx.topology.regions.length} regions: data has no copy in the second region.`,
      fix: { label: "Use GZRS", settings: { replication: "GZRS" } },
    };
  if (missionCritical)
    return {
      result: "warn",
      detail: `replication=${replication} for a mission-critical workload in one region: a regional outage loses access to the data.`,
      fix: { label: "Use GZRS", settings: { replication: "GZRS" } },
    };
  return {
    result: "pass",
    detail: `replication=${replication} in one region; add a region and GZRS only if regional disaster recovery is required.`,
  };
};

/** Zone resilience: ZRS or GZRS keeps data available through a zone failure. */
const storageZones: WafCheck = (ctx) => {
  const replication = setting(ctx, "replication", "ZRS");
  if (["ZRS", "GZRS", "RAGZRS"].includes(replication))
    return { result: "pass", detail: `replication=${replication}; zone-resilient.` };
  return {
    result: critical(ctx) ? "fail" : "warn",
    detail: `replication=${replication} keeps copies in a single datacenter; a zone failure makes data unavailable.`,
    fix: { label: "Use ZRS", settings: { replication: "ZRS" } },
  };
};

const storageCost: WafCheck = (ctx) => {
  const replication = setting(ctx, "replication", "ZRS");
  if (!productionOffered(ctx) && ["GRS", "RAGRS", "GZRS", "RAGZRS"].includes(replication)) {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, replication=${replication}; geo-replication may be unnecessary outside production.`,
      fix: { label: "Use LRS for non-production", settings: { replication: "LRS" } },
    };
  }
  return {
    result: "pass",
    detail: `replication=${replication} is deliberate for the offered environments.`,
  };
};

const redisReliableSku: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "Balanced_B5");
  const zonal = !["Balanced_B0", "Balanced_B1", "Balanced_B3"].includes(sku);
  if (critical(ctx) && !zonal) {
    return {
      result: "fail",
      detail: `sku=${sku}; ${ctx.workload.criticality} Redis needs a production tier with zone-capable HA.`,
      fix: { label: "Use Balanced B5", settings: { sku: "Balanced_B5" } },
    };
  }
  return {
    result: zonal ? "pass" : "warn",
    detail: `sku=${sku}; ${zonal ? "zone-capable production tier" : "small cache tier without zone metadata"}.`,
    ...(zonal ? {} : { fix: { label: "Use Balanced B5", settings: { sku: "Balanced_B5" } } }),
  };
};

const redisCost: WafCheck = (ctx) => {
  const sku = setting(ctx, "sku", "Balanced_B5");
  if (!productionOffered(ctx) && sku !== "Balanced_B0" && sku !== "Balanced_B1") {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, sku=${sku}; dev/test can start with a smaller cache.`,
      fix: { label: "Use Balanced B0 for non-production", settings: { sku: "Balanced_B0" } },
    };
  }
  return { result: "pass", detail: `sku=${sku} matches the offered environments.` };
};

const admeTier: WafCheck = (ctx) => {
  const tier = setting(ctx, "tier", "Developer");
  if (productionOffered(ctx) && tier !== "Standard") {
    return {
      result: critical(ctx) ? "fail" : "warn",
      detail: `tier=${tier}; production ADME should use the Standard tier.`,
      fix: { label: "Use Standard tier", settings: { tier: "Standard" } },
    };
  }
  return { result: "pass", detail: `tier=${tier}; tier matches the offered environments.` };
};

const admeCost: WafCheck = (ctx) => {
  const tier = setting(ctx, "tier", "Developer");
  if (!productionOffered(ctx) && tier === "Standard") {
    return {
      result: "warn",
      detail: `environments=${ctx.topology.environments.join(",") || "none"}, tier=${tier}; Developer is the catalog's dev/test choice.`,
      fix: { label: "Use Developer tier", settings: { tier: "Developer" } },
    };
  }
  return { result: "pass", detail: `tier=${tier}; cost posture matches the offered environments.` };
};

const apiGatewayForEnergy: WafCheck = (ctx) => {
  if (ctx.has("apim")) {
    return {
      result: "pass",
      detail: "apim is selected to front energy-data APIs with policy and auditing.",
    };
  }
  if (ctx.topology.publicAccess || ctx.workload.data === "regulated") {
    return {
      result: "warn",
      detail: `apim is not selected; publicAccess=${String(ctx.topology.publicAccess)}, data=${ctx.workload.data}.`,
      fix: { label: "Add API Management", add: ["apim"] },
    };
  }
  return {
    result: "pass",
    detail: "apim is not selected, but private topology lowers API exposure.",
  };
};

const existingAdmePrivate: WafCheck = (ctx) => {
  if (ctx.topology.privateEndpoints) {
    return {
      result: "warn",
      detail:
        "privateEndpoints=true for this offering, but the existing ADME instance must expose its own private endpoint outside this catalog.",
    };
  }
  return {
    result: "fail",
    detail:
      "privateEndpoints=false and this catalog cannot change the existing ADME instance network path.",
    fix: {
      label: "Require private endpoints in the topology",
      topology: { privateEndpoints: true, publicAccess: false },
    },
  };
};

export const DATA_GUIDES: WafServiceGuide[] = [
  {
    service: "postgres",
    learn: POSTGRES,
    summary:
      "PostgreSQL Flexible Server is deployed with Entra-only authentication, backups, diagnostics and optional private endpoints; the key catalog decisions are compute SKU, HA mode and engine version.",
    recs: [
      rec(
        "postgres",
        "reliability",
        "zone-ha",
        "Use zone-redundant high availability for critical databases",
        "A standby in another zone reduces outage impact for production relational data.",
        POSTGRES,
        postgresHa,
      ),
      rec(
        "postgres",
        "security",
        "private-access",
        "Keep database access private for sensitive workloads",
        "Private endpoints and disabled public access reduce data exfiltration paths.",
        POSTGRES,
        privateAccess("PostgreSQL"),
      ),
      rec(
        "postgres",
        "security",
        "entra-only",
        "Use Microsoft Entra authentication instead of passwords",
        "The deployed module disables password auth and grants the managed identity as an administrator.",
        POSTGRES,
        managedIdentity,
      ),
      rec(
        "postgres",
        "cost",
        "right-size",
        "Use burstable only for non-production or tolerant workloads",
        "Burstable compute lowers cost but does not provide the same HA posture as General Purpose.",
        POSTGRES,
        postgresCost,
      ),
      rec(
        "postgres",
        "operations",
        "diagnostics",
        "Export PostgreSQL diagnostics",
        "Logs and metrics are needed to see slow queries, connection pressure and failover events.",
        POSTGRES,
        monitored,
      ),
      rec(
        "postgres",
        "performance",
        "current-version",
        "Stay on a current PostgreSQL engine version",
        "Current versions receive performance and operational improvements before older engines.",
        POSTGRES,
        postgresVersion,
      ),
    ],
  },
  {
    service: "sql",
    learn: SQL,
    summary:
      "Azure SQL Database is deployed with Entra-only authentication, private endpoint support, geo backup storage in production and diagnostics; the SKU controls resilience, performance and cost.",
    recs: [
      rec(
        "sql",
        "reliability",
        "tier",
        "Choose a production-capable SQL tier for critical workloads",
        "Business Critical or Hyperscale characteristics are often needed when recovery and latency targets are strict.",
        SQL,
        sqlTier,
      ),
      rec(
        "sql",
        "security",
        "private-access",
        "Keep SQL access on private endpoints",
        "Private Link limits the server endpoint to the workload network when the topology requires private access.",
        SQL,
        privateAccess("Azure SQL"),
      ),
      rec(
        "sql",
        "security",
        "entra-only",
        "Use Entra-only SQL administration",
        "The deployment sets azuread_authentication_only and avoids SQL passwords.",
        SQL,
        managedIdentity,
      ),
      rec(
        "sql",
        "cost",
        "serverless-fit",
        "Use serverless only where pauses and scaling fit the environment",
        "Serverless can reduce non-production spend, but provisioned capacity is safer for critical production SLOs.",
        SQL,
        sqlCost,
      ),
      rec(
        "sql",
        "operations",
        "diagnostics",
        "Export SQL database diagnostics",
        "Metrics and logs help detect deadlocks, DTU/vCore saturation and failed connections.",
        SQL,
        monitored,
      ),
      rec(
        "sql",
        "performance",
        "avoid-low-tiers",
        "Avoid low DTU tiers for production data paths",
        "Low tiers throttle quickly and leave little headroom for bursty application traffic.",
        SQL,
        sqlTier,
      ),
    ],
  },
  {
    service: "cosmos",
    learn: COSMOS,
    summary:
      "Cosmos DB for NoSQL is deployed with local authentication disabled, continuous backup, private endpoint support, diagnostics and autoscale/serverless capacity choices.",
    recs: [
      rec(
        "cosmos",
        "reliability",
        "capacity",
        "Use autoscale throughput for critical containers",
        "Autoscale capacity absorbs bursts and supports the zone-redundant production shape in this catalog.",
        COSMOS,
        cosmosCapacity,
      ),
      rec(
        "cosmos",
        "security",
        "private-access",
        "Keep Cosmos DB behind Private Link",
        "Private network access plus disabled local auth reduces the blast radius for confidential data.",
        COSMOS,
        privateAccess("Cosmos DB"),
      ),
      rec(
        "cosmos",
        "security",
        "entra-only",
        "Disable keys and grant data-plane RBAC",
        "The deployment disables local authentication and assigns the managed identity a data-plane role.",
        COSMOS,
        managedIdentity,
      ),
      rec(
        "cosmos",
        "cost",
        "serverless-nonprod",
        "Use serverless for dev/test and low-volume experiments",
        "Serverless avoids reserved RU/s cost when traffic is intermittent.",
        COSMOS,
        cosmosCost,
      ),
      rec(
        "cosmos",
        "operations",
        "diagnostics",
        "Export request diagnostics",
        "Request metrics and logs reveal throttling, latency and partition hot spots.",
        COSMOS,
        monitored,
      ),
      rec(
        "cosmos",
        "performance",
        "autoscale",
        "Match RU/s mode to burst and latency needs",
        "Under-provisioned fixed throughput causes throttling; autoscale is safer for unpredictable production demand.",
        COSMOS,
        cosmosCapacity,
      ),
    ],
  },
  {
    service: "storage",
    learn: STORAGE,
    summary:
      "Storage accounts are deployed as StorageV2 with HTTPS-only, OAuth-by-default, shared keys disabled, blob soft delete/versioning, infrastructure encryption, diagnostics and private endpoint support.",
    recs: [
      rec(
        "storage",
        "reliability",
        "replication",
        "Choose replication from recovery targets",
        "ZRS protects against zonal failure; GZRS adds a paired-region copy for multi-region or low-RPO workloads.",
        STORAGE,
        storageReplication,
      ),
      rec(
        "storage",
        "security",
        "private-access",
        "Use Private Link and block public blob access",
        "Private endpoints, no anonymous containers and disabled shared keys reduce accidental exposure.",
        STORAGE,
        privateAccess("Storage"),
      ),
      rec(
        "storage",
        "security",
        "managed-identity",
        "Use OAuth and managed identity for blob access",
        "The deployment disables shared-key access and grants Blob Data Contributor to the workload identity.",
        STORAGE,
        managedIdentity,
      ),
      rec(
        "storage",
        "cost",
        "replication-cost",
        "Do not buy geo-replication where the environment does not need it",
        "Replication choices have direct recurring cost; dev/test often does not need paired-region copies.",
        STORAGE,
        storageCost,
      ),
      rec(
        "storage",
        "operations",
        "diagnostics",
        "Export storage transaction metrics",
        "Transaction metrics show latency, errors and capacity trends before customers notice failures.",
        STORAGE,
        monitored,
      ),
      rec(
        "storage",
        "performance",
        "zonal-baseline",
        "Use zone-resilient storage for production hot paths",
        "ZRS/GZRS keeps data in the region available through a zone failure without changing application code.",
        STORAGE,
        storageZones,
      ),
    ],
  },
  {
    service: "redis",
    learn: REDIS,
    summary:
      "Azure Managed Redis is deployed with Entra access policy assignment, access keys disabled, encrypted client protocol, production HA, diagnostics and private endpoint support.",
    recs: [
      rec(
        "redis",
        "reliability",
        "ha-sku",
        "Use a zone-capable Redis SKU for critical cache dependencies",
        "If the app cannot tolerate cache loss, the cache tier must support the production HA design.",
        REDIS,
        redisReliableSku,
      ),
      rec(
        "redis",
        "security",
        "private-access",
        "Keep Redis access private",
        "Private endpoints and encrypted protocol reduce exposure of session and query-cache data.",
        REDIS,
        privateAccess("Redis"),
      ),
      rec(
        "redis",
        "security",
        "entra-only",
        "Disable Redis access keys",
        "The deployment disables access-key authentication and assigns the managed identity an access policy.",
        REDIS,
        managedIdentity,
      ),
      rec(
        "redis",
        "cost",
        "right-size",
        "Use small cache SKUs outside production",
        "Lower tiers are usually enough for dev/test and avoid paying for idle memory.",
        REDIS,
        redisCost,
      ),
      rec(
        "redis",
        "operations",
        "diagnostics",
        "Export Redis metrics",
        "Cache hit rate, memory pressure and connection metrics are operational leading indicators.",
        REDIS,
        monitored,
      ),
      rec(
        "redis",
        "performance",
        "memory-headroom",
        "Size Redis for working-set memory and connection bursts",
        "A cache that evicts too aggressively can amplify database load and hurt response time.",
        REDIS,
        redisReliableSku,
      ),
    ],
  },
  {
    service: "adme",
    learn: ADME,
    summary:
      "Azure Data Manager for Energy is Microsoft's managed OSDU platform; the catalog controls tier and topology while Microsoft Learn covers zone redundancy, active-passive DR and private endpoints.",
    recs: [
      rec(
        "adme",
        "reliability",
        "standard-tier",
        "Use Standard tier for production energy data",
        "Production OSDU workloads need the service tier intended for enterprise operation.",
        ADME,
        admeTier,
      ),
      rec(
        "adme",
        "security",
        "private-access",
        "Expose ADME through private endpoints",
        "Energy data is commonly confidential or regulated, so API traffic should stay on private network paths.",
        ADME_PRIVATE,
        privateAccess("Azure Data Manager for Energy"),
      ),
      rec(
        "adme",
        "security",
        "api-gateway",
        "Front ADME APIs with a secured gateway when exposed",
        "API Management centralizes authentication, policy, throttling and audit for OSDU APIs.",
        ADME_APIM,
        apiGatewayForEnergy,
      ),
      rec(
        "adme",
        "cost",
        "developer-tier",
        "Use Developer tier only outside production",
        "Developer tier is useful for trials but should not carry production customer workloads.",
        ADME,
        admeCost,
      ),
      rec(
        "adme",
        "operations",
        "diagnostics",
        "Monitor ADME and API health",
        "Energy workflows need API availability, latency and ingestion health visible alongside the rest of the install.",
        ADME,
      ),
      rec(
        "adme",
        "performance",
        "tier",
        "Use the tier that matches ingestion and API demand",
        "Standard tier is the appropriate starting point for production-scale OSDU access patterns.",
        ADME,
        admeTier,
      ),
    ],
  },
  {
    service: "adme-connection",
    learn: ADME,
    summary:
      "An existing Azure Data Manager for Energy connection is customer-operated; the catalog can enforce surrounding topology and gateway services, but the existing instance itself must be attested by the customer.",
    recs: [
      rec(
        "adme-connection",
        "reliability",
        "attest-dr",
        "Confirm the existing ADME instance has a tested DR plan",
        "The offering cannot create failover for a customer-owned OSDU endpoint, so runbooks and recovery ownership must be explicit.",
        ADME,
      ),
      rec(
        "adme-connection",
        "security",
        "private-endpoint",
        "Require private connectivity to the existing ADME endpoint",
        "A private path prevents regulated subsurface data from traversing public endpoints unnecessarily.",
        ADME_PRIVATE,
        existingAdmePrivate,
      ),
      rec(
        "adme-connection",
        "security",
        "api-gateway",
        "Use API Management for customer ADME APIs when policy is needed",
        "A gateway gives the solution a controlled policy and audit point without owning the ADME instance.",
        ADME_APIM,
        apiGatewayForEnergy,
      ),
      rec(
        "adme-connection",
        "cost",
        "reuse",
        "Document shared-cost ownership for the existing instance",
        "The catalog shows zero monthly cost because the customer already pays for ADME; chargeback must be external.",
        ADME,
      ),
      rec(
        "adme-connection",
        "operations",
        "monitoring",
        "Add synthetic checks for the external ADME dependency",
        "The connection can fail independently of the deployed resources, so health probes need to cover endpoint, partition and auth.",
        ADME,
      ),
      rec(
        "adme-connection",
        "performance",
        "partition",
        "Validate the selected data partition for expected query and ingestion load",
        "Performance limits are inherited from the customer's existing ADME and OSDU partition design.",
        ADME,
      ),
    ],
  },
];
