/*
 * The offering's Deploy tab: put a version into a subscription for real, ring by ring, and watch it the
 * way you'd watch a pipeline in GitHub Actions or Azure DevOps — stages across the top, the selected
 * stage's steps with their live logs below.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleSlash,
  Clock,
  Loader2,
  Play,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { relative } from "@/lib/format";
import {
  type OfferingRun,
  type RunStage,
  type StepStatus,
  decideOfferingRun,
  getOfferingDeployOptions,
  getOfferingRuns,
  listResourceGroups,
  startOfferingRun,
} from "@/lib/offering/run.functions";
import { cn } from "@/lib/utils";

export const ENV_LABEL: Record<string, string> = {
  development: "Dev",
  test: "Test",
  qa: "QA",
  uat: "UAT",
  staging: "Staging",
  production: "Prod",
};
const ENV_SHORT: Record<string, string> = {
  development: "dev",
  test: "test",
  qa: "qa",
  uat: "uat",
  staging: "stg",
  production: "prod",
};

export function StatusIcon({ s, className }: { s: StepStatus | string; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  if (s === "succeeded")
    return <Check className={cn(c, "rounded-full bg-success p-0.5 text-white")} />;
  if (s === "failed") return <X className={cn(c, "rounded-full bg-danger p-0.5 text-white")} />;
  if (s === "running") return <Loader2 className={cn(c, "animate-spin text-warning")} />;
  if (s === "waiting") return <Clock className={cn(c, "text-warning")} />;
  if (s === "skipped" || s === "cancelled")
    return <CircleSlash className={cn(c, "text-muted-foreground")} />;
  return <Circle className={cn(c, "text-muted-foreground/50")} />;
}

const duration = (a?: string, b?: string | null) => {
  if (!a) return "";
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

const initials = (name: string) =>
  name
    .split(/[\s·]+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0]!.toLowerCase())
    .join("")
    .slice(0, 6);

export function useOfferingRuns(offeringId: string) {
  const runsFn = useServerFn(getOfferingRuns);
  return useQuery({
    queryKey: ["offering-runs", offeringId],
    queryFn: () => runsFn({ data: { offeringId } }) as Promise<OfferingRun[]>,
    refetchInterval: (q) =>
      (q.state.data as OfferingRun[] | undefined)?.some(
        (r) => r.status === "running" || r.status === "waiting",
      )
        ? 2000
        : false,
  });
}

export function DeployTab({
  offeringId,
  offeringName,
  versionId,
  version,
  published,
  dirty,
}: {
  offeringId: string;
  offeringName: string;
  versionId: string;
  version: string;
  published: boolean;
  dirty: boolean;
}) {
  const queryClient = useQueryClient();
  const optionsFn = useServerFn(getOfferingDeployOptions);
  const rgFn = useServerFn(listResourceGroups);
  const opts = useQuery({
    queryKey: ["offering-deploy-options", offeringId],
    queryFn: () => optionsFn({ data: { offeringId } }),
    staleTime: 60_000,
  });
  const runs = useOfferingRuns(offeringId);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [region, setRegion] = useState("");
  const [envs, setEnvs] = useState<string[] | null>(null);
  const [prefixInput, setPrefix] = useState<string | null>(null);
  const [rgMode, setRgMode] = useState<"new" | "existing">("new");
  const [rgName, setRgName] = useState("");
  const [approvalFor, setApprovalFor] = useState<string[]>(["production"]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const o = opts.data;
  // Default to where this offering was last deployed, so a re-deploy or removal targets the same install.
  const last = runs.data?.[0];
  const sub =
    subscriptionId ||
    (last && o?.subscriptions.some((x) => x.id === last.subscription_id)
      ? last.subscription_id
      : "") ||
    o?.subscriptions[0]?.id ||
    "";
  const reg = region || last?.region || o?.regions[0] || "";
  const chosen = envs ?? o?.environments.filter((e) => e !== "production").slice(0, 1) ?? [];
  const rgs = useQuery({
    queryKey: ["rgs", sub],
    queryFn: () => rgFn({ data: { subscriptionId: sub } }),
    enabled: !!sub && rgMode === "existing",
  });

  const start = useMutation({
    mutationFn: useServerFn(startOfferingRun),
    onSuccess: (r: { runId: string }) => {
      setSelectedRun(r.runId);
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["offering-runs", offeringId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const go = (action: "plan" | "deploy" | "destroy") =>
    start.mutate({
      data: {
        offeringId,
        versionId,
        action,
        subscriptionId: sub,
        region: reg,
        environments: chosen,
        installPrefix: prefix,
        resourceGroup: rgMode === "existing" ? { mode: "existing", name: rgName } : { mode: "new" },
        approvalFor: approvalFor.filter((e) => chosen.includes(e)),
      },
    });

  const prefix = prefixInput ?? last?.settings.installPrefix ?? `t-${initials(offeringName)}`;
  const list = runs.data ?? [];
  const run = list.find((r) => r.id === selectedRun) ?? list[0] ?? null;
  const busy = list.some((r) => r.status === "running" || r.status === "waiting");
  const prefixOk = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(prefix);

  return (
    <div className="grid flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-4 border-b border-border bg-card p-4 lg:border-r lg:border-b-0">
        <div>
          <p className="text-[13px] font-semibold">Deploy v{version}</p>
          <p className="text-[11.5px] text-muted-foreground">
            Real Terraform into your subscription — the same module every customer install uses.
            {!published && " Test a draft here before you publish it."}
          </p>
          {dirty && (
            <p className="mt-1 text-[11.5px] text-warning">
              You have unsaved changes; this deploys the saved v{version}.
            </p>
          )}
        </div>
        {opts.isLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Checking Azure access…
          </p>
        ) : o?.error ? (
          <p className="rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            No Azure access: {o.error}
          </p>
        ) : (
          <>
            <Field label="Subscription">
              <Select value={sub} onValueChange={setSubscriptionId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {o?.subscriptions.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Region">
              <Select value={reg} onValueChange={setRegion}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {o?.regions.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Environments, in ring order"
              hint="Each gets its own resource group and Terraform state. Non-production is sized down."
            >
              <div className="flex flex-wrap gap-1">
                {o?.environments.map((e) => {
                  const on = chosen.includes(e);
                  return (
                    <button
                      key={e}
                      onClick={() => setEnvs(on ? chosen.filter((x) => x !== e) : [...chosen, e])}
                      className={cn(
                        "flex items-center gap-1 rounded-sm border px-2 py-1 text-xs",
                        on
                          ? "border-primary bg-primary/5 font-medium"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {on ? <Check className="size-3" /> : null}
                      {ENV_LABEL[e] ?? e}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field
              label="Install prefix"
              hint={`Resource names: ${prefix}-${ENV_SHORT[chosen[0] ?? "development"]}…`}
            >
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toLowerCase())}
                className={cn("h-8 font-mono text-xs", !prefixOk && "border-danger")}
              />
            </Field>
            <Field
              label="Resource group"
              hint={
                rgMode === "new"
                  ? `One per environment: ${chosen.map((e) => `rg-${prefix}-${ENV_SHORT[e]}`).join(", ") || "—"}. Re-deploys update them in place.`
                  : "Deploy into a group that already exists. It's left in place when the install is removed."
              }
            >
              <div className="flex rounded-sm border border-border p-0.5 text-xs">
                {(
                  [
                    ["new", "Create per environment"],
                    ["existing", "Use existing"],
                  ] as const
                ).map(([m, l]) => (
                  <button
                    key={m}
                    onClick={() => setRgMode(m)}
                    className={cn(
                      "flex-1 rounded-sm px-2 py-1",
                      rgMode === m ? "bg-accent font-medium" : "text-muted-foreground",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {rgMode === "existing" && (
                <Select value={rgName} onValueChange={setRgName}>
                  <SelectTrigger className="mt-1.5 h-8 text-xs">
                    <SelectValue
                      placeholder={rgs.isLoading ? "Loading…" : "Pick a resource group"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {rgs.data?.map((g) => (
                      <SelectItem key={g.name} value={g.name} className="text-xs">
                        {g.name} · {g.location}
                        {g.managed ? " · Cloud Delivery" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Approval before apply">
              <div className="flex flex-wrap gap-1">
                {chosen.map((e) => {
                  const on = approvalFor.includes(e);
                  return (
                    <button
                      key={e}
                      onClick={() =>
                        setApprovalFor(
                          on ? approvalFor.filter((x) => x !== e) : [...approvalFor, e],
                        )
                      }
                      className={cn(
                        "flex items-center gap-1 rounded-sm border px-2 py-1 text-xs",
                        on ? "border-warning bg-warning/10" : "border-border text-muted-foreground",
                      )}
                    >
                      <ShieldCheck className="size-3" /> {ENV_LABEL[e]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1"
                disabled={
                  busy ||
                  start.isPending ||
                  !chosen.length ||
                  !prefixOk ||
                  !sub ||
                  (rgMode === "existing" && !rgName)
                }
                onClick={() => go("deploy")}
              >
                {start.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Deploy {chosen.map((e) => ENV_LABEL[e]).join(" → ")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                title="Plan only — show what would change, change nothing"
                disabled={busy || start.isPending || !chosen.length || !prefixOk || !sub}
                onClick={() => go("plan")}
              >
                Plan
              </Button>
              <Button
                size="sm"
                variant="outline"
                title="Remove these environments"
                aria-label="Remove these environments"
                disabled={busy || start.isPending || !chosen.length || !prefixOk}
                onClick={() => (confirm ? go("destroy") : setConfirm(true))}
                className={cn(confirm && "border-danger text-danger")}
              >
                <Trash2 className="size-3.5" />
                {confirm ? "Confirm" : ""}
              </Button>
            </div>
          </>
        )}

        <div className="border-t border-border pt-3">
          <p className="mb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Runs
          </p>
          {!list.length && <p className="text-xs text-muted-foreground">No runs yet.</p>}
          <ul className="space-y-0.5">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelectedRun(r.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-muted",
                    run?.id === r.id && "bg-muted",
                  )}
                >
                  <StatusIcon s={r.status} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">
                    {r.action === "destroy" ? "Remove" : r.action === "plan" ? "Plan" : "Deploy"} v
                    {r.version} · {r.environments.map((e) => ENV_SHORT[e]).join(", ")}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {relative(r.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="min-w-0 p-4">
        {run ? (
          <RunView run={run} />
        ) : (
          <div className="grid h-full place-items-center rounded-md border border-dashed border-border p-10 text-center">
            <div>
              <p className="text-[14px] font-semibold">Nothing deployed from this offering yet</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Pick a subscription and environments, then Deploy. The run lands the prerequisites,
                then plans and applies each environment in order — production waits for approval.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11.5px] font-medium">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[10.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function RunView({ run }: { run: OfferingRun }) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: useServerFn(decideOfferingRun),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["offering-runs", run.offering_id] }),
  });
  const active = run.stages.find((s) => s.status === "running" || s.status === "waiting");
  const failed = run.stages.find((s) => s.status === "failed");
  const [pick, setPick] = useState<string | null>(null);
  const stage = run.stages.find((s) => s.id === pick) ?? active ?? failed ?? run.stages.at(-1)!;
  useEffect(() => setPick(null), [run.id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (run.status !== "running" && run.status !== "waiting") return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [run.status]);
  const summary = run.summary as { error?: string } | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <StatusIcon s={run.status} className="size-5" />
            {run.action === "destroy" ? "Remove" : run.action === "plan" ? "Plan" : "Deploy"} v
            {run.version} {run.action === "plan" ? "for" : "to"}{" "}
            {run.environments.map((e) => ENV_LABEL[e]).join(" → ")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {run.started_by} · {relative(run.created_at)} ·{" "}
            {duration(run.created_at, run.finished_at)} · {run.region} · subscription{" "}
            {run.subscription_id.slice(0, 8)}…
          </p>
        </div>
        <span
          className={cn(
            "rounded-sm px-2 py-0.5 text-[11px] font-medium capitalize",
            run.status === "succeeded"
              ? "bg-success/10 text-success"
              : run.status === "failed"
                ? "bg-danger/10 text-danger"
                : run.status === "waiting"
                  ? "bg-warning/10 text-warning"
                  : "bg-muted text-muted-foreground",
          )}
        >
          {run.status === "waiting" ? "Waiting for approval" : run.status}
        </span>
      </div>
      {summary?.error && (
        <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {summary.error}
        </p>
      )}

      <div className="flex items-stretch gap-2 overflow-x-auto rounded-md border border-border bg-muted/30 p-3">
        {run.stages.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="size-4 shrink-0 text-muted-foreground/60" />}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setPick(s.id)}
              data-stage={s.id}
              className={cn(
                "w-44 cursor-pointer rounded-md border bg-card p-2.5 text-left transition-colors",
                stage.id === s.id
                  ? "border-primary ring-1 ring-primary/30"
                  : "border-border hover:border-border-strong",
                s.status === "failed" && "border-danger/60",
                s.status === "waiting" && "border-warning/60",
              )}
            >
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                <StatusIcon s={s.status} />
                {s.name}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {s.steps.filter((x) => x.status === "succeeded").length}/{s.steps.length} steps
                {s.startedAt ? ` · ${duration(s.startedAt, s.finishedAt)}` : ""}
              </p>
              {s.summary && "add" in s.summary && (
                <p className="mt-0.5 font-mono text-[11px]">
                  <span className="text-success">+{s.summary["add"]}</span>{" "}
                  <span className="text-warning">~{s.summary["change"]}</span>{" "}
                  <span className="text-danger">−{s.summary["destroy"]}</span>
                  {s.summary["resources"] !== undefined && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {s.summary["resources"]} in Azure
                    </span>
                  )}
                </p>
              )}
              {s.status === "waiting" && (
                <span className="mt-1.5 flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ data: { runId: run.id, decision: "approved" } })}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ data: { runId: run.id, decision: "rejected" } })}
                  >
                    Reject
                  </Button>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <StageSteps stage={stage} />
    </div>
  );
}

function StageSteps({ stage }: { stage: RunStage }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const live = stage.steps.find(
    (s) => s.status === "running" || s.status === "waiting" || s.status === "failed",
  );
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <StatusIcon s={stage.status} /> {stage.name}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {stage.startedAt ? duration(stage.startedAt, stage.finishedAt) : "Not started"}
        </p>
      </div>
      <ul className="divide-y divide-white/10 bg-[#0d1117] text-[#c9d1d9]">
        {stage.steps.map((s) => {
          const expanded = open[s.id] ?? s.id === live?.id;
          return (
            <li key={s.id}>
              <button
                onClick={() => setOpen({ ...open, [s.id]: !expanded })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-white/5"
              >
                {expanded ? (
                  <ChevronDown className="size-3.5 text-[#8b949e]" />
                ) : (
                  <ChevronRight className="size-3.5 text-[#8b949e]" />
                )}
                <StatusIcon s={s.status} className="size-3.5" />
                <span className="flex-1">{s.name}</span>
                {s.detail && (
                  <span className="font-mono text-[11px] text-[#8b949e]">{s.detail}</span>
                )}
                <span className="w-14 text-right font-mono text-[11px] text-[#8b949e]">
                  {s.startedAt ? duration(s.startedAt, s.finishedAt) : ""}
                </span>
              </button>
              {expanded && <StepLog text={s.log} live={s.status === "running"} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepLog({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => (text || "").split("\n").filter(Boolean), [text]);
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, live]);
  return (
    <pre
      ref={ref}
      className="max-h-96 overflow-auto border-t border-white/10 px-3 py-2 font-mono text-[11px] leading-[1.55]"
    >
      {lines.length ? (
        lines.map((l, i) => (
          <div key={i} className="flex gap-3">
            <span className="w-8 shrink-0 text-right text-[#6e7681] select-none">{i + 1}</span>
            <span
              className={cn(
                "whitespace-pre-wrap",
                /Error|FAIL|failed/i.test(l) && "text-[#ff7b72]",
                /WARN/.test(l) && "text-[#d29922]",
                /\$ terraform|Plan:|Apply complete|Destroy complete/.test(l) && "text-[#79c0ff]",
                /PASS|Success/.test(l) && "text-[#7ee787]",
              )}
            >
              {l}
            </span>
          </div>
        ))
      ) : (
        <span className="text-[#6e7681]">{live ? "Starting…" : "No output."}</span>
      )}
    </pre>
  );
}
