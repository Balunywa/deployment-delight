/*
 * The traffic story: every path through this design drawn the way Microsoft's architecture diagrams draw them
 * (nested boundaries, numbered traffic categories, the reason written on the path), animated like a live packet,
 * and computed rather than drawn: each path, hop label and outcome comes from the routing model in scene.ts, so
 * changing the design changes the picture. Step through it one category at a time, compare with an alternative
 * design side by side, or download it.
 */
import { Download, Moon, Pause, Play, Sun } from "lucide-react";
import { type ReactNode, type RefObject, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
import { type Flow, flowsFor, sceneExtras, spokesFor } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

import { OUTCOME, PALETTE as KIT_PALETTE, useDiagramTheme } from "../diagram/theme";

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
type Theme = "dark" | "light";

const W = 1240;
const H = 856;

const PALETTE = KIT_PALETTE;
const STATUS = OUTCOME;

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

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

type Pt = { x: number; y: number };

/** A flow's own port on a box side, so flows touching the same box never share a point. */
const portX = (b: Box, lane: number, lanes: number) =>
  b.x + b.w * (0.16 + (0.68 * (lane + 0.5)) / lanes);
const portY = (b: Box, lane: number, lanes: number) =>
  b.y + b.h * (0.2 + (0.6 * (lane + 0.5)) / lanes);
const channel = (gap: number, lane: number, lanes: number) => {
  const g = GAPS[gap]!;
  return g.top + ((g.bottom - g.top) * (lane + 0.5)) / lanes;
};

/** A vertical run at x would cross a box in one of these rows; find the nearest gap between boxes instead. */
function gutter(x: number, rows: number[], nodes: Placed[], lane: number) {
  const blockers = nodes.filter((n) => rows.includes(n.row));
  const free = (v: number) => blockers.every((n) => v < n.x - 5 || v > n.x + n.w + 5);
  if (free(x)) return x;
  for (let d = 4; d < 700; d += 4) {
    if (free(x - d - lane)) return x - d - lane;
    if (free(x + d + lane)) return x + d + lane;
  }
  return x;
}

function route(a: Placed, b: Placed, lane: number, lanes: number, nodes: Placed[]): Pt[] {
  if (a.row === b.row) {
    const between = nodes.filter(
      (n) =>
        n.row === a.row &&
        n !== a &&
        n !== b &&
        n.x > Math.min(a.x, b.x) &&
        n.x < Math.max(a.x, b.x),
    );
    if (!between.length) {
      const y = portY(a, lane, lanes);
      return a.x < b.x
        ? [
            { x: a.x + a.w, y },
            { x: b.x, y },
          ]
        : [
            { x: a.x, y },
            { x: b.x + b.w, y },
          ];
    }
    const gap = Math.min(a.row, GAPS.length - 1);
    const y = channel(gap, lane, lanes);
    const ax = portX(a, lane, lanes);
    const bx = portX(b, lane, lanes);
    const yb = ROWS[a.row]!.y + ROWS[a.row]!.h;
    return [
      { x: ax, y: yb },
      { x: ax, y },
      { x: bx, y },
      { x: bx, y: yb },
    ];
  }
  const down = b.row > a.row;
  const ax = portX(a, lane, lanes);
  const bx = portX(b, lane, lanes);
  const ay = down ? a.y + a.h : a.y;
  const by = down ? b.y : b.y + b.h;
  const gapA = down ? a.row : a.row - 1;
  const gapB = down ? b.row - 1 : b.row;
  const yB = channel(gapB, lane, lanes);
  const inner = Array.from({ length: Math.abs(b.row - a.row) - 1 }, (_, i) =>
    down ? a.row + 1 + i : a.row - 1 - i,
  );
  if (!inner.length)
    return [
      { x: ax, y: ay },
      { x: ax, y: yB },
      { x: bx, y: yB },
      { x: bx, y: by },
    ];
  const gx = gutter(ax, inner, nodes, lane);
  if (gx === ax)
    return [
      { x: ax, y: ay },
      { x: ax, y: yB },
      { x: bx, y: yB },
      { x: bx, y: by },
    ];
  const yA = channel(gapA, lane, lanes);
  return [
    { x: ax, y: ay },
    { x: ax, y: yA },
    { x: gx, y: yA },
    { x: gx, y: yB },
    { x: bx, y: yB },
    { x: bx, y: by },
  ];
}

const toD = (pts: Pt[]) =>
  pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

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
  const [theme, setTheme] = useDiagramTheme();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const mine = useMemo(() => storyFor(input), [input]);
  const other = useMemo(
    () => (compareWith ? storyFor({ ...input, answers: compareWith.answers }) : null),
    [compareWith, input],
  );
  const flows = mine.flows.filter((f) => !only || only.includes(f.id));
  const numbered = flows.filter((f) => f.available);
  // Numbers follow this design's flows, so ① is the same traffic in both pictures when comparing.
  const num = new Map(numbered.map((f, i) => [f.id, i + 1]));
  for (const f of other?.flows ?? [])
    if (f.available && (!only || only.includes(f.id)) && !num.has(f.id))
      num.set(f.id, num.size + 1);
  const shown = (f: Flow) =>
    f.available && !hidden.has(f.id) && (step === null || (num.get(f.id) ?? 99) <= step);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const current =
    step !== null && step > 0
      ? numbered[step - 1]
      : focus
        ? numbered.find((f) => f.id === focus)
        : undefined;

  const download = async (kind: "svg" | "png") => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Inline the icons so the file stands on its own.
    await Promise.all(
      [...clone.querySelectorAll("image")].map(async (img) => {
        const href = img.getAttribute("href");
        if (!href || href.startsWith("data:")) return;
        const text = await fetch(href).then((r) => r.text());
        img.setAttribute(
          "href",
          `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`,
        );
      }),
    );
    clone.querySelectorAll("[data-anim]").forEach((n) => n.remove());
    const data = new XMLSerializer().serializeToString(clone);
    const name = `${input.answers.intermediateRootId || "landing-zone"}-traffic`;
    const save = (blob: Blob, ext: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    };
    if (kind === "svg") return save(new Blob([data], { type: "image/svg+xml" }), "svg");
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data)))}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = W * 2;
    canvas.height = H * 2;
    canvas.getContext("2d")!.drawImage(img, 0, 0, W * 2, H * 2);
    canvas.toBlob((b) => b && save(b, "png"), "image/png");
  };

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={step === null ? "default" : "outline"}
              className="h-8"
              onClick={() => setStep(null)}
            >
              All traffic
            </Button>
            <Button
              size="sm"
              variant={step !== null ? "default" : "outline"}
              className="h-8"
              onClick={() => setStep(step === null ? 0 : step)}
            >
              Step through
            </Button>
            {step !== null && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={step === 0}
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </Button>
                <span className="text-[12px] text-muted-foreground">
                  {step === 0 ? "The pieces" : `${step} of ${numbered.length}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={step >= numbered.length}
                  onClick={() => setStep(step + 1)}
                >
                  Next
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? "Pause animation" : "Play animation"}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Switch diagram theme"
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void download("svg")}
            >
              <Download className="size-3.5" /> SVG
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void download("png")}
            >
              <Download className="size-3.5" /> PNG
            </Button>
          </div>
        </div>
      )}

      <div className={cn("grid gap-3", other && !stacked && "2xl:grid-cols-2")}>
        <Canvas
          title={other ? baseLabel : undefined}
          theme={theme}
          answers={input.answers}
          story={mine}
          only={only}
          num={num}
          shown={shown}
          focus={current?.id ?? null}
          playing={playing}
          onFocus={(id) => setFocus(focus === id ? null : id)}
          svgRef={svgRef}
        />
        {other && compareWith && (
          <Canvas
            title={compareWith.label}
            theme={theme}
            answers={compareWith.answers}
            story={other}
            only={only}
            num={num}
            shown={shown}
            focus={current?.id ?? null}
            playing={playing}
            onFocus={(id) => setFocus(focus === id ? null : id)}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Traffic categories">
        {flows.map((f) => {
          const n = num.get(f.id) ?? 0;
          const s = STATUS[f.outcome?.status ?? ""];
          const off = hidden.has(f.id);
          return (
            <button
              key={f.id}
              disabled={!f.available}
              aria-pressed={f.available && !off}
              title={
                f.available ? (f.outcome?.text ?? f.summary) : (f.reason ?? "Not in this design")
              }
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(f.id)) next.delete(f.id);
                  else next.add(f.id);
                  return next;
                })
              }
              onMouseEnter={() => setFocus(f.id)}
              onMouseLeave={() => setFocus(null)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors",
                !f.available
                  ? "border-dashed border-border text-muted-foreground"
                  : off
                    ? "border-border text-muted-foreground line-through"
                    : "border-border bg-card hover:bg-muted/50",
              )}
            >
              {f.available ? (
                <span
                  className="grid size-5 place-items-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: f.color }}
                >
                  {n}
                </span>
              ) : null}
              {f.title}
              {f.available && s && (
                <span className="font-semibold" style={{ color: s.color }}>
                  {s.mark}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <span
                  className="grid size-6 place-items-center rounded-full text-[12px] font-bold text-white"
                  style={{ background: current.color }}
                >
                  {num.get(current.id)}
                </span>
                {current.title}
              </p>
              {current.outcome && (
                <p
                  className="mt-1 text-[12.5px]"
                  style={{ color: STATUS[current.outcome.status]?.color }}
                >
                  {STATUS[current.outcome.status]?.label}: {current.outcome.text}
                </p>
              )}
            </div>
            {onTrace && (
              <Button size="sm" variant="outline" onClick={() => onTrace(current.id)}>
                Trace it hop by hop
              </Button>
            )}
          </div>
          <ol className="mt-3 space-y-1.5 text-[12.5px]">
            {current.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-5 shrink-0 text-right font-mono text-muted-foreground">
                  {i + 1}
                </span>
                <span>
                  <span className="font-medium">{s.title}</span>
                  {s.route && (
                    <span className="block text-[11.5px] text-muted-foreground">
                      {s.route.text}
                    </span>
                  )}
                  {s.gap && (
                    <span
                      className={cn(
                        "block text-[11.5px]",
                        s.gap.severity === "fail" ? "text-danger" : "text-[oklch(0.5_0.12_70)]",
                      )}
                    >
                      {s.gap.text}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {step === 0 && (
        <p className="rounded-lg bg-muted/50 px-4 py-2.5 text-[12.5px] text-muted-foreground">
          The pieces of this design. Press Next to add one kind of traffic at a time.
        </p>
      )}
    </div>
  );
}

function Canvas({
  title,
  theme,
  answers,
  story,
  only,
  num,
  shown,
  focus,
  playing,
  onFocus,
  svgRef,
}: {
  title?: string | undefined;
  theme: Theme;
  answers: Answers;
  story: ReturnType<typeof storyFor>;
  only?: string[] | undefined;
  num: Map<string, number>;
  shown: (f: Flow) => boolean;
  focus: string | null;
  playing: boolean;
  onFocus: (id: string) => void;
  svgRef?: RefObject<SVGSVGElement | null> | undefined;
}) {
  const uid = useId().replace(/:/g, "");
  const c = PALETTE[theme];
  const L = layout(answers, story.groups, story.spokeIds);
  const byId = new Map(L.nodes.map((n) => [n.id, n]));
  const flows = story.flows.filter((f) => (!only || only.includes(f.id)) && f.available);
  // Lanes are per flow across the whole design, so a flow keeps its lane when others are hidden.
  const laneOf = new Map(story.flows.filter((f) => f.available).map((f, i) => [f.id, i]));
  const lanes = Math.max(laneOf.size, 1);
  const touched = new Set(flows.flatMap((f) => f.steps.map((s) => story.alias[s.at] ?? s.at)));
  const drawn = L.nodes.filter((n) => n.row !== 0 || n.id === "internet" || touched.has(n.id));

  const paths = flows.map((f, i) => {
    const lane = laneOf.get(f.id) ?? i;
    const seq = f.steps
      .map((s) => byId.get(s.at) ?? byId.get(story.alias[s.at] ?? ""))
      .filter((n): n is Placed => !!n);
    const legs: { d: string; pts: Pt[]; via?: string | undefined }[] = [];
    for (let k = 1; k < seq.length; k++) {
      if (seq[k] === seq[k - 1]) continue;
      const pts = route(seq[k - 1]!, seq[k]!, lane, lanes, L.nodes);
      legs.push({ d: toD(pts), pts, via: f.steps[k - 1]?.via });
    }
    return { f, i, legs, start: seq[0], end: seq.at(-1) };
  });

  // Hop labels go where they overlap neither a box nor another label: each tries every segment of its own path,
  // beside a vertical run or above/below a horizontal one. A label with no room is left for the focused view.
  const placed: Box[] = drawn.map((n) => ({ x: n.x - 2, y: n.y - 2, w: n.w + 4, h: n.h + 4 }));
  const hit = (b: Box) =>
    b.x < 4 ||
    b.x + b.w > W - 4 ||
    placed.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  const labels = new Map<string, { x: number; y: number; w: number; text: string }[]>();
  const order = [...paths].sort((p, q) => (p.f.id === focus ? -1 : q.f.id === focus ? 1 : 0));
  for (const { f, legs } of order) {
    if (!shown(f)) continue;
    const out: { x: number; y: number; w: number; text: string }[] = [];
    legs.forEach((leg, k) => {
      if (!leg.via || (focus !== f.id && k > 0)) return;
      const text = leg.via.length > 34 ? `${leg.via.slice(0, 33)}…` : leg.via;
      const w = Math.min(text.length * 6.2 + 14, 230);
      const spots: Box[] = [];
      const segs = leg.pts
        .slice(1)
        .map((b, i) => ({ a: leg.pts[i]!, b }))
        .sort(
          (p, q) =>
            Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y),
        );
      for (const { a, b } of segs) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (a.x === b.x)
          for (const dy of [0, -24, 24])
            spots.push(
              { x: mx + 8, y: my - 10 + dy, w, h: 20 },
              { x: mx - 8 - w, y: my - 10 + dy, w, h: 20 },
            );
        else
          for (const dx of [0, -w / 2, w / 2])
            spots.push(
              { x: mx - w / 2 + dx, y: my - 24, w, h: 20 },
              { x: mx - w / 2 + dx, y: my + 4, w, h: 20 },
            );
      }
      const spot = spots.find((b) => !hit(b));
      if (!spot) return;
      placed.push(spot);
      out.push({ x: spot.x, y: spot.y, w, text });
    });
    labels.set(f.id, out);
  }

  return (
    <figure
      className="overflow-hidden rounded-xl border border-border"
      style={{ background: c.bg }}
    >
      {title && (
        <figcaption className="px-4 pt-3 text-[12px] font-semibold" style={{ color: c.sub }}>
          {title}
        </figcaption>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Traffic through this landing zone${title ? `: ${title}` : ""}`}
        className="block h-auto w-full"
        style={{ background: c.bg }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <style>{`
            @keyframes march-${uid} { to { stroke-dashoffset: -22; } }
            .march-${uid} { animation: march-${uid} 0.9s linear infinite; }
            @media (prefers-reduced-motion: reduce) { .march-${uid} { animation: none; } }
          `}</style>
        </defs>
        <rect width={W} height={H} fill={c.bg} />

        {/* Azure boundary */}
        <rect
          x={L.azure.x}
          y={L.azure.y}
          width={L.azure.w}
          height={L.azure.h}
          rx={22}
          fill={c.azure}
          stroke={c.azureLine}
          strokeWidth={1.5}
        />
        <text
          x={L.azure.x + L.azure.w - 18}
          y={L.azure.y + L.azure.h - 6}
          textAnchor="end"
          fill={c.sub}
          fontSize={12}
        >
          <tspan fill={c.text} fontWeight={700} fontSize={14}>
            Microsoft Azure
          </tspan>
          {`  ·  ${answers.intermediateRootName} · ${answers.connectivity === "virtual_wan" ? "Virtual WAN" : answers.connectivity === "hub_and_spoke" ? "hub and spoke" : "no central network"}`}
        </text>
        {L.zones.map((z) => (
          <g key={z.label}>
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx={14}
              fill={c.zone}
              stroke={c.zoneLine}
              strokeWidth={1.2}
              strokeDasharray={z.dashed ? "7 5" : undefined}
            />
            <text
              x={z.x + z.w - 14}
              y={z.y + 16}
              textAnchor="end"
              fill={c.sub}
              fontSize={11.5}
              fontWeight={600}
            >
              {z.label}
            </text>
          </g>
        ))}

        {/* Hybrid band and on-premises */}
        <rect
          x={L.band.x}
          y={L.band.y}
          width={L.band.w}
          height={L.band.h}
          rx={10}
          fill={L.band.on ? c.band : "none"}
          stroke={L.band.on ? c.zoneLine : c.muted}
          strokeDasharray={L.band.on ? undefined : "6 5"}
        />
        <image
          href="/azure-icons/expressroute.svg"
          x={L.band.x + 14}
          y={L.band.y + 11}
          width={22}
          height={22}
          opacity={L.band.on ? 1 : 0.4}
        />
        <text
          x={L.band.x + 46}
          y={L.band.y + 27}
          fill={L.band.on ? c.text : c.muted}
          fontSize={13}
          fontWeight={600}
        >
          {L.band.label}
        </text>
        <rect
          x={L.onprem.x}
          y={L.onprem.y}
          width={L.onprem.w}
          height={L.onprem.h}
          rx={18}
          fill="none"
          stroke="#3b82f6"
          strokeOpacity={0.6}
          strokeWidth={1.4}
        />
        <text x={L.onprem.x + 16} y={L.onprem.y + 20} fill="#60a5fa" fontSize={12} fontWeight={600}>
          On-premises network
        </text>

        {/* Flows under the boxes, so lines tuck into them */}
        {paths.map(({ f, i, legs }) => {
          if (!shown(f)) return null;
          const dim = focus && focus !== f.id;
          return (
            <g
              key={f.id}
              opacity={dim ? 0.14 : 1}
              onClick={() => onFocus(f.id)}
              style={{ cursor: "pointer" }}
            >
              {legs.map((leg, k) => (
                <g key={k}>
                  <path
                    d={leg.d}
                    fill="none"
                    stroke={f.color}
                    strokeOpacity={0.22}
                    strokeWidth={7}
                    strokeLinejoin="round"
                    filter={`url(#glow-${uid})`}
                  />
                  <path
                    d={leg.d}
                    fill="none"
                    stroke={f.color}
                    strokeWidth={2.2}
                    strokeDasharray="7 4"
                    strokeLinejoin="round"
                    className={playing ? `march-${uid}` : undefined}
                  />
                  {playing &&
                    [0, 0.5].map((phase) => (
                      <circle
                        key={phase}
                        data-anim
                        r={4.2}
                        fill={f.color}
                        filter={`url(#glow-${uid})`}
                      >
                        <animateMotion
                          dur={`${2.2 + (i % 3) * 0.4}s`}
                          begin={`${phase * 2}s`}
                          repeatCount="indefinite"
                          path={leg.d}
                        />
                      </circle>
                    ))}
                </g>
              ))}
            </g>
          );
        })}

        {drawn.map((n) => {
          const big = n.h > 80;
          const tx = n.x + (n.tight ? 36 : 48);
          const tw = n.w - (n.tight ? 42 : 58);
          const icon = n.tight ? 20 : 26;
          const titleLines = wrap(n.title, tw, 13);
          const subLines = wrap(n.sub, tw, 11);
          // A subtitle that doesn't fit a crowded box is left out rather than cut mid-word.
          const subLine =
            subLines.length === 1 ? subLines[0]! : n.tight ? "" : `${subLines[0] ?? ""}…`;
          const ty = big ? n.y + 30 : n.y + n.h / 2 - (titleLines.length > 1 ? 12 : 4);
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={10}
                fill={c.node}
                stroke={c.nodeLine}
                strokeWidth={1.2}
              />
              {n.icon && (
                <image
                  href={`/azure-icons/${n.icon}.svg`}
                  x={n.x + (n.tight ? 10 : 12)}
                  y={big ? n.y + 16 : n.y + n.h / 2 - icon / 2}
                  width={icon}
                  height={icon}
                />
              )}
              <text x={tx} y={ty} fill={c.text} fontSize={13} fontWeight={600}>
                {titleLines.map((l, i) => (
                  <tspan key={i} x={tx} dy={i ? 15 : 0}>
                    {l}
                  </tspan>
                ))}
              </text>
              <text x={tx} y={ty + titleLines.length * 15 + 1} fill={c.sub} fontSize={11}>
                {subLine}
              </text>
            </g>
          );
        })}

        {/* Labels, numbers and outcomes on top */}
        {paths.map(({ f, legs, start, end }) => {
          const n = num.get(f.id) ?? 0;
          if (!shown(f) || !start) return null;
          const dim = focus && focus !== f.id;
          const s = STATUS[f.outcome?.status ?? ""];
          // A flow whose hops all land in one box (e.g. a lookup inside the landing zone) is marked on its corner.
          const first = legs[0]?.pts[0] ?? { x: start.x + start.w - 18, y: start.y };
          const end0 = legs.at(-1)?.pts.at(-1) ?? first;
          // A flow that ends where it started (e.g. a lookup, then the connection) shows its outcome beside its number.
          const last =
            Math.hypot(end0.x - first.x, end0.y - first.y) < 24
              ? { x: first.x + 24, y: first.y }
              : end0;
          return (
            <g key={f.id} opacity={dim ? 0.14 : 1}>
              {(labels.get(f.id) ?? []).map((l, k) => (
                <g key={k}>
                  <rect
                    x={l.x}
                    y={l.y}
                    width={l.w}
                    height={20}
                    rx={6}
                    fill={c.bg}
                    stroke={f.color}
                    strokeOpacity={0.7}
                  />
                  <text
                    x={l.x + l.w / 2}
                    y={l.y + 14}
                    textAnchor="middle"
                    fill={f.color}
                    fontSize={11}
                    fontWeight={600}
                  >
                    {l.text}
                  </text>
                </g>
              ))}
              <circle
                cx={first.x}
                cy={first.y}
                r={11}
                fill={f.color}
                stroke={c.bg}
                strokeWidth={2}
              />
              <text
                x={first.x}
                y={first.y + 4.5}
                textAnchor="middle"
                fill="#fff"
                fontSize={12}
                fontWeight={800}
              >
                {n}
              </text>
              {s && (
                <g>
                  <circle
                    cx={last.x}
                    cy={last.y}
                    r={10}
                    fill={c.bg}
                    stroke={s.color}
                    strokeWidth={2}
                  />
                  <text
                    x={last.x}
                    y={last.y + 4.5}
                    textAnchor="middle"
                    fill={s.color}
                    fontSize={12}
                    fontWeight={800}
                  >
                    {s.mark}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Word wrap for SVG text by an approximate character width; at most two lines. */
function wrap(text: string, width: number, size: number) {
  const per = Math.max(8, Math.floor(width / (size * 0.56)));
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if ((cur + " " + word).trim().length > per && cur) {
      lines.push(cur.trim());
      cur = word;
    } else cur = `${cur} ${word}`;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.length > 2 ? [lines[0]!, `${lines[1]!}…`] : lines;
}
