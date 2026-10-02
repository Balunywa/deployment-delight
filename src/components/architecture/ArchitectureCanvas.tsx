import { Lock, X } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DiagramCard, DiagramZone, ThemeToggle } from "@/components/lz/diagram/Kit";
import { PALETTE, azureIcon, useDiagramTheme } from "@/components/lz/diagram/theme";
import {
  CUSTOMER_PLATFORM,
  SERVICE_BY_ID,
  type Edge,
  type Selected,
  type Topology,
  type Zone,
  edgesFor,
} from "@/lib/catalog";
import { cn } from "@/lib/utils";

import { ServiceIcon } from "./ServiceIcon";

type Props = {
  selected: Selected[];
  topology: Topology;
  focus?: string | null;
  onFocus?: (id: string | null) => void;
  onRemove?: (id: string) => void;
  /** Customer-specific values bound to the consumed platform resources. */
  bindings?: Record<string, string | boolean | undefined>;
  installName?: string;
  /** Per-node status overlay, e.g. during a deployment run. */
  status?: Record<string, "pending" | "running" | "succeeded" | "failed">;
  compact?: boolean;
  /** Numbered badges, e.g. the "how it works" step each service belongs to. */
  markers?: Record<string, number>;
  /** Services to emphasise; the rest dim. */
  highlight?: string[] | null | undefined;
};

const LANES: { zone: Zone | "endpoints"; label: string; sub: string; empty: string }[] = [
  {
    zone: "edge",
    label: "Ingress subnet",
    sub: "Public edge and private origins",
    empty: "No public or private ingress",
  },
  {
    zone: "app",
    label: "Application subnet",
    sub: "Compute and APIs",
    empty: "Add a compute service",
  },
  {
    zone: "integration",
    label: "Integration subnet",
    sub: "Events, queues and routing",
    empty: "No messaging",
  },
  { zone: "data", label: "Data subnet", sub: "Stateful services", empty: "Add a data service" },
  {
    zone: "endpoints",
    label: "Endpoint subnet",
    sub: "Private Link NICs",
    empty: "Private endpoints appear here",
  },
];

const AZURE_ICON: Record<string, string> = {
  users: "users",
  hub: "vnet",
  firewall: "firewall",
  dns: "dns-zones",
  law: "log-analytics",
  "network-spoke": "vnet",
  "private-endpoints": "private-endpoint",
  "app-gateway": "app-gateway",
  "front-door": "front-door",
  sql: "sql-database",
  "key-vault": "key-vault",
  monitoring: "monitor",
  "app-insights": "monitor",
  defender: "defender",
};

const STATUS_ACCENT = {
  pending: "#94a3b8",
  running: "#38bdf8",
  succeeded: "#22c55e",
  failed: "#ef4444",
} as const;

const EDGE_COLOR = {
  flow: "#4da3ff",
  data: "#22c55e",
  identity: "#c084fc",
  peering: "#38bdf8",
  private: "#f59e0b",
} as const;

type RouteKind = keyof typeof EDGE_COLOR;
type Path = {
  id: string;
  d: string;
  kind: RouteKind;
  label?: string;
  lx: number;
  ly: number;
  dashed?: boolean;
  live?: boolean;
};

type Rect = { l: number; t: number; w: number; h: number };
type RouteEdge = {
  kind?: Edge["kind"] | "private";
  to: string;
  from: string;
  label?: string;
};

export function ArchitectureCanvas({
  selected,
  topology,
  focus,
  onFocus,
  onRemove,
  bindings,
  installName,
  status,
  compact,
  markers,
  highlight,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [theme] = useDiagramTheme();
  const [paths, setPaths] = useState<Path[]>([]);
  const baseEdges = edgesFor(selected, topology);
  const byZone = useCallback(
    (zone: Zone) =>
      selected.filter(
        (s) =>
          SERVICE_BY_ID.get(s.id)?.zone === zone &&
          s.id !== "private-endpoints" &&
          s.id !== "network-spoke" &&
          s.id !== "resource-group",
      ),
    [selected],
  );
  const hasSpoke = selected.some((s) => s.id === "network-spoke");
  const pe = selected.find((s) => s.id === "private-endpoints");
  const privateTargets = selected.filter((s) => SERVICE_BY_ID.get(s.id)?.privateLink);
  const hub = topology.landing === "existing-customer-hub";
  const hosted = topology.landing === "isv-hosted";
  const colors = PALETTE[theme];

  const routeEdges = useMemo<RouteEdge[]>(() => {
    const edgeList: RouteEdge[] = baseEdges.map((e) => ({ ...e }));
    if (pe) {
      for (const s of privateTargets) {
        edgeList.push({
          from: s.id,
          to: `pe-${s.id}`,
          kind: "private",
          label: "private link",
        });
      }
    }
    return edgeList;
  }, [baseEdges, pe, privateTargets]);

  const edgeKey = JSON.stringify(routeEdges) + selected.length + String(hub) + String(compact);

  const measure = useCallback(() => {
    const root = container.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const rect = (id: string) => {
      const el = root.querySelector<HTMLElement>(`[data-node="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        l: r.left - box.left + root.scrollLeft,
        t: r.top - box.top + root.scrollTop,
        w: r.width,
        h: r.height,
      } satisfies Rect;
    };
    const next: Path[] = [];
    routeEdges.forEach((e, index) => {
      const a = rect(e.from);
      const b = rect(e.to);
      if (!a || !b) return;
      const routed = route(a, b, index, e.kind ?? "flow");
      const label = labelFor(e);
      next.push({
        id: `${e.from}-${e.to}-${index}`,
        d: routed.d,
        kind: (e.kind ?? "flow") as RouteKind,
        ...(label ? { label } : {}),
        lx: routed.lx,
        ly: routed.ly,
        ...(e.kind === "identity" || e.kind === "peering" ? { dashed: true } : {}),
        live: e.kind !== "peering",
      });
    });
    setPaths(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeKey]);

  useLayoutEffect(() => {
    measure();
    const root = container.current;
    if (!root) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    for (const el of root.querySelectorAll("[data-node]")) ro.observe(el);
    const frame = window.requestAnimationFrame(measure);
    return () => {
      window.cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [measure]);

  const node = (id: string, opts?: { platform?: boolean; tight?: boolean }) => {
    const def = SERVICE_BY_ID.get(id);
    const platform =
      id === "users"
        ? { id: "users", name: "Their users", type: "Entra ID", input: "customerSignInDomain" }
        : CUSTOMER_PLATFORM.find((p) => p.id === id);
    const s = selected.find((x) => x.id === id);
    const first = def?.options[0];
    const bound = platform ? bindings?.[platform.input] : undefined;
    const secondary = platform
      ? bound
        ? String(bound).split("/").pop()
        : "At onboarding"
      : first && s
        ? s.settings[first.key]
        : def?.resourceType.split("/").pop();
    const st = status?.[id];
    const isDimmed = !!highlight?.length && !highlight.includes(id);
    const accent = st ? STATUS_ACCENT[st] : highlight?.includes(id) ? colors.accent : undefined;
    const title = def
      ? def.id === "security-baseline"
        ? "Policy pack"
        : def.short
      : platform?.name;
    const remove = onRemove && def && !def.locked;
    const state = focus === id ? "selected" : isDimmed || st === "pending" ? "dim" : "normal";

    return (
      <div
        key={id}
        data-node={id}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onFocus?.(id);
        }}
        onKeyDown={(e) => e.key === "Enter" && onFocus?.(id)}
        className={cn("group relative w-full min-w-0", opts?.tight ? "h-[48px]" : "h-[56px]")}
      >
        <DiagramCard
          icon={iconFor(id)}
          title={title}
          sub={secondary}
          tight={opts?.tight}
          state={state}
          accent={accent}
          className={cn(
            "cursor-pointer",
            opts?.platform && "border-dashed",
            st === "running" && "cd-glow",
          )}
          badge={
            markers?.[id] !== undefined ? (
              <span className="grid size-5 place-items-center rounded-full bg-primary text-[10.5px] font-bold text-primary-foreground ring-2 ring-[var(--d-bg)]">
                {markers[id]}
              </span>
            ) : undefined
          }
          right={
            <span className="flex items-center gap-1">
              {def?.locked && !status && <Lock className="size-3 text-muted-foreground/70" />}
              {st && (
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    st === "running" && "animate-pulse",
                    st === "succeeded"
                      ? "bg-success"
                      : st === "failed"
                        ? "bg-danger"
                        : st === "running"
                          ? "bg-info"
                          : "bg-muted-foreground/50",
                  )}
                />
              )}
            </span>
          }
          titleAttr={def?.name ?? platform?.name}
        />
        {remove && (
          <button
            aria-label={`Remove ${def.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(id);
            }}
            className="absolute -top-2 -right-2 hidden size-5 place-items-center rounded-full border border-[var(--d-node-line)] bg-[var(--d-node)] text-[var(--d-sub)] shadow group-hover:grid hover:text-danger"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    );
  };

  const lanes = LANES.filter((l) => {
    if (l.zone === "endpoints") return !!pe;
    return byZone(l.zone).length || l.zone === "app" || l.zone === "data";
  });
  const spokeSub = hub
    ? "Peered to the customer hub · egress through their firewall"
    : "Dedicated address space · private by default";

  return (
    <div
      ref={container}
      onClick={() => onFocus?.(null)}
      data-diagram-theme={theme}
      className={cn(
        "relative overflow-auto rounded-md border border-[var(--d-azure-line)]",
        compact && "max-h-[560px]",
      )}
      style={
        {
          "--d-bg": colors.bg,
          "--d-azure": colors.azure,
          "--d-azure-line": colors.azureLine,
          "--d-zone": colors.zone,
          "--d-zone-line": colors.zoneLine,
          "--d-node": colors.node,
          "--d-node-line": colors.nodeLine,
          "--d-text": colors.text,
          "--d-sub": colors.sub,
          "--d-muted": colors.muted,
          "--d-band": colors.band,
          "--d-accent": colors.accent,
          background: colors.bg,
          color: colors.text,
        } as React.CSSProperties
      }
    >
      <div
        className={cn("relative", compact ? "min-w-[740px] p-3" : "min-w-[790px] p-4")}
        style={{
          backgroundImage: `radial-gradient(${colors.muted}55 1px, transparent 1px)`,
          backgroundSize: "16px 16px",
        }}
      >
        <div className="absolute top-3 right-3 z-20" onClick={(e) => e.stopPropagation()}>
          <ThemeToggle />
        </div>
        <ConnectorLayer paths={paths} />

        <div className="relative z-10 flex flex-col gap-4 pr-8">
          {hosted && (
            <DiagramZone
              label="Customer identity"
              sub="Users sign in with their own work accounts"
              kind="onprem"
              icon={azureIcon("users")}
              className="mx-auto h-auto w-[360px] pb-3"
            >
              <div className="px-3 pt-3">{node("users", { platform: true })}</div>
            </DiagramZone>
          )}

          <SelectableZone
            label={hosted ? "Your Azure · dedicated to this customer" : "Customer subscription"}
            sub={`${topology.regions[0] ?? "region"}${bindings?.["subscriptionId"] ? ` · ${String(bindings["subscriptionId"]).slice(0, 8)}…` : ""}${hosted ? " · you operate it" : ""}`}
            kind="subscription"
            icon={azureIcon("subscription")}
          >
            <div className={cn("grid gap-4 px-4 pb-4 pt-3", compact ? "" : "")}>
              <SelectableZone
                nodeId="resource-group"
                label={`rg-${installName ?? "{install}"}`}
                sub="One install scope · governed by the product release"
                icon={iconPath("resource-group")}
                selected={focus === "resource-group"}
                onSelect={() => onFocus?.("resource-group")}
              >
                <div className="grid gap-4 px-4 pb-4 pt-3">
                  {hasSpoke ? (
                    <SelectableZone
                      nodeId="network-spoke"
                      label="Spoke virtual network"
                      sub={spokeSub}
                      kind="vnet"
                      icon={azureIcon("vnet")}
                      selected={focus === "network-spoke"}
                      changed={!!highlight?.includes("network-spoke")}
                      onSelect={() => onFocus?.("network-spoke")}
                      badge={markers?.["network-spoke"]}
                    >
                      <div
                        className="grid items-stretch gap-3 px-3 pb-3 pt-3"
                        style={{
                          gridTemplateColumns: `repeat(${lanes.length}, minmax(118px, 1fr))`,
                        }}
                      >
                        {lanes.map((l) => (
                          <SubnetLane key={l.zone} label={l.label} sub={l.sub}>
                            {l.zone === "endpoints" ? (
                              <EndpointLane
                                aggregate={node("private-endpoints", { tight: true })}
                                targets={privateTargets}
                                focus={focus}
                                onFocus={onFocus}
                                highlight={highlight}
                              />
                            ) : byZone(l.zone).length ? (
                              byZone(l.zone).map((s) => node(s.id))
                            ) : (
                              <Empty>{l.empty}</Empty>
                            )}
                          </SubnetLane>
                        ))}
                      </div>
                    </SelectableZone>
                  ) : (
                    <div
                      className="grid items-stretch gap-3"
                      style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(118px, 1fr))` }}
                    >
                      {lanes.map((l) => (
                        <SubnetLane key={l.zone} label={l.label.replace(" subnet", "")} sub={l.sub}>
                          {l.zone === "endpoints" ? (
                            <EndpointLane
                              aggregate={node("private-endpoints", { tight: true })}
                              targets={privateTargets}
                              focus={focus}
                              onFocus={onFocus}
                              highlight={highlight}
                            />
                          ) : byZone(l.zone).length ? (
                            byZone(l.zone).map((s) => node(s.id))
                          ) : (
                            <Empty>{l.empty}</Empty>
                          )}
                        </SubnetLane>
                      ))}
                    </div>
                  )}

                  <DiagramZone
                    label="Shared services"
                    sub="Identity, policy, secrets and operations used by every subnet"
                    kind="band"
                    icon={azureIcon("law", "log-analytics")}
                    className="h-auto pb-3"
                  >
                    <div
                      className="grid gap-2.5 px-3 pt-3"
                      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
                    >
                      {byZone("shared").map((s) => node(s.id))}
                    </div>
                  </DiagramZone>
                </div>
              </SelectableZone>
            </div>
          </SelectableZone>

          {hub && (
            <DiagramZone
              label="Landing-zone platform resources consumed"
              sub="Owned by the customer platform team · referenced by onboarding bindings"
              kind="band"
              icon={azureIcon("hub", "vnet")}
              className="h-auto pb-3"
            >
              <div
                className="grid gap-3 px-3 pt-3"
                style={{ gridTemplateColumns: "repeat(4, minmax(130px, 1fr))" }}
              >
                {CUSTOMER_PLATFORM.map((p) => node(p.id, { platform: true, tight: true }))}
              </div>
            </DiagramZone>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectorLayer({ paths }: { paths: Path[] }) {
  return (
    <svg
      className="pointer-events-none absolute top-0 left-0 z-20 overflow-visible"
      width="1"
      height="1"
    >
      <defs>
        <marker
          id="arch-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--d-accent)" />
        </marker>
      </defs>
      {paths.map((p, i) => {
        const color = EDGE_COLOR[p.kind];
        return (
          <g key={p.id} opacity={p.kind === "peering" ? 0.9 : 1}>
            <path
              d={p.d}
              fill="none"
              stroke={color}
              strokeOpacity="0.2"
              strokeWidth={8}
              style={{ filter: "blur(4px)" }}
            />
            <path
              d={p.d}
              fill="none"
              markerEnd={p.kind === "peering" ? undefined : "url(#arch-arrow)"}
              stroke={color}
              strokeWidth={p.kind === "peering" ? 2 : 2.2}
              strokeDasharray={p.dashed || p.live ? "7 4" : undefined}
              style={{ animation: p.live ? "cd-march 1s linear infinite" : undefined }}
            />
            {p.live &&
              [0, 0.5].map((phase) => (
                <circle
                  key={phase}
                  r={3.6}
                  fill={color}
                  style={{ filter: `drop-shadow(0 0 5px ${color})` }}
                >
                  <animateMotion
                    dur="2.6s"
                    begin={`${phase * 2.6 - i * 0.15}s`}
                    repeatCount="indefinite"
                    path={p.d}
                  />
                </circle>
              ))}
            {p.label && (
              <g>
                <rect
                  x={p.lx - Math.max(28, p.label.length * 3.4)}
                  y={p.ly - 10}
                  width={Math.max(56, p.label.length * 6.8)}
                  height="20"
                  rx="6"
                  fill="var(--d-bg)"
                  stroke={color}
                  strokeOpacity="0.75"
                />
                <text
                  x={p.lx}
                  y={p.ly + 3.5}
                  textAnchor="middle"
                  fill={color}
                  className="text-[10px] font-semibold"
                >
                  {p.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SelectableZone({
  nodeId,
  label,
  sub,
  kind = "zone",
  icon,
  selected,
  changed,
  onSelect,
  badge,
  children,
}: {
  nodeId?: string | undefined;
  label: ReactNode;
  sub?: ReactNode | undefined;
  kind?: "azure" | "subscription" | "vnet" | "zone" | "onprem" | "band" | undefined;
  icon?: string | undefined;
  selected?: boolean | undefined;
  changed?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  badge?: number | undefined;
  children: ReactNode;
}) {
  const zone = (
    <DiagramZone
      label={label}
      sub={sub}
      kind={kind}
      icon={icon}
      state={selected ? "selected" : changed ? "changed" : undefined}
      right={
        badge !== undefined ? (
          <span className="grid size-5 place-items-center rounded-full bg-primary text-[10.5px] font-bold text-primary-foreground ring-2 ring-[var(--d-bg)]">
            {badge}
          </span>
        ) : undefined
      }
    >
      {children}
    </DiagramZone>
  );
  if (!nodeId) return zone;
  return (
    <section
      data-node={nodeId}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onKeyDown={(e) => e.key === "Enter" && onSelect?.()}
    >
      {zone}
    </section>
  );
}

function SubnetLane({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <section className="min-h-[190px] rounded-[12px] border border-dashed border-[var(--d-zone-line)] bg-[var(--d-bg)]/35 p-2.5">
      <div className="mb-2 flex items-start gap-1.5">
        <img src={azureIcon("subnet")} alt="" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold" style={{ color: "var(--d-text)" }}>
            {label}
          </p>
          <p className="truncate text-[10px]" style={{ color: "var(--d-muted)" }}>
            {sub}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function EndpointLane({
  aggregate,
  targets,
  focus,
  onFocus,
  highlight,
}: {
  aggregate: ReactNode;
  targets: Selected[];
  focus?: string | null | undefined;
  onFocus?: ((id: string | null) => void) | undefined;
  highlight?: string[] | null | undefined;
}) {
  return (
    <>
      {aggregate}
      {targets.length ? (
        targets.map((s) => {
          const def = SERVICE_BY_ID.get(s.id);
          const dim = !!highlight?.length && !highlight.includes(s.id);
          return (
            <div
              key={s.id}
              data-node={`pe-${s.id}`}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onFocus?.(s.id);
              }}
              onKeyDown={(e) => e.key === "Enter" && onFocus?.(s.id)}
              className="h-[42px] w-full min-w-0"
            >
              <DiagramCard
                icon="/azure-icons/private-endpoint.svg"
                title={`PE · ${def?.short ?? s.id}`}
                sub="NIC in endpoint subnet"
                tight
                state={focus === s.id ? "selected" : dim ? "dim" : "normal"}
              />
            </div>
          );
        })
      ) : (
        <Empty>No private-link services selected</Empty>
      )}
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-[10px] border border-dashed border-[var(--d-node-line)] px-2 py-4 text-center text-[11px]"
      style={{ color: "var(--d-muted)" }}
    >
      {children}
    </p>
  );
}

function iconFor(id: string) {
  const path = iconPath(id);
  if (path) return path;
  return <ServiceIcon id={id} />;
}

function iconPath(id: string) {
  const icon = AZURE_ICON[id];
  return icon ? `/azure-icons/${icon}.svg` : undefined;
}

function labelFor(e: RouteEdge) {
  if (e.label) return e.label;
  if (e.kind === "identity") return "identity";
  return undefined;
}

function route(a: Rect, b: Rect, index: number, kind: RouteKind) {
  const ac = { x: a.l + a.w / 2, y: a.t + a.h / 2 };
  const bc = { x: b.l + b.w / 2, y: b.t + b.h / 2 };
  const horizontal = Math.abs(bc.x - ac.x) > Math.abs(bc.y - ac.y);
  const laneOffset = ((index % 5) - 2) * 8;

  if (kind === "peering" && b.t < a.t) {
    const x1 = ac.x;
    const y1 = a.t;
    const gutter = b.l + 8;
    const y2 = b.t + b.h;
    const channelY = a.t - 22 + laneOffset;
    return {
      d: `M ${x1} ${y1} L ${x1} ${channelY} L ${gutter} ${channelY} L ${gutter} ${y2}`,
      lx: (x1 + gutter) / 2,
      ly: channelY - 9,
    };
  }

  if (kind === "identity" && b.t > a.t) {
    const x1 = ac.x;
    const y1 = a.t + a.h;
    const x2 = bc.x;
    const y2 = b.t;
    const my = b.t - 22 + laneOffset;
    return {
      d: `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`,
      lx: (x1 + x2) / 2,
      ly: my - 9,
    };
  }

  if (kind === "peering" || (!horizontal && bc.y < ac.y)) {
    const x1 = ac.x;
    const y1 = b.t > a.t ? a.t + a.h : a.t;
    const x2 = bc.x;
    const y2 = b.t > a.t ? b.t : b.t + b.h;
    const my = y1 + (y2 - y1) / 2 + laneOffset;
    return {
      d: `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`,
      lx: (x1 + x2) / 2,
      ly: my - 9,
    };
  }

  if (horizontal) {
    const leftToRight = bc.x >= ac.x;
    const x1 = leftToRight ? a.l + a.w : a.l;
    const y1 = ac.y;
    const x2 = leftToRight ? b.l : b.l + b.w;
    const y2 = bc.y;
    const mx = x1 + (x2 - x1) / 2 + laneOffset;
    return {
      d: `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`,
      lx: mx,
      ly: y1 + (y2 - y1) / 2 - 10,
    };
  }

  const topToBottom = bc.y >= ac.y;
  const x1 = ac.x;
  const y1 = topToBottom ? a.t + a.h : a.t;
  const x2 = bc.x;
  const y2 = topToBottom ? b.t : b.t + b.h;
  const my = y1 + (y2 - y1) / 2 + laneOffset;
  return {
    d: `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`,
    lx: (x1 + x2) / 2,
    ly: my - 9,
  };
}
