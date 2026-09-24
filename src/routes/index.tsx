import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CheckCircle2, GitBranch, ShieldAlert, XCircle } from "lucide-react";

import { Dot, PageHeader, Panel, Pill, deploymentTone } from "@/components/Primitives";
import { currency, relative } from "@/lib/format";
import { deploymentsQuery, driftQuery, estateQuery, wavesQuery } from "@/lib/queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Home · GridWorks Deployment Factory" },
      {
        name: "description",
        content:
          "Current release, decisions awaiting you, fleet version progression and active customer rollouts for your productized Azure deployment.",
      },
      { property: "og:title", content: "Home · GridWorks Deployment Factory" },
      {
        property: "og:description",
        content: "Release, decide, roll out: your Azure deployment as a versioned product.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

type V = { version?: string } | null;
const ver = (x: unknown) => (x as V)?.version;

function Home() {
  const estate = useQuery(estateQuery);
  const deployments = useQuery(deploymentsQuery);
  const drift = useQuery(driftQuery);
  const waves = useQuery(wavesQuery);

  const envs = estate.data ?? [];
  const prod = envs.filter((e) => e.environment_type === "production");
  const deps = deployments.data ?? [];
  const openDrift = (drift.data ?? []).filter((d) => d.status === "open");
  const latest = "4.2.0";

  const onLatest = prod.filter((e) => ver(e.actual) === latest).length;
  const behind = prod.filter((e) => ver(e.actual) && ver(e.actual) !== latest);
  const adoption = prod.length ? Math.round((onLatest / prod.length) * 100) : 0;

  const versionCounts = prod.reduce<Record<string, number>>((acc, e) => {
    const v = ver(e.actual) ?? "none";
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
  const versions = Object.entries(versionCounts).sort((a, b) => b[0].localeCompare(a[0]));

  const awaiting = deps.filter((d) => d.status === "AWAITING_APPROVAL" || d.status === "AWAITING_PLAN_APPROVAL");
  const failed = deps.filter((d) => d.status === "FAILED" || d.status === "REQUIRES_REMEDIATION");
  const manualReview = prod.filter((e) => ver(e.actual)?.startsWith("3."));
  const decisions = awaiting.length + failed.length + openDrift.length + (manualReview.length ? 1 : 0);

  const envName = (d: (typeof deps)[number]) => {
    const e = d.environments as { name?: string; customers?: { name?: string } } | null;
    return `${e?.customers?.name ?? "Customer"} · ${e?.name ?? ""}`;
  };

  const rolloutStages = [
    { label: "Planned", n: deps.filter((d) => ["DRAFT", "READY", "VALIDATING", "PLANNING"].includes(d.status)).length, tone: "neutral" as const },
    { label: "Awaiting approval", n: awaiting.length, tone: "warning" as const },
    { label: "Deploying", n: deps.filter((d) => ["QUEUED", "DEPLOYING"].includes(d.status)).length, tone: "info" as const },
    { label: "Succeeded", n: deps.filter((d) => d.status === "SUCCEEDED" && d.deployment_type === "upgrade").length, tone: "success" as const },
    { label: "Failed", n: failed.length, tone: "danger" as const },
  ];

  const monthly = envs.reduce((s, e) => s + Number(e.monthly_cost_estimate ?? 0), 0);
  const complianceGaps = envs.filter((e) => Number(e.compliance_score) < 100).length;

  return (
    <>
      <PageHeader
        title="Deployment factory"
        description="Define once → version deliberately → plan safely → approve explicitly → deploy repeatedly → reconcile continuously."
        meta={<Pill tone="warning">Demo mode — every deployment here is simulated</Pill>}
        actions={
          <Link to="/onboard" className="rounded-sm bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90">
            Onboard customer
          </Link>
        }
      />

      {/* Current release */}
      <section className="mb-4 rounded-md border border-border bg-card">
        <div className="grid gap-0 divide-y divide-border lg:grid-cols-[1.3fr_1fr] lg:divide-x lg:divide-y-0">
          <div className="p-5">
            <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">Current release</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <h2 className="text-2xl font-semibold text-foreground">Grid Analytics Platform</h2>
              <span className="mono-num text-2xl font-semibold text-primary">v{latest}</span>
              <Pill tone="success">Published · immutable</Pill>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Enterprise Private blueprint · deploys into existing enterprise landing zones</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/offerings" className="rounded-sm border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted">
                View blueprint
              </Link>
              <Link to="/estate" className="rounded-sm bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90">
                Plan upgrade for {behind.length} environments
              </Link>
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">Production adoption</p>
              <span className="mono-num text-sm font-semibold">{onLatest}/{prod.length} · {adoption}%</span>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
              {versions.map(([v, n], i) => (
                <span
                  key={v}
                  title={`v${v}: ${n}`}
                  className={i === 0 ? "bg-primary" : i === 1 ? "bg-warning" : "bg-danger"}
                  style={{ width: `${(n / Math.max(prod.length, 1)) * 100}%` }}
                />
              ))}
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {versions.map(([v, n], i) => (
                <li key={v} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${i === 0 ? "bg-primary" : i === 1 ? "bg-warning" : "bg-danger"}`} />
                    <span className="mono-num">v{v}</span>
                    <span className="text-xs text-muted-foreground">
                      {v === latest ? "current" : v.startsWith("3.") ? "manual review required" : "upgrade-compatible"}
                    </span>
                  </span>
                  <span className="mono-num text-muted-foreground">{n}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* Decisions */}
        <Panel
          title={`Decisions required · ${decisions}`}
          description="Nothing moves until someone decides. Approving a plan does not start a deployment by itself."
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {awaiting.map((d) => (
              <Decision key={d.id} icon={<ShieldAlert className="size-4 text-warning" />} title={`Approve production plan · ${envName(d)}`}
                detail={`${d.deployment_type} → v${d.desired_version ?? "—"} · requested ${relative(d.requested_at)}`}
                action={<Link to="/deployments/$deploymentId" params={{ deploymentId: d.id }} className="text-xs font-medium text-primary hover:underline">Review plan</Link>} />
            ))}
            {failed.map((d) => (
              <Decision key={d.id} icon={<XCircle className="size-4 text-danger" />} title={`Failed deployment · ${envName(d)}`}
                detail="No automatic rollback. Remediate and re-plan."
                action={<Link to="/deployments/$deploymentId" params={{ deploymentId: d.id }} className="text-xs font-medium text-primary hover:underline">Investigate</Link>} />
            ))}
            {openDrift.map((f) => (
              <Decision key={f.id} icon={<AlertTriangle className="size-4 text-warning" />}
                title={`Drift · ${(f.environments as { customers?: { name?: string } } | null)?.customers?.name ?? "Environment"} · ${f.category}`}
                detail={`${f.severity} · accept, remediate, ignore or escalate`}
                action={<Link to="/customers" className="text-xs font-medium text-primary hover:underline">Decide</Link>} />
            ))}
            {manualReview.length > 0 && (
              <Decision icon={<GitBranch className="size-4 text-info" />} title={`${manualReview.length} environments on v3.x need manual upgrade review`}
                detail="Breaking changes between 3.9 and 4.2 — cannot join an automatic wave."
                action={<Link to="/estate" className="text-xs font-medium text-primary hover:underline">Review</Link>} />
            )}
            {decisions === 0 && (
              <li className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-success" />Nothing waiting on you.</li>
            )}
          </ul>
        </Panel>

        {/* Active rollout */}
        <Panel
          title="Active rollout · v4.1 → v4.2"
          description="Waves progress only after plans are approved"
          actions={<Link to="/upgrades" className="text-xs font-medium text-primary hover:underline">Open rollouts</Link>}
        >
          <ol className="space-y-2">
            {rolloutStages.map((s, i) => (
              <li key={s.label} className="flex items-center gap-3">
                <span className="mono-num w-4 text-xs text-muted-foreground">{i + 1}</span>
                <Dot tone={s.tone} />
                <span className="flex-1 text-sm">{s.label}</span>
                <span className="mono-num text-sm font-semibold">{s.n}</span>
              </li>
            ))}
          </ol>
          {(waves.data ?? []).length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">Waves</p>
              <div className="flex flex-wrap gap-1.5">
                {[...(waves.data ?? [])].sort((a, b) => a.sequence - b.sequence).map((w) => (
                  <Pill key={w.id} tone={w.status === "completed" ? "success" : w.status === "in_progress" ? "info" : "neutral"}>
                    {w.name} · {w.environment_ids.length}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Trust & cost strip */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StripLink to="/compliance" label="Compliance gaps" value={String(complianceGaps)} hint="Evidence-backed checks only" />
        <StripLink to="/costs" label="Monthly cost · ESTIMATED" value={currency(monthly, { compact: true })} hint="ACTUAL appears once billing is connected" />
        <StripLink to="/audit" label="Audit trail" value="Immutable" hint="Every decision and step recorded" />
      </div>

      {deps[0] && (
        <p className="mt-4 text-xs text-muted-foreground">
          Latest activity:{" "}
          <LatestActivity d={deps[0]} name={envName(deps[0])} />
        </p>
      )}
    </>
  );
}

function Decision({ icon, title, detail, action }: { icon: React.ReactNode; title: string; detail: string; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </li>
  );
}

function StripLink({ to, label, value, hint }: { to: "/compliance" | "/costs" | "/audit"; label: string; value: string; hint: string }) {
  return (
    <Link to={to} className="group rounded-md border border-border bg-card p-4 hover:bg-muted/40">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">{label}</p>
        <ArrowRight className="size-3 text-muted-foreground" />
      </div>
      <p className="mono-num mt-1 text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}

function LatestActivity({ d, name }: { d: { status: string; requested_at: string }; name: string }) {
  return (
    <>
      <Pill tone={deploymentTone(d.status)}>{d.status.replace(/_/g, " ")}</Pill> {name} · {relative(d.requested_at)}
    </>
  );
}
