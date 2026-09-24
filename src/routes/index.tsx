import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { Dot, Metric, PageHeader, Panel, Pill, deploymentTone, severityTone } from "@/components/Primitives";
import { currency, percent, relative } from "@/lib/format";
import { deploymentsQuery, driftQuery, estateQuery } from "@/lib/queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview · Azure ISV Deployment Factory" },
      {
        name: "description",
        content:
          "Estate health, platform versions, deployment health and projected Azure consumption across every ISV customer environment.",
      },
      { property: "og:title", content: "Overview · Azure ISV Deployment Factory" },
      {
        property: "og:description",
        content: "Estate health, platform versions, deployment health and projected Azure consumption.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const estate = useQuery(estateQuery);
  const deployments = useQuery(deploymentsQuery);
  const drift = useQuery(driftQuery);

  const envs = estate.data ?? [];
  const prod = envs.filter((e) => e.environment_type === "production");
  const customers = new Set(envs.map((e) => e.customer_id));
  const deps = deployments.data ?? [];
  const openDrift = (drift.data ?? []).filter((d) => d.status === "open");

  const versionCounts = prod.reduce<Record<string, number>>((acc, e) => {
    const v = (e.actual as { version?: string } | null)?.version ?? "not deployed";
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});

  const outdated = prod.filter(
    (e) =>
      (e.actual as { version?: string } | null)?.version !==
      (e.desired as { version?: string } | null)?.version,
  );
  const failed = deps.filter((d) => d.status === "FAILED" || d.status === "REQUIRES_REMEDIATION");
  const inFlight = deps.filter((d) => ["QUEUED", "DEPLOYING", "PLANNING", "VALIDATING"].includes(d.status));
  const awaiting = deps.filter((d) => d.status === "AWAITING_APPROVAL" || d.status === "AWAITING_PLAN_APPROVAL");
  const succeeded = deps.filter((d) => d.status === "SUCCEEDED");
  const successRate = deps.length ? Math.round((succeeded.length / (succeeded.length + failed.length || 1)) * 100) : 0;
  const monthly = envs.reduce((sum, e) => sum + Number(e.monthly_cost_estimate ?? 0), 0);
  const complianceIssues = envs.filter((e) => Number(e.compliance_score) < 100);

  return (
    <>
      <PageHeader
        title="Overview"
        description="You've productized your software. This is your Azure deployment, productized — one versioned catalog deployed repeatably into every customer tenant."
        meta={
          <>
            <Pill tone="primary">GridWorks · Grid Analytics Platform</Pill>
            <Pill tone="warning">Demo mode — deployments are simulated, no Azure calls</Pill>
          </>
        }
        actions={
          <Link
            to="/onboard"
            className="rounded-sm bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
          >
            Onboard customer
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Customers" value={customers.size} hint={`${envs.length} environments under management`} />
        <Metric
          label="Outdated environments"
          value={outdated.length}
          tone={outdated.length ? "warning" : "success"}
          hint="Desired version differs from actual"
        />
        <Metric
          label="Drift findings"
          value={openDrift.length}
          tone={openDrift.length ? "warning" : "success"}
          hint="Open, awaiting decision"
        />
        <Metric
          label="Projected Azure spend"
          value={currency(monthly, { compact: true })}
          hint={`${currency(monthly * 12, { compact: true })} annualized · ESTIMATE`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Customer estate"
          description="Version posture across production environments"
          actions={
            <Link to="/estate" className="text-xs font-medium text-primary hover:underline">
              Open estate
            </Link>
          }
        >
          <dl className="space-y-2 text-sm">
            <Row label="Customers" value={String(customers.size)} />
            <Row label="Current" value={String(prod.length - outdated.length)} tone="success" />
            <Row label="Upgrade available" value={String(outdated.length)} tone="warning" />
            <Row
              label="Attention required"
              value={String(envs.filter((e) => e.status === "attention_required").length)}
              tone="danger"
            />
          </dl>
        </Panel>

        <Panel title="Platform versions" description="Production environments by deployed offering version">
          <ul className="space-y-2">
            {Object.entries(versionCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([version, count]) => (
                <li key={version} className="flex items-center gap-3">
                  <span className="mono-num w-14 text-foreground">v{version.replace("not deployed", "—")}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(count / Math.max(prod.length, 1)) * 100}%` }}
                    />
                  </span>
                  <span className="mono-num w-16 text-right text-muted-foreground">{count} cust.</span>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="Deployment health" description="All recorded deployments (demo engine)">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Row label="Success rate" value={`${successRate}%`} tone="success" />
            <Row label="Succeeded" value={String(succeeded.length)} />
            <Row label="Failed" value={String(failed.length)} tone={failed.length ? "danger" : "neutral"} />
            <Row label="In progress" value={String(inFlight.length)} tone="info" />
            <Row
              label="Awaiting approval"
              value={String(awaiting.length)}
              tone={awaiting.length ? "warning" : "neutral"}
            />
            <Row
              label="Compliance issues"
              value={String(complianceIssues.length)}
              tone={complianceIssues.length ? "warning" : "success"}
            />
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Needs your attention"
          description="Approvals, failures and drift that block the lifecycle"
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {[...awaiting, ...failed].slice(0, 6).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link to="/deployments/$deploymentId" params={{ deploymentId: d.id }} className="text-sm font-medium hover:underline">
                    {(d.environments as { customers?: { name?: string } } | null)?.customers?.name ?? "Environment"} ·{" "}
                    {(d.environments as { name?: string } | null)?.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {d.deployment_type} → v{d.desired_version ?? "—"} · requested {relative(d.requested_at)}
                  </p>
                </div>
                <Pill tone={deploymentTone(d.status)}>
                  <Dot tone={deploymentTone(d.status)} />
                  {d.status.replace(/_/g, " ")}
                </Pill>
              </li>
            ))}
            {openDrift.slice(0, 4).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {(f.environments as { customers?: { name?: string } } | null)?.customers?.name} · drift in {f.category}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{f.recommended_remediation}</p>
                </div>
                <Pill tone={severityTone(f.severity)}>{f.severity}</Pill>
              </li>
            ))}
            {!awaiting.length && !failed.length && !openDrift.length && (
              <li className="px-4 py-6 text-sm text-muted-foreground">Nothing needs attention.</li>
            )}
          </ul>
        </Panel>

        <Panel
          title="Estimated Azure consumption"
          description="Estimates from offering cost models — not billed consumption"
          actions={
            <Link to="/costs" className="text-xs font-medium text-primary hover:underline">
              FinOps view
            </Link>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="Monthly (estimate)" value={currency(monthly, { compact: true })} />
            <Metric label="Annualized (estimate)" value={currency(monthly * 12, { compact: true })} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Average compliance across the estate is{" "}
            {percent(envs.reduce((s, e) => s + Number(e.compliance_score), 0) / Math.max(envs.length, 1))}. Actual
            consumption appears here once Azure Cost Management ingestion is connected.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass = {
    neutral: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
  }[tone];
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mono-num font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}
