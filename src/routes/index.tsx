import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  GitBranch,
  Loader2,
  Mail,
  ShieldAlert,
} from "lucide-react";
import { type ReactNode } from "react";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { GridLegend, InstallGrid, OnboardingPipeline } from "@/components/Fleet";
import { statusLabel } from "@/components/Primitives";
import { LANDING_LABEL, fromManifest } from "@/lib/architecture";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { formatDuration, semverCompare } from "@/lib/fleet";
import { relative } from "@/lib/format";
import { pipelineFor } from "@/lib/pipeline";
import { driftQuery, organizationQuery } from "@/lib/queries";
import { useFleet } from "@/lib/use-fleet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Home · Cloud Delivery" },
      {
        name: "description",
        content:
          "Your offerings, their installs across customers, pipeline runs and what's waiting on you.",
      },
      { property: "og:title", content: "Home · Cloud Delivery" },
      {
        property: "og:description",
        content: "One product definition, deployed to every customer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const RUN_ICON: Record<string, { icon: typeof CircleCheck; cls: string }> = {
  SUCCEEDED: { icon: CircleCheck, cls: "text-success" },
  FAILED: { icon: CircleX, cls: "text-danger" },
  REQUIRES_REMEDIATION: { icon: CircleX, cls: "text-danger" },
  VALIDATION_FAILED: { icon: CircleX, cls: "text-danger" },
  AWAITING_APPROVAL: { icon: Clock, cls: "text-warning" },
  AWAITING_PLAN_APPROVAL: { icon: Clock, cls: "text-warning" },
  DEPLOYING: { icon: Loader2, cls: "animate-spin text-info" },
  QUEUED: { icon: CircleDashed, cls: "text-info" },
};

function Home() {
  const { fleet, installs, kpis, deployments, releases, offerings } = useFleet();
  const drift = useQuery(driftQuery);
  const org = useQuery(organizationQuery);

  const live = fleet.filter((c) => c.stage === "live");
  const openDrift = (drift.data ?? []).filter((d) => d.status === "open");
  const awaiting = deployments.filter(
    (d) => d.status === "AWAITING_APPROVAL" || d.status === "AWAITING_PLAN_APPROVAL",
  );
  const failed = deployments.filter(
    (d) => d.status === "FAILED" || d.status === "REQUIRES_REMEDIATION",
  );
  const waitingOnCustomer = fleet.filter((c) => c.stage === "awaiting_access");
  const preferredPct = kpis.prodLive ? Math.round((kpis.onPreferred / kpis.prodLive) * 100) : 0;

  const envLabel = (d: (typeof deployments)[number]) => {
    const e = d.environments as { name?: string; customers?: { name?: string } } | null;
    return `${e?.customers?.name ?? "Customer"} · ${e?.name ?? ""}`;
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">
            {org.data?.name ?? "GridWorks"} Cloud Delivery
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define each offering once. Every customer gets the same architecture through the same
            pipeline.
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <Stat k="Customers live" v={`${kpis.live}`} />
          <Stat k="Onboarding" v={`${kpis.onboarding}`} />
          <Stat k="Installs" v={`${kpis.liveInstalls}`} />
          <Stat k="Prod on preferred" v={`${preferredPct}%`} />
          <Stat k="Median onboard" v={formatDuration(kpis.medianOnboardHours)} />
          <Stat k="Customized" v={`${kpis.custom}`} />
        </dl>
      </div>

      <section className="mb-5 overflow-hidden rounded-md border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Offerings</h2>
          <Link to="/offerings" className="text-xs font-medium text-primary hover:underline">
            Open designer
          </Link>
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>Offering</th>
              <th>Architecture</th>
              <th>Lands into</th>
              <th>Preferred release</th>
              <th>Pipeline</th>
              <th className="text-right">Installs</th>
            </tr>
          </thead>
          <tbody>
            {offerings.map((o) => {
              const versions = (
                (o.offering_versions ?? []) as {
                  version: string;
                  status: string;
                  manifest_json: unknown;
                }[]
              )
                .slice()
                .sort((a, b) => semverCompare(b.version, a.version));
              const pref = releases.get(o.id)?.preferred;
              const current = versions.find((v) => v.version === pref) ?? versions[0];
              const arch = fromManifest(o, current?.manifest_json);
              const stages = pipelineFor(arch.selected, arch.topology);
              const inst = installs.filter((i) => i.offeringId === o.id && i.actual);
              const draft = versions.find((v) => v.status === "draft");
              return (
                <tr key={o.id}>
                  <td>
                    <Link
                      to="/offerings"
                      search={{ offering: o.id }}
                      className="font-medium hover:underline"
                    >
                      {o.name}
                    </Link>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {arch.selected
                        .filter(
                          (s) =>
                            !SERVICE_BY_ID.get(s.id)?.locked &&
                            s.id !== "private-endpoints" &&
                            s.id !== "resource-group",
                        )
                        .map((s) => (
                          <span key={s.id} title={SERVICE_BY_ID.get(s.id)?.name}>
                            <ServiceIcon id={s.id} size="sm" />
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="text-muted-foreground">
                    {LANDING_LABEL[arch.topology.landing].title}
                  </td>
                  <td>
                    <span className="font-mono text-xs">{pref ? `v${pref}` : "—"}</span>
                    {draft && (
                      <span className="ml-2 font-mono text-[11px] text-warning">
                        v{draft.version} draft
                      </span>
                    )}
                  </td>
                  <td>
                    <Link
                      to="/offerings"
                      search={{ offering: o.id, view: "pipeline" }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {stages.length} stages · {stages.reduce((n, s) => n + s.jobs.length, 0)} jobs
                    </Link>
                  </td>
                  <td className="mono-num text-right">{inst.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-md border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-[13px] font-semibold">Pipeline runs</h2>
            <Link to="/deployments" className="text-xs font-medium text-primary hover:underline">
              All runs
            </Link>
          </header>
          <ul className="divide-y divide-border">
            {deployments.slice(0, 8).map((d) => {
              const ic = RUN_ICON[d.status] ?? { icon: CircleDashed, cls: "text-muted-foreground" };
              return (
                <li key={d.id}>
                  <Link
                    to="/deployments/$deploymentId"
                    params={{ deploymentId: d.id }}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50"
                  >
                    <ic.icon className={cn("size-4 shrink-0", ic.cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {statusLabel(d.deployment_type)} → v{d.desired_version ?? "—"}{" "}
                        <span className="font-normal text-muted-foreground">· {envLabel(d)}</span>
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {statusLabel(d.status)} · {d.requested_by ?? "—"} ·{" "}
                        <span className="font-mono">{d.correlation_id.slice(0, 7)}</span>
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relative(d.requested_at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="overflow-hidden rounded-md border border-border bg-card">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[13px] font-semibold">Needs you</h2>
          </header>
          <ul className="divide-y divide-border">
            {awaiting.map((d) => (
              <Item
                key={d.id}
                icon={<ShieldAlert className="size-4 text-warning" />}
                title={`Approve plan · ${envLabel(d)}`}
                detail={`${d.deployment_type} to v${d.desired_version ?? "—"}`}
              >
                <Link
                  to="/deployments/$deploymentId"
                  params={{ deploymentId: d.id }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Review
                </Link>
              </Item>
            ))}
            {failed.map((d) => (
              <Item
                key={d.id}
                icon={<CircleX className="size-4 text-danger" />}
                title={`Failed run · ${envLabel(d)}`}
                detail="No automatic rollback — remediate and re-plan"
              >
                <Link
                  to="/deployments/$deploymentId"
                  params={{ deploymentId: d.id }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open
                </Link>
              </Item>
            ))}
            {waitingOnCustomer.map((c) => (
              <Item
                key={c.id}
                icon={<Mail className="size-4 text-muted-foreground" />}
                title={`Waiting on ${c.name}`}
                detail="Install link not completed by their Azure admin"
              >
                <Link
                  to="/customers/$customerId"
                  params={{ customerId: c.id }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open
                </Link>
              </Item>
            ))}
            {openDrift.map((f) => {
              const env = f.environments as { customers?: { id?: string; name?: string } } | null;
              return (
                <Item
                  key={f.id}
                  icon={<AlertTriangle className="size-4 text-warning" />}
                  title={`Drift · ${env?.customers?.name ?? "Install"}`}
                  detail={`${f.category.replace(/_/g, " ")} · ${f.severity}`}
                >
                  {env?.customers?.id && (
                    <Link
                      to="/customers/$customerId"
                      params={{ customerId: env.customers.id }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Decide
                    </Link>
                  )}
                </Item>
              );
            })}
            {kpis.deprecated > 0 && (
              <Item
                icon={<GitBranch className="size-4 text-info" />}
                title={`${kpis.deprecated} production install(s) on a deprecated release`}
                detail="Major-version gap — reviewed upgrade required"
              >
                <Link to="/upgrades" className="text-xs font-medium text-primary hover:underline">
                  Plan
                </Link>
              </Item>
            )}
          </ul>
        </section>
      </div>

      <section className="mb-5">
        <h2 className="mb-2 text-[13px] font-semibold">Onboarding</h2>
        <OnboardingPipeline customers={fleet} />
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold">Installed base</h2>
          <GridLegend />
        </div>
        <InstallGrid customers={live} limit={12} />
        <Link
          to="/estate"
          className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
        >
          All {live.length} customers →
        </Link>
      </section>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{k}</dt>
      <dd className="font-mono text-[15px] font-semibold tabular-nums">{v}</dd>
    </div>
  );
}

function Item({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
    </li>
  );
}
