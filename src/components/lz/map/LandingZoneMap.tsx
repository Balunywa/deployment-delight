/*
 * The landing zone as a map you can move around: two views (architecture, management groups), laid out by code,
 * with connectors only where something is really connected. Click a box to zoom into it, click a part to see
 * and change it on the right; Esc goes back to the whole picture. A traffic flow lights up its path hop by hop.
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
import { Building2, ChevronRight, KeyRound, Maximize, Network, Plus } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { AlzLibrary, Answers, MgNode } from "@/lib/alz/engine";
import type { Flow, Sel, Spoke } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

import { TOOLS, toggleTool, toolOn } from "./parts";
import { type Adding, AddDialog } from "../HierarchyEditor";
import { changedIds } from "./changed";
import {
  type ExtData,
  type Graph,
  type ItemData,
  type LabelData,
  type MapNode,
  type MgData,
  type Rect,
  type ZoneData,
  architecture,
  hierarchy,
} from "./layout";

type View = "architecture" | "hierarchy";
type Ctx = {
  sel: Sel | null;
  edit: boolean;
  changed: Set<string>;
  hops: Map<string, number[]>;
  step: number;
  color: string;
  involved: Set<string> | null;
};
const MapCtx = createContext<Ctx>({
  sel: null,
  edit: false,
  changed: new Set(),
  hops: new Map(),
  step: 0,
  color: "#0078d4",
  involved: null,
});

const same = (a: Sel | null, b: Sel | undefined) =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;

/* ------------------------------------------------------------------ nodes */

const HANDLE_STYLE = {
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
        <Handle
          key={id}
          id={id}
          type="source"
          position={p}
          isConnectable={false}
          style={HANDLE_STYLE}
        />
      ))}
    </>
  );
}

function Tick({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={on ? "Leave out of the design" : "Add to the design"}
      aria-pressed={on}
      className={cn(
        "nodrag nopan grid size-4 shrink-0 place-items-center rounded-[3px] border text-[10px] leading-none",
        on
          ? "border-[#0078d4] bg-[#0078d4] text-white"
          : "border-[#8a8886] bg-white text-[#8a8886] hover:border-[#0078d4]",
      )}
    >
      {on ? "✓" : "+"}
    </button>
  );
}

function Hops({ id }: { id: string }) {
  const c = useContext(MapCtx);
  const hops = c.hops.get(id);
  if (!hops) return null;
  return (
    <span className="absolute -top-2.5 -left-2.5 z-10 flex gap-0.5">
      {hops.map((i) => (
        <span
          key={i}
          className={cn(
            "grid size-5 place-items-center rounded-full text-[10px] font-bold text-white shadow",
            i === c.step && "ring-4",
          )}
          style={{ background: c.color, ["--tw-ring-color" as string]: `${c.color}55` }}
        >
          {i + 1}
        </span>
      ))}
    </span>
  );
}

function Actions({ actions }: { actions: ItemData["actions"] }) {
  if (!actions?.length) return null;
  return (
    <span className="absolute -top-3 right-1 z-10 hidden gap-1 group-hover:flex">
      {actions.map((a) => (
        <button
          key={a.label}
          title={a.title}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick();
          }}
          className={cn(
            "nodrag nopan rounded px-1.5 text-[10px] leading-5 font-medium text-white shadow",
            a.danger ? "bg-[#a4262c]" : "bg-[#0078d4]",
          )}
        >
          {a.label}
        </button>
      ))}
    </span>
  );
}

const ZONE_TONE: Record<ZoneData["tone"], string> = {
  sub: "border-[#c7e0f4] bg-[#f5f9fd]",
  vnet: "border-[#8ac7ea] bg-[#e8f4fc]",
  lz: "border-[#b7dcc2] bg-[#f4faf6]",
  quiet: "border-[#d2d0ce] bg-[#faf9f8]",
};

function ZoneNode({ id, data }: NodeProps<Node<ZoneData>>) {
  const c = useContext(MapCtx);
  const Icon = data.tone === "vnet" ? Network : data.tone === "lz" ? Building2 : KeyRound;
  return (
    <div
      className={cn(
        "h-full w-full rounded-lg border-[1.5px] transition-[border-color,box-shadow]",
        data.on ? ZONE_TONE[data.tone] : "border-dashed border-[#a19f9d] bg-white/70",
        data.sel && "cursor-zoom-in hover:border-[#0078d4]",
        same(c.sel, data.sel) && "ring-2 ring-[#0078d4] ring-offset-2",
        c.changed.has(id) && "cd-glow",
      )}
      title={data.sel ? "Click to zoom in and see its settings" : undefined}
    >
      <Handles />
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            data.tone === "sub"
              ? "text-[#c19c00]"
              : data.tone === "lz"
                ? "text-[#107c10]"
                : "text-[#0078d4]",
            !data.on && "text-[#a19f9d]",
          )}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-[13px] leading-tight font-semibold",
              !data.on && "text-[#8a8886] line-through",
            )}
          >
            {data.title}
          </p>
          {data.subtitle && <p className="truncate text-[11px] text-[#605e5c]">{data.subtitle}</p>}
        </div>
        {c.edit && data.toggle && <Tick on={data.on} onClick={data.toggle} />}
      </div>
    </div>
  );
}

function ItemNode({ id, data }: NodeProps<Node<ItemData>>) {
  const c = useContext(MapCtx);
  const inFlow = c.hops.has(id);
  const dim = !!c.involved && !inFlow;
  if (data.variant === "add")
    return (
      <div
        className={cn(
          "flex h-full w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-[#8a8886] bg-white/60 text-[11.5px] text-[#605e5c] hover:border-[#0078d4] hover:text-[#0078d4]",
          dim && "opacity-40",
        )}
      >
        <Handles />
        <Plus className="size-3.5" /> {data.label}
      </div>
    );
  const Icon = data.icon;
  return (
    <div
      className={cn(
        "group relative flex h-full w-full cursor-pointer items-center gap-2 rounded-md border bg-white px-2 transition-[opacity,border-color]",
        data.on && data.variant !== "ghost" && data.variant !== "more"
          ? "border-[#c8c6c4] shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#0078d4]"
          : "border-dashed border-[#a19f9d] text-[#8a8886]",
        same(c.sel, data.sel) && "ring-2 ring-[#0078d4]",
        inFlow && "ring-2 ring-offset-1",
        dim && "opacity-35",
        c.changed.has(id) && "cd-glow",
      )}
      style={inFlow ? { ["--tw-ring-color" as string]: c.color } : undefined}
      title={`${data.label}${data.detail ? ` — ${data.detail}` : ""}`}
    >
      <Handles />
      <Hops id={id} />
      <Actions actions={data.actions} />
      {Icon && (
        <span
          className="grid size-6 shrink-0 place-items-center rounded"
          style={{ background: data.on ? `${data.color}18` : "#f3f2f1" }}
        >
          <Icon className="size-3.5" style={{ color: data.on ? data.color : "#a19f9d" }} />
        </span>
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span
          className={cn("block truncate text-[11.5px] font-medium", !data.on && "line-through")}
        >
          {data.label}
        </span>
        {data.detail && data.on && (
          <span className="block truncate text-[10px] text-[#605e5c]">{data.detail}</span>
        )}
      </span>
      {c.edit && data.toggle && <Tick on={data.on} onClick={data.toggle} />}
    </div>
  );
}

function ExtNode({ id, data }: NodeProps<Node<ExtData>>) {
  const c = useContext(MapCtx);
  const inFlow = c.hops.has(id);
  const Icon = data.icon;
  return (
    <div
      className={cn(
        "relative flex h-full w-full cursor-pointer items-center gap-2.5 rounded-lg border border-[#c8c6c4] bg-[#f3f2f1] px-3 transition-opacity hover:border-[#0078d4]",
        same(c.sel, data.sel) && "ring-2 ring-[#0078d4]",
        inFlow && "ring-2 ring-offset-1",
        !!c.involved && !inFlow && "opacity-35",
      )}
      style={inFlow ? { ["--tw-ring-color" as string]: c.color } : undefined}
    >
      <Handles />
      <Hops id={id} />
      <Icon className="size-5 shrink-0 text-[#605e5c]" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12px] font-semibold">{data.label}</span>
        <span className="block truncate text-[10.5px] text-[#605e5c]">{data.detail}</span>
      </span>
    </div>
  );
}

function LabelNode({ data }: NodeProps<Node<LabelData>>) {
  return (
    <p className="pointer-events-none text-[11px] font-semibold tracking-wide text-[#605e5c] uppercase">
      {data.text}
    </p>
  );
}

function MgCard({ id, data }: NodeProps<Node<MgData>>) {
  const c = useContext(MapCtx);
  return (
    <div
      className={cn(
        "group relative flex h-full w-full flex-col justify-center rounded-lg border px-3 py-2 transition-colors",
        data.root
          ? "border-dashed border-[#8a8886] bg-white text-[#605e5c]"
          : data.included
            ? "cursor-pointer border-[#c8c6c4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#0078d4]"
            : "cursor-pointer border-dashed border-[#a19f9d] bg-white/60 text-[#8a8886] hover:border-[#0078d4] hover:text-[#0078d4]",
        data.custom && "border-[#0078d4]/60",
        same(c.sel, data.sel) && "ring-2 ring-[#0078d4] ring-offset-2",
        c.changed.has(id) && "cd-glow",
      )}
    >
      <Handles />
      <Actions actions={data.actions} />
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] leading-tight font-semibold",
            !data.included && "line-through",
          )}
        >
          {data.title}
        </p>
        {c.edit && data.toggle && <Tick on onClick={data.toggle} />}
      </div>
      <p className="truncate text-[10.5px] text-[#605e5c]">{data.counts}</p>
      {data.tags.length > 0 && (
        <div className="mt-1 flex gap-1 overflow-hidden">
          {data.tags.slice(0, 2).map((t) => (
            <span
              key={t.label}
              title={t.pending ? "Created when a customer is onboarded" : undefined}
              className={cn(
                "shrink-0 rounded-sm border px-1.5 text-[10px] whitespace-nowrap",
                t.pending
                  ? "border-dashed border-[#e8c65b] bg-[#fffbeb]"
                  : t.on
                    ? "border-[#e8c65b] bg-[#fff4ce]"
                    : "border-dashed border-[#a19f9d] text-[#8a8886] line-through",
              )}
            >
              {t.label}
            </span>
          ))}
          {data.tags.length > 2 && (
            <span className="text-[10px] text-[#605e5c]">+{data.tags.length - 2}</span>
          )}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { zone: ZoneNode, item: ItemNode, ext: ExtNode, label: LabelNode, mg: MgCard };

/* ------------------------------------------------------------------ edges */

const EDGE: Record<string, { stroke: string; dash?: string; width: number }> = {
  peering: { stroke: "#0078d4", width: 1.8 },
  onprem: { stroke: "#8661c5", dash: "6 4", width: 1.8 },
  public: { stroke: "#2fb3e8", dash: "6 4", width: 1.6 },
  tree: { stroke: "#8a8886", width: 1.3 },
  ghost: { stroke: "#c8c6c4", dash: "4 4", width: 1.2 },
};

type Side = "t" | "r" | "b" | "l";
function sides(a: Rect, b: Rect): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  // Side by side (with room between) → left/right; otherwise top/bottom.
  const apart = b.x >= a.x + a.w || a.x >= b.x + b.w;
  if (apart && Math.abs(dx) >= Math.abs(dy) * 0.4) return dx > 0 ? ["r", "l"] : ["l", "r"];
  return dy > 0 ? ["b", "t"] : ["t", "b"];
}

/* ------------------------------------------------------------------ map */

export type LandingZoneMapProps = {
  lib: AlzLibrary;
  tree: MgNode[];
  answers: Answers;
  set?: ((p: Partial<Answers>) => void) | undefined;
  spokes: Spoke[];
  sel: Sel | null;
  onSelect: (s: Sel | null) => void;
  flow: Flow | null;
  step: number;
  /** The saved design; anything that differs glows until it's saved. */
  baseline?: Answers | undefined;
  full?: boolean;
  /** Draw a scanned tenant: found parts solid, missing ones dashed. */
  asIs?: { parts: Set<string>; counts: Record<string, string>; present: Set<string> } | undefined;
};

export function LandingZoneMap(props: LandingZoneMapProps) {
  return (
    <ReactFlowProvider>
      <MapInner {...props} />
    </ReactFlowProvider>
  );
}

function MapInner({
  lib,
  tree,
  answers,
  set,
  spokes,
  sel,
  onSelect,
  flow,
  step,
  baseline,
  full,
  asIs,
}: LandingZoneMapProps) {
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("architecture");
  const [adding, setAdding] = useState<Adding>(null);
  const edit = !!set;
  const active = flow?.available ? flow : null;
  // A traffic flow is drawn on the architecture.
  useEffect(() => {
    if (active) setView("architecture");
  }, [active]);

  const graph: Graph = useMemo(
    () =>
      (view === "architecture" ? architecture : hierarchy)({
        lib,
        tree,
        answers,
        spokes,
        set,
        onAdd: setAdding,
        asIs,
      }),
    // `set` is a fresh closure each render; the design itself is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, lib, tree, answers, spokes, edit, asIs],
  );
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // Where each hop of the flow is drawn: the part itself, or the box it's in when the part isn't shown.
  const hopIds = useMemo(() => {
    if (!active) return [];
    return active.steps.map((s) => {
      if (byId.has(s.at)) return s.at;
      const spoke = spokes.find((x) => `spoke:${x.id}` === s.at);
      if (spoke && byId.has(`sub:${spoke.group}`)) return `sub:${spoke.group}`;
      return null;
    });
  }, [active, byId, spokes]);
  const hops = useMemo(() => {
    const m = new Map<string, number[]>();
    hopIds.forEach((id, i) => id && m.set(id, [...(m.get(id) ?? []), i]));
    return m;
  }, [hopIds]);

  const ctx: Ctx = useMemo(
    () => ({
      sel,
      edit,
      changed: changedIds(baseline, answers),
      hops,
      step,
      color: active?.color ?? "#0078d4",
      involved: active ? new Set(hops.keys()) : null,
    }),
    [sel, edit, baseline, answers, hops, step, active],
  );

  const nodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.rel,
        ...(n.parentId ? { parentId: n.parentId } : {}),
        data: n.data,
        width: n.abs.w,
        height: n.abs.h,
        style: { width: n.abs.w, height: n.abs.h },
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: n.type === "zone" ? (n.parentId ? 1 : 0) : 2,
      })),
    [graph],
  );

  const edges: Edge[] = useMemo(() => {
    const rect = (id: string) => byId.get(id)?.abs;
    const out: Edge[] = graph.edges.map((e) => {
      const st = EDGE[e.kind]!;
      const [s, t] =
        e.kind === "tree" || e.kind === "ghost"
          ? (["r", "l"] as [Side, Side])
          : sides(rect(e.source)!, rect(e.target)!);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: s,
        targetHandle: t,
        type: "smoothstep",
        pathOptions: { borderRadius: 10, offset: 18 },
        label: e.label,
        labelStyle: { fontSize: 10.5, fill: st.stroke, fontWeight: 500 },
        labelBgStyle: { fill: "#ffffff" },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 3,
        style: {
          stroke: st.stroke,
          strokeWidth: st.width,
          strokeDasharray: st.dash,
          opacity: active ? 0.25 : 1,
        },
        zIndex: 5,
      };
    });
    if (active)
      hopIds.forEach((from, i) => {
        const to = hopIds[i + 1];
        if (!from || !to || from === to) return;
        const [s, t] = sides(rect(from)!, rect(to)!);
        const current = i + 1 === step;
        const edge = {
          id: `flow:${i}`,
          source: from,
          target: to,
          sourceHandle: s,
          targetHandle: t,
          type: "smoothstep",
          pathOptions: { borderRadius: 12, offset: 22 },
          animated: true,
          style: { stroke: active.color, strokeWidth: current ? 3.5 : 2.4 },
          markerEnd: { type: MarkerType.ArrowClosed, color: active.color, width: 16, height: 16 },
          zIndex: 10,
        };
        out.push(edge);
      });
    return out;
  }, [graph, byId, active, hopIds, step]);

  /* Navigation */
  const fitWidth = () => {
    const el = box.current;
    if (!el || !graph.nodes.length) return;
    const xs = graph.nodes.map((n) => n.abs.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...graph.nodes.map((n) => n.abs.x + n.abs.w));
    const y0 = Math.min(...graph.nodes.map((n) => n.abs.y));
    const zoom = Math.min(1.05, Math.max(0.35, (el.clientWidth - 48) / (x1 - x0)));
    // The tree opens level with its root; the architecture opens at the top.
    const root = view === "hierarchy" ? byId.get("mg-root") : undefined;
    const y = root ? el.clientHeight / 2 - (root.abs.y + root.abs.h / 2) * zoom : 52 - y0 * zoom;
    void rf.setViewport({ x: 24 - x0 * zoom, y, zoom }, { duration: 300 });
  };
  const whole = () => void rf.fitView({ padding: 0.05, duration: 400 });
  const focus = (ids: string[]) =>
    void rf.fitView({
      nodes: ids.map((id) => ({ id })),
      padding: 0.18,
      duration: 450,
      maxZoom: 1.25,
    });

  // Readable on arrival: the full width, starting at the top.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready) return;
    fitWidth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ready, full]);
  // Follow the flow the first time it's picked.
  const flowId = active?.id;
  useEffect(() => {
    if (!ready || !flowId) return;
    const ids = hopIds.filter((x): x is string => !!x);
    if (ids.length) setTimeout(() => focus(ids), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, ready]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "Escape") {
        onSelect(null);
        whole();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Breadcrumb: where the selected part sits.
  const crumbs = useMemo(() => {
    if (!sel) return [];
    const hit = graph.nodes.find(
      (n) => "sel" in n.data && same(sel, n.data.sel) && n.type !== "label",
    );
    const chain: MapNode[] = [];
    for (let n = hit; n; n = n.parentId ? byId.get(n.parentId) : undefined) chain.unshift(n);
    return chain;
  }, [sel, graph, byId]);
  const title = (n: MapNode) =>
    "title" in n.data ? n.data.title : "label" in n.data ? n.data.label : n.id;

  const click = (_: unknown, node: Node) => {
    const d = node.data as MapNode["data"];
    if (d.kind === "label") return;
    if (d.kind === "item" && d.onClick) return d.onClick();
    if (d.kind === "mg" && d.restore) return d.restore();
    if ("sel" in d && d.sel) onSelect(d.sel);
    if (d.kind === "zone" && d.sel) focus([node.id]);
  };

  return (
    <MapCtx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-3 py-1.5 text-[12px]">
          <div className="flex rounded-md border border-border bg-muted/40 p-0.5" role="tablist">
            {(
              [
                ["architecture", "Architecture"],
                ["hierarchy", "Management groups"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded px-2.5 py-1 font-medium",
                  view === v
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground">Zoom to</span>
            {graph.sections.map((s) => (
              <button
                key={s.label}
                onClick={() => focus(s.ids)}
                className="rounded border border-border bg-card px-2 py-0.5 hover:border-primary hover:text-primary"
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={whole}
              className="flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 hover:border-primary hover:text-primary"
            >
              <Maximize className="size-3" /> Whole picture
            </button>
          </div>
          {edit && (
            <button
              onClick={() => setAdding({ kind: "group", parent: "landingzones" })}
              className="ml-auto flex items-center gap-1 rounded border border-dashed border-[#8a8886] px-2 py-0.5 text-[#605e5c] hover:border-primary hover:text-primary"
            >
              <Plus className="size-3" /> Add a management group
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-3 py-1 text-[11px]">
          {view === "hierarchy" ? (
            <span className="text-muted-foreground">
              Numbers are policies assigned at each group and inherited from above. Hover a group to
              add under it or remove it.
            </span>
          ) : (
            <span className="mr-1 text-muted-foreground">Every subscription gets</span>
          )}
          {view === "architecture" &&
            TOOLS.map((t) => {
              const onNow = toolOn(t, answers);
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  title={`${t.body}${edit && t.answer ? ` Click to turn it ${onNow ? "off" : "on"}.` : ""}`}
                  onClick={() =>
                    set && t.answer
                      ? set(toggleTool(t, answers))
                      : onSelect({ kind: "tool", id: t.id })
                  }
                  className={cn(
                    "flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
                    ctx.changed.has(`tool:${t.id}`) && "cd-glow",
                    onNow
                      ? "border-[#c7e0f4] bg-card"
                      : "border-dashed border-[#a19f9d] text-[#a19f9d] line-through",
                  )}
                >
                  <Icon className="size-3" />
                  {t.label}
                </button>
              );
            })}
          <span className="ml-auto flex items-center gap-3 text-muted-foreground">
            {view === "architecture" && (
              <>
                <span className="flex items-center gap-1">
                  <span className="h-0.5 w-4 bg-[#0078d4]" /> Peering
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-4 border-t-2 border-dashed border-[#8661c5]" /> On-premises
                </span>
                {active && (
                  <span className="flex items-center gap-1">
                    <span
                      className="w-4 border-t-2 border-dashed"
                      style={{ borderColor: active.color }}
                    />
                    Traffic
                  </span>
                )}
              </>
            )}
            <span className="flex items-center gap-1">
              <span className="h-3 w-4 rounded-sm border border-dashed border-[#a19f9d]" /> Left out
            </span>
            {ctx.changed.size > 0 && (
              <span className="flex items-center gap-1">
                <span className="cd-glow-key rounded-sm px-1">amber</span> not saved
              </span>
            )}
          </span>
        </div>
        <div
          ref={box}
          className={cn(
            "relative",
            full ? "min-h-0 flex-1" : "h-[calc(100vh-250px)] min-h-[560px]",
          )}
        >
          <ReactFlow
            key={view}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={() => setReady(true)}
            onNodeClick={click}
            onPaneClick={() => onSelect(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            connectionMode={ConnectionMode.Loose}
            panOnScroll
            zoomOnDoubleClick={false}
            minZoom={0.2}
            maxZoom={1.8}
            className="bg-white"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e1dfdd" />
            <Controls
              showInteractive={false}
              orientation="horizontal"
              position="bottom-left"
              onFitView={whole}
              fitViewOptions={{ padding: 0.05 }}
            />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              ariaLabel="Map overview"
              className="!h-[90px] !w-[140px] rounded border border-border"
              maskColor="rgba(240,240,240,0.7)"
              nodeColor={(n) =>
                n.type === "zone"
                  ? "#dbeafe"
                  : n.type === "ext"
                    ? "#e5e7eb"
                    : n.type === "label"
                      ? "transparent"
                      : "#93c5fd"
              }
            />
            <Panel position="top-left" className="!m-2">
              <nav
                aria-label="Where you are"
                className="flex items-center gap-1 rounded-md border border-border bg-card/95 px-2 py-1 text-[11.5px] shadow-sm"
              >
                <button
                  onClick={() => {
                    onSelect(null);
                    whole();
                  }}
                  className={cn(
                    "hover:text-primary",
                    crumbs.length ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {view === "architecture" ? "Whole landing zone" : "Tenant root"}
                </button>
                {!crumbs.length && (
                  <span className="text-muted-foreground">
                    · click a box to zoom in, Esc to come back
                  </span>
                )}
                {crumbs.map((n, i) => (
                  <span key={n.id} className="flex items-center gap-1">
                    <ChevronRight className="size-3 text-muted-foreground" />
                    <button
                      onClick={() => {
                        const d = n.data;
                        if ("sel" in d && d.sel) onSelect(d.sel);
                        focus([n.id]);
                      }}
                      className={cn(
                        "max-w-[220px] truncate hover:text-primary",
                        i === crumbs.length - 1 ? "font-medium" : "text-muted-foreground",
                      )}
                    >
                      {title(n)}
                    </button>
                  </span>
                ))}
              </nav>
            </Panel>
          </ReactFlow>
        </div>
      </div>
      {adding && set && (
        <AddDialog
          adding={adding}
          onClose={() => setAdding(null)}
          tree={tree}
          answers={answers}
          set={set}
        />
      )}
    </MapCtx.Provider>
  );
}
