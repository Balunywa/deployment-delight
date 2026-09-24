import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Building2, Cloud, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { StageBadge } from "@/components/Fleet";
import { EmptyState } from "@/components/Primitives";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RUNS_IN } from "@/lib/architecture";
import { currency, relative } from "@/lib/format";
import { modelOf, productOf } from "@/lib/product-catalog";
import { type FleetCustomer, useFleet } from "@/lib/use-fleet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/customers/")({
  head: () => ({
    meta: [
      { title: "Customers · Cloud Delivery" },
      {
        name: "description",
        content:
          "Every customer: where their installs run, which products they use, release status, compliance and Azure consumption.",
      },
      { property: "og:title", content: "Customers · Cloud Delivery" },
      {
        property: "og:description",
        content: "Customers, products, release status and Azure consumption.",
      },
    ],
  }),
  component: Customers,
});

type View = "all" | "live" | "onboarding" | "attention";
type SortKey = "name" | "spend" | "compliance" | "activity";

type Row = {
  c: FleetCustomer;
  products: { name: string; models: string[]; envs: number }[];
  spend: number;
  compliance: number | null;
  behind: number;
  deprecated: number;
  drift: number;
  attention: string[];
};

const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function toRow(c: FleetCustomer): Row {
  const byProduct = new Map<string, { models: Set<string>; envs: number }>();
  for (const i of c.installs) {
    const p = productOf(i.offeringName) || i.offeringName;
    const cur = byProduct.get(p) ?? { models: new Set<string>(), envs: 0 };
    cur.models.add(modelOf(i.offeringName));
    cur.envs += 1;
    byProduct.set(p, cur);
  }
  const live = c.installs.filter((i) => i.actual);
  const behind = live.filter((i) => i.tone === "supported").length;
  const deprecated = live.filter((i) => i.tone === "deprecated").length;
  const drift = c.installs.reduce((s, i) => s + i.openDrift, 0);
  const compliance = live.length ? Math.min(...live.map((i) => i.compliance)) : null;
  const attention = [
    ...(c.stage === "blocked" ? ["Run blocked"] : []),
    ...(deprecated ? [`${deprecated} on a deprecated release`] : []),
    ...(compliance !== null && compliance < 95 ? [`Compliance ${compliance}%`] : []),
    ...(drift ? [`${drift} open drift`] : []),
  ];
  return {
    c,
    products: [...byProduct.entries()].map(([name, v]) => ({
      name,
      models: [...v.models],
      envs: v.envs,
    })),
    spend: c.installs.reduce((s, i) => s + i.monthly, 0),
    compliance,
    behind,
    deprecated,
    drift,
    attention,
  };
}

function Customers() {
  const { fleet, isLoading } = useFleet();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("all");
  const [runsIn, setRunsIn] = useState("any");
  const [product, setProduct] = useState("any");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "spend", desc: true });

  const all = useMemo(() => fleet.map(toRow), [fleet]);
  const products = [...new Set(all.flatMap((r) => r.products.map((p) => p.name)))].sort();
  const counts = {
    all: all.length,
    live: all.filter((r) => r.c.stage === "live").length,
    onboarding: all.filter((r) => r.c.stage !== "live").length,
    attention: all.filter((r) => r.attention.length).length,
  };
  const spend = all.reduce((s, r) => s + r.spend, 0);
  const installs = all.reduce((s, r) => s + r.c.installs.length, 0);
  const behind = all.reduce((s, r) => s + r.behind + r.deprecated, 0);

  const rows = all
    .filter((r) =>
      view === "live"
        ? r.c.stage === "live"
        : view === "onboarding"
          ? r.c.stage !== "live"
          : view === "attention"
            ? r.attention.length > 0
            : true,
    )
    .filter((r) => runsIn === "any" || r.c.azureModel === runsIn)
    .filter((r) => product === "any" || r.products.some((p) => p.name === product))
    .filter((r) =>
      `${r.c.name} ${r.c.code} ${r.products.map((p) => p.name).join(" ")}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    )
    .sort((a, b) => {
      const d =
        sort.key === "name"
          ? a.c.name.localeCompare(b.c.name)
          : sort.key === "spend"
            ? a.spend - b.spend
            : sort.key === "compliance"
              ? (a.compliance ?? 101) - (b.compliance ?? 101)
              : (a.c.lastActivity ?? "").localeCompare(b.c.lastActivity ?? "");
      return sort.desc ? -d : d;
    });

  const Th = ({ k, children, right }: { k?: SortKey; children: string; right?: boolean }) => (
    <th className={cn("px-3 py-2 font-medium whitespace-nowrap", right && "text-right")}>
      {k ? (
        <button
          onClick={() =>
            setSort((s) =>
              s.key === k ? { key: k, desc: !s.desc } : { key: k, desc: k !== "name" },
            )
          }
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground",
            sort.key === k && "text-foreground",
          )}
        >
          {children}
          {sort.key === k &&
            (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
      ) : (
        children
      )}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold">Customers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Who runs what, where it runs, whether it's current — and the Azure consumption it
            drives.
          </p>
        </div>
        <Link
          to="/onboard"
          className="rounded-sm bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
        >
          Onboard customer
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Customers" value={String(counts.all)} hint={`${installs} installs`} />
        <Kpi
          label="Live"
          value={String(counts.live)}
          hint={`${counts.onboarding} onboarding`}
          tone="success"
        />
        <Kpi
          label="Azure consumption"
          value={`${currency(spend, { compact: true })}/mo`}
          hint={`${currency(spend * 12, { compact: true })} a year across customers' Azure`}
        />
        <Kpi
          label="Behind on releases"
          value={String(behind)}
          hint="installs not on the latest release"
          tone={behind ? "warning" : "success"}
        />
        <Kpi
          label="Needs attention"
          value={String(counts.attention)}
          hint="blocked, deprecated, drift or low compliance"
          tone={counts.attention ? "danger" : "success"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border bg-card p-0.5 text-[12.5px]">
          {(
            [
              ["all", "All"],
              ["live", "Live"],
              ["onboarding", "Onboarding"],
              ["attention", "Needs attention"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={cn(
                "rounded-sm px-2.5 py-1",
                view === k
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label} <span className="font-mono text-[11px] opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search customers or products"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <Select value={runsIn} onValueChange={setRunsIn}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Runs anywhere</SelectItem>
            {Object.entries(RUNS_IN).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={product} onValueChange={setProduct}>
          <SelectTrigger className="h-9 w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any product</SelectItem>
            {products.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {all.length}
        </span>
      </div>

      {isLoading && <EmptyState title="Loading customers…" />}
      {!isLoading && !rows.length && <EmptyState title="No customers match these filters." />}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-muted/50 text-[11.5px] text-muted-foreground">
              <tr>
                <Th k="name">Customer</Th>
                <Th>Runs in</Th>
                <Th>Products</Th>
                <Th>Releases</Th>
                <Th k="compliance">Compliance</Th>
                <Th k="spend" right>
                  Azure / month
                </Th>
                <Th>Stage</Th>
                <Th k="activity">Last activity</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={r.c.id}
                  onClick={() =>
                    void navigate({ to: "/customers/$customerId", params: { customerId: r.c.id } })
                  }
                  className="cursor-pointer align-top transition-colors hover:bg-muted/40"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                        {initials(r.c.name)}
                      </span>
                      <div className="min-w-0 whitespace-nowrap">
                        <Link
                          to="/customers/$customerId"
                          params={{ customerId: r.c.id }}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium hover:underline"
                        >
                          {r.c.name}
                        </Link>
                        <p className="font-mono text-[11px] text-muted-foreground">{r.c.code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {r.c.azureModel === "isv_hosted" ? (
                        <Cloud className="size-3.5 text-info" />
                      ) : (
                        <Building2 className="size-3.5 text-muted-foreground" />
                      )}
                      {r.c.azureModel === "isv_hosted"
                        ? "Your Azure"
                        : r.c.azureModel === "greenfield"
                          ? "Their Azure (new)"
                          : "Their landing zone"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex min-w-[260px] flex-wrap gap-1">
                      {r.products.map((p) => (
                        <span
                          key={p.name}
                          title={`${p.name} · ${p.models.join(", ")} · ${p.envs} environment(s)`}
                          className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 text-[11.5px]"
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {p.envs}
                          </span>
                        </span>
                      ))}
                      {!r.products.length && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap">
                    {r.deprecated ? (
                      <span className="text-danger">{r.deprecated} deprecated</span>
                    ) : r.behind ? (
                      <span className="text-warning">{r.behind} behind</span>
                    ) : r.c.installs.some((i) => i.actual) ? (
                      <span className="text-success">Current</span>
                    ) : (
                      <span className="text-muted-foreground">Not deployed</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.compliance === null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn(
                              "block h-full",
                              r.compliance >= 98
                                ? "bg-success"
                                : r.compliance >= 95
                                  ? "bg-warning"
                                  : "bg-danger",
                            )}
                            style={{ width: `${r.compliance}%` }}
                          />
                        </span>
                        <span className="font-mono text-[11.5px]">{r.compliance}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12.5px]">
                    {currency(r.spend, { compact: true })}
                  </td>
                  <td className="px-3 py-2.5">
                    <StageBadge stage={r.c.stage} />
                    {r.attention.length > 0 && (
                      <p
                        className="mt-0.5 max-w-[180px] truncate text-[11px] text-danger"
                        title={r.attention.join(" · ")}
                      >
                        {r.attention[0]}
                        {r.attention.length > 1 ? ` +${r.attention.length - 1}` : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] whitespace-nowrap text-muted-foreground">
                    {r.c.lastActivity ? relative(r.c.lastActivity) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-muted/30 text-[12px]">
              <tr>
                <td className="px-3 py-2 font-medium" colSpan={5}>
                  {rows.length} customer{rows.length === 1 ? "" : "s"}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {currency(
                    rows.reduce((s, r) => s + r.spend, 0),
                    { compact: true },
                  )}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3.5 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-mono text-[20px] font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
