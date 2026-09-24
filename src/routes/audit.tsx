import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, PageHeader, Pill } from "@/components/Primitives";
import { Input } from "@/components/ui/input";
import { dateTime, describe } from "@/lib/format";
import { auditQuery } from "@/lib/queries";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit · Cloud Delivery" },
      {
        name: "description",
        content:
          "Immutable audit trail: who did what, to which customer and environment, when, with previous and new values and a correlation ID.",
      },
      { property: "og:title", content: "Audit · Cloud Delivery" },
      { property: "og:description", content: "Immutable record of every control-plane action." },
    ],
  }),
  component: Audit,
});

function Audit() {
  const audit = useQuery(auditQuery);
  const [q, setQ] = useState("");

  const rows = (audit.data ?? []).filter((e) =>
    `${e.event_type} ${e.actor_name ?? ""} ${e.resource_id ?? ""}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Audit"
        description="Append-only. Records cannot be edited or deleted from this portal — every approval, publish, deployment and drift decision is retained."
        meta={<Pill tone="neutral">{rows.length} events</Pill>}
      />

      <div className="mb-3 max-w-xs">
        <Input placeholder="Search events…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {audit.isLoading && <EmptyState title="Loading audit trail…" />}

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Event</th>
              <th>Customer</th>
              <th>Environment</th>
              <th>Resource</th>
              <th>Change</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-muted-foreground">{dateTime(e.timestamp)}</td>
                <td>{e.actor_name ?? "system"}</td>
                <td className="font-mono text-[11px]">{e.event_type}</td>
                <td className="text-muted-foreground">
                  {(e.customers as { name?: string } | null)?.name ?? "—"}
                </td>
                <td className="text-muted-foreground">
                  {(e.environments as { name?: string } | null)?.name ?? "—"}
                </td>
                <td className="text-muted-foreground">
                  {e.resource_type} {e.resource_id}
                </td>
                <td className="max-w-[320px] truncate font-mono text-[11px] text-muted-foreground">
                  {e.previous_value ? `${describe(e.previous_value)} → ` : ""}
                  {e.new_value ? describe(e.new_value) : "—"}
                </td>
                <td>
                  <Pill tone={e.result === "failure" ? "danger" : "success"}>
                    {e.result ?? "success"}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
