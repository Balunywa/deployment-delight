import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { type JobStatus, PipelineGraph } from "@/components/architecture/PipelineGraph";
import { EmptyState, Pill, ResultPill, deploymentTone, statusLabel } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { fromManifest } from "@/lib/architecture";
import type { DeploymentPlan, PlanResource, PreflightResult } from "@/lib/engine/types";
import { decideApproval, executeDeployment } from "@/lib/factory.functions";
import { currency, dateTime, relative } from "@/lib/format";
import { type Job, pipelineFor } from "@/lib/pipeline";
import { deploymentQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/deployments/$deploymentId")({
  head: () => ({
    meta: [
      { title: "Pipeline run · Cloud Delivery" },
      {
        name: "description",
        content:
          "Validate, plan, approve and deploy one customer install through the central pipeline.",
      },
      { property: "og:title", content: "Pipeline run · Cloud Delivery" },
      { property: "og:description", content: "Pipeline run for one customer install." },
    ],
  }),
  component: DeploymentRun,
});

type Step = {
  id: string;
  sequence: number;
  name: string;
  module_name: string | null;
  status: string;
  log_text: string | null;
};
type Approval = {
  id: string;
  approval_type: string;
  status: string;
  requested_from: string | null;
  decided_by: string | null;
  comments: string | null;
  decided_at: string | null;
};

const PLAN_SIGN: Record<string, { sign: string; cls: string; label: string }> = {
  create: { sign: "+", cls: "text-success", label: "create" },
  update: { sign: "~", cls: "text-warning", label: "update" },
  delete: { sign: "−", cls: "text-danger", label: "delete" },
  use_existing: { sign: "=", cls: "text-muted-foreground", label: "use existing" },
};

function DeploymentRun() {
  const { deploymentId } = Route.useParams();
  const deployment = useQuery(deploymentQuery(deploymentId));
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [replay, setReplay] = useState<number | null>(null);

  const invalidate = () => {
    for (const key of [
      ["deployment", deploymentId],
      ["deployments"],
      ["estate"],
      ["customers"],
      ["audit"],
    ])
      void queryClient.invalidateQueries({ queryKey: key });
  };

  const decideFn = useServerFn(decideApproval);
  const decide = useMutation({
    mutationFn: (input: {
      approvalId: string;
      decision: "approved" | "rejected";
      comments?: string;
      decidedBy?: string;
    }) => decideFn({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.decision === "approved"
          ? "Approved — run queued for the central pipeline."
          : "Rejected — run cancelled.",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const execute = useMutation({
    mutationFn: useServerFn(executeDeployment),
    onSuccess: (r: { status: string }) => {
      setReplay(0);
      if (r.status !== "SUCCEEDED") toast.error(`Run ended in ${statusLabel(r.status)}.`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = deployment.data;
  const env = d?.environments as
    | {
        id: string;
        name: string;
        environment_type: string;
        region: string;
        configuration_json: Record<string, unknown> | null;
        customers: { id: string; name: string; customer_code: string };
        offerings: { name: string; offering_type: string; network_profile: string | null };
        desired: { version: string; manifest_json: unknown } | null;
      }
    | undefined;

  const arch = useMemo(() => {
    if (!env) return null;
    const a = fromManifest(env.offerings, env.desired?.manifest_json);
    const mode = (env.configuration_json?.["network"] as { mode?: string } | undefined)?.mode;
    if (mode === "existing-customer-hub" || mode === "dedicated-spoke" || mode === "isv-hosted")
      a.topology.landing = mode;
    a.topology.environments = [env.environment_type];
    a.topology.regions = [env.region];
    return a;
  }, [env]);

  const steps = ((d?.deployment_steps ?? []) as unknown as Step[])
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  // Replays recorded demo steps so the run reads like a live pipeline right after it executes.
  useEffect(() => {
    if (replay === null) return;
    if (replay > steps.length + 3) {
      setReplay(null);
      toast.success("Run succeeded — install is live (demo engine, no Azure calls).");
      return;
    }
    const t = setTimeout(() => setReplay((r) => (r === null ? null : r + 1)), 380);
    return () => clearTimeout(t);
  }, [replay, steps.length]);

  if (deployment.isLoading) return <EmptyState title="Loading run…" />;
  if (!d || !env || !arch) return <EmptyState title="Run not found." />;

  const preflight = asPreflight(d.preflight_json);
  const plan = asPlan(d.plan_json);
  const approvals = (d.approvals ?? []) as unknown as Approval[];
  const pending = approvals.find((a) => a.status === "pending");
  const stages = pipelineFor(arch.selected, arch.topology);
  const status = d.status as string;
  const bindings = { ...((env.configuration_json?.["inputs"] ?? {}) as Record<string, string>) };

  const stepIndex = (module: string) => steps.findIndex((s) => s.module_name === module);
  const jobStatus = (job: Job, stage: { id: string }): JobStatus | undefined => {
    if (stage.id === "validate") {
      if (!preflight) return status === "VALIDATING" ? "running" : "queued";
      return job.id === "preflight" && preflight.blocking ? "failed" : "succeeded";
    }
    if (stage.id === "plan") {
      if (status === "VALIDATION_FAILED") return "skipped";
      const planned =
        plan?.resources?.length ||
        [
          "AWAITING_APPROVAL",
          "AWAITING_PLAN_APPROVAL",
          "QUEUED",
          "DEPLOYING",
          "SUCCEEDED",
          "FAILED",
          "REQUIRES_REMEDIATION",
        ].includes(status);
      return planned
        ? "succeeded"
        : status === "PLANNING"
          ? "running"
          : status === "PLAN_FAILED"
            ? "failed"
            : "queued";
    }
    if (stage.id === "approve") {
      if (!approvals.length) return plan?.resources?.length ? "skipped" : "queued";
      if (approvals.some((a) => a.status === "rejected")) return "failed";
      return pending ? "waiting" : "succeeded";
    }
    if (
      [
        "QUEUED",
        "AWAITING_APPROVAL",
        "AWAITING_PLAN_APPROVAL",
        "VALIDATION_FAILED",
        "PLAN_FAILED",
        "CANCELLED",
        "DRAFT",
        "READY",
        "PLANNING",
        "VALIDATING",
      ].includes(status)
    )
      return status === "VALIDATION_FAILED" || status === "CANCELLED" ? "skipped" : "queued";
    if (status === "DEPLOYING") return "running";
    const i = job.module ? stepIndex(job.module) : steps.length;
    const s = job.module ? steps[i] : undefined;
    if (replay !== null && i >= 0)
      return i < replay
        ? s?.status === "failed"
          ? "failed"
          : "succeeded"
        : i === replay
          ? "running"
          : "queued";
    if (s) return s.status === "failed" ? "failed" : "succeeded";
    return status === "SUCCEEDED"
      ? "succeeded"
      : status === "FAILED" || status === "REQUIRES_REMEDIATION"
        ? "skipped"
        : "queued";
  };

  const nodeStatus: Record<string, "pending" | "running" | "succeeded" | "failed"> = {};
  const deployStages = stages.filter((s) => s.id.startsWith("deploy-") || s.id === "verify");
  for (const st of deployStages)
    for (const j of st.jobs) {
      if (!j.module) continue;
      const js = jobStatus(j, st);
      nodeStatus[j.module] =
        js === "succeeded"
          ? "succeeded"
          : js === "failed"
            ? "failed"
            : js === "running"
              ? "running"
              : "pending";
    }
  if (
    nodeStatus["private-endpoints"] === undefined &&
    arch.selected.some((s) => s.id === "private-endpoints")
  )
    nodeStatus["private-endpoints"] = "pending";

  const allJobs = stages.flatMap((s) => s.jobs.map((j) => ({ job: j, stage: s })));
  const focused =
    allJobs.find((x) => x.job.id === selectedJob) ??
    allJobs.find((x) => jobStatus(x.job, x.stage) === "waiting") ??
    allJobs[0];
  const counts = (plan?.resources ?? []).reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.action]: (acc[r.action] ?? 0) + 1 }),
    {},
  );

  return (
    <div className="-mx-4 -my-6 lg:-mx-8">
      <div className="border-b border-border bg-card px-4 py-4 lg:px-6">
        <p className="text-xs text-muted-foreground">
          <Link to="/deployments" className="hover:underline">
            Deployments
          </Link>{" "}
          /{" "}
          <Link
            to="/customers/$customerId"
            params={{ customerId: env.customers.id }}
            className="hover:underline"
          >
            {env.customers.name}
          </Link>
        </p>
        <div className="mt-0.5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold">
                {statusLabel(d.deployment_type)} · {env.customers.name} {env.name}
              </h1>
              <Pill tone={deploymentTone(status)}>{statusLabel(status)}</Pill>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {env.offerings.name} · v{d.previous_version ? `${d.previous_version} → ` : ""}
              {d.desired_version} · {env.region} · requested by {d.requested_by ?? "—"}{" "}
              {relative(d.requested_at)} ·{" "}
              <span className="font-mono">{d.correlation_id.slice(0, 8)}</span> · engine: {d.mode}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pending && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      approvalId: pending.id,
                      decision: "rejected",
                      decidedBy: "Sarah Chen",
                      comments: "Rejected from the run view.",
                    })
                  }
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      approvalId: pending.id,
                      decision: "approved",
                      decidedBy: "Sarah Chen",
                    })
                  }
                >
                  Approve & queue
                </Button>
              </>
            )}
            {status === "QUEUED" && (
              <Button
                size="sm"
                disabled={execute.isPending}
                onClick={() => execute.mutate({ data: { deploymentId } })}
              >
                {execute.isPending ? "Running…" : "Run pipeline"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 lg:p-6">
        <PipelineGraph
          stages={stages}
          status={jobStatus}
          selectedJob={focused?.job.id ?? null}
          onSelect={(j) => setSelectedJob(j.id)}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">What this run lands</h2>
              <span className="text-xs text-muted-foreground">
                Same architecture as every other {env.offerings.name} install
              </span>
            </div>
            <ArchitectureCanvas
              selected={arch.selected}
              topology={arch.topology}
              bindings={bindings}
              installName={`${env.customers.customer_code}-${env.name.toLowerCase()}`}
              status={nodeStatus}
              compact
            />
          </section>

          <section className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
            <header className="border-b border-border px-4 py-2.5">
              <p className="text-[13px] font-semibold">{focused?.job.name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {focused?.stage.name} · {focused?.job.detail}
              </p>
            </header>
            <div className="max-h-[460px] flex-1 overflow-auto">
              <JobDetail
                stageId={focused?.stage.id ?? ""}
                job={focused?.job}
                preflight={preflight}
                plan={plan}
                approvals={approvals}
                steps={steps}
              />
            </div>
          </section>
        </div>

        {plan?.resources?.length ? (
          <section className="overflow-hidden rounded-md border border-border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <p className="text-[13px] font-semibold">Plan</p>
              <p className="font-mono text-xs">
                <span className="text-success">+{counts["create"] ?? 0} create</span> ·{" "}
                <span className="text-warning">~{counts["update"] ?? 0} update</span> ·{" "}
                <span className="text-muted-foreground">
                  ={counts["use_existing"] ?? 0} consumed from customer
                </span>
                {plan.estimatedMonthlyCost && (
                  <span className="text-muted-foreground">
                    {" "}
                    · est. {currency(plan.estimatedMonthlyCost.low)}–
                    {currency(plan.estimatedMonthlyCost.high)}/mo
                  </span>
                )}
              </p>
            </header>
            <pre className="max-h-72 overflow-auto px-4 py-2 font-mono text-[12px] leading-relaxed">
              {plan.resources.map((r, i) => {
                const a = PLAN_SIGN[r.action] ?? { sign: "?", cls: "", label: r.action };
                return (
                  <div key={i} className="flex gap-3">
                    <span className={cn("w-3", a.cls)}>{a.sign}</span>
                    <span className="w-[26rem] shrink-0 truncate text-muted-foreground">
                      {r.type}
                    </span>
                    <span className={a.cls}>{r.name}</span>
                  </div>
                );
              })}
              {(plan.warnings ?? []).map((w) => (
                <div key={w} className="mt-1 text-warning">
                  ! {w}
                </div>
              ))}
            </pre>
          </section>
        ) : null}

        {(status === "FAILED" || status === "REQUIRES_REMEDIATION") && (
          <div className="rounded-md border border-danger/40 bg-danger/5 p-4 text-sm">
            <p className="font-semibold text-danger">
              This run did not complete. There is no automatic rollback.
            </p>
            <p className="mt-1 text-muted-foreground">
              Remediate the failing job, then request a new run. The install keeps its current
              version until a run succeeds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// Runs written before the engine stored full results (and seeded runs) carry summary-only or empty JSON.
function asPreflight(raw: unknown): PreflightResult | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const checks = Array.isArray(p["checks"]) ? (p["checks"] as PreflightResult["checks"]) : [];
  if (!checks.length && !("pass" in p) && !("blocking" in p)) return null;
  const blocking = num(p["blocking"]);
  return {
    checks,
    pass: num(p["pass"]),
    warning: num(p["warning"]),
    blocking,
    deployable: typeof p["deployable"] === "boolean" ? p["deployable"] : blocking === 0,
  };
}

type RunPlan = Omit<DeploymentPlan, "estimatedMonthlyCost"> & {
  estimatedMonthlyCost: DeploymentPlan["estimatedMonthlyCost"] | null;
};

function asPlan(raw: unknown): RunPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const resources: PlanResource[] = Array.isArray(p["resources"])
    ? (p["resources"] as PlanResource[])
    : [
        ...strs(p["create"]).map((name) => ({ action: "create" as const, type: name, name })),
        ...strs(p["useExisting"]).map((name) => ({
          action: "use_existing" as const,
          type: name,
          name,
        })),
      ];
  const cost = p["estimatedMonthlyCost"] as DeploymentPlan["estimatedMonthlyCost"] | undefined;
  return {
    correlationId: typeof p["correlationId"] === "string" ? p["correlationId"] : "",
    resources,
    policyAssignments: num(p["policyAssignments"]),
    roleAssignments: num(p["roleAssignments"]),
    estimatedMonthlyCost:
      cost && typeof cost.low === "number" && typeof cost.high === "number" ? cost : null,
    warnings: strs(p["warnings"]),
    blockers: strs(p["blockers"]),
    modules: Array.isArray(p["modules"]) ? (p["modules"] as DeploymentPlan["modules"]) : [],
  };
}

function JobDetail({
  stageId,
  job,
  preflight,
  plan,
  approvals,
  steps,
}: {
  stageId: string;
  job: Job | undefined;
  preflight: PreflightResult | null;
  plan: RunPlan | null;
  approvals: Approval[];
  steps: Step[];
}) {
  if (!job) return null;
  if (stageId === "validate") {
    if (!preflight)
      return <p className="px-4 py-6 text-sm text-muted-foreground">Validation has not run.</p>;
    return (
      <ul className="divide-y divide-border">
        <li className="flex gap-3 bg-muted/40 px-4 py-2 text-xs">
          <span className="text-success">{preflight.pass} pass</span>
          <span className="text-warning">{preflight.warning} warning</span>
          <span className="text-danger">{preflight.blocking} blocking</span>
        </li>
        {preflight.checks.map((c) => (
          <li key={c.key} className="flex items-start justify-between gap-3 px-4 py-2">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.detail}</p>
            </div>
            <ResultPill result={c.level} />
          </li>
        ))}
      </ul>
    );
  }
  if (stageId === "plan")
    return (
      <pre className="px-4 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {plan?.resources?.length
          ? [
              `$ az deployment sub what-if --template-file main.bicep`,
              ...plan.resources.map(
                (r) => `  ${PLAN_SIGN[r.action]?.sign ?? "?"} ${r.type}  ${r.name}`,
              ),
              ``,
              `Policy assignments: ${plan.policyAssignments} · Role assignments: ${plan.roleAssignments}`,
            ].join("\n")
          : "No plan was generated — validation must pass first."}
      </pre>
    );
  if (stageId === "approve")
    return (
      <ul className="divide-y divide-border">
        {approvals.map((a) => (
          <li key={a.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">{statusLabel(a.approval_type)}</p>
              <Pill
                tone={
                  a.status === "approved"
                    ? "success"
                    : a.status === "rejected"
                      ? "danger"
                      : "warning"
                }
              >
                {statusLabel(a.status)}
              </Pill>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Required reviewer: {a.requested_from ?? "Approver"}
              {a.decided_by
                ? ` · decided by ${a.decided_by} ${dateTime(a.decided_at)}`
                : " · waiting"}
            </p>
            {a.comments && <p className="mt-1 text-xs text-muted-foreground">“{a.comments}”</p>}
          </li>
        ))}
        {!approvals.length && (
          <li className="px-4 py-6 text-sm text-muted-foreground">
            No approval gate applies to this environment.
          </li>
        )}
      </ul>
    );
  const step = steps.find((s) => s.module_name === job.module);
  return (
    <pre className="px-4 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
      {step
        ? [
            `$ az deployment group create --template-spec ${job.detail}`,
            step.log_text ?? "",
            ``,
            `status: ${step.status}`,
          ].join("\n")
        : job.module
          ? "Job has not run yet."
          : "Runs after all deploy waves complete."}
    </pre>
  );
}
