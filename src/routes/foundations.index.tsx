import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpCircle, Building2, Eye, Server } from "lucide-react";

import { EmptyState, Pill } from "@/components/Primitives";
import {
  type Answers,
  DEFAULT_ANSWERS,
  LATEST_REF,
  hierarchy,
  libraryFor,
  shortRef,
} from "@/lib/alz/engine";
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

  return (
    <>
      <div className="mb-6 max-w-3xl">
        <p className="text-xs text-muted-foreground">Platform</p>
        <h1 className="mt-0.5 text-[22px] font-semibold">Landing zones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The Azure foundation each customer install lands in — management groups, policy and
          platform subscriptions, built from Microsoft's{" "}
          <a
            href="https://github.com/Azure/Azure-Landing-Zones-Library"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Azure Landing Zones Library
          </a>
          . There is one per Microsoft Entra tenant: your own hosting tenant, customer tenants you
          build, and customer landing zones you plug into.
        </p>
      </div>

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
      <Group
        icon={<Eye className="size-4" />}
        title="Customer landing zones you use"
        subtitle="Customers with their own enterprise landing zone — owned by their platform team, used as-is"
        items={existing}
        placementsOf={(f) => placementsFor(all, f)}
      />
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
          const answers = { ...DEFAULT_ANSWERS, ...((f.answers ?? {}) as Partial<Answers>) };
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
