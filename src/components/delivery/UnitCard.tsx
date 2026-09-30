/*
 * Shared delivery-unit UI: the status pill, and the card that solution, customer and landing zone pages show to
 * say which repository, environments, identities and state deliver them.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, GitBranch, KeyRound, Lock, Server } from "lucide-react";

import { Pill } from "@/components/Primitives";
import { UNIT_META } from "@/lib/delivery/model";
import { deliveryUnitQuery } from "@/lib/queries";

const STATUS_META: Record<
  string,
  { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }
> = {
  planned: { label: "Not vended", tone: "neutral" },
  requested: { label: "Request ready", tone: "info" },
  vending: { label: "Vending PR open", tone: "warning" },
  active: { label: "Vended", tone: "success" },
  failed: { label: "Vending failed", tone: "danger" },
  retired: { label: "Retired", tone: "neutral" },
};

export function UnitStatus({ status }: { status: string }) {
  const m = STATUS_META[status];
  return <Pill tone={m?.tone ?? "neutral"}>{m?.label ?? status}</Pill>;
}

/** "Delivered from": the unit behind a solution, customer or landing zone. */
export function UnitCard({
  link,
}: {
  link: { productId: string } | { customerId: string } | { foundationId: string };
}) {
  const q = useQuery(deliveryUnitQuery(link));
  const d = q.data;
  if (q.isLoading)
    return (
      <section className="rounded-md border bg-card p-4 text-xs text-muted-foreground">
        Loading delivery unit…
      </section>
    );
  if (!d) return null;
  const u = d.unit;
  const plans = u.spec.identities.filter((i) => i.role === "plan").length;
  const applies = u.spec.identities.length - plans;
  const gated = u.spec.environments.filter((e) => e.reviewers.length);
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Delivered from
        </h2>
        <UnitStatus status={u.status} />
      </div>
      <Link
        to="/delivery/$unitId"
        params={{ unitId: u.id }}
        className="inline-flex items-center gap-1.5 font-mono text-[13px] font-semibold text-primary hover:underline"
      >
        <GitBranch className="size-3.5" />
        {d.org}/{u.repository}
      </Link>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {UNIT_META[u.kind].label} · its own repository, pipeline, identities and state
      </p>
      <ul className="mt-3 space-y-1.5 text-xs">
        <li className="flex items-center gap-2">
          <Server className="size-3.5 text-muted-foreground" />
          {u.spec.environments.length} environments
          {gated.length > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              · <Lock className="size-3" /> {gated.map((e) => e.name).join(", ")}
            </span>
          )}
        </li>
        <li className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-muted-foreground" />
          {plans} read-only + {applies} write identities
        </li>
        <li className="flex items-center gap-2">
          <span className="grid size-3.5 place-items-center font-mono text-[9px] text-muted-foreground">
            tf
          </span>
          {u.spec.state.length} state file{u.spec.state.length === 1 ? "" : "s"}
        </li>
      </ul>
      {d.findings.length > 0 && (
        <p className="mt-3 flex gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {d.findings[0]}
          {d.findings.length > 1 && ` (+${d.findings.length - 1} more)`}
        </p>
      )}
      {u.request_url && (
        <a
          href={u.request_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Vending pull request <ExternalLink className="size-3" />
        </a>
      )}
    </section>
  );
}

/** Compact "delivered from <repo>" link for page headers. */
export function UnitLink({
  link,
}: {
  link: { productId: string } | { customerId: string } | { foundationId: string };
}) {
  const q = useQuery(deliveryUnitQuery(link));
  if (!q.data) return null;
  return (
    <Link
      to="/delivery/$unitId"
      params={{ unitId: q.data.unit.id }}
      title="Delivered from its own repository, pipeline, identities and state"
      className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-px font-mono text-[11px] text-primary hover:bg-muted"
    >
      <GitBranch className="size-3" />
      {q.data.org}/{q.data.unit.repository}
    </Link>
  );
}
