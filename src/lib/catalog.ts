/*
 * Azure service catalog: the building blocks an ISV clicks together into a product architecture.
 * Each entry knows its ARM resource type, the Azure Verified Module that deploys it, where it sits
 * in the topology, what it depends on, and which customer inputs it introduces.
 *
 * Pure data — shared by the designer UI, the IaC/pipeline generators and the deployment engine.
 */

export type Zone = "edge" | "app" | "integration" | "data" | "shared" | "foundation";

export type OptionDef = {
  key: string;
  label: string;
  choices: string[];
  default: string;
};

export type ServiceDef = {
  id: string;
  name: string;
  short: string;
  category:
    "Compute" | "Data" | "Messaging" | "Networking" | "Security" | "Observability" | "Governance";
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
      { key: "version", label: "Engine", choices: ["16", "15"], default: "16" },
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
    name: "Azure Cache for Redis",
    short: "Redis",
    category: "Data",
    zone: "data",
    resourceType: "Microsoft.Cache/redis",
    avm: "avm/res/cache/redis",
    version: "0.8.0",
    wave: 2,
    privateLink: true,
    options: [
      { key: "sku", label: "SKU", choices: ["Premium P1", "Standard C2"], default: "Premium P1" },
    ],
    monthly: 420,
    blurb: "Session and query cache.",
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

export const SERVICE_BY_ID = new Map(SERVICES.map((s) => [s.id, s]));
export const CATEGORIES = [
  "Compute",
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
};

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
  for (const o of def?.options ?? [])
    out[o.key] = typeof settings[o.key] === "string" ? (settings[o.key] as string) : o.default;
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

export const monthlyEstimate = (selected: Selected[]) =>
  selected.reduce((sum, s) => sum + (SERVICE_BY_ID.get(s.id)?.monthly ?? 0), 0);

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
    .filter((s) => ["event-hubs", "service-bus"].includes(s.id))
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
