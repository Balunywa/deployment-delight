/*
 * Architecture-standard layout for the hop-by-hop traffic simulator. It is still computed from the
 * routing topology: outside actors sit above the Microsoft Azure boundary, Azure contains the
 * management row, regional hub(s), landing-zone spokes and the hybrid band, and on-premises is the
 * bottom boundary. The same absolute positions are used by React Flow and the draw.io export.
 */
import type { Failure, Topology } from "@/lib/alz/routing";

/** Official Azure architecture icons (public/azure-icons) and their draw.io equivalents (img/lib/azure2). */
export const ICONS = {
  firewall: "networking/Firewalls.svg",
  bastion: "networking/Bastions.svg",
  "vnet-gateway": "networking/Virtual_Network_Gateways.svg",
  expressroute: "networking/ExpressRoute_Circuits.svg",
  "dns-resolver": "networking/DNS_Private_Resolver.svg",
  vnet: "networking/Virtual_Networks.svg",
  "app-gateway": "networking/Application_Gateways.svg",
  vm: "compute/Virtual_Machine.svg",
  "private-endpoint": "other/Private_Endpoints.svg",
  "log-analytics": "management_governance/Log_Analytics_Workspaces.svg",
  sentinel: "security/Azure_Sentinel.svg",
  "network-watcher": "networking/Network_Watcher.svg",
  "vwan-hub": "networking/Virtual_WAN_Hub.svg",
  "virtual-router": "networking/Virtual_Router.svg",
  "local-gateway": "networking/Local_Network_Gateways.svg",
  "on-premises": "networking/On_Premises_Data_Gateways.svg",
  "dns-zones": "networking/DNS_Zones.svg",
  users: "identity/Users.svg",
  subscription: "general/Subscriptions.svg",
  monitor: "management_governance/Monitor.svg",
  "public-ip": "networking/Public_IP_Addresses.svg",
  "vpn-client": "networking/Virtual_Network_Gateways.svg",
} as const;
export type Icon = keyof typeof ICONS;
export const iconUrl = (i: Icon) => `/azure-icons/${i}.svg`;

export type TNode = {
  id: string;
  kind: "frame" | "part" | "cloud";
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  detail?: string | undefined;
  tag?: string | undefined;
  icon?: Icon | undefined;
  fill?: string | undefined;
  stroke?: string | undefined;
  dashed?: boolean | undefined;
  chip?: { text: string; fill: string } | undefined;
  down?: boolean | undefined;
  absent?: boolean | undefined;
  /** A red ✕ on the part itself (a failed circuit). */
  failed?: boolean | undefined;
  /** Which standard boundary to draw for frame nodes. */
  zoneKind?: "azure" | "subscription" | "vnet" | "zone" | "onprem" | "band" | undefined;
  /** Lower layers are sent behind cards. */
  layer?: number | undefined;
};
export type TEdge = {
  id: string;
  source: string;
  target: string;
  kind: "peering" | "global" | "er" | "bgp" | "ipsec" | "wan" | "link" | "p2s";
  label?: string | undefined;
  down?: boolean | undefined;
};

export const PART = { w: 216, h: 58 };
const FRAME_W = PART.w + 28;
const HEAD = 50;
const GAP = 7;
const M = 28;
const OUTSIDE_Y = 18;
const AZURE_Y = 118;
const MGMT_Y = AZURE_Y + 46;
const HUB_Y = AZURE_Y + 150;
const ROW_GAP = 22;
const COL_GAP = 18;

function gwTitle(t: Topology) {
  if (!t.gateway) return "Gateway";
  const er = t.gateway.er || t.gateway.erDown;
  return `${er ? "ExpressRoute" : ""}${er && t.gateway.vpn ? " + " : ""}${t.gateway.vpn ? "VPN" : ""} gateway`;
}

function subnetTitle(name: string) {
  if (name === "snet-appgw") return "Application Gateway WAF v2";
  if (name.includes("private")) return "Private endpoint";
  return "Workload VM";
}

function subnetIcon(name: string): Icon {
  if (name === "snet-appgw") return "app-gateway";
  if (name.includes("private")) return "private-endpoint";
  return "vm";
}

export function trafficLayout(t: Topology, failure: Failure) {
  const nodes: TNode[] = [];
  const edges: TEdge[] = [];
  const regionDown = failure === "region";
  const sub = (id: string) => t.subnets.find((s) => s.id === id);
  const vnet = (id: string) => t.vnets.find((v) => v.id === id);
  const has = (id: string) => nodes.some((n) => n.id === id && !n.absent);
  const part = (n: Omit<TNode, "kind" | "w" | "h"> & { w?: number; h?: number }) =>
    nodes.push({ kind: "part", w: n.w ?? PART.w, h: n.h ?? PART.h, ...n });

  const spokeIds = [...t.corp, ...t.onlines];
  const spokeCols = Math.max(1, Math.min(4, spokeIds.length || 1));
  const azureW = Math.max(1188, M * 2 + spokeCols * FRAME_W + (spokeCols - 1) * COL_GAP);
  const actorGap = 28;
  const actorW = Math.min(230, (azureW - M * 2 - actorGap * 3) / 4);

  nodes.push(
    {
      id: "internet",
      kind: "cloud",
      x: M,
      y: OUTSIDE_Y,
      w: actorW,
      h: 66,
      title: "Internet",
      detail: "Public endpoints",
      icon: "public-ip",
      layer: 5,
    },
    {
      id: "users",
      kind: "part",
      x: M + actorW + actorGap,
      y: OUTSIDE_Y,
      w: actorW,
      h: 66,
      title: "Internet users",
      detail: "Browsers and partners",
      icon: "users",
      layer: 5,
    },
    {
      id: "operator",
      kind: "part",
      x: M + (actorW + actorGap) * 2,
      y: OUTSIDE_Y,
      w: actorW,
      h: 66,
      title: "Operators",
      detail: "Azure portal + RBAC",
      icon: "users",
      layer: 5,
    },
  );
  if (t.gateway?.vpn)
    nodes.push({
      id: "remote",
      kind: "part",
      x: M + (actorW + actorGap) * 3,
      y: OUTSIDE_Y,
      w: actorW,
      h: 66,
      title: "Remote engineers",
      detail: "Point-to-site VPN · not configured",
      icon: "vpn-client",
      layer: 5,
    });

  const mgmtItems: Array<Omit<TNode, "kind" | "x" | "y" | "w" | "h">> = [
    {
      id: "azure-dns",
      title: "Azure platform DNS",
      detail: "168.63.129.16 · privatelink zones",
      icon: "dns-zones",
    },
    {
      id: "mgmt-law",
      title: "Log Analytics workspace",
      detail: "Firewall, NSG flow and gateway logs",
      icon: "log-analytics",
    },
    {
      id: "mgmt-sentinel",
      title: "Sentinel · Defender for Cloud",
      detail: "Detections across every subscription",
      icon: "sentinel",
    },
    {
      id: "mgmt-nw",
      title: "Network Watcher",
      detail: "Next hop · connection troubleshoot",
      icon: "network-watcher",
    },
  ];
  const mgmtW = (azureW - M * 2 - 24 * (mgmtItems.length - 1)) / mgmtItems.length;
  mgmtItems.forEach((item, i) =>
    part({
      ...item,
      x: M + i * (mgmtW + 24),
      y: MGMT_Y,
      w: mgmtW,
      h: 62,
    }),
  );

  type Row = {
    id: string;
    title: string;
    detail: string;
    tag?: string | undefined;
    icon: Icon;
    present: boolean;
  };
  const hubRows = (hub: 1 | 2): Row[] => {
    const p = hub === 1 ? "hub" : "hub2";
    const base = hub === 1 ? "10.0.0" : "10.1.0";
    if (t.mode === "hub") {
      const fw = sub(`${p}-fw`);
      return [
        {
          id: `${p}-fw`,
          title: `Azure Firewall ${t.firewall?.sku ?? ""}`.trim(),
          detail: `AzureFirewallSubnet ${base}.64/26 · ${base}.68`,
          tag: fw?.routeTable ? `${fw.routeTable.name}: 0.0.0.0/0 → Internet` : undefined,
          icon: "firewall",
          present: !!fw,
        },
        {
          id: `${p}-bastion`,
          title: "Azure Bastion",
          detail: `AzureBastionSubnet ${base}.0/26`,
          icon: "bastion",
          present: !!sub(`${p}-bastion`),
        },
        {
          id: `${p}-gw`,
          title: gwTitle(t),
          detail: `GatewaySubnet ${base}.192/27 · Int-0 / Int-1`,
          tag:
            hub === 1 && t.firewall && t.gateway
              ? "rt-hub-gateway: each added spoke → firewall"
              : undefined,
          icon: "vnet-gateway",
          present: !!sub(`${p}-gw`),
        },
        {
          id: `${p}-dns`,
          title: "DNS Private Resolver",
          detail: `Inbound ${base}.228 · ${base}.224/28`,
          icon: "dns-resolver",
          present: !!sub(`${p}-dns`),
        },
      ];
    }
    return [
      {
        id: hub === 1 ? "vhub-fw" : "vhub2-fw",
        title: "Azure Firewall (secured hub)",
        detail: t.routingIntent ? "Routing intent: internet + private" : "No routing intent",
        icon: "firewall",
        present: !!t.firewall,
      },
      {
        id: hub === 1 ? "hub-router" : "hub2-router",
        title: "Hub router",
        detail: t.routingIntent
          ? "Default route table → firewall"
          : "Default route table · any-to-any",
        icon: "virtual-router",
        present: true,
      },
      {
        id: hub === 1 ? "vhub-gw" : "vhub2-gw",
        title: gwTitle(t),
        detail: "Zone-redundant hub gateways",
        icon: "vnet-gateway",
        present: !!t.gateway,
      },
      ...(hub === 1 && sub("sidecar-bastion")
        ? [
            {
              id: "sidecar-bastion",
              title: "Azure Bastion (sidecar VNet)",
              detail: "10.0.8.0/26 · IP-based connection",
              icon: "bastion" as Icon,
              present: true,
            },
          ]
        : []),
    ];
  };

  const hubExists = t.mode !== "none";
  const hubCount = hubExists && t.regions.secondary ? 2 : 1;
  const hubFrameW = hubCount === 2 ? Math.min(420, (azureW - M * 2 - 28) / 2) : 520;
  const hubStartX = M + (azureW - M * 2 - (hubFrameW * hubCount + 28 * (hubCount - 1))) / 2;
  const drawHub = (hub: 1 | 2, x: number) => {
    const exists = hubExists && (hub === 1 || !!t.regions.secondary);
    const rows = exists ? hubRows(hub) : [];
    const frameH = HEAD + Math.max(rows.length, 3) * (PART.h + GAP) + 8;
    const label = exists
      ? `${t.mode === "vwan" ? "Virtual WAN hub" : "Hub VNet"} · ${hub === 1 ? t.regions.primary : t.regions.secondary}`
      : hub === 1
        ? "No central network"
        : "No hub in a second region";
    nodes.push({
      id: `frame:${hub === 1 ? "hub" : "hub2"}`,
      kind: "frame",
      zoneKind: t.mode === "vwan" ? "band" : "vnet",
      x,
      y: HUB_Y,
      w: hubFrameW,
      h: frameH,
      title: label,
      detail: exists
        ? `${hub === 1 ? "Primary" : "Secondary"} region${t.mode === "hub" ? ` · ${vnet(hub === 1 ? "hub" : "hub2")?.cidr ?? "10.0.0.0/22"}` : ""}`
        : "A regional outage takes everything down",
      icon: t.mode === "vwan" ? "vwan-hub" : "vnet",
      dashed: t.mode !== "vwan",
      absent: !exists,
      down: hub === 1 && regionDown,
      layer: 2,
    });
    rows.forEach((r, i) =>
      part({
        id: r.id,
        x: x + 14,
        y: HUB_Y + HEAD + i * (PART.h + GAP),
        w: hubFrameW - 28,
        title: r.present
          ? r.title
          : r.id.includes("fw")
            ? "No firewall"
            : r.id.includes("gw")
              ? "No gateway"
              : `No ${r.title}`,
        detail: r.detail,
        tag: r.tag,
        icon: r.icon,
        absent: !r.present,
        down: hub === 1 && regionDown,
        failed: failure === "zone" && ["firewall", "vnet-gateway"].includes(r.icon),
      }),
    );
    return HUB_Y + frameH;
  };
  const hubBottom = Math.max(
    drawHub(1, hubStartX),
    hubCount === 2 ? drawHub(2, hubStartX + hubFrameW + 28) : HUB_Y,
  );
  if (hubExists && t.regions.secondary)
    edges.push({
      id: "global",
      source: "frame:hub",
      target: "frame:hub2",
      kind: "global",
      label: t.mode === "hub" ? "Global VNet peering" : "Hub-to-hub",
      down: regionDown,
    });

  const framedSpoke = (id: string, x: number, y: number, chip?: TNode["chip"]) => {
    const v = vnet(id)!;
    const rows = t.subnets.filter((s) => s.vnet === id);
    const h = HEAD + rows.length * (PART.h + GAP) + 8;
    const online = t.onlines.includes(id);
    nodes.push({
      id: `frame:${id}`,
      kind: "frame",
      zoneKind: "vnet",
      x,
      y,
      w: FRAME_W,
      h,
      title: `${v.name} · ${v.cidr}`,
      detail: online
        ? "Online install · public entry · not peered"
        : t.mode === "hub"
          ? `Corp spoke · peered to hub${v.useRemoteGateways ? " · remote gateways" : ""}`
          : t.mode === "vwan"
            ? "Corp spoke · Virtual WAN connection"
            : "Corp spoke · standalone network",
      icon: "vnet",
      dashed: true,
      chip,
      down: regionDown && !online,
      layer: 2,
    });
    rows.forEach((s, i) =>
      part({
        id: s.id,
        x: x + 14,
        y: y + HEAD + i * (PART.h + GAP),
        w: FRAME_W - 28,
        title: subnetTitle(s.name),
        detail: `${s.name} · ${s.cidr} · ${s.ip}`,
        tag: s.routeTable
          ? `${s.routeTable.name}: 0.0.0.0/0 → firewall`
          : s.publicIp
            ? `public IP ${s.publicIp}`
            : s.private
              ? "private subnet · no route table"
              : undefined,
        icon: subnetIcon(s.name),
        down: regionDown && !online,
      }),
    );
    return h;
  };

  const spokesY = hubBottom + ROW_GAP + 30;
  const spokeRowH = new Map<number, number>();
  spokeIds.forEach((id, i) => {
    const col = i % spokeCols;
    const row = Math.floor(i / spokeCols);
    const x = M + col * (FRAME_W + COL_GAP);
    const prevRows = Array.from({ length: row }, (_, r) => spokeRowH.get(r) ?? 0).reduce(
      (a, b) => a + b + ROW_GAP,
      0,
    );
    const y = spokesY + prevRows;
    const h = framedSpoke(
      id,
      x,
      y,
      i === 0
        ? { text: "Landing-zone spokes", fill: "#1d4ed8" }
        : t.onlines.includes(id) && !t.onlines.includes(spokeIds[i - 1] ?? "")
          ? { text: "Online spokes", fill: "#b45309" }
          : undefined,
    );
    spokeRowH.set(row, Math.max(spokeRowH.get(row) ?? 0, h));
    if (t.mode !== "none" && t.corp.includes(id))
      edges.push({
        id: `peer:${id}`,
        source: `frame:${id}`,
        target: "frame:hub",
        kind: "peering",
        label: t.mode === "hub" ? "Peering" : "Connection",
        down: regionDown,
      });
  });
  const spokeRows = Math.max(1, Math.ceil(spokeIds.length / spokeCols));
  const spokesBottom =
    spokesY +
    Array.from({ length: spokeRows }, (_, r) => spokeRowH.get(r) ?? 0).reduce(
      (a, b, i) => a + b + (i ? ROW_GAP : 0),
      0,
    );

  const hybridY = spokesBottom + 44;
  const erEver = !!t.gateway && (t.gateway.er || !!t.gateway.erDown);
  nodes.push({
    id: "frame:hybrid",
    kind: "frame",
    zoneKind: "band",
    x: M,
    y: hybridY,
    w: azureW - M * 2,
    h: erEver ? 116 : 72,
    title: erEver
      ? `Hybrid connectivity · ${t.gateway?.vpn ? "ExpressRoute + site-to-site VPN" : "ExpressRoute"}`
      : t.gateway?.vpn
        ? "Hybrid connectivity · site-to-site VPN"
        : "Hybrid connectivity · not connected",
    detail: "BGP routes and encrypted fallback live in this band",
    icon: "expressroute",
    layer: 1,
  });
  const gw1 = t.mode === "vwan" ? "vhub-gw" : "hub-gw";
  const gw2 = t.mode === "vwan" ? "vhub2-gw" : "hub2-gw";
  const mseeW = 252;
  const msee1X = hubStartX + 14;
  const msee2X = hubCount === 2 ? hubStartX + hubFrameW + 28 + 14 : msee1X + mseeW + 30;
  if (erEver) {
    part({
      id: "msee1",
      x: msee1X,
      y: hybridY + 42,
      w: mseeW,
      title: "MSEE · peering location 1",
      detail: "ExpressRoute circuit 1 · BFD",
      icon: "expressroute",
      failed: failure === "er",
    });
    part({
      id: "msee2",
      x: msee2X,
      y: hybridY + 42,
      w: mseeW,
      title: "MSEE · peering location 2",
      detail: "ExpressRoute circuit 2",
      icon: "expressroute",
      absent: !t.regions.secondary,
      failed: failure === "er" && !!t.regions.secondary,
    });
  }
  const azureH = hybridY + (erEver ? 116 : 72) + 26 - AZURE_Y;
  nodes.unshift({
    id: "frame:azure",
    kind: "frame",
    zoneKind: "azure",
    x: 0,
    y: AZURE_Y,
    w: azureW,
    h: azureH,
    title: "Microsoft Azure",
    detail: `${t.regions.primary}${t.regions.secondary ? ` + ${t.regions.secondary}` : ""} landing-zone estate`,
    icon: "subscription",
    down: regionDown,
    layer: 0,
  });

  const onpremY = AZURE_Y + azureH + 26;
  nodes.push({
    id: "frame:onprem",
    kind: "frame",
    zoneKind: "onprem",
    x: 0,
    y: onpremY,
    w: azureW,
    h: 132,
    title: "On-premises",
    detail: t.onPremRanges.join(", ") || "No ranges listed",
    icon: "on-premises",
    layer: 0,
  });
  part({
    id: "onprem",
    x: msee1X,
    y: onpremY + 50,
    w: mseeW,
    title: "DC-1 · on-premises",
    detail: `${t.onPrem} (example)`,
    icon: "on-premises",
    absent: !t.gateway,
  });
  part({
    id: "onprem2",
    x: msee2X,
    y: onpremY + 50,
    w: mseeW,
    title: "DC-2 · on-premises",
    detail: "192.168.20.0/24 (example)",
    icon: "on-premises",
    absent: !t.gateway || !t.regions.secondary,
  });

  if (erEver && has(gw1)) {
    edges.push({
      id: "er1",
      source: "msee1",
      target: gw1,
      kind: "er",
      label: "ER connection",
      down: failure === "er" || regionDown,
    });
    edges.push({
      id: "dc1-msee",
      source: "onprem",
      target: "msee1",
      kind: "link",
      label: "1 Gbps",
      down: failure === "er",
    });
    if (t.regions.secondary && has(gw2)) {
      edges.push({
        id: "er2",
        source: "msee2",
        target: gw2,
        kind: "er",
        label: "ER connection",
        down: failure === "er",
      });
      edges.push({
        id: "dc2-msee",
        source: "onprem2",
        target: "msee2",
        kind: "link",
        label: "1 Gbps",
        down: failure === "er",
      });
      edges.push({
        id: "bgp12",
        source: "msee1",
        target: gw2,
        kind: "bgp",
        label: "BGP",
        down: failure === "er",
      });
      edges.push({
        id: "bgp21",
        source: "msee2",
        target: gw1,
        kind: "bgp",
        label: "BGP",
        down: failure === "er" || regionDown,
      });
    }
  }
  if (t.gateway?.vpn && has(gw1))
    edges.push({
      id: "vpn1",
      source: "onprem",
      target: gw1,
      kind: "ipsec",
      label: "VPN IPsec",
      down: regionDown,
    });
  if (t.gateway?.vpn && t.regions.secondary && has(gw2))
    edges.push({ id: "vpn2", source: "onprem2", target: gw2, kind: "ipsec", label: "VPN IPsec" });
  if (t.gateway && t.regions.secondary)
    edges.push({ id: "wan", source: "onprem", target: "onprem2", kind: "wan", label: "WAN" });
  if (t.gateway?.vpn && has(gw1))
    edges.push({
      id: "p2s",
      source: "remote",
      target: gw1,
      kind: "p2s",
      label: "P2S (not configured)",
    });

  return { nodes, edges, width: azureW, height: onpremY + 132 };
}
