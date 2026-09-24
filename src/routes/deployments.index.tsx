import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Dot, EmptyState, PageHeader, Pill, deploymentTone } from "@/components/Primitives";
import { DEPLOYMENT_STATES } from "@/lib/engine/types";
import { dateTime, relative } from "@/lib/format";
import { deploymentsQuery } from "@/lib/queries";

export const Route = createFileRoute("/deployments/")({
  head: () => ({
    meta: [
      { title: "Deployments · Cloud Delivery" },
      {
        name: "description",
        content:
          "Every deployment run with its state machine position, correlation ID, plan, approvals and step-level execution log.",
      },
      { property: "og:title", content: "Deployments · Cloud Delivery" },
      { property: "og:description", content: "Deployment runs, approvals and execution history." },
    ],
  }),
  component: Deployments,
});

function Deployments() {
  const deployments = useQuery(deploymentsQuery);
  const [filter, setFilter] = useState<string>("all");

  const rows = (deployments.data ?? []).filter((d) => filter === "all" || d.status === filter);

  return (
    <>
      <PageHeader
        title="Deployments"
        description="Deployments move through a strict state machine. Failures are recorded as they happened — there is no pretend rollback."
        meta={<Pill tone="warning">Demo engine — no Azure resources are created</Pill>}
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {["all", ...DEPLOYMENT_STATES].map((state) => (
          <button
            key={state}
            onClick={() => setFilter(state)}
            className={`rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors ${
              filter === state
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {state === "all" ? "All" : state.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {deployments.isLoading && <EmptyState title="Loading deployments…" />}
      {!deployments.isLoading && !rows.length && (
        <EmptyState title="No deployments in this state." />
      )}

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Environment</th>
              <th>Type</th>
              <th>Version</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Correlation ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const env = d.environments as {
                name?: string;
                environment_type?: string;
                customers?: { name?: string };
              } | null;
              return (
                <tr key={d.id}>
                  <td>
                    <Link
                      to="/deployments/$deploymentId"
                      params={{ deploymentId: d.id }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {env?.customers?.name ?? "—"}
                    </Link>
                  </td>
                  <td className="text-muted-foreground">
                    {env?.name} · {env?.environment_type}
                  </td>
                  <td className="text-muted-foreground">{d.deployment_type.replace(/_/g, " ")}</td>
                  <td className="mono-num">
                    {d.previous_version ? `${d.previous_version} → ` : ""}
                    {d.desired_version ?? "—"}
                  </td>
                  <td>
                    <Pill tone={deploymentTone(d.status)}>
                      <Dot tone={deploymentTone(d.status)} />
                      {d.status.replace(/_/g, " ")}
                    </Pill>
                  </td>
                  <td className="text-muted-foreground" title={dateTime(d.requested_at)}>
                    {relative(d.requested_at)}
                  </td>
                  <td className="font-mono text-[11px] text-muted-foreground">
                    {d.correlation_id?.slice(0, 18)}…
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
