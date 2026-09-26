/*
 * Every SKU the offering designer offers per Azure service, cheapest first, with what each one can do
 * (private endpoints, zone redundancy, high availability) and an approximate monthly list price in USD
 * (Linux, East US 2, 730 hours, before discounts). Production and dev/test are chosen separately, so a
 * customer's dev install can run on a Basic tier while production runs zone redundant.
 *
 * Values are what the generated Terraform passes to the azurerm provider (or are parsed into it).
 */

export type Sku = {
  value: string;
  label: string;
  /** Approximate monthly list price in USD for one instance of this SKU. */
  monthly: number;
  /** Supports private endpoints (default true). */
  pe?: boolean;
  /** Supports availability zones / zone redundancy. */
  zones?: boolean;
  /** Supports high availability (a standby). */
  ha?: boolean;
  note?: string;
  /** Older labels saved in offering manifests that mean this SKU. */
  aliases?: string[];
};

export type SkuOption = {
  key: string;
  devKey: string;
  label: string;
  skus: Sku[];
  default: string;
  devDefault: string;
};

const vm = (value: string, vcpu: number, mem: number, monthly: number, note?: string): Sku => ({
  value,
  label: `${value.replace("Standard_", "")} · ${vcpu} vCPU, ${mem} GB`,
  monthly,
  zones: true,
  ...(note ? { note } : {}),
});

export const SKU_OPTIONS: Record<string, SkuOption[]> = {
  aks: [
    {
      key: "tier",
      devKey: "devTier",
      label: "Cluster tier",
      default: "Standard",
      devDefault: "Free",
      skus: [
        { value: "Free", label: "Free · no uptime SLA", monthly: 0, note: "Dev/test only" },
        { value: "Standard", label: "Standard · 99.95% SLA", monthly: 73 },
        { value: "Premium", label: "Premium · long-term support", monthly: 438 },
      ],
    },
    {
      key: "nodeSize",
      devKey: "devNodeSize",
      label: "Node size",
      default: "Standard_D4ds_v5",
      devDefault: "Standard_B2s",
      skus: [
        vm("Standard_B2s", 2, 4, 30, "Burstable — dev/test"),
        vm("Standard_B2ms", 2, 8, 61, "Burstable — dev/test"),
        vm("Standard_B4ms", 4, 16, 121, "Burstable"),
        vm("Standard_D2as_v5", 2, 8, 63),
        vm("Standard_D2ds_v5", 2, 8, 77),
        vm("Standard_D4as_v5", 4, 16, 126),
        vm("Standard_D4ds_v5", 4, 16, 154),
        vm("Standard_D8ds_v5", 8, 32, 308),
        vm("Standard_D16ds_v5", 16, 64, 616),
        vm("Standard_E4ds_v5", 4, 32, 210, "Memory optimized"),
        vm("Standard_E8ds_v5", 8, 64, 420, "Memory optimized"),
        vm("Standard_F4s_v2", 4, 8, 124, "Compute optimized"),
        vm("Standard_D2s_v6", 2, 8, 70),
        vm("Standard_D4s_v6", 4, 16, 140),
        vm("Standard_D2ads_v6", 2, 8, 66),
        vm("Standard_D4ads_v6", 4, 16, 132),
        vm("Standard_D2as_v7", 2, 8, 66),
        vm("Standard_D2s_v7", 2, 8, 72),
        vm("Standard_D2ds_v7", 2, 8, 80),
        vm("Standard_D4as_v7", 4, 16, 132),
        vm("Standard_D4s_v7", 4, 16, 144),
        vm("Standard_D4ds_v7", 4, 16, 160),
        vm("Standard_D8s_v7", 8, 32, 288),
      ],
    },
  ],
  "container-apps": [
    {
      key: "profile",
      devKey: "devProfile",
      label: "Workload profile",
      default: "Consumption",
      devDefault: "Consumption",
      skus: [
        { value: "Consumption", label: "Consumption · pay per use, scale to zero", monthly: 40 },
        { value: "Dedicated D4", label: "Dedicated D4 · 4 vCPU, 16 GB", monthly: 190 },
        { value: "Dedicated D8", label: "Dedicated D8 · 8 vCPU, 32 GB", monthly: 380 },
        { value: "Dedicated D16", label: "Dedicated D16 · 16 vCPU, 64 GB", monthly: 760 },
        { value: "Dedicated E4", label: "Dedicated E4 · 4 vCPU, 32 GB", monthly: 250 },
        { value: "Dedicated E8", label: "Dedicated E8 · 8 vCPU, 64 GB", monthly: 500 },
      ],
    },
  ],
  "app-service": [
    {
      key: "plan",
      devKey: "devPlan",
      label: "App Service plan",
      default: "P1v3",
      devDefault: "B1",
      skus: [
        { value: "B1", label: "Basic B1 · 1 core, 1.75 GB", monthly: 13 },
        { value: "B2", label: "Basic B2 · 2 cores, 3.5 GB", monthly: 26 },
        { value: "B3", label: "Basic B3 · 4 cores, 7 GB", monthly: 52 },
        { value: "S1", label: "Standard S1 · 1 core, 1.75 GB", monthly: 69 },
        { value: "S2", label: "Standard S2 · 2 cores, 3.5 GB", monthly: 138 },
        { value: "S3", label: "Standard S3 · 4 cores, 7 GB", monthly: 276 },
        { value: "P0v3", label: "Premium v3 P0v3 · 1 core, 4 GB", monthly: 62, zones: true },
        { value: "P1v3", label: "Premium v3 P1v3 · 2 cores, 8 GB", monthly: 124, zones: true },
        { value: "P2v3", label: "Premium v3 P2v3 · 4 cores, 16 GB", monthly: 248, zones: true },
        { value: "P3v3", label: "Premium v3 P3v3 · 8 cores, 32 GB", monthly: 496, zones: true },
        { value: "P1mv3", label: "Premium v3 P1mv3 · 2 cores, 16 GB", monthly: 150, zones: true },
        { value: "P2mv3", label: "Premium v3 P2mv3 · 4 cores, 32 GB", monthly: 300, zones: true },
        { value: "P0v4", label: "Premium v4 P0v4 · 1 core, 4 GB", monthly: 70, zones: true },
        { value: "P1v4", label: "Premium v4 P1v4 · 2 cores, 8 GB", monthly: 140, zones: true },
        { value: "P2v4", label: "Premium v4 P2v4 · 4 cores, 16 GB", monthly: 280, zones: true },
      ],
    },
  ],
  functions: [
    {
      key: "plan",
      devKey: "devPlan",
      label: "Hosting",
      default: "FC1",
      devDefault: "FC1",
      skus: [
        {
          value: "FC1",
          label: "Flex Consumption · pay per use, VNet",
          monthly: 20,
          zones: true,
          aliases: ["Flex Consumption"],
        },
        {
          value: "EP1",
          label: "Premium EP1 · always warm, 1 core",
          monthly: 155,
          zones: true,
          aliases: ["Premium EP1"],
        },
        { value: "EP2", label: "Premium EP2 · 2 cores", monthly: 310, zones: true },
        { value: "EP3", label: "Premium EP3 · 4 cores", monthly: 620, zones: true },
      ],
    },
  ],
  postgres: [
    {
      key: "sku",
      devKey: "devSku",
      label: "Compute",
      default: "GP_Standard_D4ds_v5",
      devDefault: "B_Standard_B1ms",
      skus: [
        { value: "B_Standard_B1ms", label: "Burstable B1ms · 1 vCore, 2 GB", monthly: 13 },
        { value: "B_Standard_B2s", label: "Burstable B2s · 2 vCores, 4 GB", monthly: 25 },
        { value: "B_Standard_B2ms", label: "Burstable B2ms · 2 vCores, 8 GB", monthly: 50 },
        { value: "B_Standard_B4ms", label: "Burstable B4ms · 4 vCores, 16 GB", monthly: 99 },
        { value: "B_Standard_B8ms", label: "Burstable B8ms · 8 vCores, 32 GB", monthly: 199 },
        { value: "B_Standard_B12ms", label: "Burstable B12ms · 12 vCores, 48 GB", monthly: 298 },
        { value: "B_Standard_B16ms", label: "Burstable B16ms · 16 vCores, 64 GB", monthly: 398 },
        { value: "B_Standard_B20ms", label: "Burstable B20ms · 20 vCores, 80 GB", monthly: 497 },
        ...(
          [
            ["GP_Standard_D2ds_v5", "General Purpose D2ds_v5 · 2 vCores, 8 GB", 126],
            ["GP_Standard_D4ds_v5", "General Purpose D4ds_v5 · 4 vCores, 16 GB", 252],
            ["GP_Standard_D8ds_v5", "General Purpose D8ds_v5 · 8 vCores, 32 GB", 504],
            ["GP_Standard_D16ds_v5", "General Purpose D16ds_v5 · 16 vCores, 64 GB", 1008],
            ["GP_Standard_D32ds_v5", "General Purpose D32ds_v5 · 32 vCores, 128 GB", 2016],
            ["GP_Standard_D48ds_v5", "General Purpose D48ds_v5 · 48 vCores, 192 GB", 3024],
            ["GP_Standard_D64ds_v5", "General Purpose D64ds_v5 · 64 vCores, 256 GB", 4032],
            ["GP_Standard_D2ads_v5", "General Purpose D2ads_v5 (AMD) · 2 vCores, 8 GB", 126],
            ["GP_Standard_D4ads_v5", "General Purpose D4ads_v5 (AMD) · 4 vCores, 16 GB", 252],
            ["GP_Standard_D8ads_v5", "General Purpose D8ads_v5 (AMD) · 8 vCores, 32 GB", 504],
            ["MO_Standard_E2ds_v5", "Memory Optimized E2ds_v5 · 2 vCores, 16 GB", 166],
            ["MO_Standard_E4ds_v5", "Memory Optimized E4ds_v5 · 4 vCores, 32 GB", 332],
            ["MO_Standard_E8ds_v5", "Memory Optimized E8ds_v5 · 8 vCores, 64 GB", 664],
            ["MO_Standard_E16ds_v5", "Memory Optimized E16ds_v5 · 16 vCores, 128 GB", 1328],
            ["MO_Standard_E32ds_v5", "Memory Optimized E32ds_v5 · 32 vCores, 256 GB", 2656],
          ] as const
        ).map(([value, label, monthly]) => ({ value, label, monthly, zones: true, ha: true })),
      ],
    },
  ],
  sql: [
    {
      key: "sku",
      devKey: "devSku",
      label: "Service tier",
      default: "GP_Gen5_4",
      devDefault: "GP_S_Gen5_1",
      skus: [
        { value: "Basic", label: "Basic · 5 DTU, 2 GB", monthly: 5 },
        { value: "S0", label: "Standard S0 · 10 DTU", monthly: 15 },
        { value: "S1", label: "Standard S1 · 20 DTU", monthly: 30 },
        { value: "S2", label: "Standard S2 · 50 DTU", monthly: 75 },
        { value: "S3", label: "Standard S3 · 100 DTU", monthly: 150 },
        { value: "P1", label: "Premium P1 · 125 DTU", monthly: 465, zones: true },
        {
          value: "GP_S_Gen5_1",
          label: "General Purpose serverless · 0.5–1 vCore, auto-pause",
          monthly: 40,
        },
        { value: "GP_S_Gen5_2", label: "General Purpose serverless · up to 2 vCores", monthly: 90 },
        {
          value: "GP_S_Gen5_4",
          label: "General Purpose serverless · up to 4 vCores",
          monthly: 180,
        },
        { value: "GP_Gen5_2", label: "General Purpose · 2 vCores", monthly: 370, zones: true },
        { value: "GP_Gen5_4", label: "General Purpose · 4 vCores", monthly: 740, zones: true },
        { value: "GP_Gen5_8", label: "General Purpose · 8 vCores", monthly: 1480, zones: true },
        { value: "BC_Gen5_2", label: "Business Critical · 2 vCores", monthly: 1000, zones: true },
        { value: "BC_Gen5_4", label: "Business Critical · 4 vCores", monthly: 2000, zones: true },
        { value: "HS_Gen5_2", label: "Hyperscale · 2 vCores", monthly: 460, zones: true },
        { value: "HS_Gen5_4", label: "Hyperscale · 4 vCores", monthly: 920, zones: true },
        { value: "HS_S_Gen5_2", label: "Hyperscale serverless · up to 2 vCores", monthly: 250 },
      ],
    },
  ],
  cosmos: [
    {
      key: "mode",
      devKey: "devMode",
      label: "Capacity",
      default: "Autoscale 4000 RU/s",
      devDefault: "Serverless",
      skus: [
        { value: "Serverless", label: "Serverless · pay per request", monthly: 25 },
        {
          value: "Free tier",
          label: "Free tier · first 1000 RU/s free (one per subscription)",
          monthly: 0,
        },
        { value: "Provisioned 400 RU/s", label: "Provisioned · 400 RU/s", monthly: 24 },
        { value: "Autoscale 1000 RU/s", label: "Autoscale · up to 1000 RU/s", monthly: 88 },
        {
          value: "Autoscale 4000 RU/s",
          label: "Autoscale · up to 4000 RU/s",
          monthly: 350,
          zones: true,
        },
        {
          value: "Autoscale 10000 RU/s",
          label: "Autoscale · up to 10000 RU/s",
          monthly: 876,
          zones: true,
        },
      ],
    },
  ],
  storage: [
    {
      key: "replication",
      devKey: "devReplication",
      label: "Replication",
      default: "ZRS",
      devDefault: "LRS",
      skus: [
        { value: "LRS", label: "LRS · 3 copies in one datacenter", monthly: 25 },
        { value: "ZRS", label: "ZRS · across availability zones", monthly: 31, zones: true },
        { value: "GRS", label: "GRS · copied to the paired region", monthly: 50 },
        { value: "RAGRS", label: "RA-GRS · readable paired copy", monthly: 63 },
        { value: "GZRS", label: "GZRS · zones + paired region", monthly: 56, zones: true },
        {
          value: "RAGZRS",
          label: "RA-GZRS · zones + readable paired copy",
          monthly: 70,
          zones: true,
        },
      ],
    },
  ],
  // Azure Cache for Redis is retiring and refuses new caches; Azure Managed Redis replaces it.
  redis: [
    {
      key: "sku",
      devKey: "devSku",
      label: "Cache size",
      default: "Balanced_B5",
      devDefault: "Balanced_B0",
      skus: [
        { value: "Balanced_B0", label: "Balanced B0 · 0.5 GB", monthly: 24, aliases: ["Basic C0"] },
        {
          value: "Balanced_B1",
          label: "Balanced B1 · 1 GB",
          monthly: 48,
          aliases: ["Basic C1", "Standard C0", "Standard C1"],
        },
        {
          value: "Balanced_B3",
          label: "Balanced B3 · 3 GB",
          monthly: 96,
          aliases: ["Standard C2"],
        },
        {
          value: "Balanced_B5",
          label: "Balanced B5 · 6 GB",
          monthly: 190,
          zones: true,
          aliases: ["Premium P1", "Standard C3"],
        },
        {
          value: "Balanced_B10",
          label: "Balanced B10 · 12 GB",
          monthly: 380,
          zones: true,
          aliases: ["Premium P2"],
        },
        {
          value: "Balanced_B20",
          label: "Balanced B20 · 24 GB",
          monthly: 760,
          zones: true,
          aliases: ["Premium P3"],
        },
        { value: "Balanced_B50", label: "Balanced B50 · 60 GB", monthly: 1900, zones: true },
        {
          value: "MemoryOptimized_M10",
          label: "Memory optimized M10 · 12 GB",
          monthly: 390,
          zones: true,
        },
        {
          value: "MemoryOptimized_M20",
          label: "Memory optimized M20 · 24 GB",
          monthly: 780,
          zones: true,
        },
        {
          value: "ComputeOptimized_X3",
          label: "Compute optimized X3 · 3 GB",
          monthly: 240,
          zones: true,
        },
        {
          value: "ComputeOptimized_X5",
          label: "Compute optimized X5 · 6 GB",
          monthly: 480,
          zones: true,
        },
        {
          value: "ComputeOptimized_X10",
          label: "Compute optimized X10 · 12 GB",
          monthly: 960,
          zones: true,
        },
        {
          value: "FlashOptimized_A250",
          label: "Flash optimized A250 · 256 GB",
          monthly: 2600,
          zones: true,
        },
      ],
    },
  ],
  "ai-search": [
    {
      key: "sku",
      devKey: "devSku",
      label: "Tier",
      default: "standard",
      devDefault: "basic",
      skus: [
        {
          value: "free",
          label: "Free · 50 MB, shared, no private endpoint",
          monthly: 0,
          pe: false,
          note: "One per subscription",
        },
        { value: "basic", label: "Basic · 15 GB, 3 replicas max", monthly: 75 },
        {
          value: "standard",
          label: "Standard S1 · 160 GB per partition",
          monthly: 250,
          zones: true,
        },
        {
          value: "standard2",
          label: "Standard S2 · 512 GB per partition",
          monthly: 1000,
          zones: true,
        },
        {
          value: "standard3",
          label: "Standard S3 · 1 TB per partition",
          monthly: 2000,
          zones: true,
        },
        {
          value: "storage_optimized_l1",
          label: "Storage optimized L1 · 2 TB per partition",
          monthly: 2800,
          zones: true,
        },
      ],
    },
  ],
  "data-explorer": [
    {
      key: "sku",
      devKey: "devSku",
      label: "Cluster",
      default: "Standard_E8ads_v5 × 2",
      devDefault: "Dev(No SLA)_Standard_E2a_v4 × 1",
      skus: [
        {
          value: "Dev(No SLA)_Standard_E2a_v4 × 1",
          label: "Dev (no SLA) E2a_v4 · 1 node",
          monthly: 175,
          note: "Dev/test only",
        },
        {
          value: "Dev(No SLA)_Standard_D11_v2 × 1",
          label: "Dev (no SLA) D11_v2 · 1 node",
          monthly: 190,
          note: "Dev/test only",
        },
        { value: "Standard_E2ads_v5 × 2", label: "E2ads_v5 · 2 nodes", monthly: 500, zones: true },
        { value: "Standard_E4ads_v5 × 2", label: "E4ads_v5 · 2 nodes", monthly: 1000, zones: true },
        { value: "Standard_E8ads_v5 × 2", label: "E8ads_v5 · 2 nodes", monthly: 2000, zones: true },
        {
          value: "Standard_E16ads_v5 × 2",
          label: "E16ads_v5 · 2 nodes",
          monthly: 4000,
          zones: true,
        },
        {
          value: "Standard_L8as_v3 × 2",
          label: "L8as_v3 storage optimized · 2 nodes",
          monthly: 2600,
          zones: true,
        },
      ],
    },
  ],
  "iot-hub": [
    {
      key: "sku",
      devKey: "devSku",
      label: "Tier",
      default: "S2",
      devDefault: "S1",
      skus: [
        {
          value: "F1",
          label: "Free F1 · 8,000 messages/day",
          monthly: 0,
          pe: false,
          note: "One per subscription",
        },
        { value: "B1", label: "Basic B1 · 400k messages/day, no cloud-to-device", monthly: 10 },
        { value: "B2", label: "Basic B2 · 6M messages/day, no cloud-to-device", monthly: 50 },
        { value: "S1", label: "Standard S1 · 400k messages/day", monthly: 25 },
        { value: "S2", label: "Standard S2 · 6M messages/day", monthly: 250 },
        { value: "S3", label: "Standard S3 · 300M messages/day", monthly: 2500 },
      ],
    },
  ],
  "event-hubs": [
    {
      key: "tier",
      devKey: "devTier",
      label: "Tier",
      default: "Premium",
      devDefault: "Standard",
      skus: [
        {
          value: "Basic",
          label: "Basic · 1 throughput unit, no private endpoint",
          monthly: 11,
          pe: false,
        },
        {
          value: "Standard",
          label: "Standard · 1 throughput unit, auto-inflate",
          monthly: 22,
          zones: true,
        },
        {
          value: "Premium",
          label: "Premium · 1 processing unit, isolated",
          monthly: 870,
          zones: true,
        },
      ],
    },
  ],
  "service-bus": [
    {
      key: "tier",
      devKey: "devTier",
      label: "Tier",
      default: "Premium",
      devDefault: "Standard",
      skus: [
        {
          value: "Basic",
          label: "Basic · queues only, no private endpoint",
          monthly: 1,
          pe: false,
        },
        {
          value: "Standard",
          label: "Standard · topics, no private endpoint",
          monthly: 10,
          pe: false,
        },
        {
          value: "Premium",
          label: "Premium · 1 messaging unit, private endpoint",
          monthly: 677,
          zones: true,
        },
      ],
    },
  ],
  apim: [
    {
      key: "sku",
      devKey: "devSku",
      label: "Tier",
      default: "Standard v2",
      devDefault: "Consumption",
      skus: [
        {
          value: "Consumption",
          label: "Consumption · pay per call, serverless",
          monthly: 5,
          pe: false,
        },
        {
          value: "Developer",
          label: "Developer · no SLA (classic, slow to create)",
          monthly: 50,
          pe: false,
        },
        { value: "Basic v2", label: "Basic v2", monthly: 150, pe: false },
        { value: "Standard v2", label: "Standard v2", monthly: 700, pe: false },
        { value: "Basic", label: "Basic (classic)", monthly: 150, pe: false },
        { value: "Standard", label: "Standard (classic)", monthly: 700, pe: false },
        { value: "Premium v2", label: "Premium v2", monthly: 2800, pe: false, zones: true },
        {
          value: "Premium",
          label: "Premium (classic) · zones, multi-region",
          monthly: 2800,
          pe: false,
          zones: true,
        },
      ],
    },
  ],
  "app-gateway": [
    {
      key: "sku",
      devKey: "devSku",
      label: "SKU",
      default: "WAF_v2",
      devDefault: "Standard_v2",
      skus: [
        {
          value: "Standard_v2",
          label: "Standard v2 · no web application firewall",
          monthly: 180,
          zones: true,
        },
        { value: "WAF_v2", label: "WAF v2 · OWASP and bot protection", monthly: 325, zones: true },
      ],
    },
  ],
  "front-door": [
    {
      key: "tier",
      devKey: "devTier",
      label: "Tier",
      default: "Premium",
      devDefault: "Standard",
      skus: [
        { value: "Standard", label: "Standard · CDN, custom rules", monthly: 35 },
        {
          value: "Premium",
          label: "Premium · managed WAF rules, private link origins",
          monthly: 330,
        },
      ],
    },
  ],
  monitoring: [
    {
      key: "retention",
      devKey: "devRetention",
      label: "Log retention",
      default: "90 days",
      devDefault: "30 days",
      skus: [
        { value: "30 days", label: "30 days", monthly: 50 },
        { value: "60 days", label: "60 days", monthly: 70 },
        { value: "90 days", label: "90 days", monthly: 90 },
        { value: "180 days", label: "180 days", monthly: 130 },
        { value: "365 days", label: "365 days", monthly: 200 },
        { value: "730 days", label: "730 days", monthly: 330 },
      ],
    },
  ],
};

const OPTIONS_BY_KEY = new Map(
  Object.entries(SKU_OPTIONS).flatMap(([service, opts]) =>
    opts.flatMap((o) => [
      [`${service}:${o.key}`, o] as const,
      [`${service}:${o.devKey}`, o] as const,
    ]),
  ),
);

/** The SKU a setting refers to, accepting labels older manifests saved. */
export function skuFor(service: string, key: string, value: string | undefined): Sku | undefined {
  const o = OPTIONS_BY_KEY.get(`${service}:${key}`);
  if (!o) return undefined;
  const v = value ?? (key === o.devKey ? o.devDefault : o.default);
  return o.skus.find((s) => s.value === v || s.aliases?.includes(v) || s.label === v);
}

/** Normalises a stored value to a SKU value, or undefined when it isn't one of this option's SKUs. */
export const skuValue = (service: string, key: string, value: unknown) =>
  typeof value === "string" ? skuFor(service, key, value)?.value : undefined;

/** The production and dev/test SKU of a service's main sizing option. */
export function sizing(service: string, settings: Record<string, string>) {
  return (SKU_OPTIONS[service] ?? []).map((o) => ({
    option: o,
    prod: skuFor(service, o.key, settings[o.key]) ?? o.skus.find((s) => s.value === o.default)!,
    dev:
      skuFor(service, o.devKey, settings[o.devKey]) ??
      o.skus.find((s) => s.value === o.devDefault)!,
  }));
}
