import type { Pillar, WafCheck, WafFix, WafResult, WafServiceGuide } from "../types";

const WAF = {
  virtualNetwork:
    "https://learn.microsoft.com/azure/well-architected/service-guides/virtual-network",
  privateEndpoint: "https://learn.microsoft.com/azure/private-link/private-endpoint-overview",
  appGateway:
    "https://learn.microsoft.com/azure/well-architected/service-guides/azure-application-gateway",
  frontDoor: "https://learn.microsoft.com/azure/well-architected/service-guides/azure-front-door",
  apim: "https://learn.microsoft.com/azure/well-architected/service-guides/azure-api-management",
} as const;

type CheckReturn = ReturnType<WafCheck>;
type RecInput = {
  id: string;
  pillar: Pillar;
  title: string;
  why: string;
  learn: string;
  check?: WafCheck;
};

const rec = (r: RecInput) => r;
const outcome = (result: WafResult, detail: string, fix?: WafFix): CheckReturn =>
  fix ? { result, detail, fix } : { result, detail };
const selected = (ctx: Parameters<WafCheck>[0], service: string) =>
  ctx.svc?.id === service || ctx.has(service);
const serviceSelected =
  (service: string): WafCheck =>
  (ctx) =>
    selected(ctx, service)
      ? outcome("pass", `${service} is selected.`)
      : outcome("na", `${service} is not selected.`);
const setting = (ctx: Parameters<WafCheck>[0], key: string, fallback = "not set") =>
  ctx.svc?.settings[key] ?? fallback;
const critical = (ctx: Parameters<WafCheck>[0]) => ctx.workload.criticality !== "standard";
const ensureService =
  (id: string, label: string): WafCheck =>
  (ctx) =>
    ctx.has(id)
      ? outcome("pass", `${label} is selected.`)
      : outcome("warn", `${label} is not selected.`, { label: `Add ${label}`, add: [id] });
const ensureMonitoring: WafCheck = (ctx) =>
  ctx.has("monitoring")
    ? outcome("pass", "Monitoring is selected for diagnostics.")
    : outcome("warn", "Monitoring is missing, so diagnostics have nowhere to land.", {
        label: "Add monitoring",
        add: ["monitoring"],
      });
const ensurePrivateTopology =
  (service: string): WafCheck =>
  (ctx) => {
    if (!selected(ctx, service)) return outcome("na", `${service} is not selected.`);
    if (ctx.topology.publicAccess)
      return outcome("warn", `publicAccess is ${String(ctx.topology.publicAccess)}.`, {
        label: "Turn off public access",
        topology: { publicAccess: false, privateEndpoints: true },
      });
    return outcome("pass", `publicAccess is ${String(ctx.topology.publicAccess)}.`);
  };

const networkSubnets: WafCheck = (ctx) => {
  if (!selected(ctx, "network-spoke")) return outcome("na", "network-spoke is not selected.");
  const subnets = setting(ctx, "subnets", "edge / app / data / endpoints");
  const needsEdge =
    ctx.workload.audience !== "internal" || ctx.has("app-gateway") || ctx.has("front-door");
  if (needsEdge && subnets !== "edge / app / data / endpoints")
    return outcome("warn", `subnets is ${subnets}; an edge tier is expected for this audience.`, {
      label: "Use edge/app/data/endpoints subnets",
      settings: { subnets: "edge / app / data / endpoints" },
    });
  return outcome("pass", `subnets is ${subnets}; audience is ${ctx.workload.audience}.`);
};

const networkLanding: WafCheck = (ctx) => {
  const landing = ctx.topology.landing;
  if (ctx.workload.data === "regulated" && landing !== "existing-customer-hub")
    return outcome(
      "warn",
      `landing is ${landing}; regulated workloads often need customer hub controls.`,
      {
        label: "Use existing customer hub",
        topology: { landing: "existing-customer-hub", landingZone: "corp" },
      },
    );
  return outcome("pass", `landing is ${landing}; landingZone is ${ctx.topology.landingZone}.`);
};

const networkRegions: WafCheck = (ctx) => {
  const regions = ctx.topology.regions.length;
  if (ctx.workload.criticality === "mission-critical" && regions < 2)
    return outcome(
      "warn",
      `regions has ${regions} region; mission-critical designs should consider multiple regions.`,
    );
  return outcome("pass", `regions has ${regions} region${regions === 1 ? "" : "s"}.`);
};

const privateEndpointGuardrail: WafCheck = (ctx) => {
  if (!selected(ctx, "private-endpoints"))
    return outcome("na", "private-endpoints is not selected.");
  if (!ctx.topology.privateEndpoints)
    return outcome("fail", `privateEndpoints is ${String(ctx.topology.privateEndpoints)}.`, {
      label: "Enable private endpoints",
      topology: { privateEndpoints: true },
    });
  return outcome("pass", `privateEndpoints is ${String(ctx.topology.privateEndpoints)}.`);
};

const privateEndpointSensitive: WafCheck = (ctx) => {
  const needsPrivate = ctx.workload.data === "confidential" || ctx.workload.data === "regulated";
  if (needsPrivate && !ctx.topology.privateEndpoints)
    return outcome("fail", `data is ${ctx.workload.data} and privateEndpoints is false.`, {
      label: "Enable private endpoints",
      topology: { privateEndpoints: true },
      add: ["private-endpoints"],
    });
  return outcome(
    "pass",
    `data is ${ctx.workload.data}; privateEndpoints=${String(ctx.topology.privateEndpoints)}.`,
  );
};

const appGatewayWaf: WafCheck = (ctx) => {
  if (!selected(ctx, "app-gateway")) return outcome("na", "app-gateway is not selected.");
  const sku = setting(ctx, "sku", "WAF_v2");
  if ((ctx.workload.audience !== "internal" || ctx.topology.publicAccess) && sku !== "WAF_v2")
    return outcome("fail", `sku is ${sku}; external audiences should use WAF_v2.`, {
      label: "Use WAF_v2",
      settings: { sku: "WAF_v2" },
    });
  return outcome("pass", `sku is ${sku}; audience is ${ctx.workload.audience}.`);
};

const appGatewayScale: WafCheck = (ctx) => {
  if (!selected(ctx, "app-gateway")) return outcome("na", "app-gateway is not selected.");
  return outcome(
    "pass",
    `sku is ${setting(ctx, "sku", "WAF_v2")}; Terraform sets production autoscale min 2 and max 10 with zones.`,
  );
};

const frontDoorTier: WafCheck = (ctx) => {
  if (!selected(ctx, "front-door")) return outcome("na", "front-door is not selected.");
  const tier = setting(ctx, "tier", "Premium");
  if ((ctx.topology.privateEndpoints || critical(ctx)) && tier !== "Premium")
    return outcome(
      "fail",
      `tier is ${tier}; Premium is required for private link origins and advanced protection.`,
      {
        label: "Use Premium Front Door",
        settings: { tier: "Premium" },
      },
    );
  return outcome(
    "pass",
    `tier is ${tier}; privateEndpoints=${String(ctx.topology.privateEndpoints)}.`,
  );
};

const frontDoorCost: WafCheck = (ctx) => {
  if (!selected(ctx, "front-door")) return outcome("na", "front-door is not selected.");
  const tier = setting(ctx, "tier", "Premium");
  if (
    !ctx.topology.privateEndpoints &&
    ctx.workload.criticality === "standard" &&
    tier === "Premium"
  )
    return outcome("warn", `tier is ${tier}; Standard may fit public standard workloads.`, {
      label: "Use Standard Front Door",
      settings: { tier: "Standard" },
    });
  return outcome("pass", `tier is ${tier}.`);
};

const apimSku: WafCheck = (ctx) => {
  if (!selected(ctx, "apim")) return outcome("na", "apim is not selected.");
  const sku = setting(ctx, "sku", "Standard v2");
  if (critical(ctx) && sku === "Developer")
    return outcome(
      "fail",
      `sku is ${sku}; Developer is not suitable for critical production APIs.`,
      {
        label: "Use Standard v2",
        settings: { sku: "Standard v2" },
      },
    );
  if (ctx.workload.criticality === "mission-critical" && sku !== "Premium v2")
    return outcome("warn", `sku is ${sku}; mission-critical APIs should use Premium v2.`, {
      label: "Use Premium v2",
      settings: { sku: "Premium v2" },
    });
  return outcome("pass", `sku is ${sku}.`);
};

const apimCost: WafCheck = (ctx) => {
  if (!selected(ctx, "apim")) return outcome("na", "apim is not selected.");
  const sku = setting(ctx, "sku", "Standard v2");
  if (ctx.workload.criticality === "standard" && sku === "Premium v2")
    return outcome("warn", `sku is ${sku}; Standard v2 may fit a standard workload.`, {
      label: "Use Standard v2",
      settings: { sku: "Standard v2" },
    });
  return outcome("pass", `sku is ${sku}.`);
};

const apimPrivateBackends: WafCheck = (ctx) => {
  if (!selected(ctx, "apim")) return outcome("na", "apim is not selected.");
  if (!ctx.topology.privateEndpoints && ctx.workload.data !== "public")
    return outcome("warn", `privateEndpoints is false and data is ${ctx.workload.data}.`, {
      label: "Enable private endpoints",
      topology: { privateEndpoints: true },
      add: ["private-endpoints"],
    });
  return outcome(
    "pass",
    `privateEndpoints=${String(ctx.topology.privateEndpoints)}; data=${ctx.workload.data}.`,
  );
};

export const NETWORKING_GUIDES: WafServiceGuide[] = [
  {
    service: "network-spoke",
    learn: WAF.virtualNetwork,
    summary:
      "The spoke virtual network is the foundation for workload isolation, subnet segmentation, private endpoints, and hub connectivity. The catalog controls whether the design includes an edge subnet and records topology choices for landing zone, public access, regions, and environments.",
    recs: [
      rec({
        id: "network-spoke.segment-subnets",
        pillar: "reliability",
        title: "Segment edge, app, data, and endpoint subnets",
        why: "Separate subnets let the generated Terraform attach the right NSGs, delegations, and private endpoint placement.",
        learn: WAF.virtualNetwork,
        check: networkSubnets,
      }),
      rec({
        id: "network-spoke.private-by-default",
        pillar: "security",
        title: "Turn off public access for private workloads",
        why: "Private topology reduces exposure and aligns with corporate landing zone guardrails.",
        learn: WAF.virtualNetwork,
        check: ensurePrivateTopology("network-spoke"),
      }),
      rec({
        id: "network-spoke.use-customer-hub",
        pillar: "cost",
        title: "Reuse an existing customer hub when required",
        why: "Connecting to an existing hub can reuse shared DNS, firewall, and connectivity investments.",
        learn: WAF.virtualNetwork,
        check: networkLanding,
      }),
      rec({
        id: "network-spoke.monitor-network",
        pillar: "operations",
        title: "Monitor network resources centrally",
        why: "Network telemetry helps diagnose blocked flows, route issues, and private endpoint resolution problems.",
        learn: WAF.virtualNetwork,
        check: ensureMonitoring,
      }),
      rec({
        id: "network-spoke.region-strategy",
        pillar: "performance",
        title: "Offer regions close to users and dependencies",
        why: "Regional placement affects latency to users, data services, and customer networks.",
        learn: WAF.virtualNetwork,
        check: networkRegions,
      }),
      rec({
        id: "network-spoke.security-baseline",
        pillar: "security",
        title: "Apply the security baseline to the spoke",
        why: "Policy guardrails keep network resources aligned with the landing-zone control set.",
        learn: WAF.virtualNetwork,
        check: ensureService("security-baseline", "security baseline"),
      }),
    ],
  },
  {
    service: "private-endpoints",
    learn: WAF.privateEndpoint,
    summary:
      "Private endpoints place supported service endpoints inside the spoke network and pair with private DNS. In this catalog, they are topology driven and automatically included when private endpoints are enabled for private-link-capable services.",
    recs: [
      rec({
        id: "private-endpoints.enable-for-private-link",
        pillar: "reliability",
        title: "Enable private endpoints consistently",
        why: "Consistent private endpoint placement avoids split connectivity patterns across services.",
        learn: WAF.privateEndpoint,
        check: privateEndpointGuardrail,
      }),
      rec({
        id: "private-endpoints.protect-sensitive-data",
        pillar: "security",
        title: "Use private endpoints for confidential or regulated data",
        why: "Private endpoints keep data-service traffic on private IP addresses in the workload network.",
        learn: WAF.privateEndpoint,
        check: privateEndpointSensitive,
      }),
      rec({
        id: "private-endpoints.use-when-needed",
        pillar: "cost",
        title: "Use private endpoints deliberately",
        why: "Private endpoints add resources and DNS operations, so enable them where isolation requirements justify them.",
        learn: WAF.privateEndpoint,
        check: privateEndpointSensitive,
      }),
      rec({
        id: "private-endpoints.private-dns",
        pillar: "operations",
        title: "Plan private DNS ownership",
        why: "Private endpoint reliability depends on DNS records resolving to private IP addresses from the right networks.",
        learn: WAF.privateEndpoint,
        check: serviceSelected("private-endpoints"),
      }),
      rec({
        id: "private-endpoints.place-near-consumers",
        pillar: "performance",
        title: "Place endpoints in the workload spoke",
        why: "Local private endpoints avoid unnecessary routing and keep data flows inside the workload network path.",
        learn: WAF.privateEndpoint,
        check: serviceSelected("private-endpoints"),
      }),
      rec({
        id: "private-endpoints.disable-public-access",
        pillar: "security",
        title: "Disable public access with private endpoints",
        why: "Private endpoints are strongest when paired with public network access disabled on the service.",
        learn: WAF.privateEndpoint,
        check: ensurePrivateTopology("private-endpoints"),
      }),
    ],
  },
  {
    service: "app-gateway",
    learn: WAF.appGateway,
    summary:
      "Application Gateway provides regional ingress. Terraform deploys v2 SKU choices, Standard public IP, production zones, autoscale, hardened SSL policy, diagnostics, and a WAF policy when WAF_v2 is selected.",
    recs: [
      rec({
        id: "app-gateway.zone-autoscale",
        pillar: "reliability",
        title: "Use v2 autoscale with production zones",
        why: "The generated gateway uses v2 autoscale and zone placement in production for regional resiliency.",
        learn: WAF.appGateway,
        check: appGatewayScale,
      }),
      rec({
        id: "app-gateway.waf-external",
        pillar: "security",
        title: "Use WAF_v2 for external audiences",
        why: "WAF_v2 adds managed web attack protection at the regional ingress point.",
        learn: WAF.appGateway,
        check: appGatewayWaf,
      }),
      rec({
        id: "app-gateway.standard-cost",
        pillar: "cost",
        title: "Use Standard_v2 only for internal low-risk paths",
        why: "Standard_v2 is cheaper but omits the WAF policy generated for WAF_v2.",
        learn: WAF.appGateway,
        check: appGatewayWaf,
      }),
      rec({
        id: "app-gateway.diagnostics",
        pillar: "operations",
        title: "Collect gateway diagnostics",
        why: "Access logs, firewall logs, and metrics are needed to operate ingress safely.",
        learn: WAF.appGateway,
        check: ensureMonitoring,
      }),
      rec({
        id: "app-gateway.backend-health",
        pillar: "performance",
        title: "Probe backend health and tune routing",
        why: "Health probes and routing settings keep traffic away from unhealthy backend instances.",
        learn: WAF.appGateway,
        check: serviceSelected("app-gateway"),
      }),
      rec({
        id: "app-gateway.private-backends",
        pillar: "security",
        title: "Send gateway traffic to private backends",
        why: "Private backend pools avoid exposing application tiers directly to the internet.",
        learn: WAF.appGateway,
        check: ensurePrivateTopology("app-gateway"),
      }),
    ],
  },
  {
    service: "front-door",
    learn: WAF.frontDoor,
    summary:
      "Front Door provides global edge routing. Terraform creates the profile, endpoint, origin group, health probe, HTTPS-only forwarding, security policy, diagnostics, and managed WAF rules when the Premium tier is selected.",
    recs: [
      rec({
        id: "front-door.global-entry",
        pillar: "reliability",
        title: "Use Front Door for global edge failover patterns",
        why: "A global edge entry point can route users to healthy origins and absorb regional ingress issues.",
        learn: WAF.frontDoor,
        check: serviceSelected("front-door"),
      }),
      rec({
        id: "front-door.premium-private-link",
        pillar: "security",
        title: "Use Premium for private origins",
        why: "Premium is required when the design needs private link origins and advanced edge protection.",
        learn: WAF.frontDoor,
        check: frontDoorTier,
      }),
      rec({
        id: "front-door.right-size-tier",
        pillar: "cost",
        title: "Use Standard when private origins are not required",
        why: "Standard can lower cost for public, standard-criticality workloads that do not need Premium features.",
        learn: WAF.frontDoor,
        check: frontDoorCost,
      }),
      rec({
        id: "front-door.diagnostics",
        pillar: "operations",
        title: "Collect Front Door diagnostics",
        why: "Edge access, WAF, and health telemetry are needed to understand user-facing behavior.",
        learn: WAF.frontDoor,
        check: ensureMonitoring,
      }),
      rec({
        id: "front-door.health-probes",
        pillar: "performance",
        title: "Use health probes and HTTPS-only forwarding",
        why: "The generated route probes origins and forwards to them over HTTPS for responsive edge routing.",
        learn: WAF.frontDoor,
        check: serviceSelected("front-door"),
      }),
      rec({
        id: "front-door.waf-policy",
        pillar: "security",
        title: "Attach a Front Door WAF policy",
        why: "A WAF policy blocks common attacks at the global edge before they reach regional services.",
        learn: WAF.frontDoor,
        check: frontDoorTier,
      }),
    ],
  },
  {
    service: "apim",
    learn: WAF.apim,
    summary:
      "API Management fronts integration APIs. Terraform deploys the selected SKU with managed identity, TLS 1.0/1.1 disabled, gateway output, and diagnostics; backend reachability follows the workload network topology.",
    recs: [
      rec({
        id: "apim.production-sku",
        pillar: "reliability",
        title: "Use production API Management SKUs for critical APIs",
        why: "Developer is for non-production use; critical APIs need a production SKU, with Premium v2 for the highest criticality.",
        learn: WAF.apim,
        check: apimSku,
      }),
      rec({
        id: "apim.private-backends",
        pillar: "security",
        title: "Reach backends privately for non-public data",
        why: "Private backend connectivity keeps API traffic aligned with data sensitivity requirements.",
        learn: WAF.apim,
        check: apimPrivateBackends,
      }),
      rec({
        id: "apim.right-size-sku",
        pillar: "cost",
        title: "Right-size the API Management SKU",
        why: "Premium v2 should be reserved for workloads that need its isolation, networking, or criticality benefits.",
        learn: WAF.apim,
        check: apimCost,
      }),
      rec({
        id: "apim.diagnostics",
        pillar: "operations",
        title: "Collect API Management diagnostics",
        why: "Gateway logs and metrics are necessary for API support, throttling analysis, and change validation.",
        learn: WAF.apim,
        check: ensureMonitoring,
      }),
      rec({
        id: "apim.gateway-performance",
        pillar: "performance",
        title: "Choose SKU capacity for API latency and throughput",
        why: "The selected SKU constrains gateway capacity and should match observed API demand.",
        learn: WAF.apim,
        check: apimSku,
      }),
      rec({
        id: "apim.managed-identity",
        pillar: "security",
        title: "Use managed identity for API dependencies",
        why: "Managed identity allows API policies and backends to avoid embedded credentials.",
        learn: WAF.apim,
        check: ensureService("managed-identity", "managed identity"),
      }),
    ],
  },
];
