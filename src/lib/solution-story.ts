/*
 * A solution's page, the way solution libraries present one (overview, benefits, how it works, deploy): built
 * from what the catalog actually knows, so every sentence matches the architecture that gets deployed. Each
 * "how it works" step names the services it describes; the diagram numbers those services.
 */
import { type Architecture } from "./architecture";
import { SERVICE_BY_ID, type Selected, inputsFor } from "./catalog";

export type StoryStep = { title: string; body: string; services: string[] };
export type Benefit = { kind: "outcome" | "reach" | "secure"; title: string; body: string };

/** What each service does in a solution, in one clause. */
const ROLE: Record<string, string> = {
  "front-door":
    "Front Door is the global entry point: it terminates TLS at the edge, filters requests with its web application firewall and reaches the app over Private Link",
  "app-gateway":
    "Application Gateway terminates TLS and inspects every request with its web application firewall",
  apim: "API Management publishes the APIs, authenticates callers and applies rate limits",
  "web-vmss": "web tier VMs serve the front end, autoscaled across availability zones",
  aks: "AKS runs the application containers",
  "app-vmss": "app tier VMs run the business logic behind an internal load balancer",
  "container-apps":
    "Container Apps runs the services as serverless containers with internal ingress",
  "app-service": "App Service hosts the web front end and APIs",
  functions: "Functions runs the event-driven jobs and integrations",
  vm: "data tier VMs host the database or legacy servers, reachable only from the app tier",
  "iot-hub": "IoT Hub connects field devices and edge gateways, each with its own identity",
  "event-hubs": "Event Hubs ingests telemetry from meters and devices",
  "service-bus": "Service Bus carries commands and workflow messages between services",
  postgres: "PostgreSQL holds the relational data",
  sql: "SQL Database holds the relational data, with Microsoft Entra-only authentication",
  cosmos: "Cosmos DB stores documents",
  storage: "Storage keeps blobs and files for telemetry and exports",
  redis: "Redis caches sessions and queries",
  "ai-foundry":
    "AI Foundry serves the models and agents behind the AI features, keyless through managed identity",
  "ai-search": "AI Search retrieves from manuals, procedures and records to ground answers",
  "data-explorer": "Data Explorer analyses time-series sensor and operational telemetry",
  "key-vault": "Key Vault holds the secrets, certificates and encryption keys",
  adme: "Azure Data Manager for Energy, Microsoft's managed OSDU platform, holds the subsurface and well data behind the standard OSDU APIs",
  "adme-connection":
    "it works against the customer's existing Azure Data Manager for Energy instance through its OSDU APIs",
  databricks: "Databricks prepares and transforms the data with Spark",
  "app-configuration": "App Configuration holds the settings the services read at runtime",
  "container-registry": "Container Registry keeps its images private to the install",
  "container-instances": "Container Instances runs the one-off setup and data-load jobs",
  monitoring: "Azure Monitor collects diagnostics and raises alerts",
  "app-insights": "Application Insights traces requests end to end",
  defender: "Defender for Cloud protects the workloads",
  "security-baseline":
    "your policy baseline is assigned to the install and verified after every deploy",
  budget: "a budget alerts on spend",
  "managed-identity":
    "every service signs in with its own managed identity, so there are no secrets to rotate",
};

const role = (id: string) => ROLE[id] ?? SERVICE_BY_ID.get(id)?.blurb ?? id;
const sentence = (parts: string[]) => {
  const s = parts.map(role).join("; ");
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}.` : "";
};
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const short = (id: string) => SERVICE_BY_ID.get(id)?.short ?? id;

const INGRESS = ["front-door", "app-gateway", "apim", "web-vmss"];
const COMPUTE = [
  "aks",
  "container-apps",
  "app-service",
  "functions",
  "app-vmss",
  "container-instances",
  "container-registry",
];
const MESSAGING = ["iot-hub", "event-hubs", "service-bus"];
const DATA = [
  "adme",
  "adme-connection",
  "postgres",
  "sql",
  "cosmos",
  "storage",
  "redis",
  "vm",
  "ai-foundry",
  "ai-search",
  "data-explorer",
  "databricks",
  "app-configuration",
];

/** Numbered steps following a request through one delivery model's architecture. */
export function howItWorks(arch: Architecture, productName: string): StoryStep[] {
  const ids = new Set(arch.selected.map((s: Selected) => s.id));
  const pick = (group: string[]) => group.filter((id) => ids.has(id));
  const ingress = pick(INGRESS);
  const compute = pick(COMPUTE);
  const messaging = pick(MESSAGING);
  const data = pick(DATA);
  const landing = arch.topology.landing;
  const steps: StoryStep[] = [];

  const entry =
    landing === "isv-hosted"
      ? `Users sign in with Microsoft Entra ID. Each customer gets a dedicated environment in your Azure; nothing is installed in theirs.`
      : landing === "existing-customer-hub"
        ? `Traffic from the customer's network arrives through their hub${ids.has("network-spoke") ? " and the peered spoke virtual network the solution runs in" : ""}. Their firewall, DNS and logging stay in charge.`
        : `The solution runs in its own spoke virtual network in the customer's subscription${arch.topology.publicAccess ? "" : ", with no public endpoints"}.`;
  steps.push({
    title:
      landing === "isv-hosted"
        ? "Users sign in"
        : landing === "existing-customer-hub"
          ? "Traffic arrives through the customer's hub"
          : "Its own network in the customer's Azure",
    body: ingress.length ? `${entry} ${sentence(ingress)}` : entry,
    services: [
      ...(landing === "isv-hosted"
        ? ["users"]
        : landing === "existing-customer-hub"
          ? ["hub", "firewall", "network-spoke"]
          : ["network-spoke"]),
      ...ingress,
    ],
  });
  if (compute.length)
    steps.push({
      title: `${productName} runs`,
      body: sentence(compute),
      services: compute,
    });
  if (messaging.length)
    steps.push({
      title: "Events and messages flow in",
      body: `${sentence(messaging)} Producers and consumers scale independently.`,
      services: messaging,
    });
  if (data.length) {
    const pe = ids.has("private-endpoints") || arch.topology.privateEndpoints;
    const privateData = data.filter((id) => SERVICE_BY_ID.get(id)?.privateLink);
    const onlyExisting = data.every((id) => id === "adme-connection");
    steps.push({
      title: onlyExisting ? "Works with their energy data platform" : "Data stays private",
      body: `${sentence(data)}${
        pe && privateData.length
          ? ` ${privateData.length === 1 ? `${short(privateData[0]!)} is` : `${list(privateData.map(short))} are`} reachable only through private endpoints${landing === "existing-customer-hub" ? ", with records in the customer's private DNS" : ""}.`
          : ""
      }`,
      services: [
        ...data,
        ...(pe && privateData.length && ids.has("private-endpoints") ? ["private-endpoints"] : []),
        ...(pe && privateData.length && landing === "existing-customer-hub" ? ["dns"] : []),
      ],
    });
  }
  const secrets = pick(["managed-identity", "key-vault"]);
  if (secrets.length)
    steps.push({ title: "No secrets in code", body: sentence(secrets), services: secrets });
  const operate = pick(["monitoring", "app-insights", "defender", "security-baseline", "budget"]);
  if (operate.length)
    steps.push({
      title: "Operated and governed",
      body: `${sentence(operate)}${landing === "existing-customer-hub" && ids.has("monitoring") ? " Logs go to the customer's Log Analytics workspace." : ""}`,
      services: [
        ...operate,
        ...(landing === "existing-customer-hub" && ids.has("monitoring") ? ["law"] : []),
      ],
    });
  return steps;
}

/** The first step each service appears in, for the numbered badges on the diagram. */
export function stepMarkers(steps: StoryStep[]) {
  const out: Record<string, number> = {};
  steps.forEach((s, i) => s.services.forEach((id) => (out[id] ??= i + 1)));
  return out;
}

const where = (runsIn: string) =>
  /hosted/i.test(runsIn)
    ? "hosting in your Azure"
    : /landing zone/i.test(runsIn)
      ? "the customer's landing zone"
      : "the customer's own Azure";

export function benefits(opts: {
  product: { name: string; outcome: string | null; description: string | null };
  services: string[];
  models: { name: string; runsIn: string; installs: number }[];
}): Benefit[] {
  const { product, services, models } = opts;
  const has = (id: string) => services.includes(id);
  const core = services.filter((id) => [...COMPUTE, ...MESSAGING, ...DATA].includes(id));
  const installs = models.reduce((n, m) => n + m.installs, 0);
  const privateData = services.filter((id) => SERVICE_BY_ID.get(id)?.privateLink).length;
  const guardrails = [
    privateData && has("private-endpoints") ? `private endpoints for ${privateData} services` : "",
    has("managed-identity") ? "managed identities instead of secrets" : "",
    has("key-vault") ? "keys in Key Vault" : "",
    has("defender") ? "Defender for Cloud" : "",
    has("security-baseline") ? "your policy baseline, verified after every deploy" : "",
  ].filter(Boolean);
  const places = [...new Set(models.map((m) => m.runsIn))];
  return [
    {
      kind: "outcome",
      title: product.outcome || `What ${product.name} does`,
      body: `${product.description ?? ""}${core.length ? ` Built on ${list(core.map(short))}.` : ""}`.trim(),
    },
    {
      kind: "reach",
      title: "Deploy it where each customer needs it",
      body: `${models.length} delivery model${models.length === 1 ? "" : "s"}, for ${list(places.map(where))}. Each is a versioned, reviewed offering, and customers move between versions by promotion.${installs ? ` ${installs} environment${installs === 1 ? "" : "s"} run it today.` : ""}`,
    },
    {
      kind: "secure",
      title: "Secure and governed from the first deploy",
      body: guardrails.length
        ? `Every install gets ${list(guardrails)}.`
        : "Every install is checked against your policy baseline.",
    },
  ];
}

/** What onboarding will ask the customer for, for this model. */
export function whatYouNeed(arch: Architecture) {
  return inputsFor(arch.selected, arch.topology).filter((i) => i.source === "customer");
}
