import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Dot, EmptyState, PageHeader, Panel, Pill, ResultPill, deploymentTone } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import type { DeploymentPlan, PreflightResult } from "@/lib/engine/types";
import { decideApproval, executeDeployment } from "@/lib/factory.functions";
import { currency, dateTime } from "@/lib/format";
import { deploymentQuery } from "@/lib/queries";

export const Route = createFileRoute("/deployments/$deploymentId")({
  head: () => ({
    meta: [
      { title: "Deployment run · Azure ISV Deployment Factory" },
      {
        name: "description",
        content: "Preflight results, the change plan, approval decisions and the step-by-step execution log for one deployment run.",
      },
      { property: "og:title", content: "Deployment run · Azure ISV Deployment Factory" },
      { property: "og:description", content: "Preflight, plan, approvals and execution log for a deployment run." },
    ],
  }),
  component: DeploymentDetail,
});

const ACTION_LABEL: Record<string, string> = {
  create: "CREATE",
  update: "UPDATE",
  use_existing: "USE EXISTING",
  delete: "DELETE",
};

function DeploymentDetail() {
  const { deploymentId } = Route.useParams();
  const deployment = useQuery(deploymentQuery(deploymentId));
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["deployment", deploymentId] });
    queryClient.invalidateQueries({ queryKey: ["deployments"] });
    queryClient.invalidateQueries({ queryKey: ["estate"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  };

  const decideFn = useServerFn(decideApproval);
  const decide = useMutation({
    mutationFn: (input: { approvalId: string; decision: "approved" | "rejected"; comments?: string; decidedBy?: string }) =>
      decideFn({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.decision === "approved" ? "Approved. Deployment queued for the central pipeline." : "Deployment rejected and cancelled.",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const execute = useMutation({
    mutationFn: useServerFn(executeDeployment),
    onSuccess: (result: { status: string }) => {
      toast[result.status === "SUCCEEDED" ? "success" : "error"](
        result.status === "SUCCEEDED"
          ? "Deployment succeeded (simulated by the demo engine)."
          : `Deployment ended in ${result.status.replace(/_/g, " ")}.`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (deployment.isLoading) return <EmptyState title="Loading deployment…" />;
  if (!deployment.data) return <EmptyState title="Deployment not found." />;

  const d = deployment.data;
  const env = d.environments as {
    id: string;
    name: string;
    environment_type: string;
    region: string;
    customers: { id: string; name: string };
    offerings: { name: string; offering_type: string };
  };
  const preflight = (d.preflight_json ?? null) as PreflightResult | null;
  const plan = (d.plan_json ?? null) as DeploymentPlan | null;
  const steps = ((d.deployment_steps ?? []) as unknown as {
    id: string;
    sequence: number;
    name: string;
    module_name: string | null;
    status: string;
    log_text: string | null;
  }[]).sort((a, b) => a.sequence - b.sequence);
  const approvals = (d.approvals ?? []) as unknown as {
    id: string;
    approval_type: string;
    status: string;
    requested_from: string | null;
    decided_by: string | null;
    comments: string | null;
    decided_at: string | null;
  }[];
  const pending = approvals.find((a) => a.status === "pending");

  return (
    <>
      <PageHeader
        title={`${env.customers.name} · ${env.name}`}
        description={`${d.deployment_type.replace(/_/g, " ")} to v${d.desired_version ?? "—"}${
          d.previous_version ? ` from v${d.previous_version}` : ""
        } · ${env.offerings.name} · ${env.region}`}
        meta={
          <>
            <Pill tone={deploymentTone(d.status)}>
              <Dot tone={deploymentTone(d.status)} />
              {d.status.replace(/_/g, " ")}
            </Pill>
            <Pill tone="warning">mode: {d.mode}</Pill>
            <span className="font-mono text-[11px] text-muted-foreground">{d.correlation_id}</span>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/customers/$customerId"
              params={{ customerId: env.customers.id }}
              className="rounded-sm border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-accent"
            >
              Open customer
            </Link>
            {pending && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({ approvalId: pending.id, decision: "rejected", decidedBy: "Sarah Chen", comments: "Rejected from the run view." })
                  }
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ approvalId: pending.id, decision: "approved", decidedBy: "Sarah Chen" })}
                >
                  Approve plan
                </Button>
              </>
            )}
            {d.status === "QUEUED" && (
              <Button size="sm" disabled={execute.isPending} onClick={() => execute.mutate({ data: { deploymentId } })}>
                {execute.isPending ? "Deploying…" : "Run central pipeline"}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Preflight validation"
          description={
            preflight
              ? `${preflight.pass} PASS · ${preflight.warning} WARNING · ${preflight.blocking} BLOCKING`
              : "No preflight recorded"
          }
          bodyClassName="p-0"
        >
          {preflight ? (
            <ul className="divide-y divide-border">
              {preflight.checks.map((c) => (
                <li key={c.key} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                  <ResultPill result={c.level} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">Validation has not run for this deployment.</p>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Change plan"
            description={
              plan?.estimatedMonthlyCost
                ? `Estimated ${currency(plan.estimatedMonthlyCost.low)} – ${currency(plan.estimatedMonthlyCost.high)} / month (ESTIMATE)`
                : "No plan generated"
            }
            bodyClassName="p-0"
          >
            {plan?.resources?.length ? (
              <>
                <ul className="divide-y divide-border">
                  {plan.resources.map((r) => (
                    <li key={`${r.type}-${r.name}`} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{r.name}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{r.type}</p>
                      </div>
                      <Pill tone={r.action === "use_existing" ? "neutral" : r.action === "create" ? "success" : "info"}>
                        {ACTION_LABEL[r.action] ?? r.action}
                      </Pill>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-2 gap-3 border-t border-border px-4 py-3 text-xs">
                  <span className="text-muted-foreground">
                    Policy assignments <span className="mono-num text-foreground">{plan.policyAssignments}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Role assignments <span className="mono-num text-foreground">{plan.roleAssignments}</span>
                  </span>
                </div>
                {(plan.warnings ?? []).length > 0 && (
                  <ul className="list-disc space-y-1 border-t border-border px-8 py-3 text-xs text-warning">
                    {plan.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {(plan.blockers ?? []).length > 0 && (
                  <ul className="list-disc space-y-1 border-t border-border px-8 py-3 text-xs text-danger">
                    {plan.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No plan was generated — validation must pass before planning.
              </p>
            )}
          </Panel>

          <Panel title="Approvals" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {approvals.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium">{a.approval_type.replace(/_/g, " ")}</p>
                    <Pill tone={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning"}>
                      {a.status}
                    </Pill>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.requested_from ?? "Approver"}
                    {a.decided_by ? ` · ${a.decided_by}` : ""}
                    {a.decided_at ? ` · ${dateTime(a.decided_at)}` : " · awaiting decision"}
                  </p>
                  {a.comments && <p className="mt-1 text-xs text-muted-foreground">“{a.comments}”</p>}
                </li>
              ))}
              {!approvals.length && (
                <li className="px-4 py-5 text-xs text-muted-foreground">No approval gate applied to this run.</li>
              )}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <Panel title="Execution timeline" description={summarizeResult(d.result_json)} bodyClassName="p-0">
          <ol className="divide-y divide-border">
            {steps.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-medium">
                    <span className="mono-num mr-2 text-muted-foreground">{String(s.sequence).padStart(2, "0")}</span>
                    {s.name}
                    {s.module_name && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{s.module_name}</span>}
                  </p>
                  <Pill tone={s.status === "succeeded" ? "success" : s.status === "failed" ? "danger" : "neutral"}>
                    {s.status}
                  </Pill>
                </div>
                {s.log_text && (
                  <pre className="mt-1.5 overflow-x-auto rounded-sm bg-muted px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                    {s.log_text}
                  </pre>
                )}
              </li>
            ))}
            {!steps.length && (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No steps yet. Steps are written as the pipeline executes.
              </li>
            )}
          </ol>
        </Panel>
      </div>

      {(d.status === "FAILED" || d.status === "REQUIRES_REMEDIATION") && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/5 p-4 text-sm">
          <p className="font-semibold text-danger">This deployment did not complete. There is no automatic rollback.</p>
          <p className="mt-1 text-muted-foreground">
            Partially created resources remain as recorded above. Remediate the blocking condition, then request a new
            deployment — the environment's actual version is unchanged until a run succeeds.
          </p>
        </div>
      )}
    </>
  );
}

function summarizeResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  const message = record["error"] ?? record["summary"] ?? record["message"];
  return typeof message === "string" ? message : undefined;
}
