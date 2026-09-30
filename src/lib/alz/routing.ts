/*
 * A routing simulator for the landing zone: builds the network the design deploys (hub subnets as the AVM
 * hub-and-spoke module allocates them, spoke ranges, route tables exactly as the generated Terraform creates
 * them), then forwards a packet hop by hop the way Azure does:
 *
 * - Effective routes per subnet: system routes (VNet, peering, 0.0.0.0/0 → Internet, and the private ranges
 *   10/8, 172.16/12, 192.168/16, 100.64/10 → None), gateway routes learned over BGP (unless the subnet's route
 *   table turns propagation off), and user-defined routes.
 * - Selection: longest prefix first; for the same prefix a UDR beats BGP, which beats a system route.
 * - Azure Firewall is stateful: it denies what no rule allows, source-NATs traffic to public addresses, and
 *   drops a reply for a session it never saw (asymmetric routing).
 * - Vended spoke subnets are private (default outbound access off): Internet as next hop goes nowhere without
 *   a firewall, NAT gateway or public IP.
 *
 * Sources: learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview, …/firewall/snat-private-range,
 * …/virtual-wan/how-to-routing-policies, the AVM hub-and-spoke and sub-vending module source.
 */
import { AZURE_REGIONS } from "../regions";
import { type Answers, hasFirewall, hasHub, on } from "./engine";
import type { HopGap, Spoke } from "./scene";
import type { SceneExtra } from "./scene";

/* ------------------------------------------------------------------ IP math */

const ipInt = (ip: string) => ip.split(".").reduce((a, b) => ((a << 8) >>> 0) + Number(b), 0) >>> 0;
const intIp = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
const bits = (cidr: string) => Number(cidr.split("/")[1]);
export function inCidr(ip: string, cidr: string) {
  const [net, b] = cidr.split("/");
  const n = Number(b);
  if (n === 0) return true;
  const mask = (0xffffffff << (32 - n)) >>> 0;
  return (ipInt(ip) & mask) >>> 0 === (ipInt(net!) & mask) >>> 0;
}
const host = (cidr: string, n: number) => intIp(ipInt(cidr.split("/")[0]!) + n);
const isPrivate = (ip: string) =>
  ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"].some((c) => inCidr(ip, c));

/* ---------------------------------------------------------------- topology */

export type NextHop =
  | "VnetLocal"
  | "VNetPeering"
  | "Internet"
  | "VirtualAppliance"
  | "VirtualNetworkGateway"
  | "None"
  | "InterfaceEndpoint"
  | "HubFirewall"
  | "HubConnection";
export type RouteSource =
  "Default" | "User" | "Virtual network gateway" | "Routing intent" | "Hub route table";
export type Route = { prefix: string; nextHop: NextHop; nextHopIp?: string; source: RouteSource };
export type RouteRow = Route & { active: boolean; reason?: string };

export type Subnet = {
  id: string;
  vnet: string;
  name: string;
  cidr: string;
  /** A representative address in the subnet (the VM, the firewall, the resolver…). */
  ip: string;
  what: string;
  /** Default outbound access off and no NAT gateway / public IP. */
  private: boolean;
  publicIp?: string | undefined;
  routeTable?: { name: string; propagation: boolean; routes: Route[] } | undefined;
};
export type Vnet = {
  id: string;
  name: string;
  cidr: string;
  peers: string[];
  role: "hub" | "spoke" | "sidecar";
  /** Connected to the Virtual WAN hub. */
  hubConnected?: boolean;
  useRemoteGateways?: boolean;
  label: string;
};
export type Topology = {
  mode: "hub" | "vwan" | "none";
  vnets: Vnet[];
  subnets: Subnet[];
  firewall: { ip: string; publicIp: string; sku: string; dnsProxy: boolean } | null;
  gateway: { er: boolean; vpn: boolean; erDown?: boolean } | null;
  routingIntent: boolean;
  onPrem: string;
  /** The spokes the scenarios use. */
  corpA?: string | undefined;
  corpB?: string | undefined;
  online?: string | undefined;
  /** Customer installs whose ranges have a GatewaySubnet route to the firewall. */
  gatewayRouted: Set<string>;
  regions: { primary: string; secondary?: string | undefined };
  /** What's been failed on purpose, to see how traffic reroutes. */
  failure: Failure;
};

/** Failures to simulate: an ExpressRoute circuit, one availability zone, or the whole primary region. */
export type Failure = "none" | "er" | "zone" | "region";

const ON_PREM = "192.168.0.0/16";
const INTERNET_HOST = "52.160.10.20";
const MONITOR_HOST = "20.42.65.90";
const USER_HOST = "203.0.113.25";
const FW_PUBLIC = "20.51.8.10";
const BASTION_PUBLIC = "20.51.8.20";
const APPGW_PUBLIC = "20.51.9.30";

export function topology(
  answers: Answers,
  scene: { spokes: Spoke[]; extras?: SceneExtra[] | undefined },
  failure: Failure = "none",
): Topology {
  const hubNet = answers.connectivity === "hub_and_spoke";
  const wan = answers.connectivity === "virtual_wan";
  const fw = hasFirewall(answers);
  const gw = on(answers.vpnGateway) || on(answers.expressRoute);
  const dns = hasHub(answers) && answers.privateDns === "platform";
  const vnets: Vnet[] = [];
  const subnets: Subnet[] = [];
  const gatewayRouted = new Set<string>();

  // The AVM hub module takes the first /22 of 10.0.0.0/16 and allocates subnets by size, then name.
  const firewall = fw
    ? {
        ip: hubNet ? "10.0.0.68" : "10.0.64.4",
        publicIp: FW_PUBLIC,
        sku: answers.firewall,
        dnsProxy: hubNet && dns && answers.firewall !== "Basic",
      }
    : null;
  if (hubNet) {
    vnets.push({
      id: "hub",
      name: "vnet-hub",
      cidr: "10.0.0.0/22",
      peers: [],
      role: "hub",
      label: `Hub virtual network · ${answers.primaryRegion}`,
    });
    if (on(answers.bastion))
      subnets.push({
        id: "hub-bastion",
        vnet: "hub",
        name: "AzureBastionSubnet",
        cidr: "10.0.0.0/26",
        ip: "10.0.0.4",
        what: "Azure Bastion",
        private: false,
        publicIp: BASTION_PUBLIC,
      });
    if (fw)
      subnets.push({
        id: "hub-fw",
        vnet: "hub",
        name: "AzureFirewallSubnet",
        cidr: "10.0.0.64/26",
        ip: firewall!.ip,
        what: `Azure Firewall ${answers.firewall}`,
        private: false,
        publicIp: FW_PUBLIC,
        routeTable: {
          name: "rt-hub-fw",
          propagation: true,
          routes: [{ prefix: "0.0.0.0/0", nextHop: "Internet", source: "User" }],
        },
      });
    if (gw)
      subnets.push({
        id: "hub-gw",
        vnet: "hub",
        name: "GatewaySubnet",
        cidr: "10.0.0.192/27",
        ip: "10.0.0.196",
        what: on(answers.expressRoute) ? "ExpressRoute gateway" : "VPN gateway",
        private: false,
      });
    if (dns)
      subnets.push({
        id: "hub-dns",
        vnet: "hub",
        name: "DNS resolver inbound",
        cidr: "10.0.0.224/28",
        ip: "10.0.0.228",
        what: "DNS Private Resolver",
        private: true,
      });
  }
  if (wan)
    vnets.push({
      id: "hub",
      name: "Virtual hub",
      cidr: "10.0.0.0/23",
      peers: [],
      role: "hub",
      label: `Virtual WAN hub · ${answers.primaryRegion}`,
    });

  // A hub in a second region: the module's default for a second hub is 10.1.0.0/16 (first /22 used), and hub
  // networks are mesh-peered (global peering). The generated design deploys the same hub services there.
  const second =
    hasHub(answers) &&
    !!answers.secondaryRegion &&
    answers.secondaryRegion !== answers.primaryRegion;
  if (second && hubNet) {
    vnets.push({
      id: "hub2",
      name: "vnet-hub-2",
      cidr: "10.1.0.0/22",
      peers: ["hub"],
      role: "hub",
      label: `Hub virtual network · ${answers.secondaryRegion}`,
    });
    vnets.find((v) => v.id === "hub")!.peers.push("hub2");
    if (on(answers.bastion))
      subnets.push({
        id: "hub2-bastion",
        vnet: "hub2",
        name: "AzureBastionSubnet",
        cidr: "10.1.0.0/26",
        ip: "10.1.0.4",
        what: "Azure Bastion",
        private: false,
        publicIp: "20.52.8.20",
      });
    if (fw)
      subnets.push({
        id: "hub2-fw",
        vnet: "hub2",
        name: "AzureFirewallSubnet",
        cidr: "10.1.0.64/26",
        ip: "10.1.0.68",
        what: `Azure Firewall ${answers.firewall}`,
        private: false,
        publicIp: "20.52.8.10",
        routeTable: {
          name: "rt-hub-fw-2",
          propagation: true,
          routes: [{ prefix: "0.0.0.0/0", nextHop: "Internet", source: "User" }],
        },
      });
    if (gw)
      subnets.push({
        id: "hub2-gw",
        vnet: "hub2",
        name: "GatewaySubnet",
        cidr: "10.1.0.192/27",
        ip: "10.1.0.196",
        what: on(answers.expressRoute) ? "ExpressRoute gateway" : "VPN gateway",
        private: false,
      });
    if (dns)
      subnets.push({
        id: "hub2-dns",
        vnet: "hub2",
        name: "DNS resolver inbound",
        cidr: "10.1.0.224/28",
        ip: "10.1.0.228",
        what: "DNS Private Resolver",
        private: true,
      });
  }
  if (second && wan)
    vnets.push({
      id: "hub2",
      name: "Virtual hub 2",
      cidr: "10.1.0.0/23",
      peers: [],
      role: "hub",
      label: `Virtual WAN hub · ${answers.secondaryRegion}`,
    });

  // Spokes: subscriptions added in the design (their ranges are in the generated Terraform) and customer
  // installs (ranges from the offering's network, 10.60.0.0/19 by default, one /22 each).
  let installIndex = 0;
  const addSpoke = (
    id: string,
    name: string,
    cidr: string,
    group: string,
    peered: boolean,
    routed: boolean,
  ) => {
    const connected = peered && (hubNet || wan);
    vnets.push({
      id,
      name,
      cidr,
      peers: connected && hubNet ? ["hub"] : [],
      role: "spoke",
      hubConnected: connected && wan,
      useRemoteGateways: connected && hubNet && gw,
      label: `${name} · ${group}`,
    });
    if (connected && hubNet) vnets.find((v) => v.id === "hub")!.peers.push(id);
    const base = cidr.split("/")[0]!;
    if (group === "online")
      subnets.push({
        id: `${id}-appgw`,
        vnet: id,
        name: "snet-appgw",
        cidr: `${intIp(ipInt(base) + 512)}/26`,
        ip: intIp(ipInt(base) + 516),
        what: "Application Gateway WAF v2",
        private: false,
        publicIp: APPGW_PUBLIC,
      });
    const forced = connected && hubNet && fw;
    subnets.push({
      id: `${id}-workload`,
      vnet: id,
      name: "snet-workload",
      cidr: bits(cidr) >= 24 ? `${base}/25` : `${base}/24`,
      ip: host(cidr, 4),
      what: "Workload VM",
      private: true,
      routeTable: forced
        ? {
            name: `rt-${name}`,
            propagation: false,
            routes: [
              {
                prefix: "0.0.0.0/0",
                nextHop: "VirtualAppliance",
                nextHopIp: firewall!.ip,
                source: "User",
              },
            ],
          }
        : undefined,
    });
    subnets.push({
      id: `${id}-pe`,
      vnet: id,
      name: "snet-private-endpoints",
      cidr: bits(cidr) >= 24 ? `${intIp(ipInt(base) + 128)}/26` : `${intIp(ipInt(base) + 256)}/26`,
      ip: bits(cidr) >= 24 ? intIp(ipInt(base) + 132) : intIp(ipInt(base) + 260),
      what: "Private endpoint (database)",
      private: true,
    });
    if (routed && forced && gw) gatewayRouted.add(id);
    return id;
  };
  const extras = (scene.extras ?? []).filter((e) => e.group === "corp" && e.peered);
  const installs = scene.spokes.filter((s) => !s.ghost);
  const nextInstallRange = () => `10.60.${installIndex++ * 4}.0/22`;
  const corpIds: string[] = [];
  for (const e of extras.slice(0, 2))
    corpIds.push(addSpoke(`x-${e.id}`, e.name, e.cidr, "corp", true, true));
  for (const s of installs.filter((x) => x.group === "corp")) {
    if (corpIds.length >= 2) break;
    const nm = s.placement ? `${s.placement.customerName} ${s.placement.environment}` : "install";
    corpIds.push(addSpoke(`s-${s.id}`, nm, nextInstallRange(), "corp", true, false));
  }
  const corpGhost = scene.spokes.some((s) => s.group === "corp");
  while (corpGhost && corpIds.length < 2)
    corpIds.push(
      addSpoke(
        `next-${corpIds.length}`,
        corpIds.length ? "next Corp install" : "Corp install",
        nextInstallRange(),
        "corp",
        true,
        false,
      ),
    );
  const onlineInstall = installs.find((s) => s.group === "online");
  const online = onlineInstall
    ? addSpoke(
        `s-${onlineInstall.id}`,
        onlineInstall.placement
          ? `${onlineInstall.placement.customerName} ${onlineInstall.placement.environment}`
          : "Online install",
        nextInstallRange(),
        "online",
        false,
        false,
      )
    : undefined;
  if (wan && on(answers.bastion)) {
    vnets.push({
      id: "sidecar",
      name: "vnet-sidecar",
      cidr: "10.0.8.0/24",
      peers: [],
      role: "sidecar",
      hubConnected: true,
      label: "Sidecar network (Bastion)",
    });
    subnets.push({
      id: "sidecar-bastion",
      vnet: "sidecar",
      name: "AzureBastionSubnet",
      cidr: "10.0.8.0/26",
      ip: "10.0.8.4",
      what: "Azure Bastion",
      private: false,
      publicIp: BASTION_PUBLIC,
    });
  }
  return {
    mode: hubNet ? "hub" : wan ? "vwan" : "none",
    vnets,
    subnets,
    firewall,
    gateway:
      gw && (hubNet || wan)
        ? failure === "er" && on(answers.expressRoute)
          ? // The circuit is down: BGP over ExpressRoute is withdrawn; only the VPN (if any) still carries routes.
            { er: false, vpn: on(answers.vpnGateway), erDown: true }
          : { er: on(answers.expressRoute), vpn: on(answers.vpnGateway) }
        : null,
    routingIntent: wan && fw,
    onPrem: ON_PREM,
    corpA: corpIds[0],
    corpB: corpIds[1],
    online,
    gatewayRouted,
    regions: {
      primary: answers.primaryRegion,
      secondary: second ? answers.secondaryRegion : undefined,
    },
    failure,
  };
}

/* ---------------------------------------------------------------- routing */

const SOURCE_RANK: Record<RouteSource, number> = {
  User: 3,
  "Routing intent": 2,
  "Virtual network gateway": 2,
  "Hub route table": 2,
  Default: 1,
};

/** Every route Azure would program on this subnet. */
export function effectiveRoutes(t: Topology, s: Subnet): Route[] {
  const vnet = t.vnets.find((v) => v.id === s.vnet)!;
  const routes: Route[] = [{ prefix: vnet.cidr, nextHop: "VnetLocal", source: "Default" }];
  for (const p of vnet.peers) {
    const pv = t.vnets.find((v) => v.id === p)!;
    routes.push({ prefix: pv.cidr, nextHop: "VNetPeering", source: "Default" });
  }
  // Private endpoints add a /32 in their own VNet and directly peered VNets.
  for (const pe of t.subnets.filter((x) => x.id.endsWith("-pe"))) {
    const peVnet = pe.vnet;
    if (peVnet === s.vnet || vnet.peers.includes(peVnet))
      routes.push({ prefix: `${pe.ip}/32`, nextHop: "InterfaceEndpoint", source: "Default" });
  }
  routes.push({ prefix: "0.0.0.0/0", nextHop: "Internet", source: "Default" });
  for (const p of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"])
    routes.push({ prefix: p, nextHop: "None", source: "Default" });

  if (t.mode === "vwan" && vnet.hubConnected) {
    if (t.routingIntent) {
      for (const p of ["0.0.0.0/0", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"])
        routes.push({ prefix: p, nextHop: "HubFirewall", source: "Routing intent" });
    } else {
      for (const v of t.vnets.filter((x) => x.hubConnected && x.id !== vnet.id))
        routes.push({ prefix: v.cidr, nextHop: "HubConnection", source: "Hub route table" });
      if (t.gateway)
        routes.push({ prefix: t.onPrem, nextHop: "HubConnection", source: "Hub route table" });
    }
  }
  const learns =
    t.mode === "hub" &&
    !!t.gateway &&
    (t.gateway.er || t.gateway.vpn) &&
    (vnet.role === "hub" || vnet.useRemoteGateways) &&
    (s.routeTable?.propagation ?? true);
  if (learns)
    routes.push({
      prefix: t.onPrem,
      nextHop: "VirtualNetworkGateway",
      source: "Virtual network gateway",
    });
  if (s.routeTable) routes.push(...s.routeTable.routes);
  // The GatewaySubnet route table: each added spoke's exact range → firewall.
  if (s.name === "GatewaySubnet" && t.firewall)
    for (const id of t.gatewayRouted) {
      const v = t.vnets.find((x) => x.id === id)!;
      routes.push({
        prefix: v.cidr,
        nextHop: "VirtualAppliance",
        nextHopIp: t.firewall.ip,
        source: "User",
      });
    }
  // Microsoft: adding a 0.0.0.0/0 UDR (or a 0.0.0.0/0 from a gateway) removes the default None routes for the
  // private ranges — that's what lets spoke-to-spoke traffic follow 0.0.0.0/0 to the firewall.
  if (routes.some((r) => r.prefix === "0.0.0.0/0" && r.source !== "Default"))
    return routes.filter((r) => !(r.nextHop === "None" && r.source === "Default"));
  return routes;
}

/** Longest prefix, then UDR > BGP > system — the winner and why each other matching route lost. */
export function pick(routes: Route[], dst: string): { winner: Route | null; rows: RouteRow[] } {
  const matching = routes.filter((r) => inCidr(dst, r.prefix));
  const sorted = [...matching].sort(
    (a, b) => bits(b.prefix) - bits(a.prefix) || SOURCE_RANK[b.source] - SOURCE_RANK[a.source],
  );
  const winner = sorted[0] ?? null;
  const rows: RouteRow[] = routes.map((r) => {
    if (!matching.includes(r)) return { ...r, active: false, reason: "doesn't match" };
    if (r === winner) return { ...r, active: true };
    const reason =
      bits(r.prefix) < bits(winner!.prefix)
        ? `less specific than ${winner!.prefix}`
        : `same prefix; ${winner!.source === "User" ? "user-defined route" : winner!.source} wins`;
    return { ...r, active: false, reason };
  });
  return { winner, rows };
}

/* -------------------------------------------------------------- simulation */

export type Packet = { src: string; dst: string; port: string };
export type Decision = {
  kind: "NSG" | "Firewall" | "WAF" | "DNS" | "Sign-in" | "Policy" | "Resilience";
  text: string;
  result: "allow" | "deny" | "inspect" | "needs-rule";
};
export type SimHop = {
  /** Where the packet is: a subnet id, "hub-router", "internet", "onprem", "remote", "azure-dns", … */
  at: string;
  title: string;
  body?: string | undefined;
  packet: Packet;
  routes?: RouteRow[] | undefined;
  table?: string | undefined;
  decisions?: Decision[] | undefined;
  /** Link label into the next hop. */
  via?: string | undefined;
  nat?: string | undefined;
  drop?: string | undefined;
  gap?: HopGap | undefined;
};
/** The kind of traffic, for the legend's colours. */
export type TrafficKind =
  | "egress"
  | "ingress"
  | "internal"
  | "private-endpoint"
  | "ipsec"
  | "management"
  | "monitoring"
  | "failover";
export type SimResult = {
  kind: TrafficKind;
  id: string;
  title: string;
  question: string;
  color: string;
  available: boolean;
  reason?: string | undefined;
  forward: SimHop[];
  back: SimHop[];
  verdict: {
    status: "reaches" | "needs-rules" | "isolated" | "uninspected" | "broken";
    text: string;
  };
  notes: string[];
};

type Ctx = { t: Topology; allowRules: boolean; sessions: Set<string> };
const subnetOf = (t: Topology, ip: string) =>
  [...t.subnets].sort((a, b) => bits(b.cidr) - bits(a.cidr)).find((s) => inCidr(ip, s.cidr));
const vnetOf = (t: Topology, ip: string) => t.vnets.find((v) => inCidr(ip, v.cidr));
const key = (p: Packet) => `${p.src}>${p.dst}:${p.port}`;
const rev = (p: Packet) => `${p.dst}>${p.src}:${p.port}`;

/**
 * Forward a packet from a subnet until it's delivered or dropped. The firewall keeps sessions, so a reply can
 * only pass it if the request did.
 */
function trace(
  ctx: Ctx,
  from: string,
  pkt: Packet,
  reply: boolean,
  intro?: Partial<SimHop>,
): { hops: SimHop[]; ok: boolean; at: string } {
  const { t } = ctx;
  const hops: SimHop[] = [];
  let at = from;
  let p = { ...pkt };
  for (let guard = 0; guard < 8; guard++) {
    const s = t.subnets.find((x) => x.id === at);
    if (!s) return { hops, ok: false, at };
    // Arrived: the destination is in this subnet.
    if (inCidr(p.dst, s.cidr) && hops.length) {
      hops.push({
        at,
        title: `Delivered to ${s.what} in ${s.name}`,
        packet: p,
        decisions: [
          {
            kind: "NSG",
            text: `${s.name}: inbound ${p.port} from ${p.src} must be allowed (subnet NSG, then NIC NSG)`,
            result: "allow",
          },
        ],
        ...(intro && !hops.length ? intro : {}),
      });
      return { hops, ok: true, at };
    }
    const routes = effectiveRoutes(t, s);
    const { winner, rows } = pick(routes, p.dst);
    const table = s.routeTable
      ? `${s.routeTable.name} + system routes`
      : "System routes (no route table)";
    const hop: SimHop = { at, title: "", packet: { ...p }, routes: rows, table };
    if (!hops.length && intro) Object.assign(hop, intro);
    const firewallHere = s.name === "AzureFirewallSubnet" || at === "vhub-fw";
    if (firewallHere) {
      const known = ctx.sessions.has(rev(p));
      if (reply && !known) {
        hop.title = "Azure Firewall drops the reply";
        hop.drop =
          "The firewall never saw the request, so it has no session for this reply — asymmetric routing.";
        hops.push(hop);
        return { hops, ok: false, at };
      }
      if (!reply && !ctx.allowRules) {
        hop.title = "Azure Firewall: no rule allows it";
        hop.decisions = [
          {
            kind: "Firewall",
            text: "The deployed policy has no rules; anything not allowed is denied",
            result: "deny",
          },
        ];
        hop.drop = "Denied by the firewall (no matching rule).";
        hops.push(hop);
        return { hops, ok: false, at };
      }
      if (!reply) ctx.sessions.add(key(p));
      hop.decisions = [
        reply
          ? { kind: "Firewall", text: "Matches the session the request opened", result: "allow" }
          : {
              kind: "Firewall",
              text: "A rule allows it (DNAT → network → application; first match wins)",
              result: "allow",
            },
      ];
    }
    if (!winner || winner.nextHop === "None") {
      hop.title = hop.title || `No route out of ${s.name}`;
      hop.drop =
        winner?.nextHop === "None"
          ? `${winner.prefix} → None: Azure drops traffic to private ranges outside your connected networks.`
          : "No matching route.";
      hops.push(hop);
      return { hops, ok: false, at };
    }
    const nh = winner.nextHop;
    if (nh === "Internet") {
      if (s.private && !s.publicIp) {
        hop.title = hop.title || `${s.what}: no way to the internet`;
        hop.drop =
          "0.0.0.0/0 → Internet, but the subnet is private (default outbound access off) with no NAT gateway or public IP.";
        hops.push(hop);
        return { hops, ok: false, at };
      }
      if (isPrivate(p.dst)) {
        hop.title = hop.title || "No route";
        hop.drop = "Private address with no route.";
        hops.push(hop);
        return { hops, ok: false, at };
      }
      const snat = firewallHere && !reply && !isPrivate(p.dst) ? t.firewall!.publicIp : null;
      hop.title =
        hop.title || (firewallHere ? "Azure Firewall sends it out" : `${s.what} sends it out`);
      hop.via = snat ? `SNAT → ${snat}` : "Internet";
      if (snat) {
        hop.nat = `Source NAT: ${p.src} → ${snat} (firewall public IP)`;
        p = { ...p, src: snat };
      }
      hops.push(hop);
      hops.push({ at: "internet", title: `Reaches ${p.dst} on the internet`, packet: p });
      return { hops, ok: true, at: "internet" };
    }
    if (nh === "VirtualAppliance") {
      hop.title = hop.title || `${s.what} → firewall`;
      hop.via = `UDR ${winner.prefix}`;
      hops.push(hop);
      at = t.firewall && t.mode === "hub" ? "hub-fw" : at;
      continue;
    }
    if (nh === "HubFirewall") {
      hop.title = hop.title || `${s.what} → hub firewall`;
      hop.via = `Routing intent ${winner.prefix}`;
      hops.push(hop);
      // Inside the secured hub the firewall forwards by the hub router.
      if (!reply && !ctx.allowRules) {
        hops.push({
          at: "vhub-fw",
          title: "Hub firewall: no rule allows it",
          packet: p,
          decisions: [
            { kind: "Firewall", text: "The deployed policy has no rules", result: "deny" },
          ],
          drop: "Denied by the hub firewall (no matching rule).",
        });
        return { hops, ok: false, at: "vhub-fw" };
      }
      if (reply && !ctx.sessions.has(rev(p))) {
        hops.push({
          at: "vhub-fw",
          title: "Hub firewall drops the reply",
          packet: p,
          drop: "No session: asymmetric.",
        });
        return { hops, ok: false, at: "vhub-fw" };
      }
      if (!reply) ctx.sessions.add(key(p));
      const out: SimHop = {
        at: "vhub-fw",
        title: reply ? "Hub firewall passes the reply" : "Hub firewall allows it",
        packet: p,
        decisions: [
          {
            kind: "Firewall",
            text: reply ? "Matches the session" : "A rule allows it",
            result: "allow",
          },
        ],
      };
      if (!isPrivate(p.dst)) {
        out.nat = !reply ? `Source NAT: ${p.src} → ${t.firewall!.publicIp}` : undefined;
        out.via = !reply ? `SNAT → ${t.firewall!.publicIp}` : "Internet";
        hops.push(out);
        const np = !reply ? { ...p, src: t.firewall!.publicIp } : p;
        hops.push({ at: "internet", title: `Reaches ${np.dst} on the internet`, packet: np });
        return { hops, ok: true, at: "internet" };
      }
      out.via = "Hub router";
      hops.push(out);
      const dstNet = vnetOf(t, p.dst);
      if (dstNet?.hubConnected) {
        const ds = subnetOf(t, p.dst)!;
        at = ds.id;
        hops.push({
          at: "hub-router",
          title: "Hub router → the destination's connection",
          packet: p,
          via: "VNet connection",
        });
        continue;
      }
      if (inCidr(p.dst, t.onPrem) && t.gateway) {
        hops.push({
          at: t.mode === "vwan" ? "vhub-gw" : "hub-gw",
          title: "Out through the hub gateway",
          packet: p,
          via: t.gateway.er ? "ExpressRoute" : "IPsec",
        });
        hops.push({ at: "onprem", title: "Arrives on-premises", packet: p });
        return { hops, ok: true, at: "onprem" };
      }
      return { hops, ok: false, at };
    }
    if (nh === "HubConnection") {
      hop.title = hop.title || `${s.what} → hub router`;
      hop.via = "Hub connection";
      hops.push(hop);
      if (inCidr(p.dst, t.onPrem) && t.gateway) {
        hops.push({
          at: "hub-router",
          title: "Hub router → gateway",
          packet: p,
          via: "Default route table",
        });
        hops.push({
          at: "vhub-gw",
          title: "Out through the hub gateway",
          packet: p,
          via: t.gateway.er ? "ExpressRoute" : "IPsec",
        });
        hops.push({ at: "onprem", title: "Arrives on-premises", packet: p });
        return { hops, ok: true, at: "onprem" };
      }
      const ds = subnetOf(t, p.dst);
      if (!ds) return { hops, ok: false, at };
      hops.push({
        at: "hub-router",
        title: "Hub router forwards it directly",
        packet: p,
        via: "Default route table",
        gap: {
          severity: "fail",
          text: "No inspection: without routing intent the hub connects every spoke to every other.",
        },
      });
      at = ds.id;
      continue;
    }
    if (nh === "VirtualNetworkGateway") {
      hop.title = hop.title || `${s.what} → gateway`;
      hop.via = "BGP route";
      hops.push(hop);
      const g = t.subnets.find((x) => x.name === "GatewaySubnet");
      if (g && at !== g.id) {
        hops.push({
          at: g.id,
          title: `${g.what} → on-premises`,
          packet: p,
          via: t.gateway?.er ? "ExpressRoute" : "IPsec",
        });
      }
      hops.push({ at: "onprem", title: "Arrives on-premises", packet: p });
      return { hops, ok: true, at: "onprem" };
    }
    // VnetLocal, VNetPeering, InterfaceEndpoint: straight to the subnet holding the address.
    const ds = subnetOf(t, p.dst);
    if (!ds) {
      hop.title = hop.title || "No subnet holds that address";
      hop.drop = "Unknown destination.";
      hops.push(hop);
      return { hops, ok: false, at };
    }
    hop.title = hop.title || `${s.what} → ${ds.what}`;
    hop.via =
      nh === "VNetPeering"
        ? "Peering"
        : nh === "InterfaceEndpoint"
          ? "Private endpoint /32"
          : "Same network";
    hops.push(hop);
    at = ds.id;
  }
  return { hops, ok: false, at };
}

/* --------------------------------------------------------------- scenarios */

const firstFw = (hops: SimHop[]) => hops.some((h) => h.at === "hub-fw" || h.at === "vhub-fw");

export function simulate(t: Topology, answers: Answers, allowRules: boolean): SimResult[] {
  type Built = Omit<SimResult, "kind">;
  const out: Built[] = [];
  const sub = (id?: string, kind = "workload") =>
    id ? t.subnets.find((s) => s.id === `${id}-${kind}`) : undefined;
  const name = (id?: string) => t.vnets.find((v) => v.id === id)?.name ?? "a Corp install";
  const A = sub(t.corpA);
  const B = sub(t.corpB);
  const notes = (...n: (string | false | null | undefined)[]) => n.filter(Boolean) as string[];
  const rulesNote = allowRules
    ? "Assuming the firewall has a rule allowing this. The policy the design deploys starts empty, and Azure Firewall denies what no rule allows."
    : undefined;

  const run = (
    base: Omit<SimResult, "forward" | "back" | "verdict" | "notes" | "kind"> & { notes?: string[] },
    start: string,
    pkt: Packet,
    opts: {
      intro?: Partial<SimHop>;
      expectInspection?: boolean;
      returnFrom?: (fwd: { at: string; hops: SimHop[] }) => string | null;
      isolatedIsGood?: boolean;
    } = {},
  ): Built => {
    const ctx: Ctx = { t, allowRules, sessions: new Set() };
    const fwd = trace(ctx, start, pkt, false, opts.intro);
    let back: SimHop[] = [];
    let backOk = true;
    if (fwd.ok) {
      const last = fwd.hops.at(-1)!.packet;
      const from = opts.returnFrom ? opts.returnFrom(fwd) : fwd.at;
      if (from && t.subnets.some((s) => s.id === from)) {
        const r = trace(ctx, from, { src: last.dst, dst: last.src, port: pkt.port }, true);
        back = r.hops;
        backOk = r.ok;
      }
    }
    const dropHop = fwd.hops.find((h) => h.drop) ?? back.find((h) => h.drop);
    const fwDeny =
      !fwd.ok && dropHop?.decisions?.some((d) => d.kind === "Firewall" && d.result === "deny");
    const verdict: SimResult["verdict"] = !fwd.ok
      ? fwDeny
        ? opts.isolatedIsGood
          ? {
              status: "isolated",
              text: "Stopped at the firewall: installs stay isolated unless you add a rule.",
            }
          : { status: "needs-rules", text: "Stopped at the firewall until a rule allows it." }
        : opts.isolatedIsGood && dropHop?.drop?.includes("None")
          ? {
              status: "isolated",
              text: "No route between the networks — isolated, though nothing inspects or logs it.",
            }
          : { status: "broken", text: dropHop?.drop ?? "Doesn't arrive." }
      : !backOk
        ? {
            status: "broken",
            text: `The request arrives, but the reply is dropped: ${dropHop?.drop ?? "asymmetric routing."}`,
          }
        : opts.expectInspection && !firstFw(fwd.hops)
          ? { status: "uninspected", text: "Arrives and returns, but no firewall is on the path." }
          : {
              status: "reaches",
              text: `Arrives and the reply comes back the same way${firstFw(fwd.hops) ? ", inspected by the firewall" : ""}.`,
            };
    return { ...base, forward: fwd.hops, back, verdict, notes: base.notes ?? [] };
  };

  // 1. Corp workload → internet
  if (A)
    out.push(
      run(
        {
          id: "egress",
          title: "A Corp workload calls an internet API",
          question: `${A.ip} in ${name(t.corpA)} → ${INTERNET_HOST}:443`,
          color: "#f0605a",
          available: true,
          notes: notes(t.firewall && rulesNote),
        },
        A.id,
        { src: A.ip, dst: INTERNET_HOST, port: "443" },
        { expectInspection: true },
      ),
    );

  // 2. Corp install → another Corp install
  if (A && B)
    out.push(
      run(
        {
          id: "eastwest",
          title: "One customer install talks to another",
          question: `${A.ip} (${name(t.corpA)}) → ${B.ip} (${name(t.corpB)}):443`,
          color: "#f2a33a",
          available: true,
          notes: notes(
            "For an ISV, installs should be isolated: the firewall denies this unless a network rule allows it.",
            t.firewall &&
              allowRules &&
              "Showing the path as if a rule allowed it. Switch to “As deployed” to see the default.",
          ),
        },
        A.id,
        { src: A.ip, dst: B.ip, port: "443" },
        { expectInspection: true, isolatedIsGood: true },
      ),
    );

  // 3. On-premises → Corp workload
  if (A)
    out.push(
      t.gateway && !t.gateway.er && !t.gateway.vpn
        ? {
            id: "hybrid",
            title: "The office reaches a Corp workload",
            question: `192.168.10.20 (on-premises) → ${A.ip}:1433`,
            color: "#9d7ff7",
            available: true,
            forward: [
              {
                at: "onprem",
                title: "The ExpressRoute circuit is down",
                packet: { src: "192.168.10.20", dst: A.ip, port: "1433" },
                drop: "BGP over the circuit is withdrawn and there's no other path to Azure.",
                gap: {
                  severity: "fail",
                  text: "Add a site-to-site VPN as the backup path. ExpressRoute stays primary while it's up; prefer its routes on-premises (higher local preference) to avoid asymmetric routing.",
                  fix: { label: "Add a VPN gateway", patch: { vpnGateway: "yes" } },
                },
              },
            ],
            back: [],
            verdict: {
              status: "broken",
              text: "On-premises is cut off: no backup for the ExpressRoute circuit.",
            },
            notes: [],
          }
        : t.gateway
          ? (() => {
              const r = (() => {
                const ctx: Ctx = { t, allowRules, sessions: new Set() };
                const pkt = { src: "192.168.10.20", dst: A.ip, port: "1433" };
                const entry: SimHop = {
                  at: "onprem",
                  title: t.gateway!.er
                    ? "From the data center over ExpressRoute"
                    : "From the office over a site-to-site VPN",
                  body: t.gateway!.er
                    ? "Customer edge → Microsoft edge (private peering, BGP) → the ExpressRoute gateway."
                    : "IPsec tunnel over the internet to the VPN gateway. On-premises learned the hub and spoke ranges by BGP (gateway transit).",
                  packet: pkt,
                  via: t.gateway!.er ? "ExpressRoute private peering" : "IPsec S2S",
                };
                const start = t.mode === "hub" ? "hub-gw" : null;
                if (!start) {
                  // Virtual WAN: branch → hub router (→ firewall with routing intent) → spoke.
                  const hops: SimHop[] = [
                    entry,
                    {
                      at: "vhub-gw",
                      title: `${t.gateway!.er ? "ExpressRoute" : "VPN"} gateway in the virtual hub`,
                      packet: pkt,
                      via: t.routingIntent ? "Routing intent (private)" : "Default route table",
                    },
                  ];
                  if (t.routingIntent) {
                    if (!allowRules) {
                      hops.push({
                        at: "vhub-fw",
                        title: "Hub firewall: no rule allows it",
                        packet: pkt,
                        decisions: [
                          {
                            kind: "Firewall",
                            text: "The deployed policy has no rules",
                            result: "deny",
                          },
                        ],
                        drop: "Denied by the hub firewall.",
                      });
                      return { fwd: hops, ok: false, ctx };
                    }
                    ctx.sessions.add(key(pkt));
                    hops.push({
                      at: "vhub-fw",
                      title: "Hub firewall allows it (routing intent: private traffic)",
                      packet: pkt,
                      via: "Hub router",
                      decisions: [
                        {
                          kind: "Firewall",
                          text: "A rule allows it; private traffic isn't source-NATed",
                          result: "allow",
                        },
                      ],
                    });
                  } else
                    hops.push({
                      at: "hub-router",
                      title: "Hub router forwards it",
                      packet: pkt,
                      via: "VNet connection",
                      gap: {
                        severity: "warn",
                        text: "Uninspected: branch-to-VNet goes straight through the hub router.",
                      },
                    });
                  hops.push({
                    at: A.id,
                    title: `Delivered to ${A.what}`,
                    packet: pkt,
                    decisions: [
                      {
                        kind: "NSG",
                        text: "Inbound 1433 from the on-premises range must be allowed",
                        result: "allow",
                      },
                    ],
                  });
                  return { fwd: hops, ok: true, ctx };
                }
                const tr = trace(ctx, start, pkt, false, {
                  title: `${t.gateway!.er ? "ExpressRoute" : "VPN"} gateway: GatewaySubnet routes decide`,
                });
                return { fwd: [entry, ...tr.hops], ok: tr.ok, ctx };
              })();
              let back: SimHop[] = [];
              let backOk = true;
              if (r.ok) {
                const b = trace(
                  r.ctx,
                  A.id,
                  { src: A.ip, dst: "192.168.10.20", port: "1433" },
                  true,
                );
                back = b.hops;
                backOk = b.ok;
              }
              const bypassed = r.ok && !firstFw(r.fwd);
              const drop = r.fwd.find((h) => h.drop) ?? back.find((h) => h.drop);
              const res: Built = {
                id: "hybrid",
                title: "The office reaches a Corp workload",
                question: `192.168.10.20 (on-premises) → ${A.ip}:1433 in ${name(t.corpA)}`,
                color: "#9d7ff7",
                available: true,
                forward: r.fwd,
                back,
                notes: notes(
                  t.firewall && rulesNote,
                  t.mode === "hub" &&
                    t.firewall &&
                    !t.gatewayRouted.has(t.corpA!) &&
                    "This install's range isn't in the GatewaySubnet route table, so the gateway uses the more specific peering route and skips the firewall. Subscriptions added in the design get that route automatically.",
                  t.gateway?.erDown &&
                    "The ExpressRoute circuit is down: its BGP routes are withdrawn and the site-to-site VPN carries the traffic. When the circuit is back, ExpressRoute is preferred again.",
                  t.gateway?.er &&
                    t.gateway.vpn &&
                    "With both gateways, ExpressRoute is preferred over the VPN for identical prefixes.",
                ),
                verdict: !r.ok
                  ? {
                      status: drop?.decisions?.some((d) => d.result === "deny")
                        ? "needs-rules"
                        : "broken",
                      text: drop?.drop ?? "Doesn't arrive.",
                    }
                  : !backOk
                    ? {
                        status: "broken",
                        text: `The request arrives, but ${drop?.drop ?? "the reply is dropped."}`,
                      }
                    : bypassed
                      ? {
                          status: "uninspected",
                          text: "Arrives and returns directly — no firewall on the path.",
                        }
                      : { status: "reaches", text: "Inspected by the firewall both ways." },
              };
              return res;
            })()
          : {
              id: "hybrid",
              title: "The office reaches a Corp workload",
              question: "On-premises → Corp workload",
              color: "#9d7ff7",
              available: false,
              reason:
                t.mode === "none"
                  ? "No central network."
                  : "No VPN or ExpressRoute gateway in the hub.",
              forward: [],
              back: [],
              verdict: { status: "broken", text: "No connection to on-premises." },
              notes: [],
            },
    );

  // 4. Internet users → an Online install (Application Gateway is a proxy: two legs)
  const onl = t.online;
  if (onl) {
    const agw = sub(onl, "appgw")!;
    const be = sub(onl, "workload")!;
    const first: SimHop = {
      at: "internet",
      title: "A user opens the product's URL",
      body: "HTTPS to the Application Gateway's public IP. Online spokes aren't peered, so the hub and firewall are never on this path.",
      packet: { src: USER_HOST, dst: APPGW_PUBLIC, port: "443" },
      via: "HTTPS 443",
    };
    const gwHop: SimHop = {
      at: agw.id,
      title: "Application Gateway WAF v2 terminates TLS and inspects",
      body: "It's a proxy: it opens a new connection to the backend from its own instance address.",
      packet: { src: USER_HOST, dst: APPGW_PUBLIC, port: "443" },
      decisions: [
        {
          kind: "NSG",
          text: "snet-appgw: allow 443 from Internet; GatewayManager 65200-65535",
          result: "allow",
        },
        { kind: "WAF", text: "OWASP rule set on the listener", result: "inspect" },
      ],
      nat: `New connection: ${agw.ip} → ${be.ip}`,
      gap: {
        severity: "warn",
        text: "Audit-AppGW-WAF only audits; an install published without WAF is flagged, not blocked.",
      },
    };
    const ctx: Ctx = { t, allowRules, sessions: new Set() };
    const leg = trace(ctx, agw.id, { src: agw.ip, dst: be.ip, port: "443" }, false);
    leg.hops[0] = { ...leg.hops[0]!, title: "Proxied to the backend", via: "Same network" };
    out.push({
      id: "ingress",
      title: "Users reach an Online install",
      question: `${USER_HOST} (internet) → ${APPGW_PUBLIC}:443 → ${be.ip}`,
      color: "#2fb3e8",
      available: true,
      forward: [first, gwHop, ...leg.hops],
      back: [
        {
          at: be.id,
          title: "The backend replies to the Application Gateway",
          packet: { src: be.ip, dst: agw.ip, port: "443" },
          via: "Same network",
        },
        {
          at: agw.id,
          title: "The gateway answers the user",
          packet: { src: APPGW_PUBLIC, dst: USER_HOST, port: "443" },
          via: "Internet",
        },
        {
          at: "internet",
          title: "Back to the user",
          packet: { src: APPGW_PUBLIC, dst: USER_HOST, port: "443" },
        },
      ],
      verdict: {
        status: "reaches",
        text: "Arrives through the install's own WAF; the platform firewall isn't on this path.",
      },
      notes: [
        "With Azure Front Door Premium in front, the request enters at the nearest edge and reaches the origin over Private Link.",
      ],
    });
  }

  // 5. Private endpoint: DNS first, then the connection
  if (A && t.mode !== "none" && answers.privateDns === "platform") {
    const pe = sub(t.corpA, "pe")!;
    if (t.firewall?.dnsProxy) {
      const ctx: Ctx = { t, allowRules: true, sessions: new Set() };
      const q1 = trace(ctx, A.id, { src: A.ip, dst: t.firewall.ip, port: "53" }, false, {
        title: "Asks its DNS server (the firewall) for mydb.database.windows.net",
      });
      const dnsHops: SimHop[] = [
        ...q1.hops.map((h) =>
          h.at === "hub-fw"
            ? {
                ...h,
                title: "Firewall DNS proxy takes the query",
                decisions: [
                  {
                    kind: "DNS" as const,
                    text: "DNS proxy on: forwards to the DNS Private Resolver",
                    result: "allow" as const,
                  },
                ],
              }
            : h,
        ),
        {
          at: "hub-dns",
          title: "DNS Private Resolver inbound endpoint",
          packet: { src: t.firewall.ip, dst: "10.0.0.228", port: "53" },
          via: "168.63.129.16",
        },
        {
          at: "azure-dns",
          title: "Azure DNS answers from the privatelink zone linked to the hub",
          packet: { src: "10.0.0.228", dst: "168.63.129.16", port: "53" },
          decisions: [
            { kind: "DNS", text: `privatelink.database.windows.net → ${pe.ip}`, result: "allow" },
          ],
        },
      ];
      const conn = trace(ctx, A.id, { src: A.ip, dst: pe.ip, port: "1433" }, false, {
        title: `Connects to ${pe.ip}`,
        body: "The private endpoint's /32 route beats the 0.0.0.0/0 route to the firewall, so this stays inside the spoke.",
      });
      out.push({
        id: "private-endpoint",
        title: "A workload reaches its database privately",
        question: `${A.ip} → mydb.database.windows.net (private endpoint ${pe.ip}):1433`,
        color: "#37b6df",
        available: true,
        forward: [...dnsHops, ...conn.hops],
        back: [],
        verdict: conn.ok
          ? {
              status: "reaches",
              text: "Resolves to the private IP and connects without leaving the network.",
            }
          : { status: "broken", text: "Doesn't connect." },
        notes: [
          "NSGs and route tables apply to the private endpoint only if its subnet has network policies enabled.",
        ],
      });
    } else {
      out.push({
        id: "private-endpoint",
        title: "A workload reaches its database privately",
        question: `${A.ip} → mydb.database.windows.net`,
        color: "#37b6df",
        available: true,
        forward: [
          {
            at: A.id,
            title: "Asks Azure-provided DNS (168.63.129.16)",
            packet: { src: A.ip, dst: "168.63.129.16", port: "53" },
            via: "Azure DNS",
          },
          {
            at: "azure-dns",
            title: "Azure DNS returns the public address",
            packet: { src: A.ip, dst: "168.63.129.16", port: "53" },
            drop: "The privatelink zones are linked to the hub, not this spoke, so the name resolves publicly — and Deny-Public-Endpoints keeps the database's public access off.",
            gap: {
              severity: "fail",
              text:
                t.mode === "vwan"
                  ? "Point the spokes' DNS at the DNS Private Resolver's inbound endpoint."
                  : "Use Azure Firewall Standard or Premium (its DNS proxy forwards to the resolver).",
              fix:
                t.mode === "hub"
                  ? { label: "Use Azure Firewall Standard", patch: { firewall: "Standard" } }
                  : undefined,
            },
          },
        ],
        back: [],
        verdict: {
          status: "broken",
          text: "Resolves to the public endpoint; the connection fails.",
        },
        notes: [],
      });
    }
  }

  // 6. Operator → VM through Bastion (Bastion is a proxy too)
  const bastion = t.subnets.find((s) => s.name === "AzureBastionSubnet");
  if (A && bastion) {
    const ctx: Ctx = { t, allowRules, sessions: new Set() };
    const leg = trace(ctx, bastion.id, { src: bastion.ip, dst: A.ip, port: "22" }, false, {
      title: "Azure Bastion opens SSH/RDP to the VM",
      body: "Route tables aren't supported on AzureBastionSubnet.",
      decisions: [
        {
          kind: "NSG",
          text: "AzureBastionSubnet: inbound 443 from Internet and GatewayManager; outbound 22/3389 to VirtualNetwork",
          result: "allow",
        },
      ],
    });
    let back: SimHop[] = [];
    let backOk = true;
    if (leg.ok) {
      const b = trace(ctx, A.id, { src: A.ip, dst: bastion.ip, port: "22" }, true);
      back = b.hops;
      backOk = b.ok;
    }
    const drop = leg.hops.find((h) => h.drop) ?? back.find((h) => h.drop);
    out.push({
      id: "bastion",
      title: "An operator signs in to a VM",
      question: `Operator (internet) → Bastion ${BASTION_PUBLIC}:443 → ${A.ip}:22`,
      color: "#27c1ad",
      available: true,
      forward: [
        {
          at: "internet",
          title: "Operator connects from the Azure portal",
          body: "Signed in with Microsoft Entra ID; HTTPS to Bastion's public IP.",
          packet: { src: USER_HOST, dst: BASTION_PUBLIC, port: "443" },
          via: "HTTPS 443",
          decisions: [
            {
              kind: "Sign-in",
              text: "Microsoft Entra ID; PIM activation for privileged roles",
              result: "inspect",
            },
          ],
        },
        ...leg.hops,
      ],
      back,
      verdict: !leg.ok
        ? {
            status: drop?.decisions?.some((d) => d.result === "deny") ? "needs-rules" : "broken",
            text: drop?.drop ?? "Doesn't arrive.",
          }
        : !backOk
          ? {
              status: "broken",
              text: `The session opens but ${drop?.drop ?? "replies are dropped."}`,
            }
          : {
              status: "reaches",
              text: "Reaches the VM once its NSG allows 22/3389 from the Bastion subnet; the reply returns straight to Bastion.",
            },
      notes: notes(
        t.mode === "hub" &&
          "The spoke's peering route to the hub range is more specific than its 0.0.0.0/0 route, so the reply goes straight back to Bastion — not through the firewall.",
        t.mode === "vwan" &&
          "Bastion can't live in a Virtual WAN hub; it sits in a sidecar network and uses IP-based connection (Standard SKU).",
      ),
    });
  }

  // 7. Monitoring data to Azure Monitor
  if (A && answers.monitoring === "azure_monitor")
    out.push(
      run(
        {
          id: "telemetry",
          title: "The monitoring agent sends logs",
          question: `${A.ip} → Azure Monitor ingestion (${MONITOR_HOST}):443`,
          color: "#b36cf0",
          available: true,
          notes: notes(
            t.firewall &&
              (allowRules
                ? "Assuming the firewall allows the AzureMonitor service tag on 443."
                : "Allow the AzureMonitor service tag (443) on the firewall."),
            "Or keep it private end to end with Azure Monitor Private Link Scope.",
          ),
        },
        A.id,
        { src: A.ip, dst: MONITOR_HOST, port: "443" },
      ),
    );

  // 8. Point-to-site
  if (t.gateway?.vpn)
    out.push({
      id: "p2s",
      title: "A remote engineer connects over VPN",
      question: "Laptop (Azure VPN Client) → VPN gateway → Corp workload",
      color: "#6d8bf7",
      available: true,
      forward: [
        {
          at: "remote",
          title: "Azure VPN Client connects",
          body: "OpenVPN over TLS 443 with Microsoft Entra ID sign-in.",
          packet: { src: "172.16.201.10", dst: A?.ip ?? "10.60.0.4", port: "22" },
          via: "OpenVPN 443",
        },
        {
          at: t.mode === "hub" ? "hub-gw" : "vhub-gw",
          title: "Point-to-site isn't configured on the gateway",
          packet: { src: "172.16.201.10", dst: A?.ip ?? "10.60.0.4", port: "22" },
          drop: "The VPN gateway in this design only has site-to-site.",
          gap: {
            severity: "fail",
            text: "Configure point-to-site: a non-overlapping address pool, OpenVPN, Microsoft Entra ID authentication.",
          },
        },
      ],
      back: [],
      verdict: { status: "broken", text: "Not available yet: point-to-site isn't configured." },
      notes: [
        "Once configured, the path is the same as the office's: GatewaySubnet route → firewall → spoke.",
      ],
    });

  /* Failures */
  if (t.failure === "zone") {
    const zonal: Record<string, string> = {
      "hub-fw":
        "Azure Firewall spans the region's availability zones; the surviving zones carry this",
      "vhub-fw": "The hub firewall spans availability zones; the surviving zones carry this",
      "hub-gw":
        "Zone-redundant gateway (VpnGw1AZ / ErGw1AZ, VPN active-active): an instance in another zone takes over",
      "vhub-gw": "Hub gateways are zone-redundant: an instance in another zone takes over",
    };
    for (const r of out) {
      for (const h of [...r.forward, ...r.back])
        if (zonal[h.at])
          h.decisions = [
            ...(h.decisions ?? []),
            { kind: "Resilience", text: zonal[h.at]!, result: "allow" },
          ];
      r.notes = [
        "One availability zone is down. The platform keeps routing: the firewall spans the zones and the gateways use zone-redundant SKUs. A workload VM in the failed zone is down unless the install runs across zones.",
        ...r.notes,
      ];
    }
  }
  if (t.failure === "region") {
    const primary = t.regions.primary;
    for (const r of out) {
      const first = r.forward[0];
      if (!r.available || !first) continue;
      r.forward = [
        {
          at: first.at,
          title: first.title,
          packet: first.packet,
          drop: `${primary} is down, and this path runs through its hub and installs.`,
        },
      ];
      r.back = [];
      r.verdict = { status: "broken", text: `Down with ${primary}.` };
    }
    const next =
      AZURE_REGIONS.find(
        (r) => r.name !== primary && r.geo === AZURE_REGIONS.find((x) => x.name === primary)?.geo,
      )?.name ?? "centralus";
    const sec = t.regions.secondary;
    const gw2 = t.mode === "hub" ? "hub2-gw" : "vhub2-gw";
    const fw2 = t.mode === "hub" ? "hub2-fw" : "vhub2-fw";
    const pkt = { src: "192.168.20.20", dst: "10.1.0.4", port: "443" };
    const hops: SimHop[] = [];
    if (!sec || t.mode === "none")
      hops.push({
        at: "onprem2",
        title: "Nowhere to fail over to",
        packet: pkt,
        drop: "There's no hub in a second region.",
        gap: {
          severity: "fail",
          text: `Add a hub in a second region (${next}): its own firewall and gateways, globally peered with the primary, reached over a second ExpressRoute circuit or VPN.`,
          fix: { label: `Add a hub in ${next}`, patch: { secondaryRegion: next } },
        },
      });
    else {
      hops.push({
        at: "onprem2",
        title: "From the second data center",
        body: "Over a second ExpressRoute circuit at a different peering location (or a VPN), so one site's outage doesn't cut you off.",
        packet: pkt,
        via: t.gateway?.er ? "ExpressRoute (circuit 2)" : "IPsec S2S",
      });
      if (!t.gateway)
        hops.push({
          at: gw2,
          title: `No gateway in ${sec}`,
          packet: pkt,
          drop: "The secondary hub has no VPN or ExpressRoute gateway.",
          gap: {
            severity: "fail",
            text: "Add a VPN or ExpressRoute gateway (the design adds it to both hubs).",
            fix: { label: "Add a VPN gateway", patch: { vpnGateway: "yes" } },
          },
        });
      else {
        hops.push({
          at: gw2,
          title: `The gateway in ${sec} takes the traffic`,
          body: "BGP now only offers the secondary hub's routes; the primary hub's went away with the region.",
          packet: pkt,
          via: t.firewall ? "GatewaySubnet → firewall" : "Peering",
        });
        if (t.firewall)
          hops.push({
            at: fw2,
            title: `The firewall in ${sec}`,
            body: "Use one firewall policy for both regions (Azure Firewall Manager) so the rules are identical.",
            packet: pkt,
            decisions: [
              {
                kind: "Firewall",
                text: "The secondary firewall enforces the same policy",
                result: allowRules ? "allow" : "needs-rule",
              },
            ],
          });
        hops.push({
          at: "dr-installs",
          title: `Customer installs in ${sec}`,
          packet: pkt,
          drop: `No installs are deployed in ${sec} yet, so there's nothing to fail over to.`,
          gap: {
            severity: "warn",
            text: `The platform survives in ${sec}; the workloads don't. Redeploy each install there from the same pipeline (active-passive), or run it active-active behind Azure Front Door so users fail over on their own.`,
          },
        });
      }
    }
    out.unshift({
      id: "failover",
      title: `Fail over to ${sec ?? "a second region"}`,
      question: sec ? `On-premises → the ${sec} hub → installs` : "On-premises → a second region",
      color: "#e3008c",
      available: true,
      forward: hops,
      back: [],
      verdict: sec
        ? {
            status: "broken",
            text: `Connectivity fails over to ${sec}, but no installs run there yet.`,
          }
        : { status: "broken", text: "No second region: a regional outage takes everything down." },
      notes: [
        "High availability keeps a region running through a zone or link failure. Disaster recovery needs a separate, complete copy in another region to fail over to.",
      ],
    });
  }

  const KIND: Record<string, TrafficKind> = {
    egress: "egress",
    eastwest: "internal",
    hybrid: t.gateway && t.gateway.er && !t.gateway.erDown ? "internal" : "ipsec",
    ingress: "ingress",
    "private-endpoint": "private-endpoint",
    bastion: "management",
    telemetry: "monitoring",
    p2s: "ipsec",
    failover: "failover",
  };
  return out.map((r) => ({ ...r, kind: KIND[r.id] ?? "internal" }));
}
