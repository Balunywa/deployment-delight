import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpCircle, Building2, Eye, Server, ShieldCheck } from "lucide-react";

import { NewLandingZone } from "@/components/lz/NewLandingZone";
import { EmptyState, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { accessChecks, checkSummary } from "@/lib/alz/access-checks";
import { estimateCost, money } from "@/lib/alz/cost";
import { withDefaults, LATEST_REF, hierarchy, libraryFor, shortRef } from "@/lib/alz/engine";
import { placements, placementsFor } from "@/lib/alz/placement";
import { relative } from "@/lib/format";
import type { FoundationRow } from "@/lib/data.functions";
import { customersQuery, foundationsQuery, offeringsQuery } from "@/lib/queries";

export const Route = createFileRoute("/foundations/")({
  head: () => ({
    meta: [
      { title: "Landing zones · Cloud Delivery" },
      {
        name: "description",
        content:
          "Platform landing zones built from Microsoft's Azure Landing Zones Library — your hosting tenant and the customer tenants you build or use.",
      },
    ],
  }),
  component: Foundations,
});

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "info" }> =
  {
    deployed: { label: "Deployed", tone: "success" },
    changes_pending: { label: "Changes to deploy", tone: "warning" },
    draft: { label: "Not deployed yet", tone: "neutral" },
    discovered: { label: "Discovered · read-only", tone: "info" },
  };

function Foundations() {
  const foundations = useQuery(foundationsQuery);
  const customers = useQuery(customersQuery);
  const offerings = useQuery(offeringsQuery);
  const all = placements(customers.data ?? [], offerings.data ?? []);
  const list = foundations.data ?? [];
  const isv = list.filter((f) => !f.customer_id);
  const built = list.filter((f) => f.customer_id && f.mode === "managed");
  const existing = list.filter((f) => f.mode === "existing");
  const [creating, setCreating] = useState(false);
  const run = [...isv, ...built];
  const health = (f: FoundationRow) => {
    const a = withDefaults(f.answers);
    return {
      cost: estimateCost(a).total,
      score: checkSummary(accessChecks(a, hierarchy(libraryFor(f.library_ref), a))),
    };
  };
  const totalCost = run.reduce((n, f) => n + health(f).cost, 0);
  const issues = run.reduce((n, f) => n + health(f).score.fix, 0);
  const updates = run.filter((f) => shortRef(f.library_ref) !== shortRef(LATEST_REF)).length;
  const available = (customers.data ?? [])
    .filter((c) => !list.some((f) => f.customer_id === c.id))
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <>
      <NewLandingZone open={creating} onOpenChange={setCreating} customers={available} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <p className="text-xs text-muted-foreground">Platform</p>
          <h1 className="mt-0.5 text-[22px] font-semibold">Landing zones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The Azure foundation each customer install lands in, built from Microsoft's{" "}
            <a
              href="https://github.com/Azure/Azure-Landing-Zones-Library"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Azure Landing Zones Library
            </a>{" "}
            — designed visually, costed, checked against Microsoft's guidance, and deployed with
            Terraform you own. One per Microsoft Entra tenant.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New landing zone</Button>
      </div>

      {list.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Fleet">
          <Stat
            label="Landing zones you run"
            value={run.length}
            sub={`${run.filter((f) => f.status === "deployed").length} deployed · ${run.filter((f) => f.status !== "deployed").length} not yet`}
          />
          <Stat
            label="Platform cost"
            value={`${money(totalCost)}/mo`}
            sub="Pay-as-you-go list prices · plus usage"
          />
          <Stat
            label="Best-practice issues"
            value={issues}
            sub={
              issues
                ? "Across the landing zones you run"
                : "None — all following Microsoft's guidance"
            }
            tone={issues ? "warn" : "ok"}
          />
          <Stat
            label="Updates available"
            value={updates}
            sub={
              updates
                ? `ALZ ${shortRef(LATEST_REF)} — preview what changes first`
                : "All on the latest ALZ"
            }
            tone={updates ? "warn" : "ok"}
          />
          <Stat
            label="Customer landing zones you use"
            value={existing.length}
            sub="Their platform team's — read-only"
          />
        </div>
      )}

      {foundations.isLoading && <EmptyState title="Loading landing zones…" />}

      <Group
        icon={<Server className="size-4" />}
        title="Your hosting tenant"
        subtitle="Where every customer you host gets a dedicated subscription"
        items={isv}
        placementsOf={(f) => placementsFor(all, f)}
      />
      <Group
        icon={<Building2 className="size-4" />}
        title="Customer tenants you build"
        subtitle="Customers new to Azure — you deploy the foundation first, then your product"
        items={built}
        placementsOf={(f) => placementsFor(all, f)}
      />
      {existing.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <Eye className="size-4 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold">Customer landing zones you use</h2>
            <span className="text-xs text-muted-foreground">
              · Their own enterprise landing zone — owned by their platform team, used as-is
            </span>
          </div>
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/40 text-left text-[11.5px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Customer landing zone</th>
                  <th className="px-4 py-2 font-medium">Prefix</th>
                  <th className="px-4 py-2 font-medium">Your installs</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {existing.map((f) => {
                  const placed = placementsFor(all, f);
                  const byLz = placed.reduce<Record<string, number>>(
                    (acc, p) => ({ ...acc, [p.landingZone]: (acc[p.landingZone] ?? 0) + 1 }),
                    {},
                  );
                  return (
                    <tr key={f.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Link
                          to="/foundations/$foundationId"
                          params={{ foundationId: f.id }}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {f.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11.5px] text-muted-foreground">
                        {withDefaults(f.answers).intermediateRootId}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {placed.length} ·{" "}
                        {Object.entries(byLz)
                          .map(([g, n]) => `${n} ${g}`)
                          .join(", ") || "none yet"}
                      </td>
                      <td className="px-4 py-2">
                        <Pill tone="info">Discovered · read-only</Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

type FoundationItem = FoundationRow;

function Group({
  icon,
  title,
  subtitle,
  items,
  placementsOf,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  items: FoundationItem[];
  placementsOf: (f: FoundationItem) => ReturnType<typeof placementsFor>;
}) {
  if (!items.length) return null;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">· {subtitle}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((f) => {
          const answers = withDefaults(f.answers);
          const lib = libraryFor(f.library_ref);
          const tree = hierarchy(lib, answers);
          const placed = placementsOf(f);
          const upgrade = f.mode === "managed" && shortRef(f.library_ref) !== shortRef(LATEST_REF);
          const status = STATUS[f.status] ?? { label: f.status, tone: "neutral" as const };
          const byLz = placed.reduce<Record<string, number>>(
            (acc, p) => ({ ...acc, [p.landingZone]: (acc[p.landingZone] ?? 0) + 1 }),
            {},
          );
          return (
            <Link
              key={f.id}
              to="/foundations/$foundationId"
              params={{ foundationId: f.id }}
              className="rounded-md border border-border bg-card p-4 transition-colors hover:border-border-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{f.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {answers.intermediateRootId} ·{" "}
                    {f.mode === "existing"
                      ? "their ALZ"
                      : `ALZ ${shortRef(f.deployed_ref ?? f.library_ref)}`}
                  </p>
                </div>
                <Pill tone={status.tone}>{status.label}</Pill>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tree
                  .filter((n) => ["corp", "online", "local", "sandbox"].includes(n.libraryId))
                  .map((n) => (
                    <span
                      key={n.id}
                      className="rounded-sm border border-border bg-background px-2 py-0.5 text-[11px]"
                    >
                      {n.displayName} <b className="font-mono">{byLz[n.libraryId] ?? 0}</b>
                    </span>
                  ))}
              </div>
              {f.mode === "managed" && (
                <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
                  <span>
                    <b className="font-semibold">{money(estimateCost(answers).total)}</b>
                    <span className="text-muted-foreground">/mo platform</span>
                  </span>
                  {(() => {
                    const sc = checkSummary(accessChecks(answers, tree));
                    return (
                      <span className={sc.fix ? "text-[#8a6100]" : "text-success"}>
                        <ShieldCheck className="mr-1 inline size-3.5" />
                        {sc.passed}/{sc.scored} best practices
                      </span>
                    );
                  })()}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {tree.length} management groups · {placed.length} install
                  {placed.length === 1 ? "" : "s"} placed
                </span>
                {upgrade ? (
                  <span className="inline-flex items-center gap-1 font-medium text-info">
                    <ArrowUpCircle className="size-3.5" /> ALZ {shortRef(LATEST_REF)} available
                  </span>
                ) : f.last_deployed_at ? (
                  <span>deployed {relative(f.last_deployed_at)}</span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  return (
    <div
      className={
        "rounded-md border border-border bg-card p-3 " +
        (tone === "warn"
          ? "border-l-[3px] border-l-[#c19c00]"
          : tone === "ok"
            ? "border-l-[3px] border-l-[#107c10]"
            : "")
      }
    >
      <p className="text-[11.5px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[20px] leading-tight font-semibold">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sub}>
        {sub}
      </p>
    </div>
  );
}
