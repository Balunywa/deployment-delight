import {
  CheckCircle2,
  CircleDashed,
  CirclePause,
  CircleX,
  Cloud,
  Database,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Github,
  KeyRound,
  Loader2,
  MinusCircle,
  PlugZap,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { PipelineConnection, PipelineJob, PipelineRun } from "@/lib/alz/pipeline.server";
import { cn } from "@/lib/utils";

type State = "pending" | "running" | "waiting" | "success" | "failure" | "skipped";

const ICON: Record<State, ReactNode> = {
  pending: <CircleDashed className="size-4 text-muted-foreground" />,
  running: <Loader2 className="size-4 animate-spin text-warning" />,
  waiting: <CirclePause className="size-4 text-warning" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  failure: <CircleX className="size-4 text-danger" />,
  skipped: <MinusCircle className="size-4 text-muted-foreground" />,
};

const RING: Record<State, string> = {
  pending: "border-border bg-card",
  running: "border-warning/50 bg-warning/5 shadow-[0_0_0_3px] shadow-warning/10",
  waiting: "border-warning/60 bg-warning/5 shadow-[0_0_0_3px] shadow-warning/15",
  success: "border-success/40 bg-card",
  failure: "border-danger/50 bg-danger/5",
  skipped: "border-dashed border-border bg-muted/30",
};

const LINE: Record<State, string> = {
  pending: "bg-border",
  running: "bg-warning/60",
  waiting: "bg-warning/60",
  success: "bg-success/60",
  failure: "bg-danger/60",
  skipped: "bg-border",
};

function jobState(j: PipelineJob | undefined, runDone: boolean): State {
  if (!j) return runDone ? "skipped" : "pending";
  if (j.status !== "completed") return j.status === "in_progress" ? "running" : "pending";
  if (j.conclusion === "success") return "success";
  if (j.conclusion === "skipped" || j.conclusion === "cancelled") return "skipped";
  return "failure";
}

function duration(a: string | null, b: string | null) {
  if (!a) return "";
  const s = Math.max(0, Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

type Stage = {
  key: string;
  title: string;
  sub: string;
  state: State;
  icon?: ReactNode;
  href?: string | null | undefined;
  action?: ReactNode | undefined;
};

/**
 * The run as GitHub runs it: what the app did, the pull request or merge, the Plan job, the approval and the
 * Apply job, each linked to GitHub, with the active job's steps underneath.
 */
export function PipelineGraph({
  t,
  runStatus,
  onApprove,
  approving,
}: {
  t: PipelineRun | null;
  runStatus: "queued" | "running" | "succeeded" | "failed";
  onApprove?: () => void;
  approving?: boolean;
}) {
  const runDone = runStatus !== "running" && runStatus !== "queued";
  const kind = t?.kind ?? "plan";
  const jobs = t?.jobs ?? [];
  const plan = jobs.find((j) => j.name.startsWith("Plan"));
  const apply = jobs.find((j) => j.name.startsWith("Apply"));
  const started = !!t && (!!t.sha || !!t.dispatchedAt);
  const failedBeforeGitHub = runDone && runStatus === "failed" && !t?.runId;
  const planState = failedBeforeGitHub ? "skipped" : jobState(plan, runDone);
  const waiting = (t?.waiting ?? []).length > 0;

  const stages: Stage[] = [];
  if (kind === "plan") {
    stages.push({
      key: "prepare",
      title: "Prepare Azure",
      sub: started
        ? "Groups · subscriptions · providers"
        : failedBeforeGitHub
          ? "Failed"
          : "Running in Cloud Delivery",
      state: started ? "success" : failedBeforeGitHub ? "failure" : "running",
      icon: <Cloud className="size-3.5" />,
    });
    stages.push({
      key: "pr",
      title: t?.pr ? `Pull request #${t.pr.number}` : t?.noChanges ? "No changes" : "Pull request",
      sub: t?.pr ? "Terraform committed" : t?.noChanges ? "main matches the design" : "Waiting",
      state: t?.pr || t?.noChanges ? "success" : failedBeforeGitHub ? "skipped" : "pending",
      icon: <GitPullRequest className="size-3.5" />,
      href: t?.pr?.url,
    });
  } else {
    stages.push({
      key: "trigger",
      title:
        kind === "destroy" ? "Destroy requested" : t?.pr ? `Merged #${t.pr.number}` : "Run main",
      sub:
        kind === "destroy"
          ? "workflow_dispatch"
          : t?.approval === "merge"
            ? "Merge is the approval"
            : "Pushed to main",
      state: started ? "success" : failedBeforeGitHub ? "failure" : "running",
      icon:
        kind === "destroy" ? <GitBranch className="size-3.5" /> : <GitMerge className="size-3.5" />,
      href: t?.pr?.url,
    });
  }
  stages.push({
    key: "plan",
    title: kind === "destroy" ? "Plan destroy" : "Plan",
    sub:
      planState === "running"
        ? `Running · ${duration(plan?.startedAt ?? null, null)}`
        : plan?.completedAt && plan.conclusion
          ? `${plan.conclusion} · ${duration(plan.startedAt, plan.completedAt)}`
          : "plan environment · Reader",
    state: planState,
    icon: <Github className="size-3.5" />,
    href: plan?.url,
  });
  if (kind !== "plan") {
    if (t?.approval === "environment" || waiting) {
      const approved = !!apply && apply.status !== "waiting" && !waiting;
      stages.push({
        key: "approval",
        title: "Approval",
        sub: waiting ? "Waiting for a reviewer" : approved ? "Approved" : "apply environment",
        state: waiting
          ? "waiting"
          : approved
            ? "success"
            : planState === "failure"
              ? "skipped"
              : "pending",
        icon: <ShieldCheck className="size-3.5" />,
        href: t?.runUrl,
        action:
          waiting && t?.waiting?.some((w) => w.canApprove) && onApprove ? (
            <Button
              size="sm"
              className="h-6 px-2 text-[11px]"
              disabled={approving}
              onClick={onApprove}
            >
              {approving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ShieldCheck className="size-3" />
              )}{" "}
              Approve
            </Button>
          ) : undefined,
      });
    }
    const applyState = waiting ? "pending" : jobState(apply, runDone);
    stages.push({
      key: "apply",
      title: kind === "destroy" ? "Apply destroy" : "Apply",
      sub:
        applyState === "running"
          ? `Running · ${duration(apply?.startedAt ?? null, null)}`
          : apply?.completedAt && apply.conclusion && applyState !== "skipped"
            ? `${apply.conclusion} · ${duration(apply.startedAt, apply.completedAt)}`
            : "apply environment · Owner",
      state: applyState,
      icon: <Github className="size-3.5" />,
      href: apply?.url,
    });
  }

  const focus =
    jobs.find((j) => j.status === "in_progress") ??
    [...jobs].reverse().find((j) => j.status === "completed" && j.conclusion !== "skipped");
  const steps = (focus?.steps ?? []).filter(
    (s) => !/^(Set up job|Complete job|Post )/.test(s.name),
  );

  return (
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <ol className="flex flex-wrap items-center gap-y-2">
        {stages.map((s, i) => (
          <li key={s.key} className="flex items-center">
            <div
              className={cn(
                "flex min-w-[168px] items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                RING[s.state],
              )}
            >
              {ICON[s.state]}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <span className="text-muted-foreground">{s.icon}</span>
                  {s.title}
                  {s.href && (
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Open ${s.title} in GitHub`}
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{s.sub}</p>
              </div>
              {s.action}
            </div>
            {i < stages.length - 1 && <span className={cn("h-0.5 w-5 sm:w-8", LINE[s.state])} />}
          </li>
        ))}
      </ol>
      {focus && steps.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-card">
          <p className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11.5px] font-semibold">
            <span>{focus.name} · steps</span>
            <a
              href={focus.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 font-normal text-muted-foreground hover:text-foreground"
            >
              View job in GitHub <ExternalLink className="size-3" />
            </a>
          </p>
          <ul className="grid gap-x-4 px-3 py-1.5 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.number} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                {
                  ICON[
                    s.status !== "completed"
                      ? s.status === "in_progress"
                        ? "running"
                        : "pending"
                      : s.conclusion === "success"
                        ? "success"
                        : s.conclusion === "skipped"
                          ? "skipped"
                          : "failure"
                  ]
                }
                <span className="truncate">{s.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Where Terraform runs once connected: repository, approval, identities and state. */
export function PipelinePanel({
  conn,
  pr,
}: {
  conn: PipelineConnection;
  pr: { number: number; url: string; title: string } | null;
}) {
  return (
    <div className="grid gap-3 border-b border-border bg-muted/20 px-4 py-3 text-[12px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Pipeline
        </p>
        <a
          href={conn.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 flex items-center gap-1.5 font-mono text-[12.5px] font-semibold hover:underline"
        >
          <Github className="size-3.5" /> {conn.repo} <ExternalLink className="size-3" />
        </a>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <a
            href={`${conn.url}/actions`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Actions ↗
          </a>
          <a
            href={`${conn.url}/pulls`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Pull requests ↗
          </a>
          <span className="font-mono text-[11px]">{conn.templates}</span>
        </p>
        {pr && (
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/5 px-2 py-0.5 text-[11.5px] font-medium text-success"
          >
            <GitPullRequest className="size-3" /> #{pr.number} open · ready to apply
          </a>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Identities (OIDC, no secrets)
        </p>
        {(["plan", "apply"] as const).map((k) => (
          <p key={k} className="mt-1 flex items-start gap-1.5" title={conn.identities[k].subject}>
            <KeyRound className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="font-mono text-[11.5px]">{conn.identities[k].name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {conn.identities[k].roles[0]}
              </span>
            </span>
          </p>
        ))}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Approval & state
        </p>
        <p className="mt-1 flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          {conn.approval === "environment"
            ? "Apply waits for a reviewer on the apply environment."
            : "Merging the pull request approves the apply."}
        </p>
        <p className="mt-1 flex items-start gap-1.5">
          <Database className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-[11px] break-all">
            {conn.state.account}/{conn.state.container}/{conn.state.key}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Offered when GitHub is configured and this landing zone's Terraform still runs inside the app. */
export function ConnectPipelineCard({
  repo,
  onConnect,
  pending,
  disabled,
}: {
  repo: string | null;
  onConnect: () => void;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 max-w-2xl">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold">
            <Github className="size-4" /> Run this landing zone in GitHub Actions
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Terraform runs inside this app today, with state on the app's disk. Connect GitHub and
            every change goes through a pull request: GitHub plans it and comments the plan, merging
            applies it, and each run's jobs, steps and logs show up here and in GitHub.
          </p>
        </div>
        <Button onClick={onConnect} disabled={pending || disabled}>
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <PlugZap className="size-3.5" />
          )}
          Connect GitHub Actions
        </Button>
      </div>
      <ul className="grid gap-px border-t border-border bg-border text-[11.5px] sm:grid-cols-4">
        {[
          [
            <Github key="r" className="size-3.5" />,
            "Repository",
            repo ?? "lz-<tenant>",
            "private, plan + apply environments",
          ],
          [
            <GitBranch key="t" className="size-3.5" />,
            "Pipeline",
            "cd-delivery-templates",
            "reusable lz.yml at a pinned tag",
          ],
          [
            <KeyRound key="i" className="size-3.5" />,
            "Identities",
            "plan · apply",
            "OIDC-federated, trust only that template",
          ],
          [
            <Database key="s" className="size-3.5" />,
            "State",
            "Azure Storage",
            "Entra ID only, versioned, locked",
          ],
        ].map(([icon, label, value, note]) => (
          <li key={label as string} className="bg-card px-4 py-2.5">
            <p className="flex items-center gap-1.5 text-muted-foreground">
              {icon} {label}
            </p>
            <p className="mt-0.5 truncate font-mono text-[12px] font-medium">{value}</p>
            <p className="text-[11px] text-muted-foreground">{note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
