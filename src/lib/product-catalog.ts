/*
 * The ISV's product catalog: the software services it sells, grouped by business line, and the delivery
 * models each one is offered as on Azure. A product is what the customer buys (for example "Pipeline
 * integrity agent"); an offering is that product delivered one way (Hosted, Customer Hosted, Enterprise
 * Private, Regulated) with its own Azure architecture, landing zone and guardrails.
 *
 * Demo content. `scripts/gen-product-seed.ts` turns it into db/seed/0005_product_catalog.sql; the Products
 * page reads the narrative fields from here and everything live (offerings, installs) from the database.
 */
import type { LandingZone, Topology } from "@/lib/catalog";

export type ModelKey = "hosted" | "customer" | "private" | "regulated" | "sandbox";

export type DeliveryModel = {
  key: ModelKey;
  name: string;
  offeringType:
    "saas_connected" | "customer_hosted" | "enterprise_private" | "regulated" | "sandbox";
  networkProfile: "isv-hosted" | "dedicated-spoke" | "customer-hub";
  landing: Topology["landing"];
  landingZone: LandingZone;
  body: string;
  extra: string[];
};

export const DELIVERY_MODELS: Record<ModelKey, DeliveryModel> = {
  hosted: {
    key: "hosted",
    name: "Hosted by GridWorks",
    offeringType: "saas_connected",
    networkProfile: "isv-hosted",
    landing: "isv-hosted",
    landingZone: "online",
    body: "A dedicated environment per customer in GridWorks' Azure. The customer needs no Azure of their own.",
    extra: [],
  },
  customer: {
    key: "customer",
    name: "Customer Hosted",
    offeringType: "customer_hosted",
    networkProfile: "dedicated-spoke",
    landing: "dedicated-spoke",
    landingZone: "online",
    body: "Runs in the customer's Azure with its own network — for customers without an established landing zone.",
    extra: [],
  },
  private: {
    key: "private",
    name: "Enterprise Private",
    offeringType: "enterprise_private",
    networkProfile: "customer-hub",
    landing: "existing-customer-hub",
    landingZone: "corp",
    body: "Plugs into the customer's landing zone: their hub, private DNS, firewall and Log Analytics. Private endpoints only.",
    extra: [],
  },
  regulated: {
    key: "regulated",
    name: "Regulated",
    offeringType: "regulated",
    networkProfile: "customer-hub",
    landing: "existing-customer-hub",
    landingZone: "corp",
    body: "Enterprise Private plus Defender for Cloud plans, customer-managed keys and stricter policy for critical infrastructure.",
    extra: ["defender"],
  },
  sandbox: {
    key: "sandbox",
    name: "Sandbox",
    offeringType: "sandbox",
    networkProfile: "dedicated-spoke",
    landing: "dedicated-spoke",
    landingZone: "sandbox",
    body: "A small, isolated trial environment for evaluation.",
    extra: [],
  },
};

export type BusinessLine = {
  id: string;
  name: string;
  tagline: string;
  lead: { name: string; title: string; color: string };
};

export const BUSINESS_LINES: BusinessLine[] = [
  {
    id: "upstream",
    name: "Upstream & Resources",
    tagline: "Discover, develop and responsibly operate advantaged oil, gas and mineral resources.",
    lead: { name: "Jonah Mercer", title: "GM, Upstream solutions", color: "#2f7c83" },
  },
  {
    id: "midstream",
    name: "Gas, LNG & Midstream",
    tagline:
      "Connect production to markets through integrated gas, LNG and infrastructure positions.",
    lead: { name: "Laila Haddad", title: "GM, Midstream solutions", color: "#c46a26" },
  },
  {
    id: "chemicals",
    name: "Products & Chemicals",
    tagline:
      "Manufacture and deliver fuels, materials and specialty products customers use every day.",
    lead: { name: "Rafael Torres", title: "GM, Downstream solutions", color: "#8a5a2b" },
  },
  {
    id: "power",
    name: "Power & Renewables",
    tagline: "Grow reliable power and lower-carbon energy systems at industrial scale.",
    lead: { name: "Ingrid Solberg", title: "GM, Power solutions", color: "#2f5f9e" },
  },
];

export type CatalogProduct = {
  /** Fixed id so the seed is repeatable; the three original demo products keep theirs. */
  id: string;
  line: string;
  name: string;
  pitch: string;
  audience: string;
  outcome: string;
  services: string[];
  models: ModelKey[];
  /** Existing offerings adopted by this product (their installs and release history stay). */
  adopts?: boolean;
  installs: { customer: string; model: ModelKey; envs: ("test" | "production")[] }[];
};

export const PRODUCTS: CatalogProduct[] = [
  {
    id: "22222222-2222-2222-2222-222222222301",
    line: "upstream",
    name: "Subsurface intelligence agent",
    pitch:
      "Searches seismic, well logs and reports together and answers geoscience questions with sources.",
    audience: "Geoscientists and reservoir engineers",
    outcome: "Faster prospect evaluation from existing data",
    services: ["ai-foundry", "ai-search", "data-explorer", "storage", "container-apps"],
    models: ["hosted", "private"],
    installs: [
      { customer: "meridian-energy", model: "private", envs: ["test", "production"] },
      { customer: "copper-ridge", model: "hosted", envs: ["production"] },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222302",
    line: "upstream",
    name: "Drilling and production copilot",
    pitch:
      "Guides drilling and production engineers with live well context, procedures and past incidents.",
    audience: "Drilling and production engineers",
    outcome: "Fewer non-productive hours on the rig",
    services: ["ai-foundry", "ai-search", "app-service", "cosmos", "storage"],
    models: ["hosted", "private"],
    installs: [{ customer: "western-interconnect", model: "private", envs: ["production"] }],
  },
  {
    id: "22222222-2222-2222-2222-222222222223",
    line: "upstream",
    name: "Edge inspection and integrity AI",
    pitch:
      "Runs vision models on drone and camera feeds at the site and flags corrosion and leaks.",
    audience: "Asset integrity teams",
    outcome: "Earlier defect detection with less time on site",
    services: ["iot-hub", "event-hubs", "aks", "ai-foundry", "data-explorer", "storage"],
    models: ["customer", "private"],
    installs: [{ customer: "harbor-municipal", model: "customer", envs: ["production"] }],
  },
  {
    id: "22222222-2222-2222-2222-222222222303",
    line: "upstream",
    name: "Retirement and restoration planner",
    pitch: "Plans well abandonment and site restoration with cost, schedule and regulatory steps.",
    audience: "Decommissioning and HSE teams",
    outcome: "Lower abandonment cost and cleaner regulatory filings",
    services: ["app-service", "sql", "ai-foundry", "storage"],
    models: ["hosted", "customer"],
    installs: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222304",
    line: "midstream",
    name: "LNG operations optimizer",
    pitch:
      "Balances feed gas, liquefaction trains and storage to hit cargo schedules with less flaring.",
    audience: "LNG plant operations",
    outcome: "Higher train utilization and fewer missed cargoes",
    services: ["event-hubs", "data-explorer", "ai-foundry", "container-apps", "postgres"],
    models: ["private", "regulated"],
    installs: [{ customer: "coastal-power", model: "regulated", envs: ["test", "production"] }],
  },
  {
    id: "22222222-2222-2222-2222-222222222305",
    line: "midstream",
    name: "Pipeline integrity agent",
    pitch:
      "Correlates inline inspection, SCADA and geohazard data to rank pipeline segments by risk.",
    audience: "Pipeline integrity engineers",
    outcome: "Risk-ranked digs instead of calendar-based ones",
    services: ["iot-hub", "event-hubs", "data-explorer", "ai-foundry", "aks", "storage"],
    models: ["private", "regulated", "hosted"],
    installs: [
      { customer: "cascade-utilities", model: "regulated", envs: ["production"] },
      { customer: "desert-sun", model: "private", envs: ["test", "production"] },
      { customer: "highline-grid", model: "hosted", envs: ["production"] },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222306",
    line: "midstream",
    name: "Cargo and terminal coordinator",
    pitch: "Coordinates berths, cargo nominations and terminal inventory across partners.",
    audience: "Terminal schedulers and commercial teams",
    outcome: "Less demurrage and fewer scheduling conflicts",
    services: ["app-service", "service-bus", "sql", "ai-foundry", "apim"],
    models: ["hosted", "private"],
    installs: [{ customer: "granite-state", model: "hosted", envs: ["production"] }],
  },
  {
    id: "22222222-2222-2222-2222-222222222307",
    line: "midstream",
    name: "Low-carbon fuels traceability",
    pitch:
      "Tracks carbon intensity of every molecule from source to delivery for certificates and audits.",
    audience: "Commercial and sustainability teams",
    outcome: "Audit-ready carbon claims for low-carbon fuels",
    services: ["container-apps", "cosmos", "service-bus", "apim", "storage"],
    models: ["hosted", "customer"],
    installs: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222308",
    line: "chemicals",
    name: "Process performance optimizer",
    pitch:
      "Recommends setpoints from plant historian data to cut energy use while holding quality.",
    audience: "Process and control engineers",
    outcome: "Lower energy intensity per ton",
    services: ["event-hubs", "data-explorer", "ai-foundry", "aks", "postgres"],
    models: ["private", "regulated"],
    installs: [{ customer: "summit-power", model: "private", envs: ["production"] }],
  },
  {
    id: "22222222-2222-2222-2222-222222222309",
    line: "chemicals",
    name: "Operator knowledge companion",
    pitch:
      "Answers operators' questions from procedures, P&IDs and shift logs, with the source cited.",
    audience: "Control room and field operators",
    outcome: "Faster onboarding and consistent operations",
    services: ["ai-foundry", "ai-search", "app-service", "cosmos", "storage"],
    models: ["hosted", "private"],
    installs: [
      { customer: "silver-creek", model: "private", envs: ["production"] },
      { customer: "tidewater-utilities", model: "hosted", envs: ["production"] },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222310",
    line: "chemicals",
    name: "Turnaround planning control tower",
    pitch: "Brings turnaround scope, contractors, permits and materials into one live plan.",
    audience: "Turnaround and maintenance managers",
    outcome: "Turnarounds finished on schedule",
    services: ["app-service", "sql", "service-bus", "ai-foundry"],
    models: ["hosted", "customer"],
    installs: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222311",
    line: "chemicals",
    name: "Quality and root-cause AI",
    pitch: "Links lab results, batch records and sensor data to explain off-spec product.",
    audience: "Quality and process engineers",
    outcome: "Fewer off-spec batches and faster root cause",
    services: ["data-explorer", "ai-foundry", "container-apps", "storage"],
    models: ["private", "hosted"],
    installs: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222312",
    line: "power",
    name: "Renewable forecasting engine",
    pitch: "Forecasts wind and solar output per site from weather, SCADA and market data.",
    audience: "Renewable operations and trading desks",
    outcome: "Lower imbalance costs and better bids",
    services: ["event-hubs", "data-explorer", "ai-foundry", "functions", "storage"],
    models: ["hosted", "customer", "private"],
    installs: [
      { customer: "bluewater-power", model: "hosted", envs: ["production"] },
      { customer: "prairie-electric", model: "hosted", envs: ["production"] },
      { customer: "valley-grid", model: "private", envs: ["production"] },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222221",
    line: "power",
    name: "Grid and storage orchestrator",
    pitch:
      "Real-time grid telemetry, load forecasting and battery dispatch for utilities and IPPs.",
    audience: "Grid operators and utility control rooms",
    outcome: "Firm capacity from storage and fewer outages",
    services: [],
    models: [],
    adopts: true,
    installs: [],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    line: "power",
    name: "Renewable asset health AI",
    pitch: "Predicts turbine, inverter and battery failures from condition-monitoring data.",
    audience: "Asset managers and O&M contractors",
    outcome: "Higher availability and fewer truck rolls",
    services: ["iot-hub", "data-explorer", "ai-foundry", "container-apps", "storage"],
    models: ["hosted", "private"],
    installs: [
      { customer: "redstone-coop", model: "hosted", envs: ["production"] },
      { customer: "north-grid", model: "private", envs: ["production"] },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222313",
    line: "power",
    name: "Project and interconnection agent",
    pitch:
      "Tracks interconnection queues and permits and drafts studies and filings for new projects.",
    audience: "Development and interconnection teams",
    outcome: "Projects through the queue faster",
    services: ["ai-foundry", "ai-search", "app-service", "postgres", "storage"],
    models: ["hosted", "customer"],
    installs: [{ customer: "orchard-valley", model: "hosted", envs: ["production"] }],
  },
];

export const PRODUCT_BY_NAME = new Map(PRODUCTS.map((p) => [p.name, p]));
export const LINE_BY_NAME = new Map(BUSINESS_LINES.map((l) => [l.name, l]));

/** "Pipeline integrity agent · Enterprise Private" → "Enterprise Private". */
export const modelOf = (offeringName: string) => offeringName.split(" · ").at(-1) ?? offeringName;
export const productOf = (offeringName: string) =>
  offeringName.includes(" · ") ? offeringName.split(" · ")[0]! : "";
