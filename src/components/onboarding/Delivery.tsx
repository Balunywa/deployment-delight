import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleX,
  GitMerge,
  GitPullRequest,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";

import {
  type Check,
  type Delivery,
  ENV_META,
  type Ring,
  type Trigger,
  verdict,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

export type RunState = "queued" | "running" | "success" | "failed" | "waiting";

const STATE_ICON: Record<RunState, ReactNode> = {
  queued: <Circle className="size-3.5 text-muted-foreground/60" />,
  running: <Loader2 className="size-3.5 animate-spin text-warning" />,
  success: <CheckCircle2 className="size-3.5 text-success" />,
  failed: <CircleX className="size-3.5 text-danger" />,
  waiting: <Lock className="size-3.5 text-warning" />,
};

function Node({
  title,
  sub,
  state,
  icon,
  gate,
  gateWaiting,
}: {
  title: string;
  sub: string;
  state: RunState | undefined;
  icon?: ReactNode;
  gate?: string | null | undefined;
  gateWaiting?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        "w-[136px] shrink-0 rounded-md border bg-card px-2.5 py-2",
        state === "running" && "border-warning/60",
        state === "success" && "border-success/50",
        (state === "waiting" || gateWaiting) && "border-warning/60 bg-warning/5",
        state === "failed" && "border-danger/60",
        (!state || state === "queued") && !gateWaiting && "border-border",
      )}
    >
      {gate && (
        <p
          className={cn(
            "mb-1 flex items-center gap-1 truncate text-[10px]",
            gateWaiting ? "font-medium text-warning" : "text-muted-foreground",
          )}
          title={gate}
        >
          <ShieldCheck className="size-3 shrink-0" />
          {gate}
        </p>
      )}
      <p className="flex items-center gap-1.5 text-[12px] font-medium">
        {state && state !== "queued" ? STATE_ICON[state] : (icon ?? STATE_ICON.queued)}
        <span className="truncate">{title}</span>
      </p>
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={sub}>
        {sub}
      </p>
    </div>
  );
}

function Arrow() {
  return <span className="h-px w-6 shrink-0 self-center bg-border-strong" />;
}

function Lane({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex items-stretch gap-3">
      <div className="w-[118px] shrink-0 pt-1.5">
        <p className="text-[11px] font-semibold">{label}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{sub}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-y-2">{children}</div>
    </div>
  );
}

/**
 * The delivery workflow the way GitHub Actions and Azure Pipelines run it: checks on the pull request,
 * then ring-by-ring deployment after merge, production behind its reviewers.
 */
export function PipelineGraph({
  code,
  rings,
  delivery,
  states = {},
}: {
  code: string;
  rings: Ring[];
  delivery: Delivery;
  states?: Record<string, RunState>;
}) {
  const gh = delivery.tool === "github-actions";
  const c = code || "customer";
  return (
    <div className="space-y-3 overflow-x-auto rounded-md border border-border bg-muted/30 p-3">
      <Lane label="On the pull request" sub={`installs/${c}.yaml`}>
        <Node
          title="Opened"
          sub={`onboard/${c}`}
          state={states["pr"]}
          icon={<GitPullRequest className="size-3.5 text-primary" />}
        />
        <Arrow />
        <Node title="Validate" sub="bicep · psrule · policy" state={states["validate"]} />
        <Arrow />
        <Node title="Plan" sub={`what-if × ${rings.length}`} state={states["plan"]} />
        <span className="ml-3 max-w-[200px] text-[10.5px] leading-snug text-muted-foreground">
          Results are posted on the pull request — reviewers see exactly what changes.
        </span>
      </Lane>
      <div className="ml-[130px] flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <GitMerge className="size-3" /> merge to main
      </div>
      <Lane label="After merge" sub="ring by ring">
        {rings.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 && <Arrow />}
            <Node
              title={`Deploy ${ENV_META[r.envs[0]!].short}`}
              sub={`${c}-${ENV_META[r.envs[0]!].short}`}
              state={states[`deploy-${r.id}`]}
              gate={r.gate}
              gateWaiting={states[`gate-${r.id}`] === "waiting"}
            />
          </Fragment>
        ))}
        <Arrow />
        <Node title="Verify" sub="compliance · smoke" state={states["verify"]} />
      </Lane>
      <p className="flex items-center gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
        {gh
          ? "One workflow for every customer — .github/workflows/deliver.yml. Each ring is a GitHub environment with its own OIDC credential."
          : "One pipeline for every customer — azure-pipelines/deliver.yml. Each ring is an Azure Pipelines environment with its own service connection."}
      </p>
    </div>
  );
}

export function TriggerTable({ triggers }: { triggers: Trigger[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/60 text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Trigger</th>
            <th className="px-3 py-1.5 font-medium">When</th>
            <th className="px-3 py-1.5 font-medium">What runs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {triggers.map((t) => (
            <tr key={t.event}>
              <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap">{t.event}</td>
              <td className="px-3 py-1.5">{t.when}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{t.runs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LEVEL_ICON = {
  pass: <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />,
  warn: <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />,
  fail: <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />,
};

/** Pull-request style checks box. `compact` lists only the checks that need attention. */
export function ChecksBox({
  checks,
  title,
  compact,
}: {
  checks: Check[];
  title?: string | undefined;
  compact?: boolean | undefined;
}) {
  const v = verdict(checks);
  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  const shown = compact ? checks.filter((c) => c.level !== "pass") : checks;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border",
        v === "fail"
          ? "border-danger/40"
          : v === "warn"
            ? "border-warning/40"
            : "border-success/40",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 px-3 py-2 text-[13px] font-semibold",
          v === "fail" ? "bg-danger/5" : v === "warn" ? "bg-warning/5" : "bg-success/5",
        )}
      >
        {LEVEL_ICON[v]}
        <span>
          {title ??
            (v === "fail"
              ? `${fails} check${fails === 1 ? "" : "s"} failing`
              : v === "warn"
                ? `Required checks pass · ${warns} warning${warns === 1 ? "" : "s"}`
                : "All checks have passed")}
        </span>
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">
          {checks.length - fails - warns} pass · {warns} warn · {fails} fail
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="divide-y divide-border bg-card">
          {shown.map((c) => (
            <li key={c.id} className="flex gap-2 px-3 py-2">
              {LEVEL_ICON[c.level]}
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium">
                  <span className="mr-1.5 rounded-sm bg-muted px-1 py-px text-[10px] font-normal text-muted-foreground">
                    {c.area}
                  </span>
                  {c.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Management group path, with each environment's subscription hanging off the landing group. */
export function PlacementTree({
  path,
  subs,
  source,
}: {
  path: { id: string; name: string }[];
  subs: { label: string; sub: string; pending?: boolean }[];
  source: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {path.map((n, i) => (
          <Fragment key={n.id + i}>
            {i > 0 && <span className="text-muted-foreground">›</span>}
            <span
              className={cn(
                "rounded border px-2 py-0.5",
                i === path.length - 1
                  ? "border-primary bg-primary/5 font-semibold text-primary"
                  : "border-border bg-card",
              )}
              title={n.id}
            >
              {n.name}
            </span>
          </Fragment>
        ))}
      </div>
      <div className="mt-2 ml-4 flex flex-wrap gap-1.5 border-l-2 border-border-strong pl-3">
        {subs.map((s) => (
          <span
            key={s.label}
            className={cn(
              "rounded-sm border px-1.5 py-0.5 font-mono text-[10.5px]",
              s.pending
                ? "border-dashed border-[#e8c65b] bg-[#fffbeb]"
                : "border-[#e8c65b] bg-[#fff4ce]",
            )}
            title={s.label}
          >
            {s.sub}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{source}</p>
    </div>
  );
}
