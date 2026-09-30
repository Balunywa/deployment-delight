import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, GitBranch, Search } from "lucide-react";
import { useState } from "react";

import { UnitStatus } from "@/components/delivery/UnitCard";
import { EmptyState } from "@/components/Primitives";
import { Input } from "@/components/ui/input";
import { UNIT_KINDS, UNIT_META, type UnitKind, isPlatformKind } from "@/lib/delivery/model";
import { relative } from "@/lib/format";
import { deliveryUnitsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/delivery/")({
  head: () => ({
    meta: [
      { title: "Delivery units · Cloud Delivery" },
      {
        name: "description",
        content:
          "Every landing zone, solution and customer is delivered from its own repository, with its own pipeline, cloud identities and Terraform state.",
      },
    ],
  }),
  component: DeliveryUnits,
});

type Filter = "all" | "landing-zone" | "solution" | "customer" | "platform";

const REPO_PATTERN: Record<UnitKind, string> = {
  "landing-zone": "lz-<tenant>",
  solution: "sol-<product>",
  customer: "cust-<customer>",
  modules: "cd-modules",
  templates: "cd-delivery-templates",
  vending: "cd-vending",
  "control-plane": "cd-control-plane",
};

function DeliveryUnits() {
  const data = useQuery(deliveryUnitsQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const units = data.data?.units ?? [];
  const org = data.data?.org ?? "";
  const matches = units.filter(
    (u) =>
      (filter === "all" || (filter === "platform" ? isPlatformKind(u.kind) : u.kind === filter)) &&
      (!q || `${u.name} ${u.repository} ${u.slug}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const count = (f: Filter) =>
    units.filter((u) => (f === "platform" ? isPlatformKind(u.kind) : u.kind === f)).length;
  const withFindings = units.filter((u) => u.findings.length).length;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
          Platform
        </p>
        <h1 className="mt-1 text-[26px] font-bold">Delivery units</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every landing zone, solution and customer is delivered from its own repository, with its
          own pipeline, its own narrowly scoped cloud identities and its own Terraform state.
          Approvals sit on each unit's environments. Branches stay short-lived; versions move by
          pull requests that change a pin.
        </p>
      </div>

      {!data.isLoading && !data.data?.vendingConfigured && (
        <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs">
          <p className="font-semibold">Vending requests are recorded here, not opened on GitHub</p>
          <p className="mt-0.5 text-muted-foreground">
            Set <span className="font-mono">CD_GITHUB_TOKEN</span> (a GitHub App installation token
            with contents and pull-request write on{" "}
            <span className="font-mono">{org}/cd-vending</span>) and{" "}
            <span className="font-mono">CD_GITHUB_ORG</span> to open vending pull requests. Nothing
            outside the console is changed until then.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/60 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Repository</th>
              <th className="px-3 py-2 font-medium">Branching</th>
              <th className="px-3 py-2 font-medium">Promotion</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {UNIT_KINDS.map((k) => (
              <tr key={k}>
                <td className="px-3 py-2 font-medium whitespace-nowrap">{UNIT_META[k].label}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{REPO_PATTERN[k]}</td>
                <td className="px-3 py-2 text-muted-foreground">{UNIT_META[k].branching}</td>
                <td className="px-3 py-2 text-muted-foreground">{UNIT_META[k].promotion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <nav className="-mb-px flex gap-5 text-[13px]">
          {(
            [
              ["all", "All", units.length],
              ["landing-zone", "Landing zones", count("landing-zone")],
              ["solution", "Solutions", count("solution")],
              ["customer", "Customers", count("customer")],
              ["platform", "Platform", count("platform")],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                "border-b-2 pb-2 transition-colors",
                filter === id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10.5px] text-muted-foreground">
                {n}
              </span>
            </button>
          ))}
        </nav>
        <div className="relative mb-2 w-64">
          <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or repository"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {withFindings > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5" />
          {withFindings} unit{withFindings === 1 ? "" : "s"} break an isolation rule and can't be
          vended until fixed.
        </p>
      )}

      {data.isLoading && <EmptyState title="Loading delivery units…" />}
      {!data.isLoading && matches.length === 0 && <EmptyState title="No units match" />}
      {matches.length > 0 && (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Repository</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Environments</th>
                <th className="px-3 py-2 text-right font-medium">Identities</th>
                <th className="px-3 py-2 text-right font-medium">State files</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Isolation</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {matches.map((u) => (
                <tr key={u.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link
                      to="/delivery/$unitId"
                      params={{ unitId: u.id }}
                      className="inline-flex items-center gap-1.5 font-mono font-medium text-primary hover:underline"
                    >
                      <GitBranch className="size-3.5" />
                      {org}/{u.repository}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {u.name}
                    <span className="block text-[10.5px] text-muted-foreground">
                      {UNIT_META[u.kind].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{u.environments}</td>
                  <td className="px-3 py-2 text-right font-mono">{u.identities}</td>
                  <td className="px-3 py-2 text-right font-mono">{u.state}</td>
                  <td className="px-3 py-2">
                    <UnitStatus status={u.status} />
                    {u.request_url && (
                      <a
                        href={u.request_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 inline-flex items-center text-primary"
                        aria-label="Open vending pull request"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                    {u.requested_at && (
                      <span className="block text-[10.5px] text-muted-foreground">
                        {relative(u.requested_at)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {u.findings.length ? (
                      <span
                        className="inline-flex items-center gap-1 text-warning"
                        title={u.findings.join("\n")}
                      >
                        <AlertTriangle className="size-3.5" /> {u.findings.length}
                      </span>
                    ) : (
                      <span className="text-success">Pass</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
