/*
 * Azure service catalog: the building blocks an ISV clicks together into a product architecture.
 * Each entry knows its ARM resource type, the Azure Verified Module that deploys it, where it sits
 * in the topology, what it depends on, and which customer inputs it introduces.
 *
 * Pure data — shared by the designer UI, the IaC/pipeline generators and the deployment engine.
 */

import { SKU_OPTIONS, sizing, skuValue } from "./skus";

export type Zone = "edge" | "app" | "integration" | "data" | "shared" | "foundation";

export type OptionDef = {
  key: string;
  label: string;
  choices: string[];
  default: string;
  /** Display label per choice (SKU options show size and price). */
  labels?: Record<string, string>;
  /** Approximate monthly USD per choice. */
  prices?: Record<string, number>;
  /** Caveats per choice, e.g. "no private endpoint". */
  notes?: Record<string, string>;
  /** Sizing that applies to production installs, or to dev/test installs. */
  env?: "prod" | "dev";
  /** Any value is allowed (the choices are a fallback list, e.g. models read live from Azure). */
  open?: boolean;
};

export type ServiceDef = {
  id: string;
  name: string;
  short: string;
  category:
    | "Compute"
    | "AI + analytics"
    | "Data"
    | "Messaging"
    | "Networking"
    | "Security"
    | "Observability"
    | "Governance";
  zone: Zone;
  resourceType: string;
  avm: string;
  version: string;
  /** Deploy wave: lower waves deploy first. */
  wave: number;
  /** Required by architecture policy — always present, cannot be removed. */
  locked?: boolean;
  /** Needs a private endpoint when guardrails require private access. */
  privateLink?: boolean;
  options: OptionDef[];
  inputs?: { key: string; label: string; source: "customer" | "isv"; help: string }[];
  monthly: number;
  blurb: string;
};

export const SERVICES: ServiceDef[] = [
  // foundation
  {
    id: "resource-group",
    name: "Resource group",
    short: "Resource Group",
    category: "Governance",
    zone: "foundation",
    resourceType: "Microsoft.Resources/resourceGroups",
    avm: "avm/res/resources/resource-group",
    version: "0.4.0",
    wave: 0,
    locked: true,
    options: [],
    monthly: 0,
    blurb: "Scope that holds every resource of one install.",
  },
  {
    id: "managed-identity",
    name: "Managed identity",
    short: "Managed identity",
    category: "Security",
    zone: "shared",
    resourceType: "Microsoft.ManagedIdentity/userAssignedIdentities",
    avm: "avm/res/managed-identity/user-assigned-identity",
    version: "0.4.0",
    wave: 0,
    locked: true,
    options: [],
    monthly: 0,
    blurb: "Workload identity used by every service — no secrets.",
  },
  {
    id: "security-baseline",
    name: "Policy pack",
    short: "Policy validation",
    category: "Governance",
    zone: "shared",
    resourceType: "Microsoft.Authorization/policySetDefinitions",
    avm: "avm/ptn/authorization/policy-assignment",
    version: "6.0.0",
    wave: 5,
    locked: true,
    options: [
      {
        key: "profile",
        label: "Control profile",
        choices: ["baseline", "hardened", "utility-critical"],
        default: "hardened",
      },
    ],
    monthly: 0,
    blurb: "Your security baseline, assigned at the install scope and verified after deploy.",
  },
  // networking
  {
    id: "network-spoke",
    name: "Spoke virtual network",
    short: "Network integration",
    category: "Networking",
    zone: "foundation",
    resourceType: "Microsoft.Network/virtualNetworks",
    avm: "avm/res/network/virtual-network",
    version: "0.5.2",
    wave: 1,
    options: [
      {
        key: "subnets",
        label: "Subnet layout",
        choices: ["edge / app / data / endpoints", "app / data / endpoints"],
        default: "edge / app / data / endpoints",
      },
    ],
    monthly: 150,
    blurb: "Product network, peered to the customer's hub or standalone.",
  },
  {
    id: "private-endpoints",
    name: "Private endpoints",
    short: "Private endpoints",
    category: "Networking",
    zone: "foundation",
    resourceType: "Microsoft.Network/privateEndpoints",
    avm: "avm/res/network/private-endpoint",
    version: "0.9.0",
    wave: 4,
    options: [],
    monthly: 90,
    blurb: "Private link for every data service; records land in the customer's DNS.",
  },
  {
    id: "app-gateway",
    name: "Application Gateway + WAF",
    short: "Application Gateway",
    category: "Networking",
    zone: "edge",
    resourceType: "Microsoft.Network/applicationGateways",
    avm: "avm/res/network/application-gateway",
    version: "0.6.0",
    wave: 4,
    options: [{ key: "sku", label: "SKU", choices: ["WAF_v2", "Standard_v2"], default: "WAF_v2" }],
    inputs: [
      {
        key: "customDomain",
        label: "Custom domain",
        source: "customer",
        help: "Hostname users reach the product on.",
      },
    ],
    monthly: 420,
    blurb: "Regional ingress with web application firewall.",
  },
  {
    id: "front-door",
    name: "Front Door",
    short: "Front Door",
    category: "Networking",
    zone: "edge",
    resourceType: "Microsoft.Cdn/profiles",
    avm: "avm/res/cdn/profile",
    version: "0.7.0",
    wave: 4,
    options: [{ key: "tier", label: "Tier", choices: ["Premium", "Standard"], default: "Premium" }],
    monthly: 380,
    blurb: "Global edge with private-link origin.",
  },
  // compute
  {
    id: "aks",
    name: "Azure Kubernetes Service",
    short: "AKS",
    category: "Compute",
    zone: "app",
    resourceType: "Microsoft.ContainerService/managedClusters",
    avm: "avm/res/container-service/managed-cluster",
    version: "0.8.0",
    wave: 3,
    options: [
      {
        key: "tier",
        label: "Cluster tier",
        choices: ["Standard", "Premium", "Free"],
        default: "Standard",
      },
      {
        key: "nodes",
        label: "System + user nodes",
        choices: ["3 + 3 (zonal)", "3 + 6 (zonal)", "1 + 2"],
        default: "3 + 3 (zonal)",
      },
      {
        key: "access",
        label: "API server",
        choices: ["Private cluster", "Authorized IPs"],
        default: "Private cluster",
      },
    ],
    inputs: [
      {
        key: "clusterAdminGroupId",
        label: "Cluster admin Entra group",
        source: "customer",
        help: "Customer group granted AKS RBAC admin.",
      },
    ],
    monthly: 5200,
    blurb: "Runs your application containers.",
  },
  {
    id: "web-vmss",
    name: "Web tier · VM scale set",
    short: "Web tier VMs",
    category: "Compute",
    zone: "edge",
    resourceType: "Microsoft.Compute/virtualMachineScaleSets",
    avm: "avm/res/compute/virtual-machine-scale-set",
    version: "0.8.0",
    wave: 3,
    options: [
      {
        key: "os",
        label: "Operating system",
        choices: [
          "Ubuntu 24.04 LTS",
          "Ubuntu 22.04 LTS",
          "RHEL 9",
          "Windows Server 2022",
          "Windows Server 2025",
        ],
        default: "Ubuntu 24.04 LTS",
      },
      {
        key: "instances",
        label: "Instances · production",
        choices: ["2", "3", "4", "6", "9"],
        default: "3",
        env: "prod",
      },
      {
        key: "devInstances",
        label: "Instances · dev/test",
        choices: ["1", "2"],
        default: "1",
        env: "dev",
      },
      {
        key: "maxInstances",
        label: "Autoscale up to · production",
        choices: ["4", "6", "10", "20", "50"],
        default: "10",
        env: "prod",
      },
    ],
    monthly: 210,
    blurb:
      "Front-end web servers behind Application Gateway or a load balancer, autoscaled across zones.",
  },
  {
    id: "app-vmss",
    name: "App tier · VM scale set",
    short: "App tier VMs",
    category: "Compute",
    zone: "app",
    resourceType: "Microsoft.Compute/virtualMachineScaleSets",
    avm: "avm/res/compute/virtual-machine-scale-set",
    version: "0.8.0",
    wave: 3,
    options: [
      {
        key: "os",
        label: "Operating system",
        choices: [
          "Ubuntu 24.04 LTS",
          "Ubuntu 22.04 LTS",
          "RHEL 9",
          "Windows Server 2022",
          "Windows Server 2025",
        ],
        default: "Ubuntu 24.04 LTS",
      },
      {
        key: "instances",
        label: "Instances · production",
        choices: ["2", "3", "4", "6", "9"],
        default: "3",
        env: "prod",
      },
      {
        key: "devInstances",
        label: "Instances · dev/test",
        choices: ["1", "2"],
        default: "1",
        env: "dev",
      },
      {
        key: "maxInstances",
        label: "Autoscale up to · production",
        choices: ["4", "6", "10", "20", "50"],
        default: "10",
        env: "prod",
      },
    ],
    monthly: 420,
    blurb:
      "Business logic servers behind an internal load balancer; only the web tier can reach them.",
  },
  {
    id: "vm",
    name: "Data tier · virtual machines",
    short: "Data tier VMs",
    category: "Compute",
    zone: "data",
    resourceType: "Microsoft.Compute/virtualMachines",
    avm: "avm/res/compute/virtual-machine",
    version: "0.10.0",
    wave: 3,
    options: [
      {
        key: "os",
        label: "Image",
        choices: [
          "Ubuntu 24.04 LTS",
          "RHEL 9",
          "Windows Server 2022",
          "Windows Server 2025",
          "SQL Server 2022 Developer on Windows Server 2022",
          "SQL Server 2022 Standard on Windows Server 2022",
        ],
        default: "Ubuntu 24.04 LTS",
      },
      {
        key: "count",
        label: "VMs · production",
        choices: ["1", "2", "3"],
        default: "2",
        env: "prod",
      },
      { key: "devCount", label: "VMs · dev/test", choices: ["1", "2"], default: "1", env: "dev" },
      {
        key: "dataDisk",
        label: "Data disk per VM",
        choices: ["64 GB", "128 GB", "256 GB", "512 GB", "1024 GB"],
        default: "256 GB",
      },
    ],
    monthly: 440,
    blurb:
      "Database or legacy servers on VMs with data disks, spread across zones; only the app tier reaches them.",
  },
  {
    id: "container-apps",
    name: "Container Apps",
    short: "Container Apps",
    category: "Compute",
    zone: "app",
    resourceType: "Microsoft.App/managedEnvironments",
    avm: "avm/res/app/managed-environment",
    version: "0.10.0",
    wave: 3,
    options: [
      {
        key: "profile",
        label: "Workload profile",
        choices: ["Consumption", "Dedicated D4"],
        default: "Consumption",
      },
    ],
    monthly: 900,
    blurb: "Serverless containers with internal ingress.",
  },
  {
    id: "app-service",
    name: "App Service",
    short: "App Service",
    category: "Compute",
    zone: "app",
    resourceType: "Microsoft.Web/sites",
    avm: "avm/res/web/site",
    version: "0.15.0",
    wave: 3,
    options: [{ key: "plan", label: "Plan", choices: ["P1v3", "P2v3", "P0v3"], default: "P1v3" }],
    monthly: 480,
    blurb: "Managed web front end or API.",
  },
  {
    id: "functions",
    name: "Azure Functions",
    short: "Functions",
    category: "Compute",
    zone: "app",
    resourceType: "Microsoft.Web/sites",
    avm: "avm/res/web/site",
    version: "0.15.0",
    wave: 3,
    options: [
      {
        key: "plan",
        label: "Hosting",
        choices: ["Flex Consumption", "Premium EP1"],
        default: "Flex Consumption",
      },
    ],
    monthly: 220,
    blurb: "Event-driven jobs and integrations.",
  },
  // data
  {
    id: "postgres",
    name: "PostgreSQL Flexible Server",
    short: "PostgreSQL",
    category: "Data",
    zone: "data",
    resourceType: "Microsoft.DBforPostgreSQL/flexibleServers",
    avm: "avm/res/db-for-postgre-sql/flexible-server",
    version: "0.9.0",
    wave: 2,
    privateLink: true,
    options: [
      {
        key: "sku",
        label: "Compute",
        choices: ["GP_Standard_D4ds_v5", "GP_Standard_D8ds_v5", "B_Standard_B2ms"],
        default: "GP_Standard_D4ds_v5",
      },
      {
        key: "ha",
        label: "High availability",
        choices: ["Zone redundant", "Same zone", "Disabled"],
        default: "Zone redundant",
      },
      {
        key: "version",
        label: "PostgreSQL version",
        choices: ["18", "17", "16", "15", "14", "13"],
        default: "16",
      },
    ],
    monthly: 2100,
    blurb: "Primary relational store.",
  },
  {
    id: "sql",
    name: "Azure SQL Database",
    short: "SQL Database",
    category: "Data",
    zone: "data",
    resourceType: "Microsoft.Sql/servers",
    avm: "avm/res/sql/server",
    version: "0.12.0",
    wave: 2,
    privateLink: true,
    options: [
      {
        key: "sku",
        label: "Service tier",
        choices: ["GP_Gen5_4", "BC_Gen5_4", "HS_Gen5_4"],
        default: "GP_Gen5_4",
      },
    ],
    inputs: [
      {
        key: "sqlAdminGroupId",
        label: "SQL admin Entra group",
        source: "customer",
        help: "Entra-only authentication admin.",
      },
    ],
    monthly: 1600,
    blurb: "Relational store with Entra-only auth.",
  },
  {
    id: "cosmos",
    name: "Cosmos DB",
    short: "Cosmos DB",
    category: "Data",
    zone: "data",
    resourceType: "Microsoft.DocumentDB/databaseAccounts",
    avm: "avm/res/document-db/database-account",
    version: "0.11.0",
    wave: 2,
    privateLink: true,
    options: [
      {
        key: "mode",
        label: "Capacity",
        choices: ["Autoscale 4000 RU/s", "Serverless"],
        default: "Autoscale 4000 RU/s",
      },
    ],
    monthly: 1100,
    blurb: "Globally distributed document store.",
  },
  {
    id: "storage",
    name: "Storage account",
    short: "Storage",
    category: "Data",
    zone: "data",
    resourceType: "Microsoft.Storage/storageAccounts",
    avm: "avm/res/storage/storage-account",
    version: "0.14.0",
    wave: 2,
    privateLink: true,
    options: [
      { key: "replication", label: "Replication", choices: ["ZRS", "GZRS", "LRS"], default: "ZRS" },
    ],
    monthly: 310,
    blurb: "Blob and file storage for telemetry and exports.",
  },
  {
    id: "redis",
    name: "Azure Managed Redis",
    short: "Redis",
    category: "Data",
    zone: "data",
    resourceType: "Microsoft.Cache/redisEnterprise",
    avm: "avm/res/cache/redis-enterprise",
    version: "0.1.0",
    wave: 2,
    privateLink: true,
    options: [
      { key: "sku", label: "SKU", choices: ["Premium P1", "Standard C2"], default: "Premium P1" },
    ],
    monthly: 420,
    blurb:
      "Session and query cache (Azure Managed Redis — Azure Cache for Redis no longer accepts new caches).",
  },
  // AI + analytics
  {
    id: "ai-foundry",
    name: "Azure AI Foundry",
    short: "AI Foundry",
    category: "AI + analytics",
    zone: "data",
    resourceType: "Microsoft.CognitiveServices/accounts",
    avm: "avm/res/cognitive-services/account",
    version: "0.19.1",
    wave: 2,
    privateLink: true,
    options: [
      {
        key: "chatModel",
        label: "Chat model",
        choices: [
          "gpt-5-nano",
          "gpt-5-mini",
          "gpt-5.4-nano",
          "gpt-5.4-mini",
          "gpt-4.1-nano",
          "gpt-4.1-mini",
          "o4-mini",
          "gpt-4.1",
          "gpt-5.1",
          "gpt-5.4",
          "gpt-5.5",
        ],
        default: "gpt-5-mini",
        open: true,
      },
      {
        key: "embeddingModel",
        label: "Embedding model",
        choices: ["none", "text-embedding-3-small", "text-embedding-3-large"],
        default: "none",
        open: true,
      },
      {
        key: "deployment",
        label: "Deployment type",
        choices: ["Standard", "Global standard", "Data zone standard", "Provisioned (PTU)"],
        default: "Data zone standard",
        labels: {
          Standard: "Standard · processed in the region",
          "Global standard": "Global standard · any Azure region, highest quota",
          "Data zone standard": "Data zone standard · stays in the US or EU data zone",
          "Provisioned (PTU)": "Provisioned · reserved throughput units",
        },
      },
      {
        key: "capacity",
        label: "Capacity · production",
        choices: ["10", "30", "50", "100", "200", "500"],
        default: "100",
        env: "prod",
        labels: Object.fromEntries(
          ["10", "30", "50", "100", "200", "500"].map((c) => [c, `${c}K tokens/min (or ${c} PTU)`]),
        ),
      },
      {
        key: "devCapacity",
        label: "Capacity · dev/test",
        choices: ["1", "5", "10", "30", "50"],
        default: "10",
        env: "dev",
        labels: Object.fromEntries(
          ["1", "5", "10", "30", "50"].map((c) => [c, `${c}K tokens/min (or ${c} PTU)`]),
        ),
      },
    ],
    monthly: 3200,
    blurb: "Models and agents for the product's AI features, keyless via managed identity.",
  },
  {
    id: "ai-search",
    name: "Azure AI Search",
    short: "AI Search",
    category: "AI + analytics",
    zone: "data",
    resourceType: "Microsoft.Search/searchServices",
    avm: "avm/res/search/search-service",
    version: "0.13.0",
    wave: 2,
    privateLink: true,
    options: [
      {
        key: "sku",
        label: "Tier",
        choices: ["standard", "standard2", "basic"],
        default: "standard",
      },
    ],
    monthly: 750,
    blurb: "Retrieval over manuals, procedures and records for grounded answers.",
  },
  {
    id: "data-explorer",
    name: "Azure Data Explorer",
    short: "Data Explorer",
    category: "AI + analytics",
    zone: "data",
    resourceType: "Microsoft.Kusto/clusters",
    avm: "avm/res/kusto/cluster",
    version: "0.11.0",
    wave: 2,
    privateLink: true,
    options: [
      {
        key: "sku",
        label: "Cluster",
        choices: ["Standard_E8ads_v5 × 2", "Standard_E16ads_v5 × 2", "Dev(No SLA)_Standard_E2a_v4"],
        default: "Standard_E8ads_v5 × 2",
      },
    ],
    monthly: 4100,
    blurb: "Time-series analytics over sensor and operational telemetry.",
  },
  {
    id: "iot-hub",
    name: "IoT Hub",
    short: "IoT Hub",
    category: "AI + analytics",
    zone: "integration",
    resourceType: "Microsoft.Devices/IotHubs",
    avm: "avm/res/devices/iot-hub",
    version: "0.3.0",
    wave: 2,
    privateLink: true,
    options: [{ key: "sku", label: "Tier", choices: ["S1", "S2", "S3"], default: "S2" }],
    monthly: 1250,
    blurb: "Secure device and edge gateway connectivity for field assets.",
  },
  // messaging / integration
  {
    id: "event-hubs",
    name: "Event Hubs",
    short: "Event Hubs",
    category: "Messaging",
    zone: "integration",
    resourceType: "Microsoft.EventHub/namespaces",
    avm: "avm/res/event-hub/namespace",
    version: "0.9.0",
    wave: 2,
    privateLink: true,
    options: [{ key: "tier", label: "Tier", choices: ["Premium", "Standard"], default: "Premium" }],
    monthly: 1800,
    blurb: "Telemetry ingestion from meters and devices.",
  },
  {
    id: "service-bus",
    name: "Service Bus",
    short: "Service Bus",
    category: "Messaging",
    zone: "integration",
    resourceType: "Microsoft.ServiceBus/namespaces",
    avm: "avm/res/service-bus/namespace",
    version: "0.10.0",
    wave: 2,
    privateLink: true,
    options: [{ key: "tier", label: "Tier", choices: ["Premium", "Standard"], default: "Premium" }],
    monthly: 680,
    blurb: "Commands and workflow messaging.",
  },
  {
    id: "apim",
    name: "API Management",
    short: "API Management",
    category: "Messaging",
    zone: "edge",
    resourceType: "Microsoft.ApiManagement/service",
    avm: "avm/res/api-management/service",
    version: "0.9.0",
    wave: 4,
    options: [
      {
        key: "sku",
        label: "SKU",
        choices: ["Premium v2", "Standard v2", "Developer"],
        default: "Standard v2",
      },
    ],
    inputs: [
      {
        key: "apimPublisherEmail",
        label: "API publisher email",
        source: "isv",
        help: "Shown on the developer portal.",
      },
    ],
    monthly: 700,
    blurb: "Internal API gateway for integrations.",
  },
  // security
  {
    id: "key-vault",
    name: "Key Vault",
    short: "Key Vault",
    category: "Security",
    zone: "shared",
    resourceType: "Microsoft.KeyVault/vaults",
    avm: "avm/res/key-vault/vault",
    version: "0.11.0",
    wave: 1,
    privateLink: true,
    options: [
      {
        key: "keys",
        label: "Encryption keys",
        choices: ["Microsoft-managed", "Customer-managed (HSM)"],
        default: "Microsoft-managed",
      },
    ],
    monthly: 60,
    blurb: "Secrets, certificates and encryption keys.",
  },
  {
    id: "defender",
    name: "Defender for Cloud",
    short: "Defender",
    category: "Security",
    zone: "shared",
    resourceType: "Microsoft.Security/pricings",
    avm: "avm/ptn/security/security-center",
    version: "0.1.0",
    wave: 5,
    options: [
      {
        key: "plans",
        label: "Plans",
        choices: ["Containers + Databases + Storage", "CSPM only"],
        default: "Containers + Databases + Storage",
      },
    ],
    monthly: 640,
    blurb: "Workload protection plans for this install.",
  },
  // observability
  {
    id: "monitoring",
    name: "Azure Monitor",
    short: "Monitoring",
    category: "Observability",
    zone: "shared",
    resourceType: "Microsoft.Insights/diagnosticSettings",
    avm: "avm/res/operational-insights/workspace",
    version: "0.9.0",
    wave: 1,
    locked: true,
    options: [
      {
        key: "retention",
        label: "Retention",
        choices: ["90 days", "365 days", "730 days"],
        default: "90 days",
      },
    ],
    monthly: 420,
    blurb: "Diagnostics and alerts, sent to the customer's workspace when available.",
  },
  {
    id: "app-insights",
    name: "Application Insights",
    short: "App Insights",
    category: "Observability",
    zone: "shared",
    resourceType: "Microsoft.Insights/components",
    avm: "avm/res/insights/component",
    version: "0.4.0",
    wave: 1,
    options: [],
    monthly: 180,
    blurb: "Application tracing and live metrics.",
  },
  {
    id: "budget",
    name: "Budget & cost alerts",
    short: "Budget",
    category: "Governance",
    zone: "shared",
    resourceType: "Microsoft.Consumption/budgets",
    avm: "avm/res/consumption/budget",
    version: "0.3.0",
    wave: 5,
    options: [],
    monthly: 0,
    blurb: "Budget and action group on the install scope.",
  },
];

// Sizing options come from the SKU tables: each becomes a production and a dev/test choice.
for (const svc of SERVICES) {
  const opts = SKU_OPTIONS[svc.id];
  if (!opts) continue;
  const generated: OptionDef[] = opts.flatMap((o) =>
    (["prod", "dev"] as const).map((env) => ({
      key: env === "prod" ? o.key : o.devKey,
      label: `${o.label} · ${env === "prod" ? "production" : "dev/test"}`,
      choices: o.skus.map((k) => k.value),
      default: env === "prod" ? o.default : o.devDefault,
      labels: Object.fromEntries(o.skus.map((k) => [k.value, k.label])),
      prices: Object.fromEntries(o.skus.map((k) => [k.value, k.monthly])),
      notes: Object.fromEntries(
        o.skus
          .filter((k) => k.note || k.pe === false)
          .map((k) => [
            k.value,
            [k.pe === false ? "no private endpoint" : "", k.note ?? ""].filter(Boolean).join(" · "),
          ]),
      ),
      env,
    })),
  );
  const keys = new Set(generated.map((g) => g.key));
  svc.options = [...generated, ...svc.options.filter((o) => !keys.has(o.key))];
}
const aksDef = SERVICES.find((s) => s.id === "aks")!;
aksDef.options = aksDef.options.flatMap((o) =>
  o.key === "nodes"
    ? [
        {
          ...o,
          label: "System + user nodes · production",
          choices: ["1 + 1", "1 + 2", "2 + 2", "3 + 3 (zonal)", "3 + 6 (zonal)", "3 + 9 (zonal)"],
          env: "prod" as const,
        },
        {
          key: "devNodes",
          label: "System + user nodes · dev/test",
          choices: ["1 + 1", "1 + 2", "2 + 2"],
          default: "1 + 1",
          env: "dev" as const,
        },
      ]
    : [o],
);

export const SERVICE_BY_ID = new Map(SERVICES.map((s) => [s.id, s]));
export const CATEGORIES = [
  "Compute",
  "AI + analytics",
  "Data",
  "Messaging",
  "Networking",
  "Security",
  "Observability",
  "Governance",
] as const;
export const LOCKED = SERVICES.filter((s) => s.locked).map((s) => s.id);

export type Selected = { id: string; settings: Record<string, string> };

export type Topology = {
  landing: "existing-customer-hub" | "dedicated-spoke" | "isv-hosted";
  publicAccess: boolean;
  privateEndpoints: boolean;
  regions: string[];
  environments: string[];
  /** ALZ landing zone management group the installs are placed under. */
  landingZone: LandingZone;
};

export type LandingZone = "corp" | "online" | "local" | "sandbox";

/** Default placement: installs peered to a corporate hub go to Corp; everything else is Online. */
export const defaultLandingZone = (landing: Topology["landing"]): LandingZone =>
  landing === "existing-customer-hub" ? "corp" : "online";

/** Resources the product consumes from the customer's platform instead of creating them. */
export const CUSTOMER_PLATFORM = [
  { id: "hub", name: "Hub VNet", type: "Microsoft.Network/virtualNetworks", input: "vnetId" },
  {
    id: "firewall",
    name: "Firewall",
    type: "Microsoft.Network/azureFirewalls",
    input: "firewallPrivateIp",
  },
  {
    id: "dns",
    name: "Private DNS",
    type: "Microsoft.Network/privateDnsZones",
    input: "privateDnsZoneRg",
  },
  {
    id: "law",
    name: "Log Analytics",
    type: "Microsoft.OperationalInsights/workspaces",
    input: "logAnalyticsWorkspaceId",
  },
] as const;

export const withDefaults = (id: string, settings: Record<string, unknown> = {}): Selected => {
  const def = SERVICE_BY_ID.get(id);
  const out: Record<string, string> = {};
  const given = { ...settings };
  // Older manifests stored AI models as one preset, e.g. "gpt-4.1 + text-embedding-3-large".
  if (id === "ai-foundry" && typeof given["models"] === "string" && !given["chatModel"]) {
    const parts = (given["models"] as string).split(" + ");
    given["chatModel"] = parts.find((p) => !p.startsWith("text-embedding")) ?? "gpt-4.1";
    given["embeddingModel"] = parts.find((p) => p.startsWith("text-embedding")) ?? "none";
  }
  for (const o of def?.options ?? []) {
    const v = given[o.key];
    const sku = skuValue(id, o.key, v);
    out[o.key] =
      sku ?? (typeof v === "string" && (o.open || o.choices.includes(v)) ? v : o.default);
  }
  return { id, settings: out };
};

/** Normalises a selection: locked services always present, private endpoints follow the guardrail. */
export function normalise(selected: Selected[], topology: Topology): Selected[] {
  const map = new Map(selected.filter((s) => SERVICE_BY_ID.has(s.id)).map((s) => [s.id, s]));
  for (const id of LOCKED) if (!map.has(id)) map.set(id, withDefaults(id));
  if (!map.has("network-spoke")) map.set("network-spoke", withDefaults("network-spoke"));
  const needsPe =
    topology.privateEndpoints && [...map.keys()].some((id) => SERVICE_BY_ID.get(id)?.privateLink);
  if (needsPe && !map.has("private-endpoints"))
    map.set("private-endpoints", withDefaults("private-endpoints"));
  if (!needsPe) map.delete("private-endpoints");
  return SERVICES.filter((s) => map.has(s.id)).map((s) => map.get(s.id) as Selected);
}

/** Approximate monthly list price of one install: production sizing, or dev/test sizing. */
export const serviceMonthly = (s: Selected, env: "prod" | "dev" = "prod") => {
  const sized = sizing(s.id, s.settings);
  // Model usage is billed per token; a dev/test install's spend is small.
  if (s.id === "ai-foundry" && env === "dev") return 50;
  if (!sized.length)
    return env === "dev"
      ? Math.round((SERVICE_BY_ID.get(s.id)?.monthly ?? 0) * 0.3)
      : (SERVICE_BY_ID.get(s.id)?.monthly ?? 0);
  let n = 1;
  if (s.id === "aks") {
    const counts = (s.settings[env === "prod" ? "nodes" : "devNodes"] ?? "1 + 1")
      .match(/\d+/g)
      ?.map(Number) ?? [1, 1];
    n = counts.reduce((a, b) => a + b, 0);
  }
  const vmCount = (k: string, d: string) => Number(s.settings[k]?.match(/\d+/)?.[0] ?? d);
  if (s.id === "web-vmss" || s.id === "app-vmss")
    n = env === "prod" ? vmCount("instances", "3") : vmCount("devInstances", "1");
  if (s.id === "vm") n = env === "prod" ? vmCount("count", "2") : vmCount("devCount", "1");
  return sized.reduce((sum, x, i) => {
    const sku = env === "prod" ? x.prod : x.dev;
    const count =
      s.id === "data-explorer"
        ? 1
        : (s.id === "aks" && i === 1) || ["web-vmss", "app-vmss", "vm"].includes(s.id)
          ? n
          : 1;
    return sum + sku.monthly * count;
  }, 0);
};

export const monthlyEstimate = (selected: Selected[], env: "prod" | "dev" = "prod") =>
  selected.reduce((sum, s) => sum + serviceMonthly(s, env), 0);

export type Edge = {
  from: string;
  to: string;
  label?: string;
  kind?: "data" | "peering" | "identity";
};

/** Derives the connections drawn on the canvas from what is selected. */
export function edgesFor(selected: Selected[], topology: Topology): Edge[] {
  const has = (id: string) => selected.some((s) => s.id === id);
  const ids = (zone: Zone) =>
    selected.filter((s) => SERVICE_BY_ID.get(s.id)?.zone === zone).map((s) => s.id);
  const compute = ids("app");
  const data = ids("data");
  const messaging = selected
    .filter((s) => ["event-hubs", "service-bus", "iot-hub"].includes(s.id))
    .map((s) => s.id);
  const edges: Edge[] = [];

  const ingressChain = ["front-door", "app-gateway", "apim"].filter(has);
  for (let i = 0; i < ingressChain.length - 1; i += 1)
    edges.push({ from: ingressChain[i] as string, to: ingressChain[i + 1] as string });
  const lastIngress = ingressChain.at(-1);
  if (lastIngress) for (const c of compute) edges.push({ from: lastIngress, to: c });

  for (const c of compute) {
    for (const d of [...messaging, ...data]) edges.push({ from: c, to: d, kind: "data" });
    if (has("key-vault")) edges.push({ from: c, to: "key-vault", kind: "identity" });
  }
  if (topology.landing === "isv-hosted") {
    const entry = ingressChain[0] ?? compute[0];
    if (entry) edges.push({ from: "users", to: entry, label: "sign in" });
  }
  if (topology.landing === "existing-customer-hub" && has("network-spoke"))
    edges.push({ from: "hub", to: "network-spoke", kind: "peering", label: "peering" });
  return edges;
}

/** Customer inputs implied by the architecture — this is what onboarding will ask for. */
export function inputsFor(selected: Selected[], topology: Topology) {
  const inputs: {
    key: string;
    label: string;
    source: "customer" | "isv";
    help: string;
    from: string;
  }[] =
    topology.landing === "isv-hosted"
      ? [
          {
            key: "subscriptionId",
            label: "Hosting subscription",
            source: "isv",
            help: "Created for this customer in your Azure, automatically.",
            from: "Your Azure",
          },
          {
            key: "customerSignInDomain",
            label: "Customer sign-in domain",
            source: "customer",
            help: "So their users sign in with their own work accounts.",
            from: "Customer users",
          },
        ]
      : [
          {
            key: "subscriptionId",
            label: "Target subscription",
            source: "customer",
            help: "Approved subscription for this install.",
            from: "Deployment boundary",
          },
        ];
  if (topology.landing === "existing-customer-hub") {
    for (const p of CUSTOMER_PLATFORM)
      inputs.push({
        key: p.input,
        label: p.name,
        source: "customer",
        help: `Consumed from the customer's platform (${p.type}).`,
        from: "Customer platform",
      });
  } else if (topology.landing === "dedicated-spoke") {
    inputs.push({
      key: "addressSpace",
      label: "Address space",
      source: "customer",
      help: "Non-overlapping CIDR for the product network.",
      from: "Spoke virtual network",
    });
  }
  for (const s of selected)
    for (const i of SERVICE_BY_ID.get(s.id)?.inputs ?? [])
      inputs.push({ ...i, from: SERVICE_BY_ID.get(s.id)?.name ?? s.id });
  return inputs;
}
