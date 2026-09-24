/*
 * Tenant assessment: what's in a tenant today, how it maps onto the Azure landing zone standard, what's missing
 * and what the traffic actually does — with the advisor alongside to reason over it.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, CircleAlert, Radar, RefreshCw, Sparkles, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { ArchitectureDiagram } from "@/components/lz/ArchitectureDiagram";
import { AdvisorPanel } from "@/components/lz/Panels";
import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { scanFoundationTenant } from "@/lib/advisor.functions";
import { type Assessment, type TenantSnapshot, assess, startingDesign } from "@/lib/alz/assess";
import { designContext } from "@/lib/alz/context";
import { type DemoVariant, demoSnapshot } from "@/lib/alz/demo-tenants";
import { type AlzLibrary, type Answers, DEFAULT_ANSWERS, hierarchy } from "@/lib/alz/engine";
import type { Placement } from "@/lib/alz/placement";
import { spokesFor } from "@/lib/alz/scene";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";

export function snapshotFor(
  f: {
    mode: string;
    discovered: unknown;
    customers?: { name: string; customer_code?: string | null } | null;
  },
  lib: AlzLibrary,
): TenantSnapshot | null {
  const d = (f.discovered ?? {}) as { snapshot?: TenantSnapshot; variant?: DemoVariant };
  if (d.snapshot) return d.snapshot;
  if (f.mode !== "existing") return null;
  return demoSnapshot(d.variant ?? "partial-alz", lib, {
    name: f.customers?.name ?? "Customer",
    code: f.customers?.customer_code ?? "contoso",
  });
}

export function AssessmentView({
  foundationId,
  name,
  lib,
  snapshot,
  answers,
  placed,
  managed,
  onUseDesign,
}: {
  foundationId: string;
  name: string;
  lib: AlzLibrary;
  snapshot: TenantSnapshot | null;
  answers: Answers;
  placed: Placement[];
  managed: boolean;
  onUseDesign?: ((a: Answers) => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const scan = useMutation({
    mutationFn: useServerFn(scanFoundationTenant),
    onSuccess: (res) => {
      const s = res as TenantSnapshot;
      toast.success(
        `Scanned tenant ${s.tenantId.slice(0, 8)}…: ${s.subscriptions.length} subscriptions, ${s.policyAssignments.length} policy assignments.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["foundation", foundationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const a = useMemo(() => (snapshot ? assess(snapshot, lib) : null), [snapshot, lib]);

  const scanButton = (
    <Button
      size="sm"
      variant={snapshot ? "outline" : "default"}
      disabled={scan.isPending}
      onClick={() => scan.mutate({ data: { foundationId } })}
    >
      {scan.isPending ? (
        <RefreshCw className="size-3.5 animate-spin" />
      ) : (
        <Radar className="size-3.5" />
      )}
      {scan.isPending
        ? "Scanning the tenant…"
        : snapshot?.source === "live"
          ? "Scan again"
          : "Scan a live tenant"}
    </Button>
  );

  if (!snapshot || !a)
    return (
      <div className="mx-auto max-w-2xl rounded-md border border-border bg-card p-6">
        <h2 className="text-[16px] font-semibold">Assess an existing tenant</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Reads the tenant with Azure Resource Graph — management groups, subscriptions, policy and
          role assignments, networks and platform resources — and maps it onto the Azure landing
          zone standard: what's there, what's missing, and what the traffic really does today.
          Nothing is changed.
        </p>
        <ul className="mt-3 space-y-1 text-[12.5px] text-muted-foreground">
          <li>
            • Runs as this app's managed identity; it needs <b>Reader</b> at the tenant root (or the
            scope to assess).
          </li>
          <li>
            • For a customer's tenant, they delegate Reader through Azure Lighthouse or admin
            consent.
          </li>
        </ul>
        <div className="mt-4">{scanButton}</div>
      </div>
    );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
          <div className="flex items-center gap-4">
            <Score value={a.overall} />
            <div>
              <p className="text-[15px] font-semibold">
                Aligned with the Azure landing zone standard
              </p>
              <p className="text-[12px] text-muted-foreground">
                {snapshot.source === "live" ? (
                  <>
                    Live scan of tenant <span className="font-mono">{snapshot.tenantId}</span> ·{" "}
                    {relative(snapshot.scannedAt)}
                  </>
                ) : (
                  <>Demo snapshot of {snapshot.label ?? name} — scan a live tenant to replace it</>
                )}{" "}
                · {snapshot.managementGroups.length} management groups ·{" "}
                {snapshot.subscriptions.length} subscriptions · {snapshot.policyAssignments.length}{" "}
                policy assignments · {snapshot.vnets.length} virtual networks
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {scanButton}
            {managed && onUseDesign && (
              <Button size="sm" onClick={() => onUseDesign(startingDesign(a, answers))}>
                Start the design from this tenant <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
          <div className="grid w-full grid-cols-3 gap-2 lg:grid-cols-6">
            {a.scores.map((s) => (
              <div key={s.area} className="rounded-md border border-border px-2.5 py-2">
                <p className="truncate text-[11px] text-muted-foreground">{s.area}</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", tone(s.score))}
                      style={{ width: `${s.score}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11.5px]">{s.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <Card
          title="What's missing compared with the standard"
          subtitle="Highest impact first. Fixes that map to the design can be added in one click."
        >
          <ul className="divide-y divide-border">
            {a.gaps.map((g, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                <Pill
                  tone={
                    g.severity === "high"
                      ? "danger"
                      : g.severity === "medium"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {g.severity}
                </Pill>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold">
                    {g.title} <span className="font-normal text-muted-foreground">· {g.area}</span>
                  </p>
                  <p className="text-[12px] text-muted-foreground">{g.detail}</p>
                  <p className="mt-0.5 text-[12px]">→ {g.fix}</p>
                </div>
                {managed && onUseDesign && g.patch && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0"
                    onClick={() => onUseDesign({ ...answers, ...g.patch })}
                  >
                    Add to design
                  </Button>
                )}
              </li>
            ))}
            {!a.gaps.length && (
              <li className="px-4 py-3 text-[12.5px] text-muted-foreground">
                Nothing — this tenant matches the standard.
              </li>
            )}
          </ul>
        </Card>

        <AsIs a={a} lib={lib} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Traffic today"
            subtitle="What actually happens in the tenant, not what the design says."
          >
            <ul className="divide-y divide-border">
              {a.traffic.map((t) => (
                <li key={t.id} className="flex gap-2 px-4 py-2">
                  {t.ok ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <X className="mt-0.5 size-4 shrink-0 text-danger" />
                  )}
                  <div>
                    <p className="text-[12.5px] font-medium">{t.title}</p>
                    <p className="text-[11.5px] text-muted-foreground">{t.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title="Where each subscription should go"
            subtitle="Suggested ALZ management group, from what's inside it."
          >
            <ul className="divide-y divide-border">
              {a.placement.map((p) => (
                <li key={p.id} className="px-4 py-2">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-medium">{p.name}</p>
                  <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    {p.where} <ArrowRight className="size-3" />{" "}
                    <b className="text-foreground">{LABELS[p.target] ?? p.target}</b>
                  </p>
                  {p.note && (
                    <p className="mt-0.5 flex gap-1 text-[11.5px] text-warning">
                      <CircleAlert className="mt-px size-3 shrink-0" />
                      {p.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card
          title="Policy coverage by management group"
          subtitle="ALZ Library assignments expected at each level, matched by assignment name or policy definition."
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>ALZ group</th>
                <th>Found in tenant</th>
                <th>Coverage</th>
                <th>Missing (first few)</th>
              </tr>
            </thead>
            <tbody>
              {a.coverage.map((c) => (
                <tr key={c.group}>
                  <td className="font-medium whitespace-nowrap">{c.label}</td>
                  <td className="text-muted-foreground">
                    {c.tenantGroup ?? <span className="text-danger">not found</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="font-mono text-[11.5px]">
                      {c.matched}/{c.expected}
                    </span>
                    {c.extra > 0 && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        +{c.extra} custom
                      </span>
                    )}
                  </td>
                  <td className="text-[11px] text-muted-foreground">
                    {c.missing.slice(0, 4).join(", ")}
                    {c.missing.length > 4 ? ` +${c.missing.length - 4}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <aside className="rounded-md border border-border bg-card xl:sticky xl:top-2 xl:h-[calc(100vh-1rem)]">
        <AdvisorPanel
          answers={answers}
          set={managed && onUseDesign ? (p) => onUseDesign({ ...answers, ...p }) : undefined}
          assessed
          context={() => designContext(lib, answers, placed, { name, assessment: a })}
        />
      </aside>
    </div>
  );
}

const LABELS: Record<string, string> = {
  connectivity: "Connectivity",
  management: "Management",
  identity: "Identity",
  corp: "Corp",
  online: "Online",
  sandbox: "Sandbox",
};

const tone = (n: number) => (n >= 75 ? "bg-success" : n >= 45 ? "bg-warning" : "bg-danger");

function Score({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" aria-label={`${value}% aligned`}>
      <circle cx="34" cy="34" r={r} fill="none" stroke="var(--muted)" strokeWidth="7" />
      <circle
        cx="34"
        cy="34"
        r={r}
        fill="none"
        stroke={value >= 75 ? "var(--success)" : value >= 45 ? "var(--warning)" : "var(--danger)"}
        strokeWidth="7"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 34 34)"
      />
      <text x="34" y="39" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">
        {value}%
      </text>
    </svg>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <header className="border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {subtitle && <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

/** Today's tenant drawn on the standard architecture: solid = found, dashed = missing. */
function AsIs({ a, lib }: { a: Assessment; lib: AlzLibrary }) {
  const [open, setOpen] = useState(true);
  const asIs: Answers = {
    ...DEFAULT_ANSWERS,
    ...a.inferred,
    defender: "no",
    updateManager: "no",
    vmBackup: "no",
    serviceHealth: "no",
    monitoring: "third_party",
  };
  const tree = hierarchy(lib, asIs);
  const spokes = spokesFor(
    ["corp", "online", "local", "sandbox"].filter((g) => tree.some((t) => t.libraryId === g)),
    [],
  );
  const [sel, setSel] = useState<Parameters<typeof ArchitectureDiagram>[0]["sel"]>(null);
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Sparkles className="size-3.5 text-[#0078d4]" /> Today's tenant, drawn on the standard
          </h3>
          <p className="text-[11.5px] text-muted-foreground">
            Solid = found in the tenant · dashed = missing compared with Microsoft's reference
            architecture. Management groups found: {Object.values(a.map).filter(Boolean).length} of{" "}
            {lib.managementGroups.length}.{a.hub ? ` Hub: ${a.hub}.` : ""}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </Button>
      </header>
      {open && (
        <div className="overflow-x-auto">
          <ArchitectureDiagram
            lib={lib}
            tree={tree}
            answers={asIs}
            spokes={spokes}
            sel={sel}
            onSelect={setSel}
            flow={null}
            step={0}
            present={
              new Set(
                Object.entries(a.map)
                  .filter(([, v]) => v)
                  .map(([k]) => k),
              )
            }
            asIs={a.asIs}
          />
        </div>
      )}
    </section>
  );
}
