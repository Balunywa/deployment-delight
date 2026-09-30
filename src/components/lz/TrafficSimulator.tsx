/*
 * End-to-end traffic, drawn like an Azure network logical architecture: the internet and the Online installs on
 * top, the Connectivity subscription with the primary and secondary hubs (global peering) in the middle, Corp
 * installs and platform services on either side, and ExpressRoute / VPN down to the data centers. Every traffic
 * type is drawn at once in its legend colour; pick one to step a packet through it hop by hop — effective
 * routes, NSG and firewall decisions, and the reply. Fail an ExpressRoute circuit, a zone or the primary region
 * to see what reroutes and what breaks.
 */
import {
  BrickWall,
  Building2,
  Cable,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Globe,
  Laptop,
  Lock,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Router,
  Shield,
  Signpost,
  SquareTerminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Answers } from "@/lib/alz/engine";
import {
  type Failure,
  type SimHop,
  type SimResult,
  type Topology,
  type TrafficKind,
  simulate,
  topology,
} from "@/lib/alz/routing";
import type { SceneExtra, Spoke } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

type Box = { x: number; y: number; w: number; h: number };
type El = Box & {
  id: string;
  title: string;
  detail?: string | undefined;
  tag?: string | undefined;
  icon?: LucideIcon | undefined;
  tone?: string | undefined;
  kind: "row" | "ext" | "band" | "cloud";
  absent?: boolean | undefined;
  down?: boolean | undefined;
};
type Frame = Box & {
  id: string;
  title: string;
  sub?: string | undefined;
  fill: string;
  stroke: string;
  dashed?: boolean | undefined;
  chip?: { text: string; fill: string } | undefined;
  down?: boolean | undefined;
};
type Link = {
  d: string;
  label?: string | undefined;
  lx?: number;
  ly?: number;
  color: string;
  dash?: string | undefined;
  width?: number;
  arrows?: boolean;
  down?: boolean;
};

const W = 1200;

/** The legend: one colour and line style per kind of traffic (after the classic hub-and-spoke HA/DR drawings). */
const KIND_STYLE: Record<TrafficKind, { label: string; color: string; dash?: string }> = {
  egress: { label: "HTTPS egress", color: "#e81123", dash: "9 6" },
  ingress: { label: "HTTPS ingress", color: "#e3a008", dash: "9 6" },
  internal: { label: "Internal flow", color: "#16a34a", dash: "12 5" },
  "private-endpoint": { label: "Private endpoint", color: "#2f7fd8", dash: "12 5" },
  ipsec: { label: "IPsec traffic", color: "#8661c5", dash: "6 5" },
  management: { label: "Admin (Bastion)", color: "#0d9488", dash: "10 5" },
  monitoring: { label: "Monitoring data", color: "#a855f7", dash: "4 5" },
  failover: { label: "Failover", color: "#e3008c", dash: "10 4" },
};

function layout(t: Topology, failure: Failure) {
  const els = new Map<string, El>();
  const frames: Frame[] = [];
  const links: Link[] = [];
  const add = (e: El) => els.set(e.id, e);
  const sub = (id: string) => t.subnets.find((s) => s.id === id);
  const regionDown = failure === "region";
  add({ id: "internet", x: 60, y: 6, w: W - 120, h: 60, title: "Internet", kind: "cloud" });

  // Online installs (internet-facing) sit just under the internet.
  let top = 96;
  if (t.online) {
    const v = t.vnets.find((x) => x.id === t.online)!;
    const fx = 440;
    const fw = 320;
    const rows = t.subnets.filter((s) => s.vnet === t.online);
    frames.push({
      id: `frame:${t.online}`,
      x: fx,
      y: top,
      w: fw,
      h: 48 + rows.length * 58,
      title: `${v.name} · ${v.cidr}`,
      sub: "Online install · not peered, own public entry",
      fill: "#f3faf5",
      stroke: "#8cc9a0",
      chip: { text: "Online subscription", fill: "#fde7c4" },
      down: regionDown,
    });
    rows.forEach((s, i) =>
      add({
        id: s.id,
        x: fx + 12,
        y: top + 48 + i * 58,
        w: fw - 24,
        h: 50,
        title: `${s.name} · ${s.cidr}`,
        detail: `${s.what} · ${s.ip}${s.publicIp ? ` · public ${s.publicIp}` : ""}`,
        icon: s.name === "snet-appgw" ? Shield : s.name.includes("private") ? Lock : Monitor,
        tone:
          s.name === "snet-appgw" ? "#e3a008" : s.name.includes("private") ? "#2f7fd8" : "#0078d4",
        kind: "row",
        down: regionDown,
      }),
    );
    top += 48 + rows.length * 58 + 34;
  } else top += 30;

  // Connectivity subscription: the hubs.
  const cx = 330;
  const cw = 540;
  const cy = top;
  const hw = 244;
  const hubRow = (
    id: string,
    x: number,
    y: number,
    title: string,
    detail: string,
    icon: LucideIcon,
    tone: string,
    present: boolean,
    tag?: string,
    down?: boolean,
  ) =>
    add({
      id,
      x,
      y,
      w: hw - 20,
      h: 54,
      title,
      detail,
      icon,
      tone,
      tag,
      kind: "row",
      absent: !present,
      down,
    });
  const rowsFor = (hub: 1 | 2) => {
    const p = hub === 1 ? "hub" : "hub2";
    const base = hub === 1 ? "10.0.0" : "10.1.0";
    if (t.mode === "hub")
      return [
        [
          `${p}-fw`,
          `Azure Firewall · ${base}.68`,
          `AzureFirewallSubnet ${base}.64/26 · zone-redundant`,
          BrickWall,
          "#d13438",
          !!sub(`${p}-fw`),
          sub(`${p}-fw`) ? `${sub(`${p}-fw`)!.routeTable?.name}: 0.0.0.0/0 → Internet` : undefined,
        ],
        [
          `${p}-bastion`,
          "Azure Bastion",
          `AzureBastionSubnet ${base}.0/26`,
          SquareTerminal,
          "#038387",
          !!sub(`${p}-bastion`),
          undefined,
        ],
        [
          `${p}-gw`,
          `${t.gateway?.er || (t.gateway?.erDown && hub) ? "ExpressRoute" : ""}${(t.gateway?.er || t.gateway?.erDown) && t.gateway?.vpn ? " + " : ""}${t.gateway?.vpn ? "VPN" : ""} gateway`.trim() ||
            "Gateway",
          `GatewaySubnet ${base}.192/27 · Int-0 / Int-1`,
          Cable,
          "#8661c5",
          !!sub(`${p}-gw`),
          hub === 1 && t.firewall && t.gateway
            ? "rt-hub-gateway: each added spoke → firewall"
            : undefined,
        ],
        [
          `${p}-dns`,
          `DNS Private Resolver · ${base}.228`,
          `Inbound endpoint ${base}.224/28`,
          Signpost,
          "#0078d4",
          !!sub(`${p}-dns`),
          undefined,
        ],
      ] as const;
    return [
      [
        hub === 1 ? "vhub-fw" : "vhub2-fw",
        "Azure Firewall (secured hub)",
        t.routingIntent ? "Routing intent: internet + private" : "No firewall: no routing intent",
        BrickWall,
        "#d13438",
        !!t.firewall,
        undefined,
      ],
      [
        hub === 1 ? "hub-router" : "hub2-router",
        "Hub router",
        t.routingIntent ? "Default route table → firewall" : "Default route table: any-to-any",
        Workflow,
        "#0078d4",
        true,
        undefined,
      ],
      [
        hub === 1 ? "vhub-gw" : "vhub2-gw",
        "Hub gateways",
        t.gateway
          ? `${t.gateway.er || t.gateway.erDown ? "ExpressRoute" : ""}${(t.gateway.er || t.gateway.erDown) && t.gateway.vpn ? " + " : ""}${t.gateway.vpn ? "VPN" : ""} · zone-redundant`
          : "No gateway",
        Cable,
        "#8661c5",
        !!t.gateway,
        undefined,
      ],
      ...(hub === 1 && sub("sidecar-bastion")
        ? ([
            [
              "sidecar-bastion",
              "Azure Bastion (sidecar VNet)",
              "10.0.8.0/26 · connected to the hub",
              SquareTerminal,
              "#038387",
              true,
              undefined,
            ],
          ] as const)
        : []),
    ] as const;
  };
  const drawHub = (hub: 1 | 2, x: number) => {
    const exists = hub === 1 ? t.mode !== "none" : !!t.regions.secondary && t.mode !== "none";
    const region = hub === 1 ? t.regions.primary : (t.regions.secondary ?? "second region");
    const rows = exists ? rowsFor(hub) : [];
    const h = 44 + Math.max(rows.length, 4) * 62;
    frames.push({
      id: `frame:${hub === 1 ? "hub" : "hub2"}`,
      x,
      y: cy + 34,
      w: hw,
      h,
      title: exists
        ? `${t.mode === "vwan" ? "Virtual WAN hub" : "Hub VNet"} · ${hub === 1 ? "primary" : "secondary"}`
        : "No hub in a second region",
      sub: exists
        ? `${region}${t.mode === "hub" ? ` · ${hub === 1 ? "10.0.0.0/22" : "10.1.0.0/22"}` : ""}`
        : "A regional outage takes everything down",
      fill: hub === 1 ? "#eef6e9" : "#f6e3e3",
      stroke: hub === 1 ? "#a7c98f" : "#d9a6a6",
      dashed: !exists,
      down: hub === 1 && regionDown,
    });
    rows.forEach((r, i) =>
      hubRow(
        r[0],
        x + 10,
        cy + 34 + 44 + i * 62,
        r[1],
        r[2],
        r[3],
        r[4],
        r[5],
        r[6],
        hub === 1 && regionDown,
      ),
    );
    return cy + 34 + h;
  };
  const b1 = drawHub(1, cx + 14);
  const b2 = drawHub(2, cx + cw - 14 - hw);
  const hubBottom = Math.max(b1, b2);
  frames.unshift({
    id: "frame:connectivity",
    x: cx,
    y: cy,
    w: cw,
    h: hubBottom - cy + 14,
    title: "",
    fill: "#dfeccf",
    stroke: "#b5cf9c",
    chip: { text: "Connectivity subscription", fill: "#c9b8e8" },
  });
  if (t.regions.secondary && t.mode !== "none") {
    const fy = (els.get(t.mode === "hub" ? "hub-fw" : "vhub-fw")?.y ?? cy + 80) + 27;
    links.push({
      d: `M${cx + 14 + hw},${fy} H${cx + cw - 14 - hw}`,
      label: t.mode === "hub" ? "Global peering" : "Hub-to-hub",
      lx: cx + cw / 2,
      ly: fy - 8,
      color: "#1b1b1b",
      width: 1.6,
      arrows: true,
      down: regionDown,
    });
  }

  // Corp installs (Prod) on the left, peered to the primary hub.
  let ly = cy;
  for (const id of [t.corpA, t.corpB].filter(Boolean) as string[]) {
    const v = t.vnets.find((x) => x.id === id)!;
    const rows = t.subnets.filter((s) => s.vnet === id);
    const fh = 48 + rows.length * 58;
    frames.push({
      id: `frame:${id}`,
      x: 20,
      y: ly,
      w: 290,
      h: fh,
      title: `${v.name} · ${v.cidr}`,
      sub:
        t.mode === "hub"
          ? "Corp install · peered to the hub"
          : t.mode === "vwan"
            ? "Corp install · hub connection"
            : "Corp install",
      fill: "#fbefe3",
      stroke: "#e2b98f",
      chip: ly === cy ? { text: "Prod subscriptions", fill: "#f3c9a0" } : undefined,
      down: regionDown,
    });
    rows.forEach((s, i) =>
      add({
        id: s.id,
        x: 32,
        y: ly + 48 + i * 58,
        w: 266,
        h: 50,
        title: `${s.name} · ${s.cidr}`,
        detail: `${s.what} · ${s.ip}`,
        tag: s.routeTable
          ? `${s.routeTable.name}: 0.0.0.0/0 → firewall`
          : s.private
            ? "private subnet · no route table"
            : undefined,
        icon: s.name.includes("private") ? Lock : Monitor,
        tone: s.name.includes("private") ? "#2f7fd8" : "#0078d4",
        kind: "row",
        down: regionDown,
      }),
    );
    // Peering (or hub connection) to the primary hub.
    const hubEdge = cx + 14;
    const my = ly + fh / 2;
    if (t.mode !== "none")
      links.push({
        d: `M310,${my} H${hubEdge}`,
        label: t.mode === "hub" ? "Peering" : "Connection",
        lx: (310 + hubEdge) / 2,
        ly: my - 6,
        color: "#1b1b1b",
        width: 1.4,
        arrows: true,
        down: regionDown,
      });
    ly += fh + 16;
  }

  // Platform services and the DR installs on the right.
  const rx = 890;
  const rw = W - 20 - rx;
  add({
    id: "azure-dns",
    x: rx,
    y: cy,
    w: rw,
    h: 64,
    title: "Azure platform",
    detail: "Azure DNS 168.63.129.16 · privatelink zones · Azure Monitor ingestion",
    icon: Cloud,
    tone: "#0078d4",
    kind: "ext",
  });
  if (t.regions.secondary || failure === "region")
    add({
      id: "dr-installs",
      x: rx,
      y: cy + 84,
      w: rw,
      h: 64,
      title: t.regions.secondary
        ? `Installs in ${t.regions.secondary}`
        : "Installs in a second region",
      detail: "None deployed yet — nothing to fail over to",
      icon: Monitor,
      tone: "#e3008c",
      kind: "ext",
      absent: true,
    });
  frames.push({
    id: "frame:support",
    x: rx,
    y: cy + 170,
    w: rw,
    h: 112,
    title: "Management & security",
    sub: "Log Analytics · Sentinel · Defender for Cloud · Network Watcher · firewall policy (Firewall Manager)",
    fill: "#f3f0fa",
    stroke: "#c5b3e6",
    dashed: true,
  });

  // On-premises: Microsoft edge (MSEE) at the peering location, then the data centers.
  const gw1 = els.get(t.mode === "vwan" ? "vhub-gw" : "hub-gw");
  const gw2 = els.get(t.mode === "vwan" ? "vhub2-gw" : "hub2-gw");
  const erEver = !!t.gateway && (t.gateway.er || !!t.gateway.erDown);
  const by = hubBottom + 44;
  const x1 = cx + 14;
  const x2 = cx + cw - 14 - hw;
  if (erEver) {
    add({
      id: "msee1",
      x: x1 + 10,
      y: by,
      w: hw - 20,
      h: 50,
      title: "MSEE · peering location 1",
      detail: "ExpressRoute circuit 1 (BFD)",
      icon: Router,
      tone: "#2f5bb7",
      kind: "ext",
      down: failure === "er",
    });
    add({
      id: "msee2",
      x: x2 + 10,
      y: by,
      w: hw - 20,
      h: 50,
      title: "MSEE · peering location 2",
      detail: "ExpressRoute circuit 2",
      icon: Router,
      tone: "#2f5bb7",
      kind: "ext",
      absent: !t.regions.secondary,
      down: failure === "er",
    });
  }
  const dy = by + (erEver ? 96 : 40);
  add({
    id: "onprem",
    x: x1 + 10,
    y: dy,
    w: hw - 20,
    h: 58,
    title: "DC-1 · on-premises",
    detail: `${t.onPrem} (example)`,
    icon: Building2,
    tone: "#605e5c",
    kind: "ext",
    absent: !t.gateway,
  });
  add({
    id: "onprem2",
    x: x2 + 10,
    y: dy,
    w: hw - 20,
    h: 58,
    title: "DC-2 · on-premises",
    detail: "192.168.20.0/24 (example)",
    icon: Building2,
    tone: "#605e5c",
    kind: "ext",
    absent: !t.gateway || !t.regions.secondary,
  });
  const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const erColor = "#2f5bb7";
  if (erEver && gw1) {
    const m1 = els.get("msee1")!;
    const m2 = els.get("msee2")!;
    links.push({
      d: `M${center(m1).x},${m1.y} V${gw1.y + gw1.h}`,
      label: "ER connection",
      lx: center(m1).x + 44,
      ly: (m1.y + gw1.y + gw1.h) / 2,
      color: erColor,
      width: 2,
      down: failure === "er",
    });
    links.push({
      d: `M${center(m1).x},${m1.y + m1.h} V${dy}`,
      label: "1 Gbps",
      lx: center(m1).x + 26,
      ly: m1.y + m1.h + 22,
      color: "#1b1b1b",
      width: 1.4,
      down: failure === "er",
    });
    if (t.regions.secondary && gw2) {
      links.push({
        d: `M${center(m2).x},${m2.y} V${gw2.y + gw2.h}`,
        label: "ER connection",
        lx: center(m2).x + 44,
        ly: (m2.y + gw2.y + gw2.h) / 2,
        color: erColor,
        width: 2,
        down: failure === "er",
      });
      links.push({
        d: `M${center(m2).x},${m2.y + m2.h} V${dy}`,
        label: "1 Gbps",
        lx: center(m2).x + 26,
        ly: m2.y + m2.h + 22,
        color: "#1b1b1b",
        width: 1.4,
        down: failure === "er",
      });
      // Bow-tie: each circuit also connects to the other region's gateway.
      links.push({
        d: `M${center(m1).x + 30},${m1.y} L${center(gw2).x - 30},${gw2.y + gw2.h}`,
        label: "BGP",
        lx: (center(m1).x + center(gw2).x) / 2 - 20,
        ly: (m1.y + gw2.y + gw2.h) / 2,
        color: erColor,
        width: 1.2,
        down: failure === "er",
      });
      links.push({
        d: `M${center(m2).x - 30},${m2.y} L${center(gw1).x + 30},${gw1.y + gw1.h}`,
        label: "BGP",
        lx: (center(m2).x + center(gw1).x) / 2 + 20,
        ly: (m2.y + gw1.y + gw1.h) / 2,
        color: erColor,
        width: 1.2,
        down: failure === "er",
      });
    }
  }
  const on1 = els.get("onprem")!;
  const on2 = els.get("onprem2")!;
  if (t.gateway?.vpn && gw1)
    links.push({
      d: `M${on1.x},${center(on1).y} H${on1.x - 26} V${center(gw1).y} H${gw1.x}`,
      label: "VPN IPsec",
      lx: on1.x - 26,
      ly: (center(on1).y + center(gw1).y) / 2,
      color: "#8661c5",
      dash: "6 5",
      width: 1.6,
    });
  if (t.gateway?.vpn && gw2 && t.regions.secondary)
    links.push({
      d: `M${on2.x + on2.w},${center(on2).y} H${on2.x + on2.w + 26} V${center(gw2).y} H${gw2.x + gw2.w}`,
      label: "VPN IPsec",
      lx: on2.x + on2.w + 26,
      ly: (center(on2).y + center(gw2).y) / 2,
      color: "#8661c5",
      dash: "6 5",
      width: 1.6,
    });
  if (t.gateway && t.regions.secondary)
    links.push({
      d: `M${on1.x + on1.w},${center(on1).y} H${on2.x}`,
      label: "WAN",
      lx: (on1.x + on1.w + on2.x) / 2,
      ly: center(on1).y - 6,
      color: "#605e5c",
      width: 1.2,
      arrows: true,
    });
  if (t.gateway?.vpn)
    add({
      id: "remote",
      x: 20,
      y: dy,
      w: 250,
      h: 58,
      title: "Remote engineers",
      detail: "Point-to-site VPN · not configured",
      icon: Laptop,
      tone: "#6d8bf7",
      kind: "ext",
    });
  return { els, frames, links, h: dy + 58 + 150 };
}

const mid = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** An orthogonal path from one element to the next. */
function segment(a: El, b: El): string | null {
  if (a.id === b.id) return null;
  if (a.kind === "cloud" || b.kind === "cloud") {
    const other = a.kind === "cloud" ? b : a;
    const cloudY = (a.kind === "cloud" ? a : b).y + (a.kind === "cloud" ? a : b).h - 8;
    const x = mid(other).x;
    return a.kind === "cloud" ? `M${x},${cloudY} V${other.y}` : `M${x},${other.y} V${cloudY}`;
  }
  const ac = mid(a);
  const bc = mid(b);
  if (b.x >= a.x + a.w || a.x >= b.x + b.w) {
    const sx = bc.x > ac.x ? a.x + a.w : a.x;
    const ex = bc.x > ac.x ? b.x : b.x + b.w;
    const mx = (sx + ex) / 2;
    return `M${sx},${ac.y} H${mx} V${bc.y} H${ex}`;
  }
  if (Math.abs(ac.x - bc.x) < 30) {
    const sy = bc.y > ac.y ? a.y + a.h : a.y;
    const ey = bc.y > ac.y ? b.y : b.y + b.h;
    return `M${ac.x},${sy} V${ey}`;
  }
  const lane = Math.min(a.x, b.x) - 10;
  return `M${a.x},${ac.y} H${lane} V${bc.y} H${b.x}`;
}

const VERDICT: Record<SimResult["verdict"]["status"], { label: string; cls: string }> = {
  reaches: { label: "Reaches", cls: "bg-[#dff6dd] text-[#107c10]" },
  "needs-rules": { label: "Needs a firewall rule", cls: "bg-[#fff4ce] text-[#8a6100]" },
  isolated: { label: "Isolated", cls: "bg-[#e5f1fb] text-[#0f6cbd]" },
  uninspected: { label: "Uninspected", cls: "bg-[#fff4ce] text-[#8a6100]" },
  broken: { label: "Doesn't work", cls: "bg-[#fde7e9] text-[#a4262c]" },
};
const RESULT_CLS: Record<string, string> = {
  allow: "text-[#107c10]",
  inspect: "text-[#0f6cbd]",
  deny: "text-[#a4262c]",
  "needs-rule": "text-[#8a6100]",
};
const FAILURES: [Failure, string, string][] = [
  ["none", "Everything up", "Normal operation"],
  ["er", "ExpressRoute circuit fails", "Does the VPN take over?"],
  ["zone", "An availability zone fails", "High availability inside the region"],
  ["region", "The primary region fails", "Disaster recovery to the second region"],
];

export function TrafficSimulator({
  answers,
  spokes,
  extras,
  initial,
  set,
}: {
  answers: Answers;
  spokes: Spoke[];
  extras: SceneExtra[];
  initial?: string | undefined;
  set?: ((p: Partial<Answers>) => void) | undefined;
}) {
  const [failure, setFailure] = useState<Failure>("none");
  const [allowRules, setAllowRules] = useState(true);
  const t = useMemo(
    () => topology(answers, { spokes, extras }, failure),
    [answers, spokes, extras, failure],
  );
  const sims = useMemo(() => simulate(t, answers, allowRules), [t, answers, allowRules]);
  const [id, setId] = useState<string>(initial ?? "all");
  const sim = id === "all" ? undefined : sims.find((s) => s.id === id);
  const hops = useMemo(
    () => [
      ...(sim?.forward ?? []).map((h) => ({ ...h, dir: "fwd" as const })),
      ...(sim?.back ?? []).map((h) => ({ ...h, dir: "back" as const })),
    ],
    [sim],
  );
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [allRoutes, setAllRoutes] = useState(false);
  useEffect(() => {
    setStep(0);
    setPlaying(true);
  }, [sim?.id, allowRules, answers, failure]);
  useEffect(() => {
    if (!sim || !playing || !hops.length) return;
    if (step >= hops.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), 1700);
    return () => clearTimeout(timer);
  }, [sim, playing, step, hops.length]);

  const g = useMemo(() => layout(t, failure), [t, failure]);
  const el = (at: string) => g.els.get(at);
  const erUp = !!t.gateway?.er;
  // ExpressRoute traffic is drawn through the Microsoft edge at the peering location.
  const via = (a: string, b: string) => {
    if (!erUp) return null;
    const pair = (x: string, y: string) => (a === x && y.includes(b)) || (b === x && y.includes(a));
    if (pair("onprem", "hub-gw vhub-gw")) return "msee1";
    if (pair("onprem2", "hub2-gw vhub2-gw")) return "msee2";
    return null;
  };
  const pathBetween = (a: string, b: string) => {
    const A = el(a);
    const B = el(b);
    if (!A || !B) return null;
    const v = via(a, b);
    const V = v ? el(v) : undefined;
    if (V) {
      const one = segment(A, V);
      const two = segment(V, B);
      return one && two ? `${one} ${two.replace(/^M/, "L")}` : (one ?? two);
    }
    return segment(A, B);
  };
  const segsOf = (hs: (SimHop & { dir: "fwd" | "back" })[]) =>
    hs.map((h, i) => (!i || hs[i - 1]!.dir !== h.dir ? null : pathBetween(hs[i - 1]!.at, h.at)));
  const segs = segsOf(hops);
  const cur = sim ? hops[step] : undefined;
  const curEl = cur ? el(cur.at) : undefined;
  const style = sim ? KIND_STYLE[sim.kind] : undefined;
  const fwdColor = style?.color ?? "#0078d4";
  const backColor = "#5c6bc0";
  const drop = hops.find((h) => h.drop);
  const drawn = sims.filter((s) => s.available && s.forward.length);
  const pick = (next: string) => {
    setId(next);
  };

  return (
    <div className="grid gap-4 2xl:grid-cols-[230px_minmax(0,1fr)_340px] xl:grid-cols-[220px_minmax(0,1fr)]">
      {/* Scenarios, what-ifs */}
      <aside className="space-y-1.5" aria-label="Traffic scenarios">
        <button
          onClick={() => pick("all")}
          className={cn(
            "w-full rounded-md border px-3 py-2 text-left text-[12.5px] font-medium",
            id === "all"
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-primary/50",
          )}
        >
          All traffic at once
          <span className="block text-[11px] font-normal text-muted-foreground">
            Every path, colour-coded
          </span>
        </button>
        {sims.map((s) => (
          <button
            key={s.id}
            onClick={() => pick(s.id)}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-left transition-colors",
              s.id === id
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/50",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span
                className="h-0 w-4 shrink-0 border-t-[3px]"
                style={{
                  borderColor: KIND_STYLE[s.kind].color,
                  borderStyle: KIND_STYLE[s.kind].dash ? "dashed" : "solid",
                }}
              />
              <span className="text-[12.5px] font-medium">{s.title}</span>
            </span>
            <span
              className={cn(
                "mt-1 inline-block rounded px-1.5 text-[10px] font-semibold",
                VERDICT[s.verdict.status].cls,
              )}
            >
              {s.available ? VERDICT[s.verdict.status].label : "Not in this design"}
            </span>
          </button>
        ))}
        <div className="mt-3 rounded-md border border-border bg-card p-2.5">
          <p className="mb-1.5 text-[11.5px] font-medium">What if…</p>
          <div className="space-y-1" role="radiogroup" aria-label="Failure to simulate">
            {FAILURES.map(([f, label, hint]) => {
              const disabled =
                (f === "er" && !(t.gateway?.er || t.gateway?.erDown)) ||
                (f !== "none" && t.mode === "none" && f !== "region");
              return (
                <button
                  key={f}
                  role="radio"
                  aria-checked={failure === f}
                  disabled={disabled}
                  onClick={() => setFailure(f)}
                  className={cn(
                    "w-full rounded px-2 py-1 text-left text-[11.5px] disabled:opacity-40",
                    failure === f ? "bg-[#fde7e9] font-medium text-[#a4262c]" : "hover:bg-muted",
                  )}
                  title={disabled ? "Not in this design" : hint}
                >
                  {label}
                  <span className="block text-[10.5px] font-normal text-muted-foreground">
                    {disabled && f === "er" ? "No ExpressRoute in this design" : hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {t.firewall && (
          <div className="rounded-md border border-border bg-card p-2.5">
            <p className="mb-1.5 text-[11.5px] font-medium">Firewall rules</p>
            <div
              className="flex rounded-md border border-border bg-muted/40 p-0.5 text-[11.5px]"
              role="radiogroup"
              aria-label="Firewall rules"
            >
              {(
                [
                  [true, "Assume allowed"],
                  [false, "As deployed"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={label}
                  role="radio"
                  aria-checked={allowRules === v}
                  onClick={() => setAllowRules(v)}
                  className={cn(
                    "flex-1 rounded px-2 py-1",
                    allowRules === v ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              The policy this design deploys starts empty — Azure Firewall denies whatever no rule
              allows.
            </p>
          </div>
        )}
      </aside>

      {/* The drawing */}
      <section className="min-w-0 rounded-md border border-border bg-card">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">
              {sim ? sim.title : "Every traffic path in this design"}
            </p>
            <p className="font-mono text-[11.5px] text-muted-foreground">
              {sim
                ? sim.question
                : failure !== "none"
                  ? `Simulating: ${FAILURES.find((f) => f[0] === failure)![1].toLowerCase()}`
                  : "Pick a path to step a packet through it."}
            </p>
          </div>
          {sim && (
            <span
              className={cn(
                "rounded px-2 py-0.5 text-[11.5px] font-semibold",
                VERDICT[sim.verdict.status].cls,
              )}
              data-verdict={sim.verdict.status}
            >
              {sim.available ? VERDICT[sim.verdict.status].label : "Not in this design"}
            </span>
          )}
        </header>
        {sim && (
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-1.5 text-[11.5px]">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              aria-label="Previous hop"
              onClick={() => {
                setPlaying(false);
                setStep((s) => Math.max(0, s - 1));
              }}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => {
                if (step >= hops.length - 1) setStep(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              aria-label="Next hop"
              onClick={() => {
                setPlaying(false);
                setStep((s) => Math.min(hops.length - 1, s + 1));
              }}
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              aria-label="Restart"
              onClick={() => {
                setStep(0);
                setPlaying(true);
              }}
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <span className="ml-1 text-muted-foreground">
              Hop {Math.min(step + 1, hops.length)} of {hops.length}
              {cur?.dir === "back" ? " · reply" : sim.back.length ? " · request" : ""}
            </span>
          </div>
        )}
        <div className="overflow-x-auto p-2">
          <svg
            viewBox={`0 0 ${W} ${g.h}`}
            className="h-auto w-full min-w-[860px]"
            role="img"
            aria-label="Network topology with the traffic paths"
          >
            <defs>
              <marker
                id="ts-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
              </marker>
            </defs>
            {/* Internet */}
            <g>
              <ellipse
                cx={W / 2}
                cy={34}
                rx={W / 2 - 60}
                ry={28}
                fill="#ffffff"
                stroke="#605e5c"
                strokeWidth={1.3}
              />
              <text
                x={W / 2}
                y={42}
                textAnchor="middle"
                fontSize={22}
                fontWeight={700}
                fill="#1b1b1b"
              >
                Internet
              </text>
            </g>
            {/* Subscriptions and networks */}
            {g.frames.map((f) => (
              <g key={f.id} opacity={f.down ? 0.45 : 1}>
                <rect
                  x={f.x}
                  y={f.y}
                  width={f.w}
                  height={f.h}
                  rx={6}
                  fill={f.fill}
                  stroke={f.stroke}
                  strokeWidth={1.4}
                  strokeDasharray={f.dashed ? "6 4" : undefined}
                />
                {f.chip && (
                  <g>
                    <rect
                      x={f.x + f.w / 2 - 95}
                      y={f.y - 14}
                      width={190}
                      height={24}
                      rx={3}
                      fill={f.chip.fill}
                      stroke="#8a8886"
                      strokeWidth={0.8}
                    />
                    <text
                      x={f.x + f.w / 2}
                      y={f.y + 3}
                      textAnchor="middle"
                      fontSize={12.5}
                      fontWeight={700}
                      fill="#1b1b1b"
                    >
                      {f.chip.text}
                    </text>
                  </g>
                )}
                {f.title && (
                  <text
                    x={f.x + 12}
                    y={f.y + (f.chip ? 26 : 20)}
                    fontSize={13}
                    fontWeight={700}
                    fill="#1b1b1b"
                  >
                    {f.title}
                  </text>
                )}
                {f.sub && (
                  <foreignObject
                    x={f.x + 12}
                    y={f.y + (f.chip ? 29 : 23)}
                    width={f.w - 24}
                    height={f.id === "frame:support" ? 80 : 16}
                  >
                    <p
                      className={cn(
                        "text-[11px] text-[#605e5c]",
                        f.id === "frame:support" ? "leading-snug" : "truncate",
                      )}
                    >
                      {f.sub}
                    </p>
                  </foreignObject>
                )}
                {f.down && (
                  <g pointerEvents="none">
                    <rect
                      x={f.x}
                      y={f.y}
                      width={f.w}
                      height={f.h}
                      rx={6}
                      fill="#a4262c"
                      opacity={0.07}
                    />
                    <text
                      x={f.x + f.w / 2}
                      y={f.y + f.h / 2 + 6}
                      textAnchor="middle"
                      fontSize={17}
                      fontWeight={800}
                      fill="#a4262c"
                      opacity={0.55}
                      letterSpacing={2}
                    >
                      REGION DOWN
                    </text>
                  </g>
                )}
              </g>
            ))}
            {/* Fixed connections: peering, ExpressRoute, VPN */}
            {g.links.map((l, i) => (
              <g key={i} opacity={l.down ? 0.35 : 0.8}>
                <path
                  d={l.d}
                  fill="none"
                  stroke={l.down ? "#a4262c" : l.color}
                  strokeWidth={l.width ?? 1.4}
                  strokeDasharray={l.down ? "3 4" : l.dash}
                  markerEnd={l.arrows ? "url(#ts-arrow)" : undefined}
                  markerStart={l.arrows ? "url(#ts-arrow)" : undefined}
                />
                {l.label && (
                  <text
                    x={l.lx}
                    y={l.ly}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={600}
                    fill={l.down ? "#a4262c" : l.color}
                    stroke="white"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {l.label}
                  </text>
                )}
              </g>
            ))}
            {/* Parts */}
            {[...g.els.values()]
              .filter((e) => e.kind !== "cloud")
              .map((e) => {
                const active = curEl?.id === e.id;
                const Icon = e.icon ?? (e.id === "internet" ? Globe : Monitor);
                return (
                  <g key={e.id} opacity={e.absent ? 0.55 : e.down ? 0.45 : 1}>
                    <rect
                      x={e.x}
                      y={e.y}
                      width={e.w}
                      height={e.h}
                      rx={5}
                      fill={e.kind === "ext" ? "#f7f7f7" : "#ffffff"}
                      stroke={
                        active
                          ? cur?.dir === "back"
                            ? backColor
                            : fwdColor
                          : e.absent
                            ? "#a19f9d"
                            : "#c8c6c4"
                      }
                      strokeWidth={active ? 3 : 1}
                      strokeDasharray={e.absent ? "5 4" : undefined}
                    />
                    <foreignObject x={e.x} y={e.y} width={e.w} height={e.h} pointerEvents="none">
                      <div className="flex h-full items-start gap-2 overflow-hidden px-2 py-1.5 text-[#1b1b1b]">
                        <span
                          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded"
                          style={{ background: `${e.tone ?? "#0078d4"}1a` }}
                        >
                          <Icon
                            className="size-4"
                            style={{ color: e.absent ? "#a19f9d" : (e.tone ?? "#0078d4") }}
                          />
                        </span>
                        <div className="min-w-0 leading-tight">
                          <p
                            className={cn(
                              "truncate text-[12.5px] font-semibold",
                              e.absent && "text-[#8a8886]",
                            )}
                          >
                            {e.absent && e.id.includes("gw")
                              ? "No gateway"
                              : e.absent && e.id.includes("fw")
                                ? "No firewall"
                                : e.title}
                          </p>
                          {e.detail && (
                            <p className="truncate text-[11px] text-[#605e5c]">{e.detail}</p>
                          )}
                          {e.tag && !e.absent && (
                            <p className="truncate font-mono text-[10px] text-[#0f6cbd]">{e.tag}</p>
                          )}
                        </div>
                      </div>
                    </foreignObject>
                    {e.down && e.id.startsWith("msee") && (
                      <g transform={`translate(${e.x + e.w - 12},${e.y + 12})`}>
                        <circle r={9} fill="#a4262c" />
                        <text
                          textAnchor="middle"
                          dy={4}
                          fontSize={11}
                          fontWeight={700}
                          fill="white"
                        >
                          ✕
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            {/* All traffic at once */}
            {!sim &&
              drawn.map((s, k) => {
                const st = KIND_STYLE[s.kind];
                const hs = s.forward.map((h) => ({ ...h, dir: "fwd" as const }));
                const ds = segsOf(hs);
                const off = ((k % 5) - 2) * 4;
                const stop = hs.find((h) => h.drop);
                const stopEl = stop ? el(stop.at) : undefined;
                return (
                  <g
                    key={s.id}
                    transform={`translate(${off},${off})`}
                    onClick={() => pick(s.id)}
                    className="cursor-pointer"
                  >
                    <title>{`${s.title}: ${VERDICT[s.verdict.status].label}`}</title>
                    {ds.map((d, i) =>
                      d ? (
                        <g key={i}>
                          <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
                          <path
                            d={d}
                            fill="none"
                            stroke={st.color}
                            strokeWidth={2.4}
                            strokeDasharray={st.dash}
                            className="ts-flow"
                            markerEnd="url(#ts-arrow)"
                          />
                        </g>
                      ) : null,
                    )}
                    {stopEl && (
                      <g
                        transform={`translate(${stopEl.x + stopEl.w - 12 - (k % 3) * 20},${stopEl.y - 2})`}
                      >
                        <circle r={8} fill={st.color} stroke="white" strokeWidth={1.5} />
                        <text
                          textAnchor="middle"
                          dy={3.5}
                          fontSize={10}
                          fontWeight={700}
                          fill="white"
                        >
                          ✕
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            {/* One path, hop by hop */}
            {sim &&
              segs.map((d, i) =>
                d && i <= step ? (
                  <path
                    key={`s${i}`}
                    d={d}
                    fill="none"
                    stroke={hops[i]!.dir === "back" ? backColor : fwdColor}
                    strokeWidth={i === step ? 3.6 : 2.6}
                    strokeDasharray={hops[i]!.dir === "back" ? "7 5" : undefined}
                    markerEnd="url(#ts-arrow)"
                  />
                ) : d ? (
                  <path
                    key={`s${i}`}
                    d={d}
                    fill="none"
                    stroke="#a19f9d"
                    strokeWidth={1.5}
                    strokeDasharray="3 5"
                  />
                ) : null,
              )}
            {sim &&
              hops.map((h, i) => {
                const e = el(h.at);
                if (!h.drop || !e || i > step) return null;
                return (
                  <g key={`x${i}`} transform={`translate(${e.x + e.w - 14},${e.y + 14})`}>
                    <circle r={11} fill="#a4262c" stroke="white" strokeWidth={2} />
                    <text textAnchor="middle" dy={4.5} fontSize={13} fontWeight={700} fill="white">
                      ✕
                    </text>
                    <title>{h.drop}</title>
                  </g>
                );
              })}
            {sim && segs[step] && (
              <circle
                key={`p-${sim.id}-${step}`}
                r={8}
                fill={cur?.dir === "back" ? backColor : fwdColor}
                stroke="white"
                strokeWidth={2.5}
              >
                <animateMotion dur="1.1s" fill="freeze" path={segs[step]!} />
              </circle>
            )}
            {sim && !segs[step] && curEl && (
              <circle
                cx={curEl.x + 14}
                cy={curEl.y + curEl.h / 2}
                r={8}
                fill={cur?.dir === "back" ? backColor : fwdColor}
                stroke="white"
                strokeWidth={2.5}
              />
            )}
            {/* Legend */}
            <g transform={`translate(20,${g.h - 138})`}>
              <rect width={560} height={128} rx={6} fill="white" stroke="#c8c6c4" />
              <text x={12} y={20} fontSize={12} fontWeight={700} fill="#1b1b1b">
                Legend
              </text>
              {(Object.keys(KIND_STYLE) as TrafficKind[]).map((k, i) => {
                const st = KIND_STYLE[k];
                const x = 12 + (i % 3) * 182;
                const y = 38 + Math.floor(i / 3) * 22;
                return (
                  <g key={k}>
                    <line
                      x1={x}
                      y1={y}
                      x2={x + 36}
                      y2={y}
                      stroke={st.color}
                      strokeWidth={3}
                      strokeDasharray={st.dash}
                    />
                    <text x={x + 44} y={y + 4} fontSize={11.5} fill="#1b1b1b">
                      {st.label}
                    </text>
                  </g>
                );
              })}
              <line x1={376} y1={82} x2={412} y2={82} stroke="#1b1b1b" strokeWidth={1.6} />
              <text x={420} y={86} fontSize={11.5} fill="#1b1b1b">
                Peering
              </text>
              <line x1={12} y1={104} x2={48} y2={104} stroke="#2f5bb7" strokeWidth={2} />
              <text x={56} y={108} fontSize={11.5} fill="#1b1b1b">
                ExpressRoute
              </text>
              <line
                x1={194}
                y1={104}
                x2={230}
                y2={104}
                stroke="#5c6bc0"
                strokeWidth={2.4}
                strokeDasharray="7 5"
              />
              <text x={238} y={108} fontSize={11.5} fill="#1b1b1b">
                Reply
              </text>
              <circle cx={388} cy={104} r={7} fill="#a4262c" />
              <text x={388} y={108} textAnchor="middle" fontSize={9} fontWeight={700} fill="white">
                ✕
              </text>
              <text x={402} y={108} fontSize={11.5} fill="#1b1b1b">
                Stops here
              </text>
            </g>
          </svg>
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Addresses: hubs as Microsoft's hub-and-spoke module allocates them (first /22 of
          10.0.0.0/16 and 10.1.0.0/16); spokes from this design, or the offering's range
          (10.60.0.0/19, a /22 per install) for customer installs. On-premises and internet
          addresses are examples.
        </p>
      </section>

      {/* This hop, or the overview */}
      <aside className="space-y-3 xl:col-span-2 2xl:col-span-1" aria-label="This hop">
        {sim ? (
          <>
            <div
              className={cn("rounded-md px-3 py-2 text-[12px]", VERDICT[sim.verdict.status].cls)}
            >
              <b>{sim.available ? VERDICT[sim.verdict.status].label : "Not in this design"}.</b>{" "}
              {sim.available ? sim.verdict.text : sim.reason}
            </div>
            {cur && (
              <HopCard
                hop={cur}
                dir={cur.dir}
                color={cur.dir === "back" ? backColor : fwdColor}
                allRoutes={allRoutes}
                setAllRoutes={setAllRoutes}
                set={set}
              />
            )}
            {drop && step < hops.indexOf(drop) && (
              <p className="text-[11px] text-muted-foreground">
                Keep stepping: it's dropped at hop {hops.indexOf(drop) + 1}.
              </p>
            )}
            {sim.notes.map((n) => (
              <p
                key={n}
                className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
              >
                {n}
              </p>
            ))}
          </>
        ) : (
          <section className="rounded-md border border-border bg-card" aria-label="Summary">
            <header className="border-b border-border px-3 py-2">
              <p className="text-[13px] font-semibold">What this network does today</p>
              <p className="text-[11.5px] text-muted-foreground">
                Click a path on the drawing, or one on the left, to step through it.
              </p>
            </header>
            <ul className="divide-y divide-border">
              {sims.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => pick(s.id)}
                    className="w-full px-3 py-2 text-left hover:bg-muted/40"
                  >
                    <span className="flex items-center gap-2 text-[12px] font-medium">
                      <span
                        className="h-0 w-4 shrink-0 border-t-[3px]"
                        style={{
                          borderColor: KIND_STYLE[s.kind].color,
                          borderStyle: KIND_STYLE[s.kind].dash ? "dashed" : "solid",
                        }}
                      />
                      {s.title}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      <b
                        className={cn(
                          "mr-1 rounded px-1 text-[10px]",
                          VERDICT[s.verdict.status].cls,
                        )}
                      >
                        {VERDICT[s.verdict.status].label}
                      </b>
                      {s.available ? s.verdict.text : s.reason}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <details className="rounded-md border border-border bg-card px-3 py-2 text-[11.5px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            High availability vs disaster recovery
          </summary>
          <p className="mt-1.5">
            High availability keeps a region running through a component failure: the firewall spans
            availability zones, gateways use zone-redundant SKUs (VPN active-active), and a
            site-to-site VPN backs up ExpressRoute. Disaster recovery is a separate, complete copy
            in a second region — its own hub, a second ExpressRoute circuit at a different peering
            location, and the workloads themselves — that you fail over to.
          </p>
          <a
            className="mt-1.5 inline-block text-primary hover:underline"
            href="https://learn.microsoft.com/en-us/azure/expressroute/designing-for-disaster-recovery-with-expressroute-privatepeering"
            target="_blank"
            rel="noreferrer"
          >
            Designing for disaster recovery with ExpressRoute
          </a>
        </details>
        <details className="rounded-md border border-border bg-card px-3 py-2 text-[11.5px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            How Azure picks a route
          </summary>
          <p className="mt-1.5">
            Longest prefix wins. For the same prefix, a route table entry (UDR) beats a BGP route,
            which beats Azure's system routes. A 0.0.0.0/0 UDR also removes the system routes that
            drop private ranges (10/8, 172.16/12, 192.168/16) — that's why spoke-to-spoke follows it
            to the firewall. Route Server isn't needed: Azure Firewall is steered by route tables or
            routing intent.
          </p>
          <a
            className="mt-1.5 inline-block text-primary hover:underline"
            href="https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview"
            target="_blank"
            rel="noreferrer"
          >
            Virtual network traffic routing (Microsoft Learn)
          </a>
        </details>
      </aside>
    </div>
  );
}

function HopCard({
  hop,
  dir,
  color,
  allRoutes,
  setAllRoutes,
  set,
}: {
  hop: SimHop;
  dir: "fwd" | "back";
  color: string;
  allRoutes: boolean;
  setAllRoutes: (v: boolean) => void;
  set?: ((p: Partial<Answers>) => void) | undefined;
}) {
  const rows =
    hop.routes?.filter((r) => allRoutes || r.active || r.reason !== "doesn't match") ?? [];
  return (
    <section
      className="rounded-md border bg-card"
      style={{ borderColor: color }}
      aria-label="Current hop"
    >
      <header className="border-b border-border px-3 py-2">
        <p className="text-[10.5px] font-semibold tracking-wide uppercase" style={{ color }}>
          {dir === "back" ? "Reply" : "Request"}
        </p>
        <p className="text-[13px] font-semibold">{hop.title}</p>
        {hop.body && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hop.body}</p>}
      </header>
      <div className="space-y-2 px-3 py-2">
        <p className="rounded bg-muted/60 px-2 py-1 font-mono text-[11px]" data-testid="packet">
          {hop.packet.src} → {hop.packet.dst}:{hop.packet.port}
        </p>
        {hop.nat && <p className="font-mono text-[11px] text-[#0f6cbd]">{hop.nat}</p>}
        {hop.routes && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold">Effective routes · {hop.table}</p>
              <button
                className="text-[10.5px] text-primary hover:underline"
                onClick={() => setAllRoutes(!allRoutes)}
              >
                {allRoutes ? "Only matching" : `All ${hop.routes.length}`}
              </button>
            </div>
            <table className="w-full font-mono text-[10.5px]" aria-label="Effective routes">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-normal">Prefix</th>
                  <th className="font-normal">Next hop</th>
                  <th className="font-normal">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={cn(
                      r.active
                        ? "bg-[#dff6dd] font-semibold text-[#0b5a08]"
                        : r.reason === "doesn't match"
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground line-through",
                    )}
                    title={r.active ? "Azure uses this route" : r.reason}
                    data-active={r.active || undefined}
                  >
                    <td className="py-0.5 pr-1">{r.prefix}</td>
                    <td className="pr-1">
                      {r.nextHop}
                      {r.nextHopIp ? ` ${r.nextHopIp}` : ""}
                    </td>
                    <td>{r.source === "Virtual network gateway" ? "BGP" : r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.filter((r) => !r.active && r.reason && r.reason !== "doesn't match").length >
              0 && (
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                Struck through: matched but lost (
                {[
                  ...new Set(
                    rows
                      .filter((r) => !r.active && r.reason && r.reason !== "doesn't match")
                      .map((r) => r.reason),
                  ),
                ].join("; ")}
                ).
              </p>
            )}
          </div>
        )}
        {hop.decisions?.map((d) => (
          <p key={d.text} className="flex gap-1 text-[11px]">
            <span className={cn("shrink-0 font-semibold", RESULT_CLS[d.result])}>{d.kind}:</span>
            <span>{d.text}</span>
          </p>
        ))}
        {hop.via && <p className="text-[11px] text-muted-foreground">Next: {hop.via}</p>}
        {hop.drop && (
          <p
            className="rounded bg-[#fde7e9] px-2 py-1.5 text-[11.5px] text-[#a4262c]"
            data-testid="drop"
          >
            <b>Dropped.</b> {hop.drop}
          </p>
        )}
        {hop.gap && (
          <p
            className={cn(
              "rounded px-2 py-1.5 text-[11.5px]",
              hop.gap.severity === "fail"
                ? "bg-[#fde7e9] text-[#a4262c]"
                : "bg-[#fff4ce] text-[#5c4400]",
            )}
          >
            <b>{hop.gap.severity === "fail" ? "Gap: " : "Note: "}</b>
            {hop.gap.text}
            {hop.gap.fix && set && (
              <button
                className="ml-1 font-semibold underline"
                onClick={() => set(hop.gap!.fix!.patch)}
              >
                {hop.gap.fix.label}
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
