import type { Architecture } from "@/lib/architecture";
import { type Topology, normalise, withDefaults } from "@/lib/catalog";
import type { Workload } from "@/lib/waf/types";

export type ReferenceDesign = {
  id: string;
  title: string;
  summary: string;
  when: string;
  source: { title: string; url: string };
  pattern: string[];
  workload: Workload;
  architecture: Architecture;
  differences: string[];
};

type ServiceSelection = readonly [id: string, settings?: Record<string, string>];

const baseTopology: Topology = {
  landing: "dedicated-spoke",
  // Microsoft's baselines: private by default, zone-redundant in one region (multi-region is a separate decision).
  publicAccess: false,
  privateEndpoints: true,
  regions: ["eastus2"],
  environments: ["development", "test", "production"],
  landingZone: "online",
};

const pick = (items: readonly ServiceSelection[]) =>
  items.map(([id, settings]) => withDefaults(id, settings ?? {}));

const architecture = (
  selected: readonly ServiceSelection[],
  topology: Topology = baseTopology,
): Architecture => ({
  topology,
  selected: normalise(pick(selected), topology),
});

const workload = (patch: Partial<Workload>): Workload => ({
  criticality: "business-critical",
  slo: "99.9",
  rtoMinutes: 240,
  rpoMinutes: 60,
  data: "confidential",
  audience: "external",
  ...patch,
});

const foundationSource = {
  title: "Landing zone identity and access management - Cloud Adoption Framework",
  url: "https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/landing-zone/design-area/identity-access-landing-zones",
};

export const REFERENCE_DESIGNS: ReferenceDesign[] = [
  {
    id: "scratch",
    title: "Start from scratch",
    summary: "Only the required governance, identity, monitoring, and workload network baseline.",
    when: "Choose this when the offering shape is still unknown and you want a clean CAF-ready baseline.",
    source: foundationSource,
    pattern: ["CAF Ready", "foundation", "custom"],
    workload: workload({ criticality: "standard", slo: "99.5", data: "internal" }),
    architecture: architecture([], { ...baseTopology, publicAccess: false }),
    differences: [
      "The catalog automatically includes a workload spoke so future services have a deployment scope.",
    ],
  },
  {
    id: "baseline-zone-redundant-web-app",
    title: "Baseline highly available zone-redundant web app",
    summary:
      "Regional WAF ingress to zone-capable App Service with SQL, Key Vault, Storage, and application telemetry.",
    when: "Choose this for a classic external web product that needs private data access and a familiar managed PaaS stack.",
    source: {
      title: "Baseline Highly Available Zone-Redundant App Services Web Application",
      url: "https://learn.microsoft.com/en-us/azure/architecture/web-apps/app-service/architectures/baseline-zone-redundant",
    },
    pattern: ["web", "zone-redundant", "PaaS", "CAF Ready"],
    workload: workload({ slo: "99.95", rtoMinutes: 60, rpoMinutes: 15 }),
    architecture: architecture([
      ["app-gateway", { sku: "WAF_v2", devSku: "Standard_v2" }],
      ["app-service", { plan: "P1v3", devPlan: "B1" }],
      ["sql", { sku: "GP_Gen5_4", devSku: "GP_S_Gen5_1" }],
      ["key-vault", { keys: "Microsoft-managed" }],
      ["storage", { replication: "ZRS", devReplication: "LRS" }],
      ["app-insights"],
      ["defender"],
      ["budget"],
    ]),
    differences: [
      "The source includes detailed subnet, DNS, deployment slot, and App Service configuration not modeled as separate catalog settings.",
      "The baseline is zone-redundant in one region; multi-region failover is a separate decision (add a region and geo-redundant data).",
    ],
  },
  {
    id: "baseline-aks-cluster",
    title: "Baseline AKS cluster",
    summary:
      "Private AKS with zonal node pools, private container registry, Application Gateway ingress, Key Vault, and monitoring.",
    when: "Choose this when the product already runs on Kubernetes or needs platform primitives such as ingress controllers and node pools.",
    source: {
      title: "Baseline Architecture for an AKS Cluster",
      url: "https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/containers/aks/baseline-aks",
    },
    pattern: ["containers", "AKS", "private cluster", "CAF Ready"],
    workload: workload({ slo: "99.95", rtoMinutes: 60, rpoMinutes: 30 }),
    architecture: architecture([
      [
        "aks",
        {
          tier: "Standard",
          devTier: "Free",
          nodeSize: "Standard_D4ds_v5",
          devNodeSize: "Standard_B2s",
          nodes: "3 + 3 (zonal)",
          devNodes: "1 + 1",
          access: "Private cluster",
        },
      ],
      ["container-registry", { sku: "Premium", devSku: "Basic" }],
      ["app-gateway", { sku: "WAF_v2", devSku: "Standard_v2" }],
      ["key-vault", { keys: "Microsoft-managed" }],
      ["app-insights"],
      ["defender"],
      ["budget"],
    ]),
    differences: [
      "The reference's Azure Firewall, Bastion, GitOps, workload identity details, and ingress controller wiring are not first-class catalog components yet.",
      "Multiple node pools are summarized by the catalog's system + user node setting.",
    ],
  },
  {
    id: "baseline-foundry-chat",
    title: "Baseline Microsoft Foundry / Azure OpenAI chat",
    summary:
      "Network-secured AI chat stack with AI Foundry, AI Search retrieval, App Service, Cosmos DB chat state, Storage, and Key Vault.",
    when: "Choose this for grounded chat, copilots, or agentic experiences that need private data stores and managed identity access.",
    source: {
      title: "Baseline Microsoft Foundry Chat Reference Architecture",
      url: "https://learn.microsoft.com/en-us/azure/architecture/ai-ml/architecture/baseline-microsoft-foundry-chat",
    },
    pattern: ["AI", "RAG", "chat", "zone-redundant", "CAF Ready"],
    workload: workload({ slo: "99.9", rtoMinutes: 120, rpoMinutes: 30, data: "regulated" }),
    architecture: architecture([
      ["app-gateway", { sku: "WAF_v2", devSku: "Standard_v2" }],
      ["app-service", { plan: "P1v3", devPlan: "B1" }],
      [
        "ai-foundry",
        {
          chatModel: "gpt-5-mini",
          embeddingModel: "text-embedding-3-large",
          deployment: "Data zone standard",
          capacity: "100",
          devCapacity: "10",
        },
      ],
      ["ai-search", { sku: "standard", devSku: "basic" }],
      ["cosmos", { mode: "Autoscale 4000 RU/s", devMode: "Serverless" }],
      ["storage", { replication: "ZRS", devReplication: "LRS" }],
      ["key-vault", { keys: "Microsoft-managed" }],
      ["app-configuration", { sku: "standard" }],
      ["app-insights"],
      ["defender"],
      ["budget"],
    ]),
    differences: [
      "The catalog does not yet model Azure AI Agent Service, prompt flow, content safety, model quota governance, or separate private DNS zones.",
      "Cosmos DB is used for chat/session state because the catalog does not expose all state options from the reference.",
    ],
  },
  {
    id: "container-apps-microservices",
    title: "Microservices on Container Apps",
    summary:
      "Global edge to serverless container microservices with Service Bus, Cosmos DB, Container Registry, and managed operations.",
    when: "Choose this for independently deployable services that need container packaging without operating Kubernetes.",
    source: {
      title: "Deploy Microservices to Azure Container Apps",
      url: "https://learn.microsoft.com/en-us/azure/architecture/example-scenario/serverless/microservices-with-container-apps",
    },
    pattern: ["microservices", "containers", "event-driven", "CAF Ready"],
    workload: workload({ slo: "99.9", rtoMinutes: 120, rpoMinutes: 30 }),
    architecture: architecture([
      ["front-door", { tier: "Premium", devTier: "Standard" }],
      ["container-apps", { profile: "Dedicated D4", devProfile: "Consumption" }],
      ["service-bus", { tier: "Premium", devTier: "Standard" }],
      ["cosmos", { mode: "Autoscale 4000 RU/s", devMode: "Serverless" }],
      ["container-registry", { sku: "Premium", devSku: "Basic" }],
      ["key-vault", { keys: "Microsoft-managed" }],
      ["app-configuration", { sku: "standard" }],
      ["app-insights"],
      ["defender"],
      ["budget"],
    ]),
    differences: [
      "The source's per-service Container Apps, Dapr, KEDA rules, and revision rollout settings are represented as one Container Apps environment.",
      "Catalog Front Door captures global ingress but not all route, custom domain, and WAF policy details.",
    ],
  },
  {
    id: "serverless-event-driven",
    title: "Serverless event-driven",
    summary:
      "Functions react to Event Grid and Service Bus events, persist to Cosmos DB and Storage, and keep secrets in Key Vault.",
    when: "Choose this for bursty workflows, file processing, async integration, or CQRS-style back-end automation.",
    source: {
      title: "Event-Driven Architecture Style",
      url: "https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven",
    },
    pattern: ["serverless", "events", "integration", "CAF Ready"],
    workload: workload({ slo: "99.9", rtoMinutes: 120, rpoMinutes: 15, audience: "internal" }),
    architecture: architecture(
      [
        ["functions", { plan: "FC1", devPlan: "FC1" }],
        ["event-grid"],
        ["service-bus", { tier: "Premium", devTier: "Standard" }],
        ["storage", { replication: "GZRS", devReplication: "LRS" }],
        ["cosmos", { mode: "Autoscale 4000 RU/s", devMode: "Serverless" }],
        ["key-vault", { keys: "Microsoft-managed" }],
        ["defender"],
        ["app-insights"],
        ["budget"],
      ],
      { ...baseTopology, publicAccess: false },
    ),
    differences: [
      "The catalog does not yet model individual event subscriptions, retry policies, dead-letter destinations, or Function trigger bindings.",
      "Durable Functions and workflow orchestration are covered conceptually rather than as separate services.",
    ],
  },
  {
    id: "api-platform",
    title: "API platform",
    summary:
      "Application Gateway WAF fronts API Management, which publishes Functions and App Service APIs secured by Key Vault and telemetry.",
    when: "Choose this for productized partner/customer APIs that need developer portal, policy, throttling, and protected back ends.",
    source: {
      title: "Protect APIs by using Azure Application Gateway and Azure API Management",
      url: "https://learn.microsoft.com/en-us/azure/architecture/web-apps/api-management/architectures/protect-apis",
    },
    pattern: ["API", "integration", "WAF", "CAF Ready"],
    workload: workload({ slo: "99.9", rtoMinutes: 120, rpoMinutes: 30, audience: "both" }),
    architecture: architecture([
      ["app-gateway", { sku: "WAF_v2", devSku: "Standard_v2" }],
      ["apim", { sku: "Standard v2", devSku: "Consumption" }],
      ["functions", { plan: "EP1", devPlan: "FC1" }],
      ["app-service", { plan: "P1v3", devPlan: "B1" }],
      ["storage", { replication: "ZRS", devReplication: "LRS" }],
      ["defender"],
      ["key-vault", { keys: "Microsoft-managed" }],
      ["app-insights"],
      ["budget"],
    ]),
    differences: [
      "The reference's APIM policy set, product taxonomy, named values, certificates, and private API DNS are not catalog settings yet.",
      "Developer portal content and API versioning strategy remain implementation work for the offering team.",
    ],
  },
  {
    id: "iot-telemetry",
    title: "IoT telemetry",
    summary:
      "Device ingress through IoT Hub, streaming through Event Hubs, processing with Functions, and analytics in Azure Data Explorer.",
    when: "Choose this for fleet, sensor, or operational telemetry products that need near real-time time-series analytics.",
    source: {
      title: "IoT Analytics with Azure Data Explorer and Azure IoT Hub",
      url: "https://learn.microsoft.com/en-us/azure/architecture/solution-ideas/articles/iot-azure-data-explorer",
    },
    pattern: ["IoT", "telemetry", "streaming", "analytics", "CAF Ready"],
    workload: workload({ slo: "99.9", rtoMinutes: 120, rpoMinutes: 15, audience: "internal" }),
    architecture: architecture([
      ["iot-hub", { sku: "S2", devSku: "S1" }],
      ["event-hubs", { tier: "Premium", devTier: "Standard" }],
      [
        "data-explorer",
        { sku: "Standard_E8ads_v5 × 2", devSku: "Dev(No SLA)_Standard_E2a_v4 × 1" },
      ],
      ["functions", { plan: "EP1", devPlan: "FC1" }],
      ["storage", { replication: "GZRS", devReplication: "LRS" }],
      ["defender"],
      ["key-vault", { keys: "Microsoft-managed" }],
      ["app-insights"],
      ["budget"],
    ]),
    differences: [
      "Device provisioning service, Stream Analytics, ADX database/table policies, and dashboarding are not explicit catalog resources yet.",
      "IoT edge/offline device topology is out of scope for the current catalog.",
    ],
  },
  {
    id: "analytics-lakehouse",
    title: "Analytics lakehouse",
    summary:
      "Event Hubs and zone-redundant Storage feed Databricks jobs and notebooks for curated lakehouse analytics.",
    when: "Choose this for batch/stream data engineering, ML feature preparation, and analytics products centered on a data lake.",
    source: {
      title: "Create a Modern Analytics Architecture by Using Azure Databricks",
      url: "https://learn.microsoft.com/en-us/azure/architecture/solution-ideas/articles/azure-databricks-modern-analytics-architecture",
    },
    pattern: ["analytics", "lakehouse", "streaming", "CAF Ready"],
    workload: workload({
      slo: "99.9",
      rtoMinutes: 240,
      rpoMinutes: 60,
      data: "regulated",
      audience: "internal",
    }),
    architecture: architecture(
      [
        ["databricks", { sku: "premium" }],
        ["defender"],
        ["storage", { replication: "GZRS", devReplication: "LRS" }],
        ["event-hubs", { tier: "Premium", devTier: "Standard" }],
        ["key-vault", { keys: "Customer-managed (HSM)" }],
        ["app-insights"],
        ["budget"],
      ],
      { ...baseTopology, publicAccess: false },
    ),
    differences: [
      "The catalog uses Databricks and Storage to represent the lakehouse; Unity Catalog, Purview, pipelines, Fabric OneLake, and Power BI are not modeled in detail.",
      "Data zones, medallion layers, and workspace-level network rules are implementation decisions outside the template.",
    ],
  },
  {
    id: "n-tier-vms",
    title: "N-tier on VMs",
    summary:
      "Application Gateway WAF reaches web and app VM scale sets, with a VM data tier and supporting Key Vault, Storage, and monitoring.",
    when: "Choose this for lift-and-shift or packaged software that still requires full VM control across web, app, and data tiers.",
    source: {
      title: "Multitier Web Application Built for High Availability and Disaster Recovery",
      url: "https://learn.microsoft.com/en-us/azure/architecture/example-scenario/infrastructure/multi-tier-app-disaster-recovery",
    },
    pattern: ["N-tier", "VMs", "lift-and-shift", "CAF Ready"],
    workload: workload({ slo: "99.9", rtoMinutes: 240, rpoMinutes: 60 }),
    architecture: architecture([
      ["app-gateway", { sku: "WAF_v2", devSku: "Standard_v2" }],
      [
        "web-vmss",
        {
          size: "Standard_D2s_v6",
          devSize: "Standard_B2s",
          os: "Ubuntu 24.04 LTS",
          instances: "3",
          devInstances: "1",
          maxInstances: "10",
        },
      ],
      [
        "app-vmss",
        {
          size: "Standard_D4s_v6",
          devSize: "Standard_B2s",
          os: "Ubuntu 24.04 LTS",
          instances: "3",
          devInstances: "1",
          maxInstances: "10",
        },
      ],
      [
        "vm",
        {
          size: "Standard_E4ds_v5",
          devSize: "Standard_B2ms",
          os: "SQL Server 2022 Standard on Windows Server 2022",
          count: "2",
          devCount: "1",
          dataDisk: "512 GB",
        },
      ],
      ["storage", { replication: "ZRS", devReplication: "LRS" }],
      ["key-vault", { keys: "Microsoft-managed" }],
      ["app-insights"],
      ["defender"],
      ["budget"],
    ]),
    differences: [
      "The source includes Azure Site Recovery, backup policy, load balancer, SQL Server HA/DR, and failover runbooks that are not separate catalog services yet.",
      "OS hardening, patch orchestration, and VM extension details remain part of generated implementation work.",
    ],
  },
];
