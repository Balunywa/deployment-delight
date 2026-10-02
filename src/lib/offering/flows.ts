import type { Flow, FlowOutcome, FlowStep, HopCheck, HopGap, HopRoute } from "@/lib/alz/scene";
import type { Architecture } from "@/lib/architecture";
import {
  CUSTOMER_PLATFORM,
  SERVICE_BY_ID,
  SERVICES,
  inputsFor,
  monthlyEstimate,
  normalise,
  type Selected,
  type Topology,
  type Zone,
} from "@/lib/catalog";
import type { Workload } from "@/lib/waf/types";

export type WorkloadFlow = Flow & {
  kind: "traffic" | "identity" | "logging" | "deploy" | "operate";
};

export type DiagramNode = {
  id: string;
  title: string;
  sub: string;
  icon: string;
  row: "outside" | "edge" | "app" | "integration" | "data" | "shared" | "platform";
  zone?: "spoke" | "endpoints" | "landing-zone";
};

type AccessModel = {
  zones: string[];
  subresource: string;
  publicDisabledWhenPrivate: boolean;
  note?: string;
};

type RoleGrant = {
  target: string;
  role: string;
  scope: string;
  detail: string;
  builtIn?: boolean;
  gap?: string;
};

const GENERATED_IDS = new Set([
  "web-vmss",
  "app-vmss",
  "vm",
  "app-gateway",
  "key-vault",
  "storage",
  "postgres",
  "sql",
  "cosmos",
  "redis",
  "ai-foundry",
  "ai-search",
  "data-explorer",
  "iot-hub",
  "event-hubs",
  "service-bus",
  "aks",
  "container-apps",
  "app-service",
  "functions",
  "apim",
  "front-door",
  "app-insights",
  "defender",
  "budget",
  "security-baseline",
  "sre-agent",
]);

const COMPUTE_IDS = new Set([
  "aks",
  "app-service",
  "container-apps",
  "functions",
  "web-vmss",
  "app-vmss",
  "vm",
  "container-instances",
]);

const ASYNC_IDS = new Set(["service-bus", "event-hubs", "event-grid", "iot-hub"]);

const PRIVATE_LINK: Record<string, AccessModel> = {
  "app-service": {
    zones: ["privatelink.azurewebsites.net"],
    subresource: "sites",
    publicDisabledWhenPrivate: true,
  },
  functions: {
    zones: ["privatelink.blob.core.windows.net"],
    subresource: "blob",
    publicDisabledWhenPrivate: true,
    note: "The generated private endpoint is for the Functions host storage account.",
  },
  "key-vault": {
    zones: ["privatelink.vaultcore.azure.net"],
    subresource: "vault",
    publicDisabledWhenPrivate: true,
  },
  storage: {
    zones: ["privatelink.blob.core.windows.net"],
    subresource: "blob",
    publicDisabledWhenPrivate: true,
  },
  postgres: {
    zones: ["privatelink.postgres.database.azure.com"],
    subresource: "postgresqlServer",
    publicDisabledWhenPrivate: true,
  },
  sql: {
    zones: ["privatelink.database.windows.net"],
    subresource: "sqlServer",
    publicDisabledWhenPrivate: true,
  },
  cosmos: {
    zones: ["privatelink.documents.azure.com"],
    subresource: "Sql",
    publicDisabledWhenPrivate: true,
  },
  redis: {
    zones: ["privatelink.redis.azure.net"],
    subresource: "redisEnterprise",
    publicDisabledWhenPrivate: true,
    note: "This architecture uses Azure Managed Redis, not retired Azure Cache for Redis.",
  },
  "ai-foundry": {
    zones: [
      "privatelink.cognitiveservices.azure.com",
      "privatelink.openai.azure.com",
      "privatelink.services.ai.azure.com",
    ],
    subresource: "account",
    publicDisabledWhenPrivate: true,
  },
  "ai-search": {
    zones: ["privatelink.search.windows.net"],
    subresource: "searchService",
    publicDisabledWhenPrivate: true,
  },
  "data-explorer": {
    zones: [
      "privatelink.${region}.kusto.windows.net",
      "privatelink.blob.core.windows.net",
      "privatelink.queue.core.windows.net",
      "privatelink.table.core.windows.net",
    ],
    subresource: "cluster",
    publicDisabledWhenPrivate: true,
  },
  "iot-hub": {
    zones: ["privatelink.azure-devices.net"],
    subresource: "iotHub",
    publicDisabledWhenPrivate: false,
    note: "Field devices stay public; services inside the VNet use the private endpoint.",
  },
  "event-hubs": {
    zones: ["privatelink.servicebus.windows.net"],
    subresource: "namespace",
    publicDisabledWhenPrivate: true,
  },
  "service-bus": {
    zones: ["privatelink.servicebus.windows.net"],
    subresource: "namespace",
    publicDisabledWhenPrivate: true,
    note: "Private endpoints are emitted only for Premium namespaces.",
  },
  "container-registry": {
    zones: ["privatelink.azurecr.io"],
    subresource: "registry",
    publicDisabledWhenPrivate: true,
    note: "The catalog includes ACR, but the Terraform generator currently does not emit it.",
  },
  "app-configuration": {
    zones: ["privatelink.azconfig.io"],
    subresource: "configurationStores",
    publicDisabledWhenPrivate: true,
  },
  "event-grid": {
    zones: ["privatelink.eventgrid.azure.net"],
    subresource: "topic",
    publicDisabledWhenPrivate: false,
  },
};

const ICONS: Record<string, string> = {
  users: "users",
  operators: "users",
  internet: "public-ip",
  cicd: "connections",
  entra: "connections",
  onprem: "on-premises",
  hub: "vwan-hub",
  firewall: "firewall",
  dns: "dns-zones",
  law: "log-analytics",
  "front-door": "front-door",
  "app-gateway": "app-gateway",
  "key-vault": "key-vault",
  sql: "sql-database",
  postgres: "sql-database",
  cosmos: "sql-database",
  storage: "subscription",
  redis: "sql-database",
  "network-spoke": "vnet",
  "private-endpoints": "private-endpoint",
  "managed-identity": "connections",
  "app-insights": "monitor",
  monitoring: "log-analytics",
  defender: "defender",
  aks: "vnet",
  "container-apps": "connections",
  "app-service": "connections",
  functions: "connections",
  "web-vmss": "vm",
  "app-vmss": "vm",
  vm: "vm",
  apim: "connections",
  "service-bus": "connections",
  "event-hubs": "connections",
  "event-grid": "connections",
  "iot-hub": "connections",
  "container-registry": "subscription",
};

const COLORS = {
  traffic: "#2fb3e8",
  identity: "#8b5cf6",
  logging: "#22c55e",
  deploy: "#f59e0b",
  operate: "#ec4899",
} as const;

const nameOf = (id: string) => SERVICE_BY_ID.get(id)?.name ?? titleCase(id);
const shortOf = (id: string) => SERVICE_BY_ID.get(id)?.short ?? nameOf(id);

const titleCase = (id: string) =>
  id
    .split("-")
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1))
    .join(" ");

const selectedOf = (arch: Architecture) => normalise(arch.selected, arch.topology);
const selectedMap = (selected: Selected[]) => new Map(selected.map((s) => [s.id, s]));
const hasId = (selected: Selected[], id: string) => selected.some((s) => s.id === id);

const flow = (kind: WorkloadFlow["kind"], base: Flow): WorkloadFlow => ({ ...base, kind });

const step = (
  at: string,
  title: string,
  body: string,
  opts: {
    via?: string | undefined;
    route?: HopRoute | undefined;
    checks?: HopCheck[] | undefined;
    gap?: HopGap | undefined;
  } = {},
): FlowStep => {
  const out: FlowStep = { at, title, body };
  if (opts.via) out.via = opts.via;
  if (opts.route) out.route = opts.route;
  if (opts.checks?.length) out.checks = opts.checks;
  if (opts.gap) out.gap = opts.gap;
  return out;
};

const peSupported = (s: Selected) => {
  if (!PRIVATE_LINK[s.id]) return false;
  if (s.id === "service-bus") return (s.settings["tier"] ?? "Premium") === "Premium";
  if (s.id === "ai-search")
    return !["free", "basic"].includes((s.settings["sku"] ?? "").toLowerCase());
  if (s.id === "container-registry") return (s.settings["sku"] ?? "Premium") === "Premium";
  return true;
};

const peDeployed = (s: Selected, topology: Topology) =>
  topology.privateEndpoints && peSupported(s) && GENERATED_IDS.has(s.id);

const dnsMode = (topology: Topology) =>
  topology.landing === "existing-customer-hub"
    ? "platform/policy private DNS zones in the customer's landing zone"
    : "private DNS zones created in the workload resource group and linked to the spoke";

const routeForTarget = (target: Selected, topology: Topology): HopRoute => {
  if (peDeployed(target, topology))
    return {
      kind: "DNS",
      text: `${dnsMode(topology)} resolves ${PRIVATE_LINK[target.id]!.zones.join(", ")} to the private endpoint.`,
    };
  return {
    kind: "Public",
    text: `${shortOf(target.id)} is reached on its Azure public endpoint.`,
  };
};

const targetGap = (target: Selected, topology: Topology): HopGap | undefined => {
  const link = PRIVATE_LINK[target.id];
  if (!GENERATED_IDS.has(target.id))
    return {
      severity: "fail",
      text: `${nameOf(target.id)} is selected, but the Terraform generator does not currently emit this resource.`,
    };
  if (topology.privateEndpoints && link && !peSupported(target))
    return {
      severity: "warn",
      text: `${nameOf(target.id)} is on a tier/SKU where this generator keeps the public endpoint because private endpoint support is unavailable.`,
    };
  if (!peDeployed(target, topology) && !topology.publicAccess)
    return {
      severity: "fail",
      text: "The workload is private-by-default, but this selected service has no deployed private endpoint in the generated Terraform.",
    };
  if (!peDeployed(target, topology))
    return {
      severity: "warn",
      text: "Traffic leaves the spoke to a public Azure endpoint; no Private Link DNS record is deployed.",
    };
  return undefined;
};

const outcomeForTarget = (target: Selected, topology: Topology): FlowOutcome => {
  const gap = targetGap(target, topology);
  if (gap?.severity === "fail") return { status: "blocked", text: gap.text };
  if (gap?.severity === "warn") return { status: "uninspected", text: gap.text };
  return {
    status: "reaches",
    text: `${shortOf(target.id)} is reachable through Private Link and ${PRIVATE_LINK[target.id]!.zones.join(", ")}.`,
  };
};

const computeSelected = (selected: Selected[]) => selected.filter((s) => COMPUTE_IDS.has(s.id));

const runtimeTargets = (selected: Selected[]) =>
  selected.filter((s) => {
    const def = SERVICE_BY_ID.get(s.id);
    if (!def) return false;
    if (COMPUTE_IDS.has(s.id)) return false;
    if (["resource-group", "network-spoke", "managed-identity", "monitoring"].includes(s.id))
      return false;
    return (
      def.zone === "data" ||
      def.zone === "integration" ||
      ["key-vault", "app-configuration"].includes(s.id)
    );
  });

const ingressChain = (selected: Selected[]) =>
  ["front-door", "app-gateway", "apim"].filter((id) => hasId(selected, id));

function ingressFlows(arch: Architecture, workload?: Workload): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const chain = ingressChain(selected);
  const audience = workload?.audience ?? "external";
  const computes = computeSelected(selected);
  if (!computes.length) return [];
  return computes.map((compute) => {
    const directPrivate =
      !chain.length && !arch.topology.publicAccess && arch.topology.privateEndpoints;
    const steps: FlowStep[] = [
      step(
        "users",
        audience === "internal"
          ? "Internal users open the product URL"
          : "Users open the product URL",
        audience === "internal"
          ? "Users usually arrive from the customer network or VPN. The application still relies on Entra sign-in and the selected edge services."
          : "HTTPS starts at the public product hostname and follows the selected edge chain.",
        {
          via: "HTTPS 443",
          route: {
            kind: "Public",
            text: "User DNS resolves the product hostname to the first public edge.",
          },
        },
      ),
    ];
    for (const id of chain) {
      const checks: HopCheck[] = [];
      if (id === "front-door" || id === "app-gateway")
        checks.push({
          kind: "WAF",
          text: `${shortOf(id)} deploys managed WAF rules in prevention for production and detection for non-production.`,
          result: "inspect",
        });
      steps.push(
        step(
          id,
          `${shortOf(id)} forwards the request`,
          id === "front-door"
            ? "Front Door terminates at the global edge and forwards over HTTPS to the workload origin configured by Terraform."
            : id === "app-gateway"
              ? "Application Gateway listens on the public frontend and forwards to the application backend over HTTP/HTTPS."
              : "API Management provides the product API edge; diagnostics go to Log Analytics.",
          { via: "HTTPS", checks },
        ),
      );
    }
    steps.push(
      step(
        compute.id,
        `${shortOf(compute.id)} receives application traffic`,
        computeIngressBody(compute, arch.topology, !!chain.length),
        {
          via: chain.length ? "backend pool / origin" : "direct endpoint",
          gap: directPrivate
            ? {
                severity: "fail",
                text: "Public access is off and no edge entry point is selected, so internet users cannot reach this compute tier.",
              }
            : undefined,
        },
      ),
    );
    return flow("traffic", {
      id: `traffic-ingress-${compute.id}`,
      title: `Users reach ${shortOf(compute.id)}`,
      summary: chain.length
        ? `Ingress follows ${chain.map(shortOf).join(" → ")} before ${shortOf(compute.id)}.`
        : `Ingress goes directly to ${shortOf(compute.id)}.`,
      color: COLORS.traffic,
      available: !directPrivate,
      reason: directPrivate
        ? "No public edge service is selected for a private workload."
        : undefined,
      steps,
      outcome: directPrivate
        ? {
            status: "blocked",
            text: "Add Front Door/Application Gateway or expose a private access path.",
          }
        : { status: "reaches", text: `${shortOf(compute.id)} receives the request.` },
    });
  });
}

function computeIngressBody(compute: Selected, topology: Topology, edge: boolean) {
  if (compute.id === "aks") {
    const access = compute.settings["access"] ?? "Private cluster";
    return access === "Private cluster"
      ? "Application traffic is expected through in-cluster ingress; the AKS API server itself is private, with Azure RBAC enabled."
      : "Application traffic is expected through in-cluster ingress; the AKS API server is restricted by authorized IPs.";
  }
  if (["web-vmss", "app-vmss", "vm"].includes(compute.id))
    return edge
      ? "The VM tier receives traffic from the gateway/load balancer. NSGs only allow the intended tier-to-tier ports."
      : topology.publicAccess
        ? "The generated VM tier may expose a public load balancer when no gateway is selected."
        : "The generated VM tier is private unless reached from the network or a selected gateway.";
  if (compute.id === "container-apps")
    return "Container Apps runs in a managed environment; Terraform sets the environment internal when public access is disabled.";
  if (compute.id === "functions")
    return "Functions runs with the workload identity and uses a private storage endpoint when private endpoints are enabled.";
  return topology.publicAccess
    ? "The app permits public network access and uses the workload user-assigned managed identity."
    : "Public network access is disabled when private endpoints are enabled; requests should arrive through the selected edge/private path.";
}

function serviceTrafficFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const computes = computeSelected(selected);
  const targets = runtimeTargets(selected);
  return computes.flatMap((compute) =>
    targets
      .filter((target) => target.id !== compute.id)
      .map((target) => {
        const link = PRIVATE_LINK[target.id];
        const privatePath = peDeployed(target, arch.topology);
        const gap = targetGap(target, arch.topology);
        const checks: HopCheck[] = privatePath
          ? [
              {
                kind: "Policy",
                text: `${shortOf(target.id)} public network access is ${link?.publicDisabledWhenPrivate ? "disabled" : "restricted"} by the private endpoint design.`,
                result: "allow",
              },
            ]
          : [];
        const steps = [
          step(
            compute.id,
            `${shortOf(compute.id)} calls ${shortOf(target.id)}`,
            "The application authenticates with the workload user-assigned managed identity; no keys or connection strings are required by the generated module.",
            { via: privatePath ? "Private Link" : "Azure public endpoint" },
          ),
          ...(privatePath
            ? [
                step(
                  "dns",
                  "Private DNS resolves the service FQDN",
                  `${dnsMode(arch.topology)} hosts ${link!.zones.join(", ")} for the private endpoint.`,
                  { route: routeForTarget(target, arch.topology) },
                ),
              ]
            : []),
          step(
            target.id,
            `${shortOf(target.id)} accepts the request`,
            link?.note ?? "The service is deployed by the offering Terraform.",
            { route: routeForTarget(target, arch.topology), checks, gap },
          ),
        ];
        return flow("traffic", {
          id: `traffic-${compute.id}-to-${target.id}`,
          title: `${shortOf(compute.id)} reaches ${shortOf(target.id)}`,
          summary: privatePath
            ? `Private endpoint with ${link!.zones.join(", ")}.`
            : "Public endpoint or missing generator path.",
          color: COLORS.traffic,
          available: gap?.severity !== "fail",
          reason: gap?.severity === "fail" ? gap.text : undefined,
          steps,
          outcome: outcomeForTarget(target, arch.topology),
        });
      }),
  );
}

function asyncFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const computes = computeSelected(selected);
  if (!computes.length) return [];
  return selected
    .filter((s) => ASYNC_IDS.has(s.id))
    .map((bus) => {
      const producer = computes[0]!;
      const consumer = computes[1] ?? producer;
      const gap = targetGap(bus, arch.topology);
      return flow("traffic", {
        id: `traffic-async-${bus.id}`,
        title: `${shortOf(bus.id)} asynchronous producer/consumer`,
        summary: `${shortOf(producer.id)} publishes and ${shortOf(consumer.id)} consumes through ${shortOf(bus.id)}.`,
        color: COLORS.traffic,
        available: gap?.severity !== "fail",
        reason: gap?.severity === "fail" ? gap.text : undefined,
        steps: [
          step(
            producer.id,
            "Producer sends a message",
            "The producer uses Entra ID and the workload managed identity.",
            {
              via: peDeployed(bus, arch.topology) ? "Private Link" : "public endpoint",
            },
          ),
          step(
            bus.id,
            `${shortOf(bus.id)} buffers the work`,
            "The namespace/topic decouples producers from consumers.",
            {
              route: routeForTarget(bus, arch.topology),
              gap,
            },
          ),
          step(
            consumer.id,
            "Consumer processes the message",
            "The consumer uses the same workload identity and data-plane role assignment.",
          ),
        ],
        outcome: outcomeForTarget(bus, arch.topology),
      });
    });
}

function egressFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const computes = computeSelected(selected);
  if (!computes.length) return [];
  return computes.map((compute) => {
    const throughFirewall = arch.topology.landing === "existing-customer-hub";
    const steps: FlowStep[] = [
      step(
        compute.id,
        `${shortOf(compute.id)} starts outbound traffic`,
        "Application subnets have route-all/UDR semantics where the generated Terraform supports them.",
        {
          via: "0.0.0.0/0",
        },
      ),
    ];
    if (throughFirewall) {
      steps.push(
        step(
          "firewall",
          "Hub firewall inspects egress",
          "When customer input firewallPrivateIp is set, generated route tables send 0.0.0.0/0 to the customer's Azure Firewall private IP.",
          {
            route: {
              kind: "UDR",
              text: "0.0.0.0/0 → VirtualAppliance (customer firewallPrivateIp).",
            },
            checks: [
              {
                kind: "Firewall",
                text: "The customer firewall needs explicit application/network rules for required destinations.",
                result: "needs-rule",
              },
            ],
            gap: {
              severity: "warn",
              text: "If firewallPrivateIp is left blank, the generated spoke uses its own outbound path instead of the hub firewall.",
            },
          },
        ),
      );
    }
    steps.push(
      step(
        "internet",
        "Outbound destination",
        throughFirewall
          ? "Approved egress leaves through the customer's landing zone."
          : "Outbound traffic leaves through the spoke's own outbound mechanism (NAT gateway for VM tiers, service-managed outbound for PaaS/AKS when no firewall IP is supplied).",
        { via: "HTTPS / service endpoints" },
      ),
    );
    return flow("traffic", {
      id: `traffic-egress-${compute.id}`,
      title: `${shortOf(compute.id)} internet egress`,
      summary: throughFirewall
        ? "Egress is intended to traverse the customer's hub firewall."
        : "Egress uses the workload spoke or service-managed outbound path.",
      color: COLORS.traffic,
      available: true,
      steps,
      outcome: throughFirewall
        ? {
            status: "needs-rules",
            text: "Firewall rules and the firewallPrivateIp onboarding input decide reachability.",
          }
        : {
            status: "uninspected",
            text: "No hub firewall is on this path unless the customer supplies one.",
          },
    });
  });
}

function operatorFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const flows: WorkloadFlow[] = [];
  const aks = selected.find((s) => s.id === "aks");
  if (aks) {
    const privateCluster = (aks.settings["access"] ?? "Private cluster") === "Private cluster";
    flows.push(
      flow("traffic", {
        id: "traffic-operators-aks",
        title: "Operators administer AKS",
        summary: privateCluster
          ? "Private API server reached from the customer network."
          : "Public API server restricted by authorized IPs.",
        color: COLORS.traffic,
        available: true,
        steps: [
          step(
            "operators",
            "Operator signs in",
            "Cluster local accounts are disabled; Microsoft Entra ID and Azure RBAC are required.",
            {
              via: "kubectl / Azure CLI",
            },
          ),
          step(
            "entra",
            "Entra authorizes the operator",
            "clusterAdminGroupId is granted AKS Azure RBAC admin when provided.",
          ),
          step(
            aks.id,
            "AKS API server",
            privateCluster
              ? 'The API server is private; Terraform sets private_dns_zone_id = "None" and keeps the public FQDN enabled for name resolution.'
              : "The API server is public but constrained by authorized IP rules.",
            {
              route: privateCluster
                ? {
                    kind: "BGP",
                    text: "Operators need VPN/ExpressRoute/peering into the spoke or customer hub.",
                  }
                : { kind: "Public", text: "Authorized public source IPs only." },
            },
          ),
        ],
        outcome: privateCluster
          ? { status: "isolated", text: "Admin access requires a private network path." }
          : {
              status: "reaches",
              text: "Admin access reaches the public API only from approved IPs.",
            },
      }),
    );
  }
  const vm = selected.find((s) => ["web-vmss", "app-vmss", "vm"].includes(s.id));
  if (vm) {
    flows.push(
      flow("traffic", {
        id: "traffic-operators-vm",
        title: "Operators administer virtual machines",
        summary: "VM admin uses Bastion/network access from the landing zone plus Entra VM login.",
        color: COLORS.traffic,
        available: true,
        steps: [
          step(
            "operators",
            "Operator starts SSH/RDP",
            "Operators sign in with Entra accounts, not shared passwords.",
          ),
          step(
            "hub",
            "Landing zone access path",
            "Bastion/VPN/ExpressRoute in the landing zone provides the private network path.",
            {
              via: "Bastion or private connectivity",
            },
          ),
          step(
            vm.id,
            `${shortOf(vm.id)} accepts admin traffic`,
            "NSGs allow SSH/RDP from VirtualNetwork for Bastion-style administration.",
          ),
        ],
        outcome: {
          status: "reaches",
          text: "Reachability depends on the customer's Bastion/private connectivity.",
        },
      }),
    );
  }
  return flows;
}

function roleGrants(selected: Selected[]): RoleGrant[] {
  const has = (id: string) => selected.some((s) => s.id === id);
  const roles: RoleGrant[] = [];
  if (has("aks"))
    roles.push({
      target: "aks",
      role: "Network Contributor",
      scope: "spoke virtual network",
      detail: "The workload identity joins AKS nodes to the spoke subnet.",
      builtIn: true,
    });
  if (has("key-vault"))
    roles.push({
      target: "key-vault",
      role: "Key Vault Secrets User",
      scope: "Key Vault",
      detail: "The workload identity reads secrets via Key Vault RBAC.",
      builtIn: true,
    });
  if (has("storage"))
    roles.push({
      target: "storage",
      role: "Storage Blob Data Contributor",
      scope: "Storage account",
      detail: "The workload identity reads and writes blob data.",
      builtIn: true,
    });
  if (has("functions"))
    roles.push({
      target: "functions",
      role: "Storage Blob Data Owner",
      scope: "Functions storage account",
      detail: "Functions uses managed identity for deployment packages and host state.",
      builtIn: true,
    });
  if (has("ai-foundry"))
    roles.push({
      target: "ai-foundry",
      role: "Cognitive Services OpenAI User",
      scope: "AI Foundry/Cognitive Services account",
      detail: "The workload identity calls model deployments without keys.",
      builtIn: true,
    });
  if (has("ai-search"))
    roles.push({
      target: "ai-search",
      role: "Search Index Data Contributor",
      scope: "Azure AI Search service",
      detail: "The Terraform generator grants write access to indexes.",
      builtIn: true,
    });
  if (has("event-hubs"))
    roles.push({
      target: "event-hubs",
      role: "Azure Event Hubs Data Owner",
      scope: "Event Hubs namespace",
      detail: "The generated role is owner, not just sender.",
      builtIn: true,
    });
  if (has("service-bus"))
    roles.push({
      target: "service-bus",
      role: "Azure Service Bus Data Owner",
      scope: "Service Bus namespace",
      detail: "The generated role is owner, covering send and receive.",
      builtIn: true,
    });
  if (has("iot-hub"))
    roles.push({
      target: "iot-hub",
      role: "IoT Hub Data Contributor",
      scope: "IoT Hub",
      detail: "The workload identity gets data-plane IoT Hub access.",
      builtIn: true,
    });
  if (has("cosmos"))
    roles.push({
      target: "cosmos",
      role: "Cosmos DB Built-in Data Contributor",
      scope: "Cosmos DB account data plane",
      detail: "Assigned with SQL role definition 00000000-0000-0000-0000-000000000002.",
    });
  if (has("postgres"))
    roles.push({
      target: "postgres",
      role: "PostgreSQL Flexible Server Microsoft Entra administrator",
      scope: "PostgreSQL server",
      detail: "The workload identity is configured as the Entra administrator.",
    });
  if (has("sql"))
    roles.push({
      target: "sql",
      role: "Azure SQL Microsoft Entra administrator",
      scope: "SQL server",
      detail:
        "sqlAdminGroupId is used when supplied; otherwise the workload identity is the Entra-only admin.",
    });
  if (has("redis"))
    roles.push({
      target: "redis",
      role: "Azure Managed Redis access policy assignment",
      scope: "Managed Redis",
      detail: "The generated assignment binds the workload identity to Redis Entra access.",
    });
  if (has("data-explorer"))
    roles.push({
      target: "data-explorer",
      role: "Kusto database principal assignment: Admin",
      scope: "Kusto telemetry database",
      detail: "The workload identity is assigned as an app principal on the database.",
    });
  if (has("app-insights"))
    roles.push({
      target: "app-insights",
      role: "Monitoring Metrics Publisher",
      scope: "Application Insights component",
      detail: "The workload identity can publish keyless telemetry.",
      builtIn: true,
    });
  if (has("container-registry"))
    roles.push({
      target: "container-registry",
      role: "AcrPull",
      scope: "Container Registry",
      detail:
        "This is the expected pull role for compute, but the current Terraform generator does not emit ACR or this assignment.",
      builtIn: true,
      gap: "ACR is cataloged but not generated.",
    });
  return roles;
}

/** Shorten a role for a line label: "Storage Blob Data Contributor" fits, a sentence doesn't. */
const roleLabel = (role: string) => (role.length > 34 ? `${role.slice(0, 33)}…` : role);

/*
 * One flow per role grant, the way a token is actually used: the compute holding the workload identity asks
 * Entra ID for a token, and the target service accepts it because of that role. A grant scoped to the network is
 * drawn to the spoke, not back to the compute.
 */
function identityFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const roles = roleGrants(selected);
  if (!roles.length && !hasId(selected, "managed-identity")) return [];
  const holder = computeSelected(selected)[0]?.id ?? "managed-identity";
  const attach = flow("identity", {
    id: "identity-attach",
    title: `${holder === "managed-identity" ? "The workload" : shortOf(holder)} runs as the workload identity`,
    summary:
      "A user-assigned managed identity, so there are no secrets in code or pipeline variables.",
    color: COLORS.identity,
    available: true,
    steps: [
      step(
        holder,
        `${shortOf(holder)} uses the workload identity`,
        "The generated Terraform creates azurerm_user_assigned_identity.app and attaches it to AKS, App Service, Functions, Container Apps, APIM, VMs and supported data services.",
      ),
      step(
        "managed-identity",
        "User-assigned managed identity",
        "One identity per install, created with the resource group and deleted with it.",
        { via: "user-assigned identity" },
      ),
    ],
    outcome: { status: "reaches", text: "Compute authenticates without secrets." },
  });
  const grants = roles.map((r) => {
    const target =
      r.scope.toLowerCase().includes("virtual network") && hasId(selected, "network-spoke")
        ? "network-spoke"
        : r.target;
    return flow("identity", {
      id: `identity-${r.target}-${r.role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: `${shortOf(r.target)} · ${r.role}`,
      summary: `${r.detail} Scope: ${r.scope}.`,
      color: COLORS.identity,
      available: true,
      steps: [
        step(
          holder,
          `${shortOf(holder)} asks for a token`,
          "The workload identity requests a token from Microsoft Entra ID; nothing is stored.",
        ),
        step(
          "entra",
          "Microsoft Entra ID issues the token",
          "Conditional Access does not apply to managed identities; the role assignment is the control.",
          { via: "managed identity token" },
        ),
        step(target, r.role, `${r.detail} Scope: ${r.scope}.`, {
          via: roleLabel(r.role),
          checks: [
            {
              kind: "Policy",
              text: r.builtIn
                ? "Azure built-in role name verified against Microsoft Learn."
                : "Provider-native data-plane assignment.",
              result: r.gap ? "needs-rule" : "allow",
            },
          ],
          gap: r.gap ? { severity: "warn", text: r.gap } : undefined,
        }),
      ],
      outcome: r.gap
        ? { status: "needs-rules", text: r.gap }
        : { status: "reaches", text: `${r.role} on the ${r.scope}.` },
    });
  });
  return [attach, ...grants];
}

const diagnosticTargets = (selected: Selected[]) =>
  selected.filter((s) => {
    if (
      [
        "resource-group",
        "managed-identity",
        "private-endpoints",
        "security-baseline",
        "budget",
      ].includes(s.id)
    )
      return false;
    if (s.id === "app-insights") return false;
    return GENERATED_IDS.has(s.id) || ["network-spoke", "monitoring", "defender"].includes(s.id);
  });

function loggingFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const lawText =
    arch.topology.landing === "existing-customer-hub"
      ? "Diagnostics use the customer's Log Analytics workspace input when supplied."
      : "Diagnostics use the workload Log Analytics workspace created by the generated Terraform.";
  const flows = diagnosticTargets(selected).map((svc) => {
    const vm = ["web-vmss", "app-vmss", "vm"].includes(svc.id);
    const aks = svc.id === "aks";
    return flow("logging", {
      id: `logging-${svc.id}`,
      title: `${shortOf(svc.id)} diagnostics to Log Analytics`,
      summary: vm
        ? "Azure Monitor Agent ships VM telemetry."
        : "Diagnostic settings stream platform logs and metrics.",
      color: COLORS.logging,
      available: svc.id !== "defender",
      reason:
        svc.id === "defender"
          ? "Defender plans are enabled, but no continuous export rule is generated."
          : undefined,
      steps: [
        step(
          svc.id,
          vm
            ? "Azure Monitor Agent collects guest telemetry"
            : aks
              ? "OMS agent and diagnostics collect AKS telemetry"
              : "Diagnostic settings collect resource telemetry",
          vm
            ? "VM extensions use the workload managed identity to authenticate the Azure Monitor Agent."
            : svc.id === "container-apps"
              ? "The Container Apps managed environment is created with log_analytics_workspace_id."
              : svc.id === "defender"
                ? "Defender subscription plans produce recommendations and alerts in Defender for Cloud."
                : "The generated azurerm_monitor_diagnostic_setting points at local.law_id.",
          {
            gap:
              svc.id === "defender"
                ? {
                    severity: "warn",
                    text: "The module enables Defender plans but does not configure Defender continuous export to Log Analytics.",
                  }
                : undefined,
          },
        ),
        step("law", "Log Analytics stores telemetry", lawText),
      ],
      outcome:
        svc.id === "defender"
          ? {
              status: "uninspected",
              text: "Defender plans are enabled; exporting signals to LAW remains a platform/customer setting.",
            }
          : { status: "reaches", text: `${shortOf(svc.id)} telemetry reaches Log Analytics.` },
    });
  });
  const appInsights = hasId(selected, "app-insights");
  if (appInsights) {
    for (const compute of computeSelected(selected)) {
      flows.push(
        flow("logging", {
          id: `logging-appinsights-${compute.id}`,
          title: `${shortOf(compute.id)} application telemetry`,
          summary:
            "Application telemetry goes to workspace-based Application Insights, then Log Analytics.",
          color: COLORS.logging,
          available: true,
          steps: [
            step(
              compute.id,
              "Application emits traces and metrics",
              "The compute resource receives the Application Insights connection string where the generator supports it.",
            ),
            step(
              "app-insights",
              "Application Insights ingests telemetry",
              "The component is workspace-based and local authentication is disabled.",
            ),
            step("law", "Log Analytics stores application telemetry", lawText),
          ],
          outcome: {
            status: "reaches",
            text: "Application telemetry reaches the workspace-backed App Insights component.",
          },
        }),
      );
    }
  }
  return flows;
}

function deployFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const computes = computeSelected(selected);
  const flows: WorkloadFlow[] = [
    flow("deploy", {
      id: "deploy-terraform-oidc",
      title: "Pipeline plans and applies Terraform",
      summary:
        "Customer repository workflows use federated identity (OIDC) to deploy into the approved subscription/resource group.",
      color: COLORS.deploy,
      available: true,
      steps: [
        step(
          "cicd",
          "Customer delivery pipeline starts",
          "Onboarding creates a customer configuration repository and environment-scoped workflow.",
        ),
        step(
          "entra",
          "OIDC token is exchanged",
          "The workload identity federation subject is pinned to the repository, environment and reusable workflow template.",
        ),
        step(
          "cicd",
          "Terraform plan/apply runs",
          "The generated module deploys one install environment with customer-provided subscription, networking, DNS and LAW inputs.",
        ),
      ],
      outcome: {
        status: "reaches",
        text: "Terraform can deploy after the customer grants the federated identity the target scope.",
      },
    }),
  ];
  const acr = selected.find((s) => s.id === "container-registry");
  if (acr && computes.length) {
    flows.push(
      flow("deploy", {
        id: "deploy-image-acr",
        title: "Pipeline publishes images to Container Registry",
        summary:
          "Images should flow through ACR before rollout to compute, but ACR is not emitted by the current Terraform generator.",
        color: COLORS.deploy,
        available: false,
        reason:
          "container-registry has no offering Terraform generator or AcrPull assignment today.",
        steps: [
          step(
            "cicd",
            "Build produces a container image",
            "The release pipeline builds and signs the product image.",
          ),
          step(
            "container-registry",
            "Container Registry stores the image",
            "ACR is selected in the catalog.",
            {
              gap: {
                severity: "fail",
                text: "offeringTerraform does not include a container-registry generator, private endpoint or AcrPull role assignment.",
              },
            },
          ),
          ...computes.map((compute) =>
            step(
              compute.id,
              `${shortOf(compute.id)} pulls the image`,
              "The compute plane needs AcrPull and network reachability to the registry.",
            ),
          ),
        ],
        outcome: {
          status: "broken",
          text: "Add/generate ACR or supply an external registry before relying on this path.",
        },
      }),
    );
  } else if (computes.length) {
    flows.push(
      flow("deploy", {
        id: "deploy-image-compute",
        title: "Pipeline rolls out application artifacts",
        summary:
          "The generated Terraform creates placeholder/default compute; release automation owns the running image or app package.",
        color: COLORS.deploy,
        available: true,
        steps: [
          step(
            "cicd",
            "Build produces deployable artifacts",
            "Images/packages are built outside Terraform.",
          ),
          ...computes.map((compute) =>
            step(
              compute.id,
              `${shortOf(compute.id)} is updated`,
              "Terraform ignores runtime image drift where appropriate so the release pipeline can roll forward independently.",
            ),
          ),
        ],
        outcome: {
          status: "reaches",
          text: "Compute can be updated by the release pipeline once its artifact source is configured.",
        },
      }),
    );
  }
  return flows;
}

export function workloadFlows(arch: Architecture, workload?: Workload): WorkloadFlow[] {
  return [
    ...ingressFlows(arch, workload),
    ...serviceTrafficFlows(arch),
    ...asyncFlows(arch),
    ...egressFlows(arch),
    ...operatorFlows(arch),
    ...identityFlows(arch),
    ...loggingFlows(arch),
    ...deployFlows(arch),
    ...operateFlows(arch),
  ];
}

/*
 * How the install is operated once it's live, when the design includes Azure SRE Agent: the release briefs the
 * agent, alerts become investigations, mitigations wait for approval, and what it learns goes back to the design.
 */
function operateFlows(arch: Architecture): WorkloadFlow[] {
  const selected = selectedOf(arch);
  const sre = selected.find((s) => s.id === "sre-agent");
  if (!sre) return [];
  const existing = sre.settings["agent"] === "Customer's existing agent";
  const autonomous = sre.settings["mode"] === "Autonomous";
  const high = sre.settings["access"] === "Contributor on the install";
  const compute = computeSelected(selected)[0]?.id ?? "monitoring";
  const telemetry = hasId(selected, "app-insights") ? "app-insights" : "law";
  const op = (base: Omit<Flow, "color">) =>
    flow("operate", { ...base, color: COLORS.operate } as Flow);
  return [
    op({
      id: "operate-brief",
      title: "The release briefs the agent",
      summary:
        "After apply, the pipeline uploads the design (overview, architecture, runbook, design document) and creates the drift and target checks.",
      available: true,
      steps: [
        step("cicd", "Pipeline finishes the deploy", "Verify stage, after smoke tests."),
        step(
          "sre-agent",
          existing
            ? "The customer's agent learns this install"
            : "The install's agent learns the design",
          existing
            ? "brief.sh adds the resource group to the agent's managed resources and uploads this install's documents."
            : "brief.sh uploads overview.md (always in context), architecture.md, deployment.md, the runbook and the design document.",
          { via: "design knowledge" },
        ),
      ],
      outcome: { status: "reaches", text: "The agent knows what this install should look like." },
    }),
    op({
      id: "operate-alert",
      title: "An alert becomes an investigation",
      summary:
        "Azure Monitor alerts from the managed resource group reach the agent without credentials; recurring alerts merge into one thread.",
      available: true,
      steps: [
        step("monitoring", "An Azure Monitor alert fires", "Alerts on the install's resources."),
        step(
          "sre-agent",
          "The agent opens an investigation",
          "Azure Monitor is its built-in incident platform.",
          {
            via: "alert",
          },
        ),
        step(
          telemetry,
          "It reads the evidence",
          "Logs, metrics and traces, with Log Analytics Reader and Monitoring Reader.",
          {
            via: "KQL",
          },
        ),
        step(compute, "And the resources themselves", "Reader on the install's resource group.", {
          via: "Reader",
        }),
      ],
      outcome: {
        status: "reaches",
        text: "A probable root cause, checked against the design, and a proposed mitigation in the thread.",
      },
    }),
    op({
      id: "operate-mitigate",
      title: autonomous ? "It mitigates on its own" : "A mitigation waits for approval",
      summary: autonomous
        ? "Autonomous mode acts without approval, within its access level."
        : "Review mode: Azure write actions show Approve / Deny; only SRE Agent Administrators can approve.",
      available: true,
      steps: [
        step(
          "sre-agent",
          "The agent proposes a fix",
          "Scale out, restart, roll back to the previous release.",
        ),
        ...(autonomous && high
          ? []
          : [
              step(
                "operators",
                autonomous ? "An administrator elevates it" : "An SRE Agent Administrator approves",
                high
                  ? "Approve or deny in the thread."
                  : "With read-only access, every write runs on behalf of the approving administrator.",
                { via: "approve" },
              ),
            ]),
        step(
          compute,
          "The change is made",
          high
            ? "With the agent's Contributor role on the install."
            : "On behalf of the administrator.",
          {
            via: high ? "Contributor" : "on behalf of",
          },
        ),
      ],
      outcome:
        autonomous && !high
          ? {
              status: "needs-rules",
              text: "Autonomous mode with read-only access still needs an administrator to elevate each write.",
            }
          : {
              status: "reaches",
              text: autonomous ? "Mitigated without waiting." : "Mitigated once a person agrees.",
            },
    }),
    op({
      id: "operate-drift",
      title: "Every morning it checks the design",
      summary:
        "A scheduled task compares the install with architecture.md and the runbook, and changes nothing.",
      available: true,
      steps: [
        step("sre-agent", "07:00 UTC drift check", "design-drift-check, Review mode."),
        step(
          compute,
          "Each resource against the design",
          "Public access, private endpoints, roles, SKUs, zones, diagnostics.",
          {
            via: "compare",
          },
        ),
      ],
      outcome: { status: "reaches", text: "Differences from the design are reported as drift." },
    }),
    op({
      id: "operate-feedback",
      title: "What it learns goes back to the design",
      summary:
        "Design-level fixes become GitHub issues on the offering's repository, so the next release changes the design rather than the install.",
      available: true,
      steps: [
        step("sre-agent", "A design-level finding", "Something no mitigation should fix by hand."),
        step(
          "cicd",
          "An issue on the offering's repository",
          "Reviewed in the next design session.",
          {
            via: "GitHub issue",
            gap: {
              severity: "warn",
              text: "Connect the offering's repository in the agent's GitHub connector; the Terraform doesn't set connectors.",
            },
          },
        ),
      ],
      outcome: {
        status: "needs-rules",
        text: "Needs the agent's GitHub connector pointed at the offering's repository.",
      },
    }),
  ];
}

const factSet = (xs: string[]) => [...new Set(xs)].sort();

const roleFacts = (arch: Architecture) =>
  factSet(roleGrants(selectedOf(arch)).map((r) => `${shortOf(r.target)}: ${r.role} on ${r.scope}`));

const dnsZoneFacts = (arch: Architecture) =>
  factSet(
    selectedOf(arch).flatMap((s) =>
      peDeployed(s, arch.topology)
        ? (PRIVATE_LINK[s.id]?.zones ?? []).map((z) => `${shortOf(s.id)}: ${z}`)
        : [],
    ),
  );

const privateEndpointFacts = (arch: Architecture) =>
  factSet(
    selectedOf(arch)
      .filter((s) => peDeployed(s, arch.topology))
      .map((s) => `${shortOf(s.id)}: ${PRIVATE_LINK[s.id]!.subresource} private endpoint`),
  );

const diagnosticFacts = (arch: Architecture) =>
  factSet(
    diagnosticTargets(selectedOf(arch)).map((s) => `${shortOf(s.id)} diagnostics to Log Analytics`),
  );

const inputFacts = (arch: Architecture) =>
  factSet(
    inputsFor(selectedOf(arch), arch.topology).map((i) => `${i.label} (${i.key}) from ${i.from}`),
  );

function diffFacts(before: string[], after: string[]) {
  const b = new Set(before);
  const a = new Set(after);
  return [
    ...after.filter((x) => !b.has(x)).map((x) => `Adds ${x}`),
    ...before.filter((x) => !a.has(x)).map((x) => `Removes ${x}`),
  ];
}

function flowKey(f: WorkloadFlow) {
  return JSON.stringify({
    title: f.title,
    summary: f.summary,
    available: f.available,
    reason: f.reason,
    steps: f.steps,
    outcome: f.outcome,
    kind: f.kind,
  });
}

export function impactOf(
  before: Architecture,
  after: Architecture,
): {
  added: WorkloadFlow[];
  removed: WorkloadFlow[];
  changed: WorkloadFlow[];
  roles: string[];
  dnsZones: string[];
  privateEndpoints: string[];
  diagnostics: string[];
  inputs: string[];
  monthlyDelta: number;
  summary: string[];
} {
  const beforeFlows = workloadFlows(before);
  const afterFlows = workloadFlows(after);
  const beforeById = new Map(beforeFlows.map((f) => [f.id, f]));
  const afterById = new Map(afterFlows.map((f) => [f.id, f]));
  const added = afterFlows.filter((f) => !beforeById.has(f.id));
  const removed = beforeFlows.filter((f) => !afterById.has(f.id));
  const changed = afterFlows.filter((f) => {
    const old = beforeById.get(f.id);
    return old ? flowKey(old) !== flowKey(f) : false;
  });
  const beforeSelected = selectedOf(before);
  const afterSelected = selectedOf(after);
  const beforeIds = new Set(beforeSelected.map((s) => s.id));
  const afterIds = new Set(afterSelected.map((s) => s.id));
  const addedServices = afterSelected.filter((s) => !beforeIds.has(s.id)).map((s) => shortOf(s.id));
  const removedServices = beforeSelected
    .filter((s) => !afterIds.has(s.id))
    .map((s) => shortOf(s.id));
  const monthlyDelta = monthlyEstimate(afterSelected) - monthlyEstimate(beforeSelected);
  const roles = diffFacts(roleFacts(before), roleFacts(after));
  const dnsZones = diffFacts(dnsZoneFacts(before), dnsZoneFacts(after));
  const privateEndpoints = diffFacts(privateEndpointFacts(before), privateEndpointFacts(after));
  const diagnostics = diffFacts(diagnosticFacts(before), diagnosticFacts(after));
  const inputs = diffFacts(inputFacts(before), inputFacts(after));
  const summary = [
    ...(addedServices.length ? [`Adds services: ${addedServices.join(", ")}.`] : []),
    ...(removedServices.length ? [`Removes services: ${removedServices.join(", ")}.`] : []),
    `Monthly estimate changes by ${monthlyDelta >= 0 ? "+" : "-"}$${Math.abs(monthlyDelta).toLocaleString()}.`,
    ...(roles.length ? [`RBAC/admin changes: ${roles.length}.`] : []),
    ...(dnsZones.length ? [`Private DNS changes: ${dnsZones.length}.`] : []),
    ...(privateEndpoints.length ? [`Private endpoint changes: ${privateEndpoints.length}.`] : []),
    ...(diagnostics.length ? [`Diagnostic setting changes: ${diagnostics.length}.`] : []),
    ...(inputs.length ? [`Customer/input changes: ${inputs.length}.`] : []),
    ...(changed.length ? [`Existing flows changed: ${changed.length}.`] : []),
  ];
  return {
    added,
    removed,
    changed,
    roles,
    dnsZones,
    privateEndpoints,
    diagnostics,
    inputs,
    monthlyDelta,
    summary,
  };
}

const rowForZone = (zone: Zone): DiagramNode["row"] =>
  zone === "edge"
    ? "edge"
    : zone === "app"
      ? "app"
      : zone === "integration"
        ? "integration"
        : zone === "data"
          ? "data"
          : zone === "shared"
            ? "shared"
            : "platform";

const diagramZone = (id: string): DiagramNode["zone"] => {
  if (["hub", "firewall", "dns", "law"].includes(id)) return "landing-zone";
  if (id === "private-endpoints") return "endpoints";
  if (["network-spoke", "app-gateway", "front-door"].includes(id)) return "spoke";
  const def = SERVICE_BY_ID.get(id);
  if (!def) return undefined;
  if (def.privateLink) return "endpoints";
  if (def.zone === "foundation") return "spoke";
  return "spoke";
};

const node = (
  id: string,
  title: string,
  sub: string,
  row: DiagramNode["row"],
  zone?: DiagramNode["zone"],
): DiagramNode => {
  const out: DiagramNode = { id, title, sub, icon: ICONS[id] ?? "connections", row };
  if (zone) out.zone = zone;
  return out;
};

export function nodesFor(arch: Architecture): DiagramNode[] {
  const selected = selectedOf(arch);
  const ids = new Set(selected.map((s) => s.id));
  const computes = computeSelected(selected);
  const out: DiagramNode[] = [];
  if (computes.length || ingressChain(selected).length)
    out.push(node("users", "Users", "Product users", "outside"));
  if (computes.length) out.push(node("operators", "Operators", "Admin users", "outside"));
  if (computes.length) out.push(node("internet", "Internet", "Public destinations", "outside"));
  out.push(node("cicd", "CI/CD", "Delivery pipeline", "outside"));
  out.push(node("entra", "Microsoft Entra ID", "Identity provider", "platform", "landing-zone"));
  if (arch.topology.landing === "existing-customer-hub") {
    for (const p of CUSTOMER_PLATFORM) {
      const row: DiagramNode["row"] = p.id === "law" || p.id === "dns" ? "platform" : "platform";
      out.push(node(p.id, p.name, "Customer landing zone", row, "landing-zone"));
    }
    out.push(node("onprem", "On-premises", "Customer network", "outside"));
  } else {
    if (ids.has("private-endpoints"))
      out.push(node("dns", "Private DNS", "Workload private DNS zones", "platform", "spoke"));
    if (ids.has("monitoring"))
      out.push(node("law", "Log Analytics", "Workload monitoring", "platform", "spoke"));
  }
  for (const svc of SERVICES) {
    if (!ids.has(svc.id)) continue;
    out.push(
      node(
        svc.id,
        svc.short,
        `${svc.category} · ${svc.resourceType}`,
        rowForZone(svc.zone),
        diagramZone(svc.id),
      ),
    );
  }
  return out.filter((n, i, all) => all.findIndex((x) => x.id === n.id) === i);
}
