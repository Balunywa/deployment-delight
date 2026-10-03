/* The engagements with one customer, on their customer page: where each one is and what it needs next. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ear, Plus } from "lucide-react";

import { progressOf } from "@/lib/engagements";
import { relative } from "@/lib/format";
import { engagementsQuery } from "@/lib/queries";

import { StageDots } from "./StageDots";

export function CustomerEngagements({ customerId }: { customerId: string }) {
  const list = useQuery(engagementsQuery);
  const items = (list.data ?? []).filter((e) => e.customer_id === customerId);
  return (
    <section
      aria-label="Engagements with this customer"
      className="mb-5 overflow-hidden rounded-md border border-border bg-card"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Ear className="size-3.5 text-primary" /> Engagements
        </h2>
        <Link
          to="/customers/onboard"
          search={{ customer: customerId }}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
        >
          <Plus className="size-3.5" /> Start one with this customer
        </Link>
      </header>
      {items.length ? (
        <ul className="divide-y divide-border">
          {items.map((e) => (
            <li key={e.id}>
              <Link
                to="/engagements/$engagementId"
                params={{ engagementId: e.id }}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{e.name}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {e.status === "draft"
                      ? "Preparing: not started with the customer"
                      : progressOf(e).next}
                    {e.owner_name ? ` · ${e.owner_name}` : ""}
                    {e.brief.team?.csa ? ` · CSA ${e.brief.team.csa}` : ""} ·{" "}
                    {relative(e.updated_at)}
                  </span>
                </span>
                <StageDots e={e} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">
          No engagements yet. Start with what they're trying to accomplish, before any solution.
        </p>
      )}
    </section>
  );
}
