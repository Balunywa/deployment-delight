/*
 * The traffic story: every path through this design drawn the way Microsoft's architecture diagrams draw them
 * (nested boundaries, numbered traffic categories, the reason written on the path), animated like a live packet,
 * and computed rather than drawn: each path, hop label and outcome comes from the routing model in scene.ts, so
 * changing the design changes the picture. Step through it one category at a time, compare with an alternative
 * design side by side, or download it.
 */
import { useMemo } from "react";

import {
  type AlzLibrary,
  type Answers,
  hasFirewall,
  hasHub,
  hierarchy,
  on,
} from "@/lib/alz/engine";
import { hubSubnets } from "@/lib/alz/ipplan";
import type { Placement } from "@/lib/alz/placement";
import { flowsFor, sceneExtras, spokesFor } from "@/lib/alz/scene";

import { type StoryData, StoryView } from "../diagram/Story";

type Box = { x: number; y: number; w: number; h: number };
type NodeDef = Box & {
  id: string;
  title: string;
  sub: string;
  icon?: string;
  /** A shorter title for crowded rows. */
  short?: string;
  /** Drawn tighter, with the short title, when its row is crowded. */
  tight?: boolean;
};

const W = 1240;
const H = 856;

/*
 * Rows, top to bottom: who's outside (internet, users, operators), Azure services, the hub, the landing zones, and
 * on-premises below the hybrid band. Every flow gets its own lane: its own port on each box and its own channel
 * between rows, and long runs go through the gaps between boxes, so no two flows share a line and none cross a box.
 */
const ROWS = [
  { y: 30, h: 66 },
  { y: 186, h: 62 },
  { y: 326, h: 66 },
  { y: 496, h: 104 },
  { y: 762, h: 62 },
];
/** Free band between row r and r+1 (inside the zone borders), where horizontal channels run. */
const GAPS = [
  { top: 134, bottom: 182 },
  { top: 254, bottom: 298 },
  { top: 414, bottom: 456 },
  { top: 676, bottom: 708 },
];

type Row = 0 | 1 | 2 | 3 | 4;
type Placed = NodeDef & { row: Row };

function layout(a: Answers, groups: string[], spokeIds: Record<string, string>) {
  const hub = hasHub(a);
  const wan = a.connectivity === "virtual_wan";
  const sub = Object.fromEntries(
    hubSubnets(a.hubAddressSpace, a).map((s) => [s.key, s.cidr]),
  ) as Record<string, string>;
  const nodes: Placed[] = [];
  const rowOf = (
    row: Row,
    items: Omit<NodeDef, "x" | "y" | "w" | "h">[],
    x0: number,
    x1: number,
    gap = 22,
  ) => {
    const w = Math.min(230, (x1 - x0 - gap * (items.length - 1)) / Math.max(items.length, 1));
    items.forEach((it, i) =>
      nodes.push({
        ...it,
        row,
        x: x0 + i * (w + gap),
        y: ROWS[row]!.y,
        w,
        h: ROWS[row]!.h,
        ...(w < 160 ? { tight: true, title: it.short ?? it.title } : {}),
      }),
    );
  };

  rowOf(
    0,
    [
      { id: "internet", title: "Internet", sub: "Public endpoints", icon: "public-ip" },
      { id: "users", title: "Internet users", sub: "Browsers and partners", icon: "users" },
      { id: "operator", title: "Operator", sub: "Azure portal", icon: "users" },
      { id: "remote", title: "Remote engineer", sub: "Azure VPN Client", icon: "vpn-client" },
    ],
    40,
    1000,
    40,
  );
  rowOf(
    1,
    [
      { id: "dcr", title: "Data collection rules", sub: "Azure Monitor Agent", icon: "monitor" },
      { id: "law", title: "Log Analytics", sub: "Central workspace", icon: "log-analytics" },
      { id: "sentinel", title: "Microsoft Sentinel", sub: "Security analytics", icon: "sentinel" },
    ],
    560,
    1180,
  );
  if (hub) {
    const items: Omit<NodeDef, "x" | "y" | "w" | "h">[] = [];
    if (wan)
      items.push({
        id: "hub1",
        short: "Hub router",
        title: "Virtual hub router",
        sub: "Routes between connections",
        icon: "vwan-hub",
      });
    if (hasFirewall(a))
      items.push({
        id: "firewall",
        short: `Firewall ${a.firewall}`,
        title: `Azure Firewall ${a.firewall}`,
        sub: wan ? "In the secured hub" : (sub["firewall"] ?? ""),
        icon: "firewall",
      });
    if (on(a.vpnGateway))
      items.push({
        id: "vpngw",
        short: "VPN gateway",
        title: "VPN gateway",
        sub: wan ? "Site-to-site" : (sub["gateway"] ?? ""),
        icon: "vnet-gateway",
      });
    if (on(a.expressRoute))
      items.push({
        id: "ergw",
        short: "ER gateway",
        title: "ExpressRoute gateway",
        sub: "Private circuit",
        icon: "expressroute",
      });
    if (on(a.bastion))
      items.push({
        id: "bastion",
        short: "Bastion",
        title: "Azure Bastion",
        sub: wan ? "Sidecar network" : (sub["bastion"] ?? ""),
        icon: "bastion",
      });
    if (a.privateDns === "platform") {
      items.push({
        id: "dnsresolver",
        short: "DNS resolver",
        title: "DNS Private Resolver",
        sub: "Inbound endpoint",
        icon: "dns-resolver",
      });
      items.push({
        id: "dnszones",
        short: "DNS zones",
        title: "Private DNS zones",
        sub: "privatelink.*",
        icon: "dns-zones",
      });
    }
    rowOf(2, items, 290, 1180, 26);
  }
  const lz = (["corp", "online", "sandbox"] as const).filter(
    (g) => groups.includes(g) && spokeIds[g],
  );
  const widths: Record<string, number> = { corp: 400, online: 250, sandbox: 190 };
  let x = 290;
  for (const g of lz) {
    nodes.push({
      id: spokeIds[g]!,
      row: 3,
      x,
      y: ROWS[3]!.y,
      w: widths[g]!,
      h: ROWS[3]!.h,
      title:
        g === "corp" ? "Corp landing zone" : g === "online" ? "Online landing zone" : "Sandbox",
      sub:
        g === "corp"
          ? "Workload VMs and private endpoints, peered to the hub"
          : g === "online"
            ? "Internet-facing, not routed through the hub"
            : "Isolated experiments",
      icon: g === "corp" ? "vm" : g === "online" ? "app-gateway" : "subscription",
    });
    x += widths[g]! + 24;
  }
  nodes.push({
    id: "onprem",
    row: 4,
    x: 290,
    y: ROWS[4]!.y,
    w: 260,
    h: ROWS[4]!.h,
    title: "Office / data center",
    sub: a.onPremRanges.join(", ") || "No ranges listed",
    icon: "on-premises",
  });

  const gw = on(a.vpnGateway) || on(a.expressRoute);
  return {
    nodes,
    azure: { x: 260, y: 122, w: 950, h: 520 },
    zones: [
      ...(hub
        ? [
            {
              x: 276,
              y: 302,
              w: 918,
              h: 108,
              label: `${wan ? "Virtual hub" : "Hub virtual network"} · ${a.primaryRegion} · ${a.hubAddressSpace}`,
              dashed: true,
            },
          ]
        : []),
      { x: 276, y: 460, w: 918, h: 154, label: "Landing zones" },
    ],
    band: {
      x: 260,
      y: 672,
      w: 950,
      h: 40,
      label: gw
        ? [
            on(a.expressRoute) && "ExpressRoute private circuit",
            on(a.vpnGateway) && "Site-to-site VPN (IPsec over the internet)",
          ]
            .filter(Boolean)
            .join("  ·  ")
        : "No hybrid connection in this design",
      on: gw,
    },
    onprem: { x: 260, y: 724, w: 950, h: 112 },
  };
}

export type StoryInput = {
  lib: AlzLibrary;
  answers: Answers;
  placed: Placement[];
};

/** The flows and the scene for a design, the same way the hop-by-hop simulator builds them. */
function storyFor({ lib, answers, placed }: StoryInput) {
  const tree = hierarchy(lib, answers);
  const groups = ["corp", "online", "local", "sandbox"].filter((g) =>
    tree.some((n) => n.libraryId === g),
  );
  const spokes = spokesFor(groups, placed);
  const flows = flowsFor({ spokes, extras: sceneExtras(answers, lib, tree) }, answers);
  const spokeIds: Record<string, string> = {};
  for (const s of spokes) if (!spokeIds[s.group]) spokeIds[s.group] = `spoke:${s.id}`;
  // Workloads in subscriptions added on the canvas (or custom groups like AKS under Online) are drawn in the
  // landing zone they sit under.
  const landingZoneOf = (libraryId: string): string | undefined => {
    let n = tree.find((t) => t.libraryId === libraryId);
    while (n) {
      if (spokeIds[n.libraryId]) return n.libraryId;
      n = tree.find((t) => t.id === n!.parentId);
    }
    return undefined;
  };
  const alias: Record<string, string> = {};
  for (const s of spokes) {
    const g = landingZoneOf(s.group);
    if (g) alias[`spoke:${s.id}`] = spokeIds[g]!;
  }
  for (const x of sceneExtras(answers, lib, tree)) {
    const g = landingZoneOf(x.group);
    if (g) alias[`extra:${x.id}`] = spokeIds[g]!;
  }
  return { flows, groups, spokeIds, alias };
}

export function TrafficStory({
  input,
  compareWith,
  only,
  compact,
  onTrace,
  baseLabel = "Your design",
  stacked,
}: {
  input: StoryInput;
  /** What to call this design when it's drawn beside an alternative. */
  baseLabel?: string;
  /** Draw the comparison underneath rather than beside (for narrow columns). */
  stacked?: boolean;
  /** An alternative design to draw beside this one. */
  compareWith?: { label: string; answers: Answers } | undefined;
  /** Show only these flows (e.g. the outbound ones in the guided step). */
  only?: string[] | undefined;
  compact?: boolean;
  onTrace?: ((flowId: string) => void) | undefined;
}) {
  const mine = useMemo(() => dataFor(input), [input]);
  const other = useMemo(
    () =>
      compareWith
        ? { ...dataFor({ ...input, answers: compareWith.answers }), label: compareWith.label }
        : undefined,
    [compareWith, input],
  );
  return (
    <StoryView
      mine={mine}
      other={other}
      only={only}
      compact={compact ?? false}
      onTrace={onTrace}
      baseLabel={baseLabel}
      stacked={stacked ?? false}
      fileName={`${input.answers.intermediateRootId || "landing-zone"}-traffic`}
      label="Traffic through this landing zone"
    />
  );
}

/** The landing zone's story: its layout and the flows the routing model computes for it. */
function dataFor(input: StoryInput): StoryData {
  const story = storyFor(input);
  const L = layout(input.answers, story.groups, story.spokeIds);
  const a = input.answers;
  return {
    flows: story.flows,
    alias: story.alias,
    layout: {
      width: W,
      height: H,
      rows: ROWS,
      gaps: GAPS,
      nodes: L.nodes.map((n) => ({
        ...n,
        ...(n.row === 0 && n.id !== "internet" ? { optional: true } : {}),
      })),
      zones: L.zones,
      outer: {
        ...L.azure,
        title: "Microsoft Azure",
        sub: `${a.intermediateRootName} · ${a.connectivity === "virtual_wan" ? "Virtual WAN" : a.connectivity === "hub_and_spoke" ? "hub and spoke" : "no central network"}`,
      },
      band: L.band,
      lower: { ...L.onprem, label: "On-premises network" },
    },
  };
}
