import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { GridLegend, InstallGrid } from "@/components/Fleet";
import { Dot, EmptyState, PageHeader, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { createDeployment } from "@/lib/factory.functions";
import { currency, titleize } from "@/lib/format";
import { estateQuery } from "@/lib/queries";
import { useFleet } from "@/lib/use-fleet";

export const Route = createFileRoute("/estate")({
  head: () => ({
    meta: [
      { title: "Installed base · Cloud Delivery" },
      {
        name: "description",
        content:
          "Every customer environment in one table: offering, current version, target version, compliance and drift, with batch plan generation.",
      },
      { property: "og:title", content: "Installed base · Cloud Delivery" },
      {
        property: "og:description",
        content: "Fleet-wide view of customer environments, versions, compliance and drift.",
      },
    ],
  }),
  component: Estate,
});

function Estate() {
  const estate = useQuery(estateQuery);
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "outdated" | "drift" | "noncompliant">("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"grid" | "table">("grid");
  const { fleet } = useFleet();

  const plan = useMutation({
    mutationFn: useServerFn(createDeployment),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (estate.data ?? []).filter((e) => {
    const customer = (e.customers as { name?: string; customer_code?: string } | null) ?? {};
    const text =
      `${customer.name ?? ""} ${customer.customer_code ?? ""} ${e.name} ${e.region}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    const desired = (e.desired as { version?: string } | null)?.version;
    const actual = (e.actual as { version?: string } | null)?.version;
    const openDrift = ((e.drift_findings ?? []) as { status: string }[]).filter(
      (f) => f.status === "open",
    ).length;
    if (only === "outdated") return desired !== actual;
    if (only === "drift") return openDrift > 0;
    if (only === "noncompliant") return Number(e.compliance_score) < 100;
    return true;
  });

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const generatePlans = async () => {
    let ok = 0;
    let failed = 0;
    for (const environmentId of selectedIds) {
      try {
        await plan.mutateAsync({
          data: { environmentId, deploymentType: "upgrade", requestedBy: "Sarah Chen" },
        });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setSelected({});
    queryClient.invalidateQueries({ queryKey: ["deployments"] });
    queryClient.invalidateQueries({ queryKey: ["estate"] });
    toast[failed ? "warning" : "success"](
      `${ok} plan(s) generated and awaiting approval${failed ? `, ${failed} could not be planned` : ""}. Nothing was deployed.`,
    );
  };

  return (
    <>
      <PageHeader
        title="Installed base"
        description="Every install of your product across customers. Batch actions generate plans for approval — they never deploy immediately."
        actions={
          selectedIds.length > 0 && (
            <Button size="sm" disabled={plan.isPending} onClick={generatePlans}>
              {plan.isPending
                ? "Generating plans…"
                : `Generate upgrade plans (${selectedIds.length})`}
            </Button>
          )
        }
      />

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex rounded-sm border border-border p-0.5 text-xs">
          {(["grid", "table"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-sm px-2 py-1 ${view === v ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"}`}
            >
              {v === "grid" ? "Release grid" : "Table"}
            </button>
          ))}
        </div>
        {view === "grid" && <GridLegend />}
      </div>

      {view === "grid" && (
        <div className="rounded-md border border-border bg-card p-4">
          <InstallGrid customers={fleet.filter((c) => c.installs.length)} />
        </div>
      )}

      {view === "table" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              placeholder="Search customer, environment, region…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {(["all", "outdated", "drift", "noncompliant"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setOnly(f)}
                className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  only === f
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {titleize(f)}
              </button>
            ))}
            <span className="text-xs text-muted-foreground">{rows.length} environments</span>
          </div>

          {estate.isLoading && <EmptyState title="Loading estate…" />}

          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Customer</th>
                  <th>Environment</th>
                  <th>Offering</th>
                  <th>Current</th>
                  <th>Target</th>
                  <th>Compliance</th>
                  <th>Drift</th>
                  <th className="text-right">Monthly (est.)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const customer = e.customers as {
                    id: string;
                    name: string;
                    azure_model: string;
                  } | null;
                  const offering = e.offerings as { name: string } | null;
                  const desired = (e.desired as { version?: string } | null)?.version;
                  const actual = (e.actual as { version?: string } | null)?.version;
                  const openDrift = ((e.drift_findings ?? []) as { status: string }[]).filter(
                    (f) => f.status === "open",
                  ).length;
                  const outdated = desired !== actual;
                  return (
                    <tr key={e.id}>
                      <td>
                        <Checkbox
                          checked={!!selected[e.id]}
                          onCheckedChange={(v) => setSelected((s) => ({ ...s, [e.id]: !!v }))}
                          aria-label={`Select ${customer?.name} ${e.name}`}
                        />
                      </td>
                      <td>
                        {customer ? (
                          <Link
                            to="/customers/$customerId"
                            params={{ customerId: customer.id }}
                            className="font-medium hover:underline"
                          >
                            {customer.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-muted-foreground">
                        {e.name} · {e.region}
                      </td>
                      <td className="text-muted-foreground">{offering?.name ?? "—"}</td>
                      <td className="mono-num">{actual ? `v${actual}` : "—"}</td>
                      <td
                        className={`mono-num ${outdated ? "text-warning" : "text-muted-foreground"}`}
                      >
                        v{desired ?? "—"}
                      </td>
                      <td
                        className={`mono-num ${Number(e.compliance_score) < 100 ? "text-warning" : "text-success"}`}
                      >
                        {e.compliance_score}%
                      </td>
                      <td
                        className={`mono-num ${openDrift ? "text-warning" : "text-muted-foreground"}`}
                      >
                        {openDrift || "none"}
                      </td>
                      <td className="mono-num text-right">
                        {currency(e.monthly_cost_estimate, { compact: true })}
                      </td>
                      <td>
                        <Pill
                          tone={
                            e.status === "healthy"
                              ? "success"
                              : e.status === "attention_required"
                                ? "danger"
                                : "warning"
                          }
                        >
                          <Dot
                            tone={
                              e.status === "healthy"
                                ? "success"
                                : e.status === "attention_required"
                                  ? "danger"
                                  : "warning"
                            }
                          />
                          {titleize(e.status)}
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
