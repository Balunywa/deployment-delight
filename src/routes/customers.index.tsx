import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Dot, EmptyState, PageHeader, Pill } from "@/components/Primitives";
import { Input } from "@/components/ui/input";
import { currency, relative, titleize } from "@/lib/format";
import { customersQuery } from "@/lib/queries";

export const Route = createFileRoute("/customers/")({
  head: () => ({
    meta: [
      { title: "Customers · Azure ISV Deployment Factory" },
      {
        name: "description",
        content:
          "Every customer tenant, its Azure deployment model, connection status, environments, platform version and estimated consumption.",
      },
      { property: "og:title", content: "Customers · Azure ISV Deployment Factory" },
      { property: "og:description", content: "Customer tenants, deployment models and platform versions." },
    ],
  }),
  component: Customers,
});

function Customers() {
  const customers = useQuery(customersQuery);
  const [q, setQ] = useState("");

  const rows = (customers.data ?? []).filter((c) =>
    `${c.name} ${c.customer_code} ${c.industry ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Each customer keeps its own Azure tenant, connection and environments. Existing enterprise landing zones are consumed, never replaced."
        actions={
          <Link
            to="/onboard"
            className="rounded-sm bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
          >
            Onboard customer
          </Link>
        }
      />

      <div className="mb-3 max-w-xs">
        <Input placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {customers.isLoading && <EmptyState title="Loading customers…" />}
      {!customers.isLoading && !rows.length && <EmptyState title="No customers match that search." />}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((customer) => {
          const envs = (customer.environments ?? []) as {
            id: string;
            environment_type: string;
            status: string;
            compliance_score: number;
            monthly_cost_estimate: number | null;
            actual: { version?: string } | null;
            desired: { version?: string } | null;
            offerings: { name?: string } | null;
          }[];
          const prod = envs.find((e) => e.environment_type === "production");
          const connection = ((customer.customer_connections ?? []) as {
            connection_type: string;
            status: string;
            last_validated_at: string | null;
          }[])[0];
          const cost = envs.reduce((s, e) => s + Number(e.monthly_cost_estimate ?? 0), 0);
          const outdated = prod && prod.actual?.version !== prod.desired?.version;

          return (
            <Link
              key={customer.id}
              to="/customers/$customerId"
              params={{ customerId: customer.id }}
              className="block rounded-md border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{customer.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{customer.tenant_id}</p>
                </div>
                <Pill tone={customer.azure_model === "greenfield" ? "warning" : "neutral"}>
                  {customer.azure_model === "greenfield" ? "Greenfield" : "Existing ALZ"}
                </Pill>
              </div>

              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Offering</dt>
                  <dd className="truncate font-medium">{prod?.offerings?.name ?? envs[0]?.offerings?.name ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Platform version</dt>
                  <dd className={`mono-num font-medium ${outdated ? "text-warning" : "text-success"}`}>
                    v{prod?.actual?.version ?? "not deployed"}
                    {outdated ? ` → v${prod?.desired?.version}` : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Environments</dt>
                  <dd className="mono-num font-medium">{envs.length}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Compliance</dt>
                  <dd className="mono-num font-medium">{prod ? `${prod.compliance_score}%` : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Estimated monthly</dt>
                  <dd className="mono-num font-medium">{currency(cost, { compact: true })}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone={connection?.status === "validated" ? "success" : "warning"} />
                  {titleize(connection?.connection_type ?? "no connection")}
                </span>
                <span>{connection?.last_validated_at ? `validated ${relative(connection.last_validated_at)}` : "not validated"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
