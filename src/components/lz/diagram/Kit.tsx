/*
 * Building blocks of the architecture standard for React Flow diagrams, matching the SVG traffic overview: a
 * canvas, boundaries (Azure, subscriptions, virtual networks, landing zones, on-premises), icon cards, and lane
 * connectors that glow, march and carry particles. Every diagram in the landing zone area is built from these.
 */
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, useStore } from "@xyflow/react";
import { Moon, Sun } from "lucide-react";
import { type CSSProperties, type ReactNode, useMemo } from "react";

import { cn } from "@/lib/utils";

import { type Rect, midOfLongest, routeAround, toPath } from "./router";
import { type DiagramTheme, PALETTE, useDiagramTheme } from "./theme";

/** Card-like node types that connectors route around; boundaries (zones, frames) and labels don't count. */
const OBSTACLES = new Set(["item", "ext", "part", "cloud", "mg", "gov"]);

export type CardState = "normal" | "selected" | "out" | "missing" | "dim" | "focus" | "changed";

/** The diagram's background and colour variables; everything inside reads them. */
export function DiagramCanvas({
  theme,
  className,
  children,
}: {
  theme: DiagramTheme;
  className?: string | undefined;
  children: ReactNode;
}) {
  const c = PALETTE[theme];
  const vars = {
    "--d-bg": c.bg,
    "--d-azure": c.azure,
    "--d-azure-line": c.azureLine,
    "--d-zone": c.zone,
    "--d-zone-line": c.zoneLine,
    "--d-node": c.node,
    "--d-node-line": c.nodeLine,
    "--d-text": c.text,
    "--d-sub": c.sub,
    "--d-muted": c.muted,
    "--d-band": c.band,
    "--d-accent": c.accent,
    background: c.bg,
    color: c.text,
  } as CSSProperties;
  return (
    <div data-diagram-theme={theme} className={cn("relative", className)} style={vars}>
      {children}
    </div>
  );
}

export function ThemeToggle({ className }: { className?: string | undefined }) {
  const [theme, setTheme] = useDiagramTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Light diagrams" : "Dark diagrams"}
      title={theme === "dark" ? "Light diagrams" : "Dark diagrams"}
      className={cn(
        "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  );
}

/** A component: Azure icon, title (two lines at most) and one line of detail. */
export function DiagramCard({
  icon,
  title,
  sub,
  state = "normal",
  tight,
  accent,
  badge,
  right,
  children,
  className,
  style,
  titleAttr,
}: {
  /** Path to an Azure icon (see azureIcon), or a node to draw instead. */
  icon?: string | ReactNode | undefined;
  title: ReactNode;
  sub?: ReactNode | undefined;
  state?: CardState | undefined;
  tight?: boolean | undefined;
  /** Ring colour when it's on a highlighted path. */
  accent?: string | undefined;
  /** A small marker in the top-right corner (counts, outcome). */
  badge?: ReactNode | undefined;
  /** Controls on the right (tick, actions). */
  right?: ReactNode | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  titleAttr?: string | undefined;
}) {
  const out = state === "out" || state === "missing";
  return (
    <div
      title={titleAttr}
      className={cn(
        "group relative flex h-full w-full items-center gap-2.5 rounded-[10px] border transition-[opacity,border-color,box-shadow]",
        tight ? "px-2 py-1" : "px-3 py-1.5",
        out ? "border-dashed opacity-60" : "",
        state === "selected" &&
          "ring-2 ring-[var(--d-accent)] ring-offset-2 ring-offset-[var(--d-bg)]",
        state === "dim" && "opacity-25",
        state === "changed" && "cd-glow",
        className,
      )}
      style={{
        background: "var(--d-node)",
        borderColor: accent ?? "var(--d-node-line)",
        boxShadow: accent ? `0 0 0 1.5px ${accent}, 0 0 16px ${accent}55` : undefined,
        ...style,
      }}
    >
      {typeof icon === "string" ? (
        <img
          src={icon}
          alt=""
          className={cn("shrink-0", tight ? "size-5" : "size-[26px]", out && "grayscale")}
        />
      ) : (
        icon
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span
          className={cn(
            "line-clamp-2 font-semibold",
            tight ? "text-[12px]" : "text-[13px]",
            out && "line-through decoration-[var(--d-muted)]",
          )}
          style={{ color: out ? "var(--d-muted)" : "var(--d-text)" }}
        >
          {title}
        </span>
        {sub && (
          <span
            className={cn("block truncate", tight ? "text-[10.5px]" : "text-[11px]")}
            style={{ color: "var(--d-sub)" }}
          >
            {sub}
          </span>
        )}
        {children}
      </span>
      {right}
      {badge && <span className="absolute -top-2.5 -right-2.5">{badge}</span>}
    </div>
  );
}

/** A boundary: Azure, a subscription, a virtual network (dashed), a group of landing zones, on-premises. */
export function DiagramZone({
  label,
  sub,
  kind = "zone",
  out,
  state,
  right,
  icon,
  className,
  children,
}: {
  label: ReactNode;
  sub?: ReactNode | undefined;
  kind?: "azure" | "subscription" | "vnet" | "zone" | "onprem" | "band" | undefined;
  out?: boolean | undefined;
  state?: "selected" | "changed" | undefined;
  right?: ReactNode | undefined;
  icon?: string | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
}) {
  const border =
    kind === "onprem" ? "#3b82f6" : kind === "azure" ? "var(--d-azure-line)" : "var(--d-zone-line)";
  const fill =
    kind === "azure"
      ? "var(--d-azure)"
      : kind === "band"
        ? "var(--d-band)"
        : kind === "onprem"
          ? "transparent"
          : "var(--d-zone)";
  return (
    <div
      className={cn(
        "relative h-full w-full rounded-[14px] border-[1.4px] transition-[border-color,box-shadow]",
        (kind === "vnet" || out) && "border-dashed",
        out && "opacity-60",
        state === "selected" &&
          "ring-2 ring-[var(--d-accent)] ring-offset-2 ring-offset-[var(--d-bg)]",
        state === "changed" && "cd-glow",
        className,
      )}
      style={{
        background: fill,
        borderColor: border,
        borderRadius: kind === "azure" ? 22 : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2 px-3.5 pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <img src={icon} alt="" className={cn("size-4 shrink-0", out && "grayscale")} />}
          <div className="min-w-0">
            <p
              className={cn("truncate text-[11.5px] font-semibold", out && "line-through")}
              style={{
                color:
                  kind === "onprem"
                    ? "#60a5fa"
                    : kind === "azure"
                      ? "var(--d-text)"
                      : "var(--d-sub)",
              }}
            >
              {label}
            </p>
            {sub && (
              <p className="truncate text-[10.5px]" style={{ color: "var(--d-muted)" }}>
                {sub}
              </p>
            )}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** A numbered marker for a traffic category or hop, like the overview's. */
export function DiagramBadge({
  n,
  color,
  title,
}: {
  n: ReactNode;
  color: string;
  title?: string | undefined;
}) {
  return (
    <span
      title={title}
      className="grid size-[22px] place-items-center rounded-full text-[11px] font-extrabold text-white"
      style={{ background: color, boxShadow: "0 0 0 2px var(--d-bg)" }}
    >
      {n}
    </span>
  );
}

export type LaneEdgeData = {
  color?: string | undefined;
  label?: string | undefined;
  /** Marching dashes and particles: a live connection. */
  live?: boolean | undefined;
  /** Drawn faint (not on the highlighted path, or left out of the design). */
  dim?: boolean | undefined;
  /** Dashed but still (a planned or optional connection). */
  dashed?: boolean | undefined;
  /** Offset parallel lanes between the same cards. */
  lane?: number | undefined;
  /** Override the orthogonal offset. */
  offset?: number | undefined;
  /** Custom dash pattern for reply/fallback paths. */
  dash?: string | undefined;
  /** Start particles out of phase when many paths are live. */
  begin?: number | undefined;
  width?: number | undefined;
  /** Route around cards (default); false draws the plain step line. */
  avoid?: boolean | undefined;
};

/** A connector in the standard: orthogonal, glowing, dashed, with particles running along it when live. */
export function LaneEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  source,
  target,
}: EdgeProps & { data?: LaneEdgeData }) {
  // Card rectangles as a string, so the edge re-routes only when cards move, not on every pan or zoom.
  const sig = useStore((st) => {
    const parts: string[] = [];
    st.nodeLookup.forEach((n) => {
      if (n.id === source || n.id === target || !OBSTACLES.has(n.type ?? "") || n.hidden) return;
      const w = n.measured.width ?? n.width ?? 0;
      const h = n.measured.height ?? n.height ?? 0;
      if (!w || !h) return;
      const p = n.internals.positionAbsolute;
      parts.push(`${n.id}|${Math.round(p.x)}|${Math.round(p.y)}|${Math.round(w)}|${Math.round(h)}`);
    });
    return parts.join(";");
  });
  const lane = data?.lane ?? 0;
  const avoid = data?.avoid !== false;
  const { path, lx, ly } = useMemo(() => {
    const rects: Rect[] =
      !avoid || !sig
        ? []
        : sig.split(";").map((r) => {
            const [rid, x, y, w, h] = r.split("|");
            return { id: rid!, x: +x!, y: +y!, w: +w!, h: +h! };
          });
    const pts = routeAround(
      { x: sourceX, y: sourceY },
      sourcePosition,
      { x: targetX, y: targetY },
      targetPosition,
      rects,
      lane,
    );
    const m = midOfLongest(pts);
    return { path: toPath(pts), lx: m.x, ly: m.y };
  }, [avoid, lane, sig, sourcePosition, sourceX, sourceY, targetPosition, targetX, targetY]);

  const color = data?.color ?? "#4da3ff";
  const live = !!data?.live;
  const width = data?.width ?? 2.2;
  const dash = live || data?.dashed ? (data?.dash ?? "7 4") : undefined;
  const begin = data?.begin ?? 0;
  return (
    <>
      <g opacity={data?.dim ? 0.18 : 1}>
        {(live || !data?.dashed) && (
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeOpacity={0.22}
            strokeWidth={width + 5}
            style={{ filter: "blur(3px)" }}
          />
        )}
        <BaseEdge
          id={id}
          path={path}
          {...(markerEnd ? { markerEnd } : {})}
          style={{
            stroke: color,
            strokeWidth: width,
            strokeDasharray: dash,
            animation: live ? "cd-march 0.9s linear infinite" : undefined,
          }}
        />
        {live &&
          [0, 0.5].map((phase) => (
            <circle
              key={phase}
              r={4}
              fill={color}
              style={{ filter: `drop-shadow(0 0 4px ${color})` }}
            >
              <animateMotion
                dur="2.4s"
                begin={`${phase * 2.4 - begin}s`}
                repeatCount="indefinite"
                path={path}
              />
            </circle>
          ))}
      </g>
      {data?.label && (
        <EdgeLabelRenderer>
          <span
            className="nodrag nopan pointer-events-none absolute rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap"
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              background: "var(--d-bg)",
              borderColor: `${color}b3`,
              color,
              opacity: data.dim ? 0.25 : 1,
            }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
