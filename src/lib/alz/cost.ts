/*
 * What the platform costs to run each month, from the design and the Azure retail prices for its region
 * (prices.azure.com, pay-as-you-go, USD). Only what the landing zone itself deploys: firewalls, gateways,
 * Bastion, DDoS protection, DNS, public IPs. Usage-based items (log ingestion, firewall data processed,
 * ExpressRoute circuits from your provider) are listed separately, not guessed.
 *
 * Fallback prices: East US 2, retail API, checked 30 Sep 2026. Live prices replace them when available.
 */
import { type Answers, hasFirewall, hasHub, on } from "./engine";

export type PriceKey =
  | "fw-Basic"
  | "fw-Standard"
  | "fw-Premium"
  | "vpn-VpnGw1AZ"
  | "er-ErGw1AZ"
  | "bastion-Standard"
  | "ddos-plan"
  | "dns-inbound"
  | "dns-zone"
  | "public-ip"
  | "la-gb";

export type Prices = {
  region: string;
  live: boolean;
  asOf: string;
  hourly: Partial<Record<PriceKey, number>>;
};

/** Hourly (or per unit for dns-zone, dns-inbound monthly, la-gb per GB) retail prices, USD. */
export const FALLBACK_PRICES: Prices = {
  region: "eastus2",
  live: false,
  asOf: "2026-09-30",
  hourly: {
    "fw-Basic": 0.395,
    "fw-Standard": 1.25,
    "fw-Premium": 1.75,
    "vpn-VpnGw1AZ": 0.21,
    "er-ErGw1AZ": 0.361,
    "bastion-Standard": 0.29,
    "ddos-plan": 4.032258,
    "dns-inbound": 180,
    "dns-zone": 0.5,
    "public-ip": 0.005,
    "la-gb": 2.76,
  },
};

/** The retail-price API filters for each price. */
export const PRICE_QUERIES: Record<PriceKey, string> = {
  "fw-Basic": "serviceName eq 'Azure Firewall' and meterName eq 'Basic Deployment'",
  "fw-Standard": "serviceName eq 'Azure Firewall' and meterName eq 'Standard Deployment'",
  "fw-Premium": "serviceName eq 'Azure Firewall' and meterName eq 'Premium Deployment'",
  "vpn-VpnGw1AZ": "serviceName eq 'VPN Gateway' and meterName eq 'VpnGw1AZ'",
  "er-ErGw1AZ": "serviceName eq 'ExpressRoute' and meterName eq 'ErGw1AZ Gateway'",
  "bastion-Standard": "serviceName eq 'Azure Bastion' and meterName eq 'Standard Gateway'",
  "ddos-plan": "serviceName eq 'Azure DDOS Protection' and meterName eq 'Network Protection Plan'",
  "dns-inbound": "meterName eq 'Private Resolver Inbound Endpoint'",
  "dns-zone": "serviceName eq 'Azure DNS' and meterName eq 'Private Zone'",
  "public-ip": "serviceName eq 'Virtual Network' and meterName eq 'Standard IPv4 Static Public IP'",
  "la-gb": "serviceName eq 'Log Analytics' and meterName eq 'Analytics Logs Data Ingestion'",
};
/** Priced per region; the rest are global (the API lists them under zones). */
export const REGIONAL: PriceKey[] = [
  "fw-Basic",
  "fw-Standard",
  "fw-Premium",
  "vpn-VpnGw1AZ",
  "er-ErGw1AZ",
  "bastion-Standard",
  "ddos-plan",
  "public-ip",
  "la-gb",
];

const HOURS = 730;
/** Private Link DNS zones the ALZ connectivity module creates (Azure/avm-ptn-network-private-link-private-dns-zones). */
export const PRIVATE_DNS_ZONES = 96;

export type CostLine = { group: string; what: string; detail: string; monthly: number };
export type CostEstimate = {
  total: number;
  lines: CostLine[];
  usage: { what: string; rate: string }[];
  prices: Prices;
};

export function estimateCost(a: Answers, prices: Prices = FALLBACK_PRICES): CostEstimate {
  const p = (k: PriceKey) => prices.hourly[k] ?? FALLBACK_PRICES.hourly[k] ?? 0;
  const lines: CostLine[] = [];
  const hub = hasHub(a);
  const wan = a.connectivity === "virtual_wan";
  const hubs = hub ? (a.secondaryRegion && a.secondaryRegion !== a.primaryRegion ? 2 : 1) : 0;
  const per = (n: number) => (hubs > 1 ? ` × ${n} hubs` : "");
  const add = (group: string, what: string, detail: string, monthly: number) =>
    monthly > 0 && lines.push({ group, what, detail, monthly });
  let ips = 0;
  if (hub && hasFirewall(a)) {
    const k = `fw-${a.firewall}` as PriceKey;
    add(
      "Connectivity",
      `Azure Firewall ${a.firewall}`,
      `$${p(k)}/hour${per(hubs)}`,
      p(k) * HOURS * hubs,
    );
    ips += (a.firewall === "Basic" ? 2 : 1) * hubs;
  }
  if (hub && on(a.vpnGateway)) {
    add(
      "Connectivity",
      "VPN gateway (VpnGw1AZ, active-active)",
      `$${p("vpn-VpnGw1AZ")}/hour${per(hubs)}`,
      p("vpn-VpnGw1AZ") * HOURS * hubs,
    );
    ips += 2 * hubs;
  }
  if (hub && on(a.expressRoute)) {
    add(
      "Connectivity",
      "ExpressRoute gateway (ErGw1AZ)",
      `$${p("er-ErGw1AZ")}/hour${per(hubs)}`,
      p("er-ErGw1AZ") * HOURS * hubs,
    );
    ips += hubs;
  }
  if (hub && on(a.bastion)) {
    add(
      "Connectivity",
      "Azure Bastion Standard",
      `$${p("bastion-Standard")}/hour${per(hubs)}`,
      p("bastion-Standard") * HOURS * hubs,
    );
    ips += hubs;
  }
  if (hub && on(a.ddosPlan))
    add(
      "Connectivity",
      "DDoS Network Protection plan",
      `$${p("ddos-plan")}/hour · one per tenant, covers 100 public IPs`,
      p("ddos-plan") * HOURS,
    );
  if (hub && a.privateDns === "platform") {
    if (!wan)
      add(
        "Connectivity",
        "DNS Private Resolver",
        `$${p("dns-inbound")}/month per inbound endpoint${per(hubs)}`,
        p("dns-inbound") * hubs,
      );
    // $0.50 each for the first 25 zones, $0.10 after that (the retail tiers).
    const zones =
      Math.min(25, PRIVATE_DNS_ZONES) * p("dns-zone") + Math.max(0, PRIVATE_DNS_ZONES - 25) * 0.1;
    add(
      "Connectivity",
      `Private DNS zones (${PRIVATE_DNS_ZONES})`,
      `$${p("dns-zone")}/zone for the first 25, $0.10 after`,
      zones,
    );
  }
  if (ips)
    add(
      "Connectivity",
      `Public IP addresses (${ips})`,
      `$${p("public-ip")}/hour each`,
      p("public-ip") * HOURS * ips,
    );
  const total = Math.round(lines.reduce((s, l) => s + l.monthly, 0));
  return {
    total,
    lines: lines.map((l) => ({ ...l, monthly: Math.round(l.monthly) })),
    usage: [
      { what: "Log Analytics ingestion", rate: `$${p("la-gb")}/GB (first 5 GB/month free)` },
      ...(hub && hasFirewall(a)
        ? [
            {
              what: "Firewall data processed",
              rate: "$0.016/GB (Standard, Premium) · $0.065/GB (Basic)",
            },
          ]
        : []),
      ...(a.siem === "sentinel"
        ? [{ what: "Microsoft Sentinel analysis", rate: "per GB analysed, on top of ingestion" }]
        : []),
      ...(hub && on(a.expressRoute)
        ? [
            {
              what: "ExpressRoute circuit",
              rate: "from your provider and Microsoft, by bandwidth and plan",
            },
          ]
        : []),
    ],
    prices,
  };
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** About how long a first deployment takes (Microsoft: ~5 min without networking, ~40 with VPN and ExpressRoute). */
export function deployMinutes(a: Answers) {
  if (!hasHub(a)) return 10;
  const gw = on(a.vpnGateway) || on(a.expressRoute);
  return 15 + (hasFirewall(a) ? 5 : 0) + (gw ? 25 : 0);
}
