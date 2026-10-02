/*
 * The landing zone as a map you can move around: two views (architecture, management groups), laid out by code,
 * with connectors only where something is really connected. Click a box to zoom into it, click a part to see
 * and change it on the right; Esc goes back to the whole picture. A traffic flow lights up its path hop by hop.
 */
import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
} from "@xyflow/react";
import { ChevronRight, CircleAlert, CircleHelp, Maximize, Plus, UserRound } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { AlzLibrary, Answers, MgNode } from "@/lib/alz/engine";
import type { Flow, Sel, Spoke } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

import { TOOLS, toggleTool, toolOn } from "./parts";
import { type Adding, AddDialog } from "../HierarchyEditor";
import { type Check, accessChecks, checkSummary } from "@/lib/alz/access-checks";

import { changedIds } from "./changed";
import { StatusIcon } from "./StatusIcon";
import { type Govern, GovernDialog } from "./GovernDialog";
import {
  DiagramBadge,
  DiagramCanvas,
  DiagramCard,
  DiagramZone,
  LaneEdge,
  ThemeToggle,
} from "../diagram/Kit";
import { OUTCOME, PALETTE, azureIcon, useDiagramTheme } from "../diagram/theme";
import {
  type ExtData,
  type GovData,
  type Graph,
  type ItemData,
  type LabelData,
  type MapNode,
  type MgData,
  type Rect,
  type ZoneData,
  architecture,
  governance,
  hierarchy,
} from "./layout";

export type View = "architecture" | "hierarchy" | "governance";
type Ctx = {
  sel: Sel | null;
  edit: boolean;
  changed: Set<string>;
  hops: Map<string, number[]>;
  step: number;
  color: string;
  involved: Set<string> | null;
  /** Where the traffic stops (blocked, isolated or broken). */
  stopAt: string | null;
  /** Hops with a gap, and how bad. */
  gaps: Map<string, "fail" | "warn">;
};
const MapCtx = createContext<Ctx>({
  sel: null,
  edit: false,
  changed: new Set(),
  hops: new Map(),
  step: 0,
  color: "#0078d4",
  involved: null,
  stopAt: null,
  gaps: new Map(),
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
        "nodrag nopan grid size-5 shrink-0 place-items-center rounded-full border text-[10px] leading-none shadow-sm",
        on
          ? "border-[var(--d-accent)] bg-[var(--d-accent)] text-white"
          : "border-[var(--d-muted)] bg-[var(--d-node)] text-[var(--d-muted)] hover:border-[var(--d-accent)] hover:text-[var(--d-accent)]",
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
  const gap = c.gaps.get(id);
  return (
    <span className="absolute -top-2.5 -left-2.5 z-10 flex gap-0.5">
      {hops.map((i) => (
        <span
          key={i}
          className={cn(i === c.step && "rounded-full ring-4")}
          style={{ ["--tw-ring-color" as string]: `${c.color}55` }}
        >
          <DiagramBadge n={i + 1} color={c.color} />
        </span>
      ))}
      {c.stopAt === id && (
        <span
          title="Traffic stops here"
          className="grid size-5 place-items-center rounded-full bg-[#a4262c] text-[11px] font-bold text-white shadow ring-2 ring-white"
        >
          ✕
        </span>
      )}
      {gap && c.stopAt !== id && (
        <span
          title={gap === "fail" ? "Gap on this hop" : "Needs attention on this hop"}
          className={cn(
            "grid size-5 place-items-center rounded-full text-[11px] font-bold text-white shadow ring-2 ring-white",
            gap === "fail" ? "bg-[#a4262c]" : "bg-[#c19c00]",
          )}
        >
          !
        </span>
      )}
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

function ZoneNode({ id, data }: NodeProps<Node<ZoneData>>) {
  const c = useContext(MapCtx);
  const dim = !!c.involved && !c.hops.has(id);
  const selected = same(c.sel, data.sel);
  const state = selected ? "selected" : c.changed.has(id) ? "changed" : undefined;
  return (
    <DiagramZone
      label={data.title}
      kind={
        data.zoneKind ??
        (data.tone === "vnet" ? "vnet" : data.tone === "sub" ? "subscription" : "zone")
      }
      out={!data.on}
      className={cn(
        data.sel && "cursor-zoom-in hover:border-[var(--d-accent)]",
        dim && "opacity-25",
      )}
      {...(data.subtitle ? { sub: data.subtitle } : {})}
      {...(state ? { state } : {})}
      {...(data.iconId ? { icon: azureIcon(data.iconId) } : {})}
      {...(c.edit && data.toggle ? { right: <Tick on={data.on} onClick={data.toggle} /> } : {})}
    >
      <Handles />
      <Hops id={id} />
    </DiagramZone>
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
          "flex h-full w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[var(--d-muted)] bg-[var(--d-node)] text-[11.5px] text-[var(--d-sub)] hover:border-[var(--d-accent)] hover:text-[var(--d-accent)]",
          dim && "opacity-40",
          c.changed.has(id) && "cd-glow",
        )}
      >
        <Handles />
        <Plus className="size-3.5" /> {data.label}
      </div>
    );
  const Icon = data.icon;
  const selected = same(c.sel, data.sel);
  const out = !data.on;
  const icon = data.iconId ? (
    azureIcon(data.iconId)
  ) : Icon ? (
    <Icon className="size-5 shrink-0 text-[var(--d-accent)]" />
  ) : undefined;
  return (
    <DiagramCard
      title={data.label}
      titleAttr={`${data.label}${data.detail ? ` — ${data.detail}` : ""}`}
      state={dim ? "dim" : selected ? "selected" : out ? "out" : "normal"}
      className={cn(
        "cursor-pointer",
        data.variant === "ghost" && "border-dashed opacity-70",
        c.changed.has(id) && "cd-glow",
      )}
      {...(icon ? { icon } : {})}
      {...(data.detail ? { sub: data.detail } : {})}
      {...(inFlow ? { accent: c.color } : {})}
      {...(c.edit && data.toggle ? { right: <Tick on={data.on} onClick={data.toggle} /> } : {})}
    >
      <Handles />
      <Hops id={id} />
      <Actions actions={data.actions} />
    </DiagramCard>
  );
}

function ExtNode({ id, data }: NodeProps<Node<ExtData>>) {
  const c = useContext(MapCtx);
  const inFlow = c.hops.has(id);
  const Icon = data.icon;
  const dim = !!c.involved && !inFlow;
  return (
    <DiagramCard
      icon={
        data.iconId ? (
          azureIcon(data.iconId)
        ) : (
          <Icon className="size-5 shrink-0 text-[var(--d-accent)]" />
        )
      }
      title={data.label}
      sub={data.detail}
      state={dim ? "dim" : same(c.sel, data.sel) ? "selected" : "normal"}
      className="cursor-pointer"
      {...(inFlow ? { accent: c.color } : {})}
    >
      <Handles />
      <Hops id={id} />
    </DiagramCard>
  );
}

function LabelNode({ data }: NodeProps<Node<LabelData>>) {
  return (
    <p className="pointer-events-none text-[11px] font-semibold tracking-[0.18em] text-[var(--d-sub)] uppercase">
      {data.text}
    </p>
  );
}

const CHECK_TONE: Record<Check["status"], { mark: string; color: string; label: string }> = {
  pass: { mark: OUTCOME.reaches.mark, color: OUTCOME.reaches.color, label: "Pass" },
  warn: { mark: OUTCOME["needs-rules"].mark, color: OUTCOME["needs-rules"].color, label: "Fix" },
  fail: { mark: OUTCOME.broken.mark, color: OUTCOME.broken.color, label: "Fix" },
  confirm: { mark: "?", color: OUTCOME.isolated.color, label: "Confirm" },
};

const checkStatus = (issues: Check[]): Check["status"] =>
  issues.some((x) => x.status === "fail")
    ? "fail"
    : issues.some((x) => x.status === "warn")
      ? "warn"
      : issues.some((x) => x.status === "confirm")
        ? "confirm"
        : "pass";

function InlineTick({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Leave out of the design"
      aria-pressed
      className="nodrag nopan grid size-5 shrink-0 place-items-center rounded-md border border-[var(--d-accent)] bg-[var(--d-accent)] text-[11px] font-bold text-white shadow-[0_0_10px_rgba(77,163,255,0.45)]"
    >
      ✓
    </button>
  );
}

function MgCard({ id, data }: NodeProps<Node<MgData>>) {
  const c = useContext(MapCtx);
  const selected = same(c.sel, data.sel);
  const changed = c.changed.has(id);
  const policyBadge =
    typeof data.policyCount === "number" ? (
      <DiagramBadge
        n={data.policyCount}
        color={data.included ? OUTCOME.reaches.color : "#64748b"}
        title="Policies assigned here"
      />
    ) : undefined;
  const icon = data.root ? azureIcon("users") : azureIcon("subscription");
  return (
    <div className="group relative h-full w-full">
      <Handles />
      <Actions actions={data.actions} />
      <DiagramCard
        icon={icon}
        title={data.title}
        sub={data.counts}
        state={!data.included ? "out" : selected ? "selected" : "normal"}
        badge={policyBadge}
        right={c.edit && data.toggle ? <InlineTick onClick={data.toggle} /> : undefined}
        className={cn(
          "cursor-pointer overflow-visible pr-2",
          data.root && "border-dashed",
          data.custom && "border-[var(--d-accent)]",
          changed && "cd-glow",
        )}
        titleAttr={
          data.included ? "Click to inspect this management group" : "Click to add this group back"
        }
      >
        {data.tags.length > 0 && (
          <div className="mt-1.5 flex max-h-[44px] flex-wrap gap-1 overflow-hidden">
            {data.tags.slice(0, 4).map((t) => (
              <span
                key={t.label}
                title={t.pending ? "Created when a customer is onboarded" : undefined}
                className={cn(
                  "inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap",
                  t.pending
                    ? "border-dashed border-amber-300/70 bg-amber-300/10 text-amber-100"
                    : t.on
                      ? "border-sky-300/40 bg-sky-300/10 text-sky-100"
                      : "border-dashed border-[var(--d-muted)] text-[var(--d-muted)] line-through",
                )}
              >
                <img src={azureIcon("subscription")} alt="" className="size-3 shrink-0" />
                <span className="truncate">{t.label}</span>
              </span>
            ))}
            {data.tags.length > 4 && (
              <span className="text-[10px] text-[var(--d-sub)]">+{data.tags.length - 4}</span>
            )}
          </div>
        )}
      </DiagramCard>
    </div>
  );
}

function GovCard({ id, data }: NodeProps<Node<GovData>>) {
  const c = useContext(MapCtx);
  const selected = same(c.sel, data.sel);
  const status = checkStatus(data.issues);
  const tone = CHECK_TONE[status];
  const changed = c.changed.has(id);
  const icon = data.variant === "entra" ? azureIcon("users") : azureIcon("subscription");
  return (
    <div className="group relative h-full w-full">
      <Handles />
      <DiagramCard
        icon={icon}
        title={data.title}
        sub={data.lines ? "Identity and root checks" : data.policies}
        state={selected ? "selected" : "normal"}
        accent={status === "pass" ? undefined : tone.color}
        badge={<DiagramBadge n={tone.mark} color={tone.color} title={tone.label} />}
        className={cn("cursor-pointer items-start overflow-hidden", changed && "cd-glow")}
      >
        {data.lines ? (
          <ul className="mt-1 space-y-1">
            {data.lines.slice(0, 3).map((l) => (
              <li
                key={l.id}
                className="flex items-start gap-1.5 text-[10.5px] leading-snug"
                title={l.detail}
              >
                <StatusIcon status={l.status} className="mt-px size-3" />
                <span className="line-clamp-2">{l.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {!!data.added?.length && (
              <p className="mt-1 truncate text-[10.5px] text-sky-200" title={data.added.join(", ")}>
                + {data.added.join(", ")}
              </p>
            )}
            {!!data.weakened && (
              <p className="mt-1 text-[10.5px]" style={{ color: OUTCOME.broken.color }}>
                {data.weakened} ALZ polic{data.weakened === 1 ? "y" : "ies"} weakened
              </p>
            )}
            <ul className="mt-1 space-y-0.5 border-t border-[var(--d-node-line)] pt-1">
              {data.access?.slice(0, 3).map((r) => (
                <li
                  key={r.label}
                  className="flex items-center gap-1.5 truncate text-[10.5px]"
                  style={r.flag ? { color: OUTCOME["needs-rules"].color } : undefined}
                >
                  <UserRound className="size-3 shrink-0" />
                  <span className="truncate">
                    <b className="font-medium">{r.label}</b> · {r.role}
                  </span>
                </li>
              ))}
              {(data.access?.length ?? 0) > 3 && (
                <li className="text-[10.5px] text-[var(--d-sub)]">
                  +{data.access!.length - 3} more
                </li>
              )}
              {!data.access?.length && (
                <li className="text-[10.5px] text-[var(--d-muted)]">No roles here — inherited</li>
              )}
            </ul>
            {!!data.actions?.length && (
              <div className="mt-2 flex gap-1.5">
                {data.actions.map((a) => (
                  <button
                    key={a.label}
                    title={a.title}
                    onClick={(e) => {
                      e.stopPropagation();
                      a.onClick();
                    }}
                    className="nodrag nopan rounded-md border border-[var(--d-node-line)] bg-[var(--d-band)] px-2 text-[10.5px] leading-5 font-semibold text-[var(--d-text)] hover:border-[var(--d-accent)] hover:text-[var(--d-accent)]"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </DiagramCard>
    </div>
  );
}

/** A hop of a traffic flow: the path, a packet moving along it, and what routes it. */
function PacketEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  data,
}: EdgeProps) {
  const [path, lx, ly] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
    offset: 22,
  });
  const d = data as { color: string; current: boolean; gap?: "fail" | "warn" };
  return (
    <>
      <path
        d={path}
        fill="none"
        stroke={d.color}
        strokeOpacity={0.22}
        strokeWidth={10}
        style={{ filter: "blur(3px)" }}
      />
      <BaseEdge
        id={id}
        path={path}
        {...(style ? { style } : {})}
        {...(markerEnd ? { markerEnd } : {})}
      />
      <circle r={d.current ? 5 : 3.5} fill={d.color} stroke="white" strokeWidth={1.5}>
        <animateMotion dur={d.current ? "1.4s" : "2.6s"} repeatCount="indefinite" path={path} />
      </circle>
      {label && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-none absolute rounded-md border bg-[var(--d-bg)] px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap shadow-sm",
              d.current ? "z-20 font-semibold" : "opacity-90",
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              borderColor: d.color,
              color: d.gap === "fail" ? "#ef4444" : d.color,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { packet: PacketEdge, lane: LaneEdge };

const nodeTypes = {
  zone: ZoneNode,
  item: ItemNode,
  ext: ExtNode,
  label: LabelNode,
  mg: MgCard,
  gov: GovCard,
};

/* ------------------------------------------------------------------ edges */

const EDGE: Record<string, { stroke: string; dash?: string; width: number }> = {
  peering: { stroke: "#0078d4", width: 1.8 },
  onprem: { stroke: "#8661c5", dash: "6 4", width: 1.8 },
  public: { stroke: "#2fb3e8", dash: "6 4", width: 1.6 },
  tree: { stroke: "#8a8886", width: 1.3 },
  ghost: { stroke: "#c8c6c4", dash: "4 4", width: 1.2 },
  identity: { stroke: "#8661c5", dash: "6 4", width: 1.6 },
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
  /** Open the full list of best-practice checks (the Access panel). */
  onShowChecks?: (() => void) | undefined;
  onViewChange?: ((v: View) => void) | undefined;
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
  onShowChecks,
  onViewChange,
}: LandingZoneMapProps) {
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("architecture");
  const [adding, setAdding] = useState<Adding>(null);
  const [govern, setGovern] = useState<Govern>(null);
  const checks = useMemo(() => accessChecks(answers, tree), [answers, tree]);
  const summary = checkSummary(checks);
  const edit = !!set;
  const active = flow?.available ? flow : null;
  const [theme] = useDiagramTheme();
  const colors = PALETTE[theme];
  // A traffic flow is drawn on the architecture.
  useEffect(() => {
    if (active) setView("architecture");
  }, [active]);

  const graph: Graph = useMemo(
    () =>
      (view === "architecture" ? architecture : view === "hierarchy" ? hierarchy : governance)({
        lib,
        tree,
        answers,
        spokes,
        set,
        onAdd: setAdding,
        asIs,
        checks,
        onGovern: setGovern,
      }),
    // `set` is a fresh closure each render; the design itself is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, lib, tree, answers, spokes, edit, asIs, checks],
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
      stopAt:
        active && ["blocked", "isolated", "broken"].includes(active.outcome?.status ?? "")
          ? (hopIds.filter(Boolean).at(-1) ?? null)
          : null,
      gaps: new Map(
        active
          ? active.steps.flatMap((st, i) =>
              st.gap && hopIds[i] ? [[hopIds[i]!, st.gap.severity] as const] : [],
            )
          : [],
      ),
    }),
    [sel, edit, baseline, answers, hops, step, active, hopIds],
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
        zIndex:
          n.type === "zone"
            ? n.data.kind === "zone" && n.data.zoneKind === "azure"
              ? -2
              : n.parentId
                ? 1
                : 0
            : n.type === "label"
              ? 3
              : 2,
      })),
    [graph],
  );

  const edges: Edge[] = useMemo(() => {
    const rect = (id: string) => byId.get(id)?.abs;
    const out: Edge[] = graph.edges.map((e) => {
      const st = EDGE[e.kind]!;
      const standardLane =
        view === "architecture" ||
        ((view === "hierarchy" || view === "governance") &&
          (e.kind === "tree" || e.kind === "ghost" || e.kind === "identity"));
      const [s, t] =
        standardLane && view !== "architecture"
          ? (["b", "t"] as [Side, Side])
          : e.kind === "tree" || e.kind === "ghost"
            ? (["r", "l"] as [Side, Side])
            : sides(rect(e.source)!, rect(e.target)!);
      const laneData = standardLane
        ? {
            color: e.data?.color ?? st.stroke,
            dashed: e.data?.dashed ?? !!st.dash,
            width: e.data?.width ?? st.width,
            ...(active ? { dim: true } : e.data?.dim ? { dim: e.data.dim } : {}),
            ...(e.data?.live ? { live: e.data.live } : {}),
            ...(active || !(e.data?.label ?? e.label) ? {} : { label: e.data?.label ?? e.label }),
          }
        : undefined;
      const laneProps = laneData ? { data: laneData } : {};
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: s,
        targetHandle: t,
        type: standardLane ? "lane" : "smoothstep",
        pathOptions: { borderRadius: 10, offset: 18 },
        // While a flow plays, its own hop labels are the ones to read.
        ...(standardLane ? laneProps : active || !e.label ? {} : { label: e.label }),
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
        zIndex: standardLane ? 1 : 5,
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
          type: "packet",
          label: active.steps[i]?.via,
          data: { color: active.color, current, gap: active.steps[i]?.gap?.severity },
          style: { stroke: active.color, strokeWidth: current ? 3.2 : 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: active.color, width: 16, height: 16 },
          zIndex: 10,
        };
        out.push(edge);
      });
    return out;
  }, [graph, byId, active, hopIds, step, view]);

  /* Navigation */
  const fitWidth = () => {
    const el = box.current;
    if (!el || !graph.nodes.length) return;
    const xs = graph.nodes.map((n) => n.abs.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...graph.nodes.map((n) => n.abs.x + n.abs.w));
    const y0 = Math.min(...graph.nodes.map((n) => n.abs.y));
    const y1 = Math.max(...graph.nodes.map((n) => n.abs.y + n.abs.h));
    const widthZoom = (el.clientWidth - 48) / (x1 - x0);
    const heightZoom = (el.clientHeight - 64) / (y1 - y0);
    // Every lens is drawn top-down in the standard, so all open on the whole picture, centred, from the top.
    const zoom = Math.min(1.05, Math.max(0.35, Math.min(widthZoom, heightZoom)));
    const x = Math.max(24, (el.clientWidth - (x1 - x0) * zoom) / 2) - x0 * zoom;
    const y = 52 - y0 * zoom;
    void rf.setViewport({ x, y, zoom }, { duration: 300 });
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
                ...(asIs ? [] : ([["governance", "Access & policy"]] as const)),
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setView(v);
                  onViewChange?.(v);
                }}
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
          {edit ? <ThemeToggle /> : <ThemeToggle className="ml-auto" />}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-3 py-1 text-[11px]">
          {view === "governance" ? (
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>
                Microsoft best practices:{" "}
                <b className="text-foreground">
                  {summary.passed} of {summary.scored}
                </b>{" "}
                pass
              </span>
              {summary.fix > 0 && (
                <span className="flex items-center gap-1 text-[#8a6100]">
                  <CircleAlert className="size-3" /> {summary.fix} to fix
                </span>
              )}
              {summary.confirm > 0 && (
                <span className="flex items-center gap-1 text-[#0078d4]">
                  <CircleHelp className="size-3" /> {summary.confirm} to confirm
                </span>
              )}
              {onShowChecks && (
                <button onClick={onShowChecks} className="font-medium text-primary hover:underline">
                  See every check
                </button>
              )}
              {edit && <span>· Use + access and + policy on any group.</span>}
            </span>
          ) : view === "hierarchy" ? (
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
        <DiagramCanvas
          theme={theme}
          className={cn(
            "relative overflow-hidden",
            full ? "min-h-0 flex-1" : "h-[calc(100vh-250px)] min-h-[560px]",
          )}
        >
          <div ref={box} className="h-full w-full">
            <ReactFlow
              key={view}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
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
              className="bg-transparent"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={18}
                size={1}
                color={colors.nodeLine}
              />
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
                maskColor={theme === "dark" ? "rgba(15,20,28,0.72)" : "rgba(240,244,250,0.72)"}
                nodeColor={(n) =>
                  n.type === "zone"
                    ? colors.zoneLine
                    : n.type === "ext"
                      ? colors.muted
                      : n.type === "label"
                        ? "transparent"
                        : colors.accent
                }
              />
              <Panel position="top-left" className="!m-2">
                <nav
                  aria-label="Where you are"
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] shadow-sm [&_.text-muted-foreground]:!text-[var(--d-sub)]"
                  style={{
                    background: "var(--d-node)",
                    borderColor: "var(--d-node-line)",
                    color: "var(--d-text)",
                  }}
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
        </DiagramCanvas>
      </div>
      {set && (
        <GovernDialog
          govern={govern}
          onClose={() => setGovern(null)}
          tree={tree}
          answers={answers}
          set={set}
        />
      )}
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
