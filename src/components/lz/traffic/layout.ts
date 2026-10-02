/*
 * Where everything sits on the traffic canvas, computed from the routing topology: the internet on top, Online
 * installs under it, the Connectivity subscription (primary and secondary hubs) in the middle, every Corp spoke on
 * the left (one or two columns), platform services on the right, and ExpressRoute / VPN down to the data centers.
 * Positions are absolute and fixed-size, so the drawing is the same every time and exports cleanly to draw.io.
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
  defender: "security/Security_Center.svg",
  "network-watcher": "networking/Network_Watcher.svg",
  "vwan-hub": "networking/Virtual_WAN_Hub.svg",
  "virtual-router": "networking/Virtual_Router.svg",
  "local-gateway": "networking/Local_Network_Gateways.svg",
  "on-premises": "networking/On_Premises_Data_Gateways.svg",
  "dns-zones": "networking/DNS_Zones.svg",
  users: "identity/Users.svg",
  subscription: "general/Subscriptions.svg",
  monitor: "management_governance/Monitor.svg",
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
};
export type TEdge = {
  id: string;
  source: string;
  target: string;
  kind: "peering" | "global" | "er" | "bgp" | "ipsec" | "wan" | "link" | "p2s";
  label?: string | undefined;
  down?: boolean | undefined;
};

export const PART = { w: 284, h: 72 };
const FRAME_W = PART.w + 28;
const HEAD = 56;
const GAP = 8;

function gwTitle(t: Topology) {
  if (!t.gateway) return "Gateway";
  const er = t.gateway.er || t.gateway.erDown;
  return `${er ? "ExpressRoute" : ""}${er && t.gateway.vpn ? " + " : ""}${t.gateway.vpn ? "VPN" : ""} gateway`;
}

export function trafficLayout(t: Topology, failure: Failure) {
  const nodes: TNode[] = [];
  const edges: TEdge[] = [];
  const regionDown = failure === "region";
  const sub = (id: string) => t.subnets.find((s) => s.id === id);
  const part = (n: Omit<TNode, "kind" | "w" | "h"> & { w?: number }) =>
    nodes.push({ kind: "part", w: n.w ?? PART.w, h: PART.h, ...n });
  const framedSpoke = (id: string, x: number, y: number, chip?: TNode["chip"]) => {
    const v = t.vnets.find((z) => z.id === id)!;
    const rows = t.subnets.filter((s) => s.vnet === id);
    const h = HEAD + rows.length * (PART.h + GAP) + 4;
    const online = t.onlines.includes(id);
    nodes.push({
      id: `frame:${id}`,
      kind: "frame",
      x,
      y,
      w: FRAME_W,
      h,
      title: `${v.name} · ${v.cidr}`,
      detail: online
        ? "Online install · not peered · own public entry"
        : t.mode === "hub"
          ? `Corp · peered to the hub${v.useRemoteGateways ? " · uses its gateway" : ""}`
          : t.mode === "vwan"
            ? "Corp · hub connection"
            : "Corp · standalone network",
      icon: "vnet",
      fill: online ? "#f1f8f3" : "#fdf3ea",
      stroke: online ? "#9fd1ae" : "#e7c29d",
      chip,
      down: regionDown,
    });
    rows.forEach((s, i) =>
      part({
        id: s.id,
        x: x + 14,
        y: y + HEAD + i * (PART.h + GAP),
        title:
          s.name === "snet-appgw"
            ? "Application Gateway WAF v2"
            : s.name.includes("private")
              ? "Private endpoint"
              : "Workload VM",
        detail: `${s.name} · ${s.cidr} · ${s.ip}`,
        tag: s.routeTable
          ? `${s.routeTable.name}: 0.0.0.0/0 → firewall`
          : s.publicIp
            ? `public IP ${s.publicIp}`
            : s.private
              ? "private subnet · no route table"
              : undefined,
        icon:
          s.name === "snet-appgw"
            ? "app-gateway"
            : s.name.includes("private")
              ? "private-endpoint"
              : "vm",
        down: regionDown,
      }),
    );
    return h;
  };

  /* Column positions */
  const corpCols = t.corp.length > 4 ? 2 : 1;
  const leftW = corpCols * (FRAME_W + 16) + 16;
  const connX = leftW + 52;
  const hubW = FRAME_W;
  const connW = hubW * 2 + 56 + 32;
  const rightX = connX + connW + 34;
  const rightW = 286;
  const totalW = rightX + rightW;

  nodes.push({
    id: "internet",
    kind: "cloud",
    x: 40,
    y: 0,
    w: totalW - 80,
    h: 74,
    title: "Internet",
  });

  /* Online installs, just under the internet */
  let y = 124;
  if (t.onlines.length) {
    const rowW = t.onlines.length * (FRAME_W + 18) - 18;
    let x = connX + connW / 2 - rowW / 2;
    let maxH = 0;
    t.onlines.forEach((id, i) => {
      maxH = Math.max(
        maxH,
        framedSpoke(
          id,
          x,
          y,
          i === 0 ? { text: "Online subscriptions", fill: "#fde2b8" } : undefined,
        ),
      );
      x += FRAME_W + 18;
    });
    y += maxH + 76;
  }

  /* Connectivity subscription: the hubs */
  const connY = y;
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
  const drawHub = (hub: 1 | 2, x: number) => {
    const exists = t.mode !== "none" && (hub === 1 || !!t.regions.secondary);
    const rows = exists ? hubRows(hub) : [];
    const h = HEAD + Math.max(rows.length, 4) * (PART.h + GAP) + 4;
    nodes.push({
      id: `frame:${hub === 1 ? "hub" : "hub2"}`,
      kind: "frame",
      x,
      y: connY + 44,
      w: hubW,
      h,
      title: exists
        ? `${t.mode === "vwan" ? "Virtual WAN hub" : "Hub VNet"} · ${hub === 1 ? t.regions.primary : t.regions.secondary}`
        : hub === 1
          ? "No central network"
          : "No hub in a second region",
      detail: exists
        ? `${hub === 1 ? "Primary" : "Secondary"} region${t.mode === "hub" ? ` · ${hub === 1 ? "10.0.0.0/22" : "10.1.0.0/22"}` : ""}`
        : "A regional outage takes everything down",
      icon: t.mode === "vwan" ? "vwan-hub" : "vnet",
      fill: hub === 1 ? "#edf6e6" : "#f8e6e6",
      stroke: hub === 1 ? "#a3c98a" : "#dba7a7",
      dashed: !exists,
      down: hub === 1 && regionDown,
    });
    rows.forEach((r, i) =>
      part({
        id: r.id,
        x: x + 14,
        y: connY + 44 + HEAD + i * (PART.h + GAP),
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
      }),
    );
    return connY + 44 + h;
  };
  const h1 = drawHub(1, connX + 20);
  const h2 = drawHub(2, connX + 20 + hubW + 56);
  const connBottom = Math.max(h1, h2) + 20;
  nodes.unshift({
    id: "frame:connectivity",
    kind: "frame",
    x: connX,
    y: connY,
    w: connW,
    h: connBottom - connY,
    title: "",
    fill: "#e3efd6",
    stroke: "#b9d3a0",
    chip: { text: "Connectivity subscription", fill: "#d4c6ee" },
  });
  if (t.mode !== "none" && t.regions.secondary)
    edges.push({
      id: "global",
      source: "frame:hub",
      target: "frame:hub2",
      kind: "global",
      label: t.mode === "hub" ? "Global VNet peering" : "Hub-to-hub",
      down: regionDown,
    });

  /* Corp spokes (Prod) on the left */
  const perCol = Math.ceil(t.corp.length / corpCols) || 1;
  let corpBottom = connY;
  t.corp.forEach((id, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const fy = connY + row * (HEAD + 2 * (PART.h + GAP) + 4 + 22);
    const fh = framedSpoke(
      id,
      20 + col * (FRAME_W + 16),
      fy,
      i === 0 ? { text: "Prod subscriptions", fill: "#f5cfa6" } : undefined,
    );
    corpBottom = Math.max(corpBottom, fy + fh);
    if (t.mode !== "none")
      edges.push({
        id: `peer:${id}`,
        source: `frame:${id}`,
        target: "frame:hub",
        kind: "peering",
        label: t.mode === "hub" ? "Peering" : "Connection",
        down: regionDown,
      });
  });

  /* Platform, DR installs, management on the right */
  part({
    id: "azure-dns",
    x: rightX,
    y: connY + 44,
    w: rightW,
    title: "Azure platform",
    detail: "Azure DNS 168.63.129.16 · privatelink zones · Azure Monitor",
    icon: "dns-zones",
  });
  if (t.regions.secondary || failure === "region")
    part({
      id: "dr-installs",
      x: rightX,
      y: connY + 44 + PART.h + 16,
      w: rightW,
      title: t.regions.secondary
        ? `Installs in ${t.regions.secondary}`
        : "Installs in a second region",
      detail: "None deployed yet — nothing to fail over to",
      icon: "vm",
      absent: true,
    });
  const mgY = connY + 44 + 2 * (PART.h + 16);
  nodes.push({
    id: "frame:mgmt",
    kind: "frame",
    x: rightX,
    y: mgY,
    w: rightW,
    h: HEAD + 3 * (PART.h + GAP) + 4,
    title: "Management & security",
    detail: "Shared services subscription",
    icon: "subscription",
    fill: "#f2effa",
    stroke: "#c9b9e8",
  });
  (
    [
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
        detail: "Next hop · connection troubleshoot · flow logs",
        icon: "network-watcher",
      },
    ] as const
  ).forEach((p, i) =>
    part({ ...p, x: rightX + 14, y: mgY + HEAD + i * (PART.h + GAP), w: rightW - 28 }),
  );

  /* ExpressRoute edge and the data centers */
  const erEver = !!t.gateway && (t.gateway.er || !!t.gateway.erDown);
  const gw1 = t.mode === "vwan" ? "vhub-gw" : "hub-gw";
  const gw2 = t.mode === "vwan" ? "vhub2-gw" : "hub2-gw";
  const has = (id: string) => nodes.some((n) => n.id === id && !n.absent);
  const bottom = Math.max(connBottom, corpBottom) + 70;
  const x1 = connX + 20 + 14;
  const x2 = connX + 20 + hubW + 56 + 14;
  if (erEver) {
    part({
      id: "msee1",
      x: x1,
      y: bottom,
      title: "MSEE · peering location 1",
      detail: "ExpressRoute circuit 1 · BFD",
      icon: "expressroute",
      failed: failure === "er",
    });
    part({
      id: "msee2",
      x: x2,
      y: bottom,
      title: "MSEE · peering location 2",
      detail: "ExpressRoute circuit 2",
      icon: "expressroute",
      absent: !t.regions.secondary,
      failed: failure === "er" && !!t.regions.secondary,
    });
  }
  const dcY = bottom + (erEver ? 130 : 20);
  part({
    id: "onprem",
    x: x1,
    y: dcY,
    title: "DC-1 · on-premises",
    detail: `${t.onPrem} (example)`,
    icon: "on-premises",
    absent: !t.gateway,
  });
  part({
    id: "onprem2",
    x: x2,
    y: dcY,
    title: "DC-2 · on-premises",
    detail: "192.168.20.0/24 (example)",
    icon: "on-premises",
    absent: !t.gateway || !t.regions.secondary,
  });
  if (t.gateway?.vpn)
    part({
      id: "remote",
      x: 20,
      y: dcY,
      title: "Remote engineers",
      detail: "Point-to-site VPN · not configured",
      icon: "users",
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

  return { nodes, edges, width: totalW, height: dcY + PART.h };
}
