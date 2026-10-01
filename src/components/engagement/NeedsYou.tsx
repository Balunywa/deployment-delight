/* What's waiting on the SE or CSA across every engagement: due actions, runs to approve, value checkpoints, handoffs. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, CalendarClock, FlaskConical, Handshake, Rocket } from "lucide-react";

import type { WorkItem } from "@/lib/engagements.functions";
import { workQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ICON: Record<WorkItem["kind"], typeof Rocket> = {
  action: CalendarClock,
  run: Rocket,
  checkpoint: BadgeCheck,
  handoff: Handshake,
  untested: FlaskConical,
};

const when = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function NeedsYou({ limit = 8, className }: { limit?: number; className?: string }) {
  const q = useQuery(workQuery);
  const items = q.data ?? [];
  if (q.isLoading) return null;
  return (
    <section
      aria-label="Needs you"
      className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[13.5px] font-semibold">Needs you</h2>
        <span className="text-[11.5px] text-muted-foreground">
          {items.length ? `${items.length} across your engagements` : "Nothing waiting on you"}
        </span>
      </header>
      {items.length > 0 && (
        <ul className="divide-y divide-border">
          {items.slice(0, limit).map((w) => {
            const Icon = ICON[w.kind];
            const body = (
              <>
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    w.overdue ? "text-danger" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{w.title}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {w.engagement} · {w.detail}
                  </span>
                </span>
                {w.due && (
                  <span
                    className={cn(
                      "shrink-0 text-[11.5px]",
                      w.overdue ? "font-semibold text-danger" : "text-muted-foreground",
                    )}
                  >
                    {w.overdue ? "Overdue · " : "Due "}
                    {when(w.due)}
                  </span>
                )}
              </>
            );
            const cls = "flex items-start gap-3 px-4 py-2.5 hover:bg-muted/40";
            return (
              <li key={w.key}>
                {w.deploymentId ? (
                  <Link
                    to="/deployments/$deploymentId"
                    params={{ deploymentId: w.deploymentId }}
                    className={cls}
                  >
                    {body}
                  </Link>
                ) : (
                  <Link
                    to="/engagements/$engagementId"
                    params={{ engagementId: w.engagementId }}
                    search={{ tab: w.tab }}
                    className={cls}
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
