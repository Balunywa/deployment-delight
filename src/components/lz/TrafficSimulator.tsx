/*
 * End-to-end traffic on a real canvas: the network this design deploys, drawn with the official Azure icons like an
 * architecture diagram — the internet on top, Online installs under it, the Connectivity subscription with both
 * hubs, every Corp spoke, platform services, and ExpressRoute / VPN down to the data centers. Every flow from every
 * spoke moves at once (a packet "comet" per path, in its legend colour); click one to step a packet through it —
 * the subnet's effective routes, the NSG and firewall decisions, the reply. Fail a circuit, a zone or the region
 * to see what reroutes and what breaks. Pan, zoom and fit like the landing zone map; export to draw.io.
 */
import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { ChevronLeft, ChevronRight, Download, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Answers, MgNode } from "@/lib/alz/engine";
import {
  type Failure,
  type Decision,
  type SimHop,
  type SimResult,
  type TrafficKind,
  simulate,
  simulateAll,
  topology,
} from "@/lib/alz/routing";
import type { SceneExtra, Spoke } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

import { type Adding, AddDialog } from "./HierarchyEditor";
import {
  DiagramBadge,
  DiagramCanvas,
  DiagramCard,
  DiagramZone,
  LaneEdge,
  ThemeToggle,
} from "./diagram/Kit";
import { OUTCOME, PALETTE, azureIcon, useDiagramTheme } from "./diagram/theme";
import { toDrawio } from "./traffic/drawio";
import { type TEdge, type TNode, iconUrl, trafficLayout } from "./traffic/layout";

/** The legend: one colour and line style per kind of traffic (after the classic hub-and-spoke HA/DR drawings). */
const KIND_STYLE: Record<TrafficKind, { label: string; color: string; dash?: string }> = {
  egress: { label: "HTTPS egress", color: "#e81123", dash: "9 6" },
  ingress: { label: "HTTPS ingress", color: "#e3a008", dash: "9 6" },
  internal: { label: "Internal flow", color: "#16a34a" },
  "private-endpoint": { label: "Private endpoint", color: "#2f7fd8" },
  ipsec: { label: "IPsec traffic", color: "#8661c5", dash: "6 5" },
  management: { label: "Admin (Bastion)", color: "#0d9488", dash: "10 5" },
  monitoring: { label: "Monitoring data", color: "#a855f7", dash: "3 5" },
  failover: { label: "Failover", color: "#e3008c", dash: "10 4" },
};
const WIRE: Record<
  TEdge["kind"],
  { color: string; width: number; dash?: string; arrows?: boolean }
> = {
  peering: { color: "#9db4d6", width: 1.6, arrows: true },
  global: { color: "#9db4d6", width: 2.2, arrows: true },
  er: { color: "#55a6ff", width: 2.6 },
  bgp: { color: "#55a6ff", width: 1.4 },
  ipsec: { color: "#8661c5", width: 1.6, dash: "6 5" },
  wan: { color: "#94a3b8", width: 1.3, arrows: true },
  link: { color: "#9db4d6", width: 1.3 },
  p2s: { color: "#94a3b8", width: 1.3, dash: "4 4" },
};
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
const BACK = "#5c6bc0";

type HopSummary = {
  index: number;
  dir: "fwd" | "back";
  text: string;
  result?: Decision["result"] | "drop" | undefined;
};
type Ctx = {
  active: string | null;
  drops: Set<string>;
  hopNums: Map<string, number[]>;
  hopSummaries: Map<string, HopSummary[]>;
  currentStep: number;
  color: string;
  focus: boolean;
  involved: Set<string>;
};
const TCtx = createContext<Ctx>({
  active: null,
  drops: new Set(),
  hopNums: new Map(),
  hopSummaries: new Map(),
  currentStep: 0,
  color: "#0078d4",
  focus: false,
  involved: new Set(),
});

const HS = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  pointerEvents: "none",
} as const;
function Handles() {
  return (
    <>
      {(
        [
          ["t", Position.Top],
          ["r", Position.Right],
          ["b", Position.Bottom],
          ["l", Position.Left],
        ] as const
      ).map(([id, p]) => (
        <Handle key={id} id={id} type="source" position={p} isConnectable={false} style={HS} />
      ))}
    </>
  );
}

function hopSummary(h: SimHop): Omit<HopSummary, "index" | "dir"> {
  const activeRoute = h.routes?.find((r) => r.active);
  const decision = h.decisions?.[0];
  if (h.drop) return { text: `Drop: ${h.drop.split(".")[0]}`, result: "drop" };
  if (decision)
    return {
      text: `${decision.kind}: ${
        decision.result === "needs-rule" ? "needs rule" : decision.result
      }`,
      result: decision.result,
    };
  if (activeRoute)
    return {
      text: `Route: ${activeRoute.prefix} → ${activeRoute.nextHop}`,
      result: "inspect",
    };
  if (h.via) return { text: `Next: ${h.via}`, result: "inspect" };
  return { text: h.title };
}

function HopBadges({ id }: { id: string }) {
  const c = useContext(TCtx);
  const summaries = c.hopSummaries.get(id);
  if (!summaries?.length) return null;
  const visible = summaries.filter((s) => s.index === c.currentStep);
  if (!visible.length) return null;
  return (
    // A callout beside the card, so the hop's decision never covers what the card says.
    <div className="pointer-events-none absolute top-1/2 left-full z-30 ml-2 w-max max-w-[300px] -translate-y-1/2 space-y-1">
      {visible.map((s) => {
        const current = s.index === c.currentStep;
        const tone =
          s.result === "drop" || s.result === "deny"
            ? OUTCOME.blocked.color
            : s.result === "allow"
              ? OUTCOME.reaches.color
              : s.result === "needs-rule"
                ? OUTCOME["needs-rules"].color
                : c.color;
        return (
          <span
            key={`${s.dir}-${s.index}`}
            className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-tight font-semibold shadow-lg"
            style={{
              background: "var(--d-bg)",
              borderColor: `${tone}${current ? "" : "99"}`,
              color: current ? tone : "var(--d-sub)",
              boxShadow: current ? `0 0 0 2px ${tone}66, 0 0 18px ${tone}55` : undefined,
            }}
          >
            <DiagramBadge n={s.index + 1} color={current ? tone : "var(--d-muted)"} />
            <span>{s.text}</span>
          </span>
        );
      })}
    </div>
  );
}

function FrameNode({ id, data }: NodeProps<Node<TNode>>) {
  const c = useContext(TCtx);
  const dim = c.focus && !c.involved.has(id);
  const kind = data.zoneKind ?? (data.dashed ? "vnet" : "zone");
  const failed = data.down || data.failed;
  return (
    <DiagramZone
      label={data.title || data.chip?.text || " "}
      sub={data.detail}
      kind={kind}
      out={data.absent || failed}
      state={c.involved.has(id) && c.focus ? "selected" : undefined}
      icon={data.icon ? iconUrl(data.icon) : undefined}
      right={
        failed ? (
          <span
            className="grid size-6 place-items-center rounded-full text-[12px] font-bold text-white shadow"
            style={{ background: OUTCOME.broken.color }}
            title={data.down ? "Region unavailable" : "Traffic stops here"}
          >
            ✕
          </span>
        ) : undefined
      }
      className={cn("transition-opacity", dim && "opacity-25")}
    >
      <Handles />
      {data.chip && !failed && (
        // The group a frame starts, as a tab on its top edge, so it never squeezes the frame's own title.
        <span
          className="absolute -top-2.5 left-3 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
          style={{
            borderColor: "var(--d-zone-line)",
            color: "var(--d-sub)",
            background: "var(--d-bg)",
          }}
        >
          {data.chip.text}
        </span>
      )}
      {failed && (
        <span
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-[inherit] text-[15px] font-extrabold tracking-[0.24em]"
          style={{ color: OUTCOME.broken.color, background: `${OUTCOME.broken.color}10` }}
        >
          {data.down ? "REGION DOWN" : "FAILED"}
        </span>
      )}
      <HopBadges id={id} />
    </DiagramZone>
  );
}

function PartNode({ id, data }: NodeProps<Node<TNode>>) {
  const c = useContext(TCtx);
  const active = c.active === id;
  const nums = c.hopNums.get(id);
  const dim = c.focus && !c.involved.has(id);
  const stopped = data.failed || c.drops.has(id);
  const state = active
    ? "selected"
    : data.absent || data.down || data.failed
      ? "out"
      : dim
        ? "dim"
        : c.focus && c.involved.has(id)
          ? "focus"
          : "normal";
  return (
    <div
      className="relative h-full w-full"
      title={`${data.title}${data.detail ? ` — ${data.detail}` : ""}`}
    >
      <Handles />
      <DiagramCard
        icon={data.icon ? iconUrl(data.icon) : undefined}
        title={data.title}
        sub={data.detail}
        state={state}
        accent={stopped ? OUTCOME.broken.color : active ? c.color : undefined}
        titleAttr={`${data.title}${data.detail ? ` — ${data.detail}` : ""}`}
        right={
          stopped ? (
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white shadow"
              style={{ background: OUTCOME.broken.color }}
              title="Traffic stops here"
            >
              ✕
            </span>
          ) : undefined
        }
      >
        {data.tag && !data.absent && (
          <span
            className="mt-0.5 block truncate font-mono text-[10.5px]"
            style={{ color: PALETTE.dark.accent }}
          >
            {data.tag}
          </span>
        )}
      </DiagramCard>
      {nums && (
        <span className="absolute -top-2.5 -left-2.5 z-20 flex gap-0.5">
          {nums.map((n) => {
            const current = n === c.currentStep;
            const passed = n < c.currentStep;
            return (
              <span
                key={n}
                className={cn(current && "scale-110")}
                style={{ opacity: current || passed ? 1 : 0.45 }}
              >
                <DiagramBadge
                  n={n + 1}
                  color={current ? c.color : passed ? `${c.color}` : "var(--d-muted)"}
                  title={current ? "Current hop" : passed ? "Passed hop" : "Upcoming hop"}
                />
              </span>
            );
          })}
        </span>
      )}
      <HopBadges id={id} />
    </div>
  );
}

function CloudNode({ id, data }: NodeProps<Node<TNode>>) {
  const c = useContext(TCtx);
  const dim = c.focus && !c.involved.has(id);
  return (
    <div className="relative h-full w-full" style={{ opacity: dim ? 0.25 : 1 }}>
      <Handles />
      <DiagramCard
        icon={data.icon ? iconUrl(data.icon) : azureIcon(id)}
        title={data.title}
        sub={data.detail}
        state={c.active === id ? "selected" : "normal"}
        accent={c.active === id ? c.color : undefined}
      />
      {c.drops.has(id) && (
        <span
          className="absolute -top-2.5 -right-2.5 grid size-6 place-items-center rounded-full text-[12px] font-bold text-white"
          style={{ background: OUTCOME.broken.color }}
          title="Traffic stops here"
        >
          ✕
        </span>
      )}
      <HopBadges id={id} />
      {Array.from({ length: 60 }, (_, k) => (
        <Handle
          key={k}
          id={`b${k}`}
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          style={{ ...HS, left: `${(k + 0.5) * (100 / 60)}%` }}
        />
      ))}
    </div>
  );
}

const nodeTypes = { frame: FrameNode, part: PartNode, cloud: CloudNode };
const edgeTypes = { comet: LaneEdge };

type Rect = { x: number; y: number; w: number; h: number };
function sides(a: Rect, b: Rect): [string, string] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const apart = b.x >= a.x + a.w || a.x >= b.x + b.w;
  if (apart && Math.abs(dx) >= Math.abs(dy) * 0.35) return dx > 0 ? ["r", "l"] : ["l", "r"];
  return dy > 0 ? ["b", "t"] : ["t", "b"];
}

export function TrafficSimulator(props: {
  answers: Answers;
  spokes: Spoke[];
  extras: SceneExtra[];
  tree?: MgNode[] | undefined;
  initial?: string | undefined;
  set?: ((p: Partial<Answers>) => void) | undefined;
}) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

function Inner({
  answers,
  spokes,
  extras,
  tree,
  initial,
  set,
}: {
  answers: Answers;
  spokes: Spoke[];
  extras: SceneExtra[];
  tree?: MgNode[] | undefined;
  initial?: string | undefined;
  set?: ((p: Partial<Answers>) => void) | undefined;
}) {
  const rf = useReactFlow();
  const [theme] = useDiagramTheme();
  const [failure, setFailure] = useState<Failure>("none");
  const [allowRules, setAllowRules] = useState(true);
  const [scenario, setScenario] = useState<string>(initial ?? "all");
  const [spokeSel, setSpokeSel] = useState<string>("");
  const [hidden, setHidden] = useState<Set<TrafficKind>>(new Set());
  const [adding, setAdding] = useState<Adding>(null);
  const t = useMemo(
    () => topology(answers, { spokes, extras }, failure),
    [answers, spokes, extras, failure],
  );
  const all = useMemo(() => simulateAll(t, answers, allowRules), [t, answers, allowRules]);
  const from =
    spokeSel && (t.corp.includes(spokeSel) || t.onlines.includes(spokeSel)) ? spokeSel : "";
  const scenarios = useMemo(() => {
    const a = t.corp.includes(from) ? from : t.corp[0];
    const i = a ? t.corp.indexOf(a) : 0;
    const b = t.corp.length > 1 ? t.corp[(i + 1) % t.corp.length] : undefined;
    return simulate(
      { ...t, corpA: a, corpB: b, online: t.onlines.includes(from) ? from : t.onlines[0] },
      answers,
      allowRules,
    );
  }, [t, from, answers, allowRules]);
  const sim = scenario === "all" ? undefined : scenarios.find((s) => s.id === scenario);
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
  }, [sim?.id, from, allowRules, answers, failure]);
  useEffect(() => {
    if (!sim || !playing || !hops.length) return;
    if (step >= hops.length - 1) return setPlaying(false);
    const timer = setTimeout(() => setStep((s) => s + 1), 1800);
    return () => clearTimeout(timer);
  }, [sim, playing, step, hops.length]);

  const L = useMemo(() => trafficLayout(t, failure), [t, failure]);
  const byId = useMemo(() => new Map(L.nodes.map((n) => [n.id, n])), [L]);
  const erUp = !!t.gateway?.er;
  /** ExpressRoute is drawn through the Microsoft edge at the peering location. */
  const legs = (a: string, b: string): [string, string][] => {
    if (!erUp) return [[a, b]];
    const via = (x: string, gws: string[]) =>
      (a === x && gws.includes(b)) || (b === x && gws.includes(a))
        ? x === "onprem"
          ? "msee1"
          : "msee2"
        : null;
    const v = via("onprem", ["hub-gw", "vhub-gw"]) ?? via("onprem2", ["hub2-gw", "vhub2-gw"]);
    return v && byId.has(v)
      ? [
          [a, v],
          [v, b],
        ]
      : [[a, b]];
  };
  const handlesFor = (a: string, b: string): [string, string] => {
    const A = byId.get(a)!;
    const B = byId.get(b)!;
    if (b === "internet")
      return ["t", `b${Math.max(0, Math.min(59, Math.floor(((A.x + A.w / 2 - B.x) / B.w) * 60)))}`];
    if (a === "internet")
      return [`b${Math.max(0, Math.min(59, Math.floor(((B.x + B.w / 2 - A.x) / A.w) * 60)))}`, "t"];
    return sides(A, B) as [string, string];
  };

  /* Nodes */
  const drops = new Set(hops.filter((h, i) => h.drop && i <= step).map((h) => h.at));
  const hopNums = new Map<string, number[]>();
  const hopSummaries = new Map<string, HopSummary[]>();
  hops.forEach((h, i) => {
    hopNums.set(h.at, [...(hopNums.get(h.at) ?? []), i]);
    const summary = hopSummary(h);
    hopSummaries.set(h.at, [
      ...(hopSummaries.get(h.at) ?? []),
      { index: i, dir: h.dir, ...summary },
    ]);
  });
  const color = sim ? KIND_STYLE[sim.kind].color : "#0078d4";
  const involved = new Set(hops.map((h) => h.at));
  if (sim) {
    const involvedParts = L.nodes.filter((n) => involved.has(n.id));
    L.nodes
      .filter((n) => n.kind === "frame")
      .forEach((frame) => {
        if (
          involvedParts.some(
            (n) =>
              n.id === frame.id ||
              (n.x + n.w / 2 >= frame.x &&
                n.x + n.w / 2 <= frame.x + frame.w &&
                n.y + n.h / 2 >= frame.y &&
                n.y + n.h / 2 <= frame.y + frame.h),
          )
        )
          involved.add(frame.id);
      });
  }
  const ctx: Ctx = {
    active: sim ? (hops[step]?.at ?? null) : null,
    drops: sim
      ? drops
      : new Set(
          all.flatMap((f) =>
            hidden.has(f.kind) ? [] : f.forward.filter((h) => h.drop).map((h) => h.at),
          ),
        ),
    hopNums: sim ? hopNums : new Map(),
    hopSummaries: sim ? hopSummaries : new Map(),
    currentStep: step,
    color: hops[step]?.dir === "back" ? BACK : color,
    focus: !!sim,
    involved,
  };
  const nodes: Node[] = useMemo(
    () =>
      L.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: { x: n.x, y: n.y },
        data: n,
        width: n.w,
        height: n.h,
        style: { width: n.w, height: n.h },
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: n.kind === "frame" ? (n.layer ?? 1) : 5,
      })),
    [L],
  );

  /* Edges: the fixed wiring, then the traffic */
  const edges: Edge[] = [];
  const lanes = new Map<string, number>();
  const lane = (a: string, b: string) => {
    const k = [a, b].sort().join("|");
    const n = lanes.get(k) ?? 0;
    lanes.set(k, n + 1);
    return n;
  };
  const selectedLinks = new Set<string>();
  if (sim)
    hops.forEach((h, i) => {
      const prev = hops[i - 1];
      if (!prev || prev.at === h.at || prev.dir !== h.dir) return;
      legs(prev.at, h.at).forEach(([x, y]) => {
        selectedLinks.add(`${x}>${y}`);
        selectedLinks.add(`${y}>${x}`);
      });
    });
  for (const e of L.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const w = WIRE[e.kind];
    const [s, tg] = handlesFor(e.source, e.target);
    const fixedInPath =
      selectedLinks.has(`${e.source}>${e.target}`) ||
      (involved.has(e.source) && involved.has(e.target));
    edges.push({
      id: `w:${e.id}`,
      source: e.source,
      target: e.target,
      sourceHandle: s,
      targetHandle: tg,
      type: "comet",
      data: {
        color: e.down ? OUTCOME.broken.color : w.color,
        label: sim ? undefined : e.label,
        width: w.width,
        dashed: !!w.dash || e.down,
        dash: e.down ? "3 4" : w.dash,
        dim: e.down ? false : sim ? !fixedInPath : false,
      },
      ...(w.arrows
        ? {
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: e.down ? OUTCOME.broken.color : w.color,
              width: 14,
              height: 14,
            },
            markerStart: {
              type: MarkerType.ArrowClosed,
              color: e.down ? OUTCOME.broken.color : w.color,
              width: 14,
              height: 14,
            },
          }
        : {}),
      zIndex: 2,
    });
  }
  const flowEdge = (
    key: string,
    a: string,
    b: string,
    data: Record<string, unknown>,
    label?: string,
  ) => {
    for (const [x, y] of legs(a, b)) {
      if (!byId.has(x) || !byId.has(y) || x === y) continue;
      const [s, tg] = handlesFor(x, y);
      edges.push({
        id: `${key}:${x}>${y}`,
        source: x,
        target: y,
        sourceHandle: s,
        targetHandle: tg,
        type: "comet",
        data: {
          color: data["color"],
          label,
          lane: lane(x, y),
          width: data["current"] ? 4.4 : data["faint"] ? 1.6 : 3,
          live: !!data["current"] || (!sim && !!data["comet"]),
          dim: !!data["faint"],
          dashed: !!data["dash"] || !!data["faint"],
          dash: data["faint"] ? "3 6" : (data["dash"] as string | undefined),
          begin: data["begin"],
          flowId: data["flowId"],
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: data["color"] as string,
          width: 14,
          height: 14,
        },
        zIndex: data["current"] ? 12 : 8,
      });
    }
  };
  if (!sim) {
    // Every flow from every spoke; identical legs of the same kind are drawn once.
    const seen = new Set<string>();
    all.forEach((f, k) => {
      if (!f.available || hidden.has(f.kind)) return;
      const st = KIND_STYLE[f.kind];
      f.forward.forEach((h, i) => {
        const prev = f.forward[i - 1];
        if (!prev || prev.at === h.at) return;
        const key = `${f.kind}:${prev.at}>${h.at}`;
        if (seen.has(key)) return;
        seen.add(key);
        flowEdge(`all:${f.id}:${i}`, prev.at, h.at, {
          color: st.color,
          dash: st.dash,
          flowing: true,
          comet: true,
          begin: (k * 0.37) % 2.4,
          flowId: f.id,
        });
      });
    });
  } else {
    hops.forEach((h, i) => {
      const prev = hops[i - 1];
      if (!prev || prev.at === h.at || prev.dir !== h.dir) return;
      const done = i <= step;
      const c = h.dir === "back" ? BACK : color;
      flowEdge(
        `sim:${i}`,
        prev.at,
        h.at,
        {
          color: c,
          dash: h.dir === "back" ? "7 5" : undefined,
          faint: !done,
          current: i === step,
          comet: i === step,
          flowing: done && h.dir === "back",
        },
        done ? prev.via : undefined,
      );
    });
  }

  /* Navigation */
  // The internet and on-premises clouds span the whole canvas edge; fitting to them would zoom out to nothing.
  const EDGE = useMemo(
    () => new Set(["internet", "msee1", "msee2", "onprem", "onprem2", "remote"]),
    [],
  );
  const pathNodeIds = useMemo(() => {
    const ids = [...new Set(hops.map((h) => h.at))];
    const inner = ids.filter((x) => !EDGE.has(x));
    return inner.length ? inner : ids;
  }, [EDGE, hops]);
  const overviewNodeIds = useMemo(
    () => L.nodes.filter((n) => !n.absent && !EDGE.has(n.id)).map((n) => n.id),
    [EDGE, L],
  );
  const focusIds = useCallback(
    (
      ids: string[],
      opts: { padding: number; duration: number; minZoom: number; maxZoom: number },
    ) =>
      void rf.fitView({
        nodes: ids.filter((x) => byId.has(x)).map((x) => ({ id: x })),
        padding: opts.padding,
        duration: opts.duration,
        minZoom: opts.minZoom,
        maxZoom: opts.maxZoom,
      }),
    [byId, rf],
  );
  const focusOverview = useCallback(
    () => focusIds(overviewNodeIds, { padding: 0.08, duration: 450, minZoom: 0.48, maxZoom: 0.88 }),
    [focusIds, overviewNodeIds],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      if (sim) focusIds(pathNodeIds, { padding: 0.22, duration: 500, minZoom: 0.6, maxZoom: 1.12 });
      else focusOverview();
    }, 80);
    return () => clearTimeout(timer);
  }, [focusIds, focusOverview, from, L, pathNodeIds, sim]);
  useEffect(() => {
    if (!sim || step === 0) return;
    const around = [hops[step - 1]?.at, hops[step]?.at, hops[step + 1]?.at].filter(
      Boolean,
    ) as string[];
    const ids = [...new Set(around)].filter((x) => !EDGE.has(x));
    const timer = setTimeout(
      () =>
        focusIds(ids.length > 1 ? ids : pathNodeIds, {
          padding: 0.38,
          duration: 420,
          minZoom: 0.6,
          maxZoom: 1.22,
        }),
      40,
    );
    return () => clearTimeout(timer);
  }, [EDGE, focusIds, hops, pathNodeIds, sim, step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [role=dialog]"))
        return;
      if (e.key === "Escape") {
        setScenario("all");
        setTimeout(focusOverview, 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusOverview]);

  const exportDrawio = () => {
    const flows = all
      .filter((f) => f.available && !hidden.has(f.kind))
      .flatMap((f) =>
        f.forward.slice(1).flatMap((h, i) => {
          const a = f.forward[i]!.at;
          if (a === h.at) return [];
          return legs(a, h.at).map(([x, y], j) => ({
            id: `${f.id}-${i}-${j}`,
            source: x,
            target: y,
            color: KIND_STYLE[f.kind].color,
            dashed: !!KIND_STYLE[f.kind].dash,
            label: j === 0 ? f.forward[i]!.via : undefined,
          }));
        }),
      );
    const uniq = [...new Map(flows.map((f) => [`${f.color}|${f.source}|${f.target}`, f])).values()];
    const xml = toDrawio("Traffic flows", L.nodes, L.edges, uniq);
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `traffic-${answers.intermediateRootId || "landing-zone"}.drawio`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const spokeName = (id: string) => t.vnets.find((v) => v.id === id)?.name ?? id;
  const shownFlows = all.filter((f) => f.available && !hidden.has(f.kind));
  const cur = sim ? hops[step] : undefined;
  const drop = hops.find((h) => h.drop);

  return (
    <TCtx.Provider value={ctx}>
      <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)]">
        {/* Scenarios and what-ifs */}
        <aside className="space-y-1.5" aria-label="Traffic scenarios">
          <button
            onClick={() => {
              setScenario("all");
              focusOverview();
            }}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-left text-[12.5px] font-medium",
              scenario === "all"
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/50",
            )}
          >
            All traffic at once
            <span className="block text-[11px] font-normal text-muted-foreground">
              {shownFlows.length} paths across {t.corp.length + t.onlines.length} spokes
            </span>
          </button>
          {(t.corp.length > 1 || t.onlines.length > 1) && (
            <label className="block rounded-md border border-border bg-card px-3 py-2 text-[11.5px]">
              <span className="font-medium">Follow traffic from</span>
              <select
                aria-label="Follow traffic from"
                value={from || t.corp[0] || ""}
                onChange={(e) => setSpokeSel(e.target.value)}
                className="mt-1 h-7 w-full rounded border border-input bg-background px-1.5"
              >
                {t.corp.map((id) => (
                  <option key={id} value={id}>
                    {spokeName(id)} (Corp)
                  </option>
                ))}
                {t.onlines.map((id) => (
                  <option key={id} value={id}>
                    {spokeName(id)} (Online)
                  </option>
                ))}
              </select>
            </label>
          )}
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => setScenario(s.id)}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left transition-colors",
                s.id === scenario
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
                const disabled = f === "er" && !(t.gateway?.er || t.gateway?.erDown);
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
                  >
                    {label}
                    <span className="block text-[10.5px] font-normal text-muted-foreground">
                      {disabled ? "No ExpressRoute in this design" : hint}
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

        {/* The canvas */}
        <DiagramCanvas
          theme={theme}
          className="min-w-0 overflow-hidden rounded-md border border-[var(--d-azure-line)]"
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--d-azure-line)] px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">
                {sim ? sim.title : "Every traffic path in this design"}
              </p>
              <p className="truncate font-mono text-[11.5px]" style={{ color: "var(--d-sub)" }}>
                {sim
                  ? sim.question
                  : failure !== "none"
                    ? `Simulating: ${FAILURES.find((f) => f[0] === failure)![1].toLowerCase()} · click a path to follow it`
                    : "Click a path to follow a packet through it · Esc to come back"}
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
            {set && tree && (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setAdding({ kind: "subscription", parent: "corp" })}
              >
                <Plus className="size-3.5" /> Add a spoke
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7" onClick={exportDrawio}>
              <Download className="size-3.5" /> draw.io
            </Button>
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                setScenario("all");
                focusOverview();
              }}
            >
              Whole picture
            </Button>
          </header>
          {sim && (
            <div className="flex items-center gap-1.5 border-b border-[var(--d-azure-line)] px-4 py-1.5 text-[11.5px]">
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
              <span className="ml-1" style={{ color: "var(--d-sub)" }}>
                Hop {Math.min(step + 1, hops.length)} of {hops.length}
                {cur?.dir === "back" ? " · reply" : sim.back.length ? " · request" : ""}
              </span>
              <button
                className="ml-auto text-primary hover:underline"
                onClick={() => {
                  setScenario("all");
                  focusOverview();
                }}
              >
                Whole picture (Esc)
              </button>
            </div>
          )}
          <div
            className="relative h-[max(680px,calc(100vh-230px))]"
            aria-label="Network topology with the traffic paths"
            role="img"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView={false}
              minZoom={0.35}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              connectionMode={ConnectionMode.Loose}
              panOnScroll
              zoomOnDoubleClick={false}
              onEdgeClick={(_, e) => {
                const id = (e.data as { flowId?: string } | undefined)?.flowId;
                if (!id) return;
                const f = all.find((x) => x.id === id);
                if (!f) return;
                setSpokeSel(f.spoke);
                setScenario(f.scenario);
              }}
              className="bg-transparent [&_.react-flow__node]:overflow-visible"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color={theme === "dark" ? "#243247" : "#dbe3ef"}
              />
              <Controls showInteractive={false} position="top-left" />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                ariaLabel="Overview"
                className="!h-[90px] !w-[150px] rounded border border-[var(--d-node-line)]"
                maskColor={theme === "dark" ? "rgba(15,20,28,0.72)" : "rgba(247,249,252,0.72)"}
                nodeColor={(n) =>
                  (n.data as TNode).kind === "frame" ? PALETTE[theme].zone : PALETTE[theme].nodeLine
                }
              />
              <Panel position="bottom-left" className="!m-2">
                <div
                  className="rounded-md border p-2 text-[11px] shadow-sm backdrop-blur"
                  aria-label="Legend"
                  style={{
                    background: `${PALETTE[theme].bg}ee`,
                    borderColor: "var(--d-node-line)",
                  }}
                >
                  <p className="mb-1 font-semibold">Legend · click to show or hide</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {(Object.keys(KIND_STYLE) as TrafficKind[]).map((k) => {
                      const st = KIND_STYLE[k];
                      const off = hidden.has(k);
                      return (
                        <button
                          key={k}
                          aria-pressed={!off}
                          onClick={() =>
                            setHidden((h) => {
                              const n = new Set(h);
                              if (n.has(k)) n.delete(k);
                              else n.add(k);
                              return n;
                            })
                          }
                          className={cn(
                            "flex items-center gap-1.5 rounded px-1 text-left hover:bg-muted",
                            off && "opacity-35",
                          )}
                        >
                          <svg width="28" height="6" aria-hidden>
                            <line
                              x1="0"
                              y1="3"
                              x2="28"
                              y2="3"
                              stroke={st.color}
                              strokeWidth="3"
                              strokeDasharray={st.dash}
                            />
                          </svg>
                          {st.label}
                        </button>
                      );
                    })}
                    <span className="flex items-center gap-1.5 px-1">
                      <svg width="28" height="6" aria-hidden>
                        <line
                          x1="0"
                          y1="3"
                          x2="28"
                          y2="3"
                          stroke={WIRE.peering.color}
                          strokeWidth="1.6"
                        />
                      </svg>
                      Peering
                    </span>
                    <span className="flex items-center gap-1.5 px-1">
                      <svg width="28" height="6" aria-hidden>
                        <line
                          x1="0"
                          y1="3"
                          x2="28"
                          y2="3"
                          stroke={WIRE.er.color}
                          strokeWidth="2.4"
                        />
                      </svg>
                      ExpressRoute
                    </span>
                    <span className="flex items-center gap-1.5 px-1">
                      <svg width="28" height="6" aria-hidden>
                        <line
                          x1="0"
                          y1="3"
                          x2="28"
                          y2="3"
                          stroke={BACK}
                          strokeWidth="2.4"
                          strokeDasharray="7 5"
                        />
                      </svg>
                      Reply
                    </span>
                    <span className="flex items-center gap-1.5 px-1">
                      <span className="grid size-3.5 place-items-center rounded-full bg-[#a4262c] text-[8px] font-bold text-white">
                        ✕
                      </span>
                      Stops here
                    </span>
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          </div>
          <p
            className="border-t border-[var(--d-azure-line)] px-4 py-1.5 text-[11px]"
            style={{ color: "var(--d-sub)" }}
          >
            Icons: Microsoft's Azure architecture icons. Addresses: hubs as Microsoft's
            hub-and-spoke module allocates them (10.0.0.0/22, 10.1.0.0/22); spokes from this design,
            or the offering's range (10.60.0.0/19, a /22 per install). On-premises and internet
            addresses are examples.
          </p>
        </DiagramCanvas>

        {/* This hop, or the overview */}
        <aside className="space-y-3 xl:col-span-2" aria-label="This hop">
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
                  color={cur.dir === "back" ? BACK : color}
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
                  From{" "}
                  {t.corp[0]
                    ? spokeName(from && t.corp.includes(from) ? from : t.corp[0])
                    : "the first spoke"}
                  . Click one to follow a packet.
                </p>
              </header>
              <ul className="divide-y divide-border">
                {scenarios.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setScenario(s.id)}
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
              High availability keeps a region running through a component failure: the firewall
              spans availability zones, gateways use zone-redundant SKUs (VPN active-active), and a
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
              drop private ranges (10/8, 172.16/12, 192.168/16) — that's why spoke-to-spoke follows
              it to the firewall. Route Server isn't needed: Azure Firewall is steered by route
              tables or routing intent.
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
      {adding && set && tree && (
        <AddDialog
          adding={adding}
          onClose={() => setAdding(null)}
          tree={tree}
          answers={answers}
          set={set}
        />
      )}
    </TCtx.Provider>
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
