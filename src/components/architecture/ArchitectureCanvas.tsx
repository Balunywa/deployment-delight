import { Lock, X } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  CUSTOMER_PLATFORM,
  SERVICE_BY_ID,
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
};

const LANES: { zone: Zone; label: string; empty: string }[] = [
  { zone: "edge", label: "Ingress subnet", empty: "No public or private ingress" },
  { zone: "app", label: "Application subnet", empty: "Add a compute service" },
  { zone: "integration", label: "Integration subnet", empty: "No messaging" },
  { zone: "data", label: "Data subnet", empty: "Add a data service" },
];

type Path = { d: string; kind: string; label?: string; lx: number; ly: number };

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
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Path[]>([]);
  const edges = edgesFor(selected, topology);
  const byZone = (zone: Zone) =>
    selected.filter(
      (s) =>
        SERVICE_BY_ID.get(s.id)?.zone === zone &&
        s.id !== "private-endpoints" &&
        s.id !== "network-spoke" &&
        s.id !== "resource-group",
    );
  const hasSpoke = selected.some((s) => s.id === "network-spoke");
  const pe = selected.find((s) => s.id === "private-endpoints");
  const privateCount = selected.filter((s) => SERVICE_BY_ID.get(s.id)?.privateLink).length;
  const hub = topology.landing === "existing-customer-hub";
  const hosted = topology.landing === "isv-hosted";
  const edgeKey = JSON.stringify(edges) + selected.length + String(hub);

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
      };
    };
    const next: Path[] = [];
    for (const e of edges) {
      const a = rect(e.from);
      const b = rect(e.to);
      if (!a || !b) continue;
      let d: string;
      let lx: number;
      let ly: number;
      if (e.kind === "peering") {
        const x = a.l + a.w / 2;
        const y1 = a.t + a.h;
        const y2 = b.t;
        d = `M ${x} ${y1} L ${x} ${y2}`;
        lx = x + 30;
        ly = y1 + 20;
      } else if (b.l > a.l + a.w - 4) {
        const x1 = a.l + a.w;
        const y1 = a.t + a.h / 2;
        const x2 = b.l;
        const y2 = b.t + b.h / 2;
        const mx = (x1 + x2) / 2;
        d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
        lx = mx;
        ly = (y1 + y2) / 2;
      } else {
        const x1 = a.l + a.w / 2;
        const y1 = a.t + a.h;
        const x2 = b.l + b.w / 2;
        const y2 = b.t;
        const my = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
        lx = (x1 + x2) / 2;
        ly = my;
      }
      next.push({ d, kind: e.kind ?? "flow", ...(e.label ? { label: e.label } : {}), lx, ly });
    }
    setPaths(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeKey, compact]);

  useLayoutEffect(() => {
    measure();
    const root = container.current;
    if (!root) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure]);

  const node = (id: string, opts?: { platform?: boolean }) => {
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
        className={cn(
          "group relative flex w-40 cursor-pointer items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-colors",
          opts?.platform
            ? "border-dashed border-border-strong bg-card/70"
            : "border-border hover:border-border-strong",
          focus === id && "border-primary ring-2 ring-primary/20",
          st === "running" && "border-info ring-2 ring-info/25",
          st === "succeeded" && "border-success/60",
          st === "failed" && "border-danger ring-2 ring-danger/20",
          st === "pending" && "opacity-60",
        )}
      >
        <ServiceIcon id={id} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] leading-tight font-semibold">
            {def ? (def.id === "security-baseline" ? "Policy pack" : def.short) : platform?.name}
          </p>
          <p className="truncate font-mono text-[10.5px] leading-tight text-muted-foreground">
            {secondary}
          </p>
        </div>
        {def?.locked && !status && <Lock className="size-3 shrink-0 text-muted-foreground/60" />}
        {st && (
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              st === "succeeded"
                ? "bg-success"
                : st === "failed"
                  ? "bg-danger"
                  : st === "running"
                    ? "animate-pulse bg-info"
                    : "bg-muted-foreground/40",
            )}
          />
        )}
        {onRemove && def && !def.locked && (
          <button
            aria-label={`Remove ${def.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(id);
            }}
            className="absolute -top-2 -right-2 hidden size-4 place-items-center rounded-full border border-border bg-card text-muted-foreground group-hover:grid hover:text-danger"
          >
            <X className="size-2.5" />
          </button>
        )}
      </div>
    );
  };

  const lanes = LANES.filter((l) => byZone(l.zone).length || l.zone === "app" || l.zone === "data");

  return (
    <div
      ref={container}
      onClick={() => onFocus?.(null)}
      className={cn(
        "canvas-grid relative overflow-auto rounded-md border border-border",
        compact ? "p-4" : "p-6",
      )}
    >
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width="1"
        height="1"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground/70" />
          </marker>
        </defs>
        {paths.map((p, i) => (
          <g key={i}>
            <path
              d={p.d}
              fill="none"
              markerEnd={p.kind === "peering" ? undefined : "url(#arrow)"}
              className={cn(
                p.kind === "peering"
                  ? "stroke-cat-networking"
                  : p.kind === "identity"
                    ? "stroke-cat-security/80"
                    : "stroke-muted-foreground/75",
              )}
              strokeWidth={p.kind === "peering" ? 2 : 1.25}
              strokeDasharray={
                p.kind === "identity" ? "3 3" : p.kind === "peering" ? "6 3" : undefined
              }
            />
            {p.label && (
              <text
                x={p.lx}
                y={p.ly}
                textAnchor="middle"
                className="fill-cat-networking text-[10px] font-medium"
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className={cn("relative flex flex-col items-start gap-8", compact ? "w-full" : "w-max")}>
        {hub && (
          <Boundary
            title="Customer platform"
            subtitle="Owned by the customer's platform team · consumed, never replaced"
            dashed
          >
            <div className={cn("flex gap-2.5", compact && "flex-wrap")}>
              {CUSTOMER_PLATFORM.map((p) => node(p.id, { platform: true }))}
            </div>
          </Boundary>
        )}
        {hosted && (
          <Boundary
            title="Customer"
            subtitle="No Azure needed on their side · users sign in with their own accounts"
            dashed
          >
            <div className="flex gap-2.5">{node("users", { platform: true })}</div>
          </Boundary>
        )}

        <Boundary
          title={hosted ? "Your Azure · dedicated to this customer" : "Customer subscription"}
          subtitle={`${topology.regions[0] ?? "region"}${bindings?.["subscriptionId"] ? ` · ${String(bindings["subscriptionId"]).slice(0, 8)}…` : ""}${hosted ? " · you operate it" : ""}`}
        >
          <Boundary
            title={`rg-${installName ?? "{install}"}`}
            icon="resource-group"
            nodeId="resource-group"
            focused={focus === "resource-group"}
            onClick={() => onFocus?.("resource-group")}
            inner
          >
            <div className="flex flex-col gap-4">
              {hasSpoke ? (
                <Boundary
                  title="Spoke virtual network"
                  subtitle={
                    hub
                      ? "Peered to customer hub · egress via customer firewall"
                      : "Dedicated address space"
                  }
                  icon="network-spoke"
                  nodeId="network-spoke"
                  focused={focus === "network-spoke"}
                  onClick={() => onFocus?.("network-spoke")}
                  inner
                  tone="network"
                >
                  <div className={cn("flex gap-3", compact && "flex-wrap")}>
                    {lanes.map((l) => (
                      <Lane key={l.zone} label={l.label}>
                        {byZone(l.zone).length ? (
                          byZone(l.zone).map((s) => node(s.id))
                        ) : (
                          <Empty>{l.empty}</Empty>
                        )}
                      </Lane>
                    ))}
                  </div>
                  {pe && (
                    <div className="mt-3 flex items-center gap-3 rounded-sm border border-dashed border-cat-networking/40 px-2 py-1.5">
                      {node("private-endpoints")}
                      <p className="text-[11px] text-muted-foreground">
                        Endpoint subnet · {privateCount} private endpoint
                        {privateCount === 1 ? "" : "s"}
                        {hub ? " · DNS records in customer zones" : ""}
                      </p>
                    </div>
                  )}
                </Boundary>
              ) : (
                <div className={cn("flex gap-3", compact && "flex-wrap")}>
                  {lanes.map((l) => (
                    <Lane key={l.zone} label={l.label.replace(" subnet", "")}>
                      {byZone(l.zone).length ? (
                        byZone(l.zone).map((s) => node(s.id))
                      ) : (
                        <Empty>{l.empty}</Empty>
                      )}
                    </Lane>
                  ))}
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                  Shared services
                </p>
                <div className="flex max-w-[44rem] flex-wrap gap-2">
                  {byZone("shared").map((s) => node(s.id))}
                </div>
              </div>
            </div>
          </Boundary>
        </Boundary>
      </div>
    </div>
  );
}

function Boundary({
  title,
  subtitle,
  children,
  dashed,
  inner,
  icon,
  nodeId,
  focused,
  onClick,
  tone,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  dashed?: boolean;
  inner?: boolean;
  icon?: string;
  nodeId?: string;
  focused?: boolean;
  onClick?: () => void;
  tone?: "network";
}) {
  return (
    <section
      data-node={nodeId}
      className={cn(
        "rounded-md border p-3",
        dashed
          ? "border-dashed border-border-strong bg-muted/40"
          : inner
            ? "bg-card/60"
            : "bg-card/40",
        tone === "network"
          ? "border-cat-networking/40 bg-cat-networking/[0.03]"
          : !dashed && "border-border-strong/70",
        focused && "ring-2 ring-primary/25",
      )}
    >
      <header
        onClick={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          onClick();
        }}
        className={cn("mb-2.5 flex items-center gap-2", onClick && "cursor-pointer")}
      >
        {icon && <ServiceIcon id={icon} size="sm" />}
        <div className="min-w-0">
          <p className="font-mono text-[11px] leading-tight font-semibold text-foreground">
            {title}
          </p>
          {subtitle && (
            <p className="text-[10.5px] leading-tight text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-44 flex-col gap-2 rounded-sm border border-border/80 bg-card/50 p-2">
      <p className="text-[10.5px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-sm border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
      {children}
    </p>
  );
}
