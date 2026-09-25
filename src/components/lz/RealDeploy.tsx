import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  CircleAlert,
  CircleX,
  Loader2,
  Play,
  Rocket,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type DeployRun,
  getDeployReadiness,
  getDeployRuns,
  startDeployRun,
} from "@/lib/alz/deploy.functions";
import { relative } from "@/lib/format";
import { cn } from "@/lib/utils";

type Choice = { mode: "existing"; subscriptionId: string } | { mode: "new" };
type Summary = {
  add?: number;
  change?: number;
  destroy?: number;
  byType?: Record<string, number>;
  managementGroups?: string[];
  policyAssignments?: number;
  roleAssignments?: number;
  error?: string;
  stage?: string;
};

const LEVEL = {
  pass: <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />,
  warn: <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />,
  fail: <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />,
};

/** Deploys the saved design into Azure for real: vend or pick platform subscriptions, plan, apply, destroy. */
export function RealDeploy({ foundationId, dirty }: { foundationId: string; dirty: boolean }) {
  const queryClient = useQueryClient();
  const readinessFn = useServerFn(getDeployReadiness);
  const runsFn = useServerFn(getDeployRuns);
  const readiness = useQuery({
    queryKey: ["deploy-readiness", foundationId],
    queryFn: () => readinessFn({ data: { foundationId } }),
    staleTime: 60_000,
  });
  const runs = useQuery({
    queryKey: ["deploy-runs", foundationId],
    queryFn: () => runsFn({ data: { foundationId } }) as Promise<DeployRun[]>,
    refetchInterval: (q) =>
      (q.state.data as DeployRun[] | undefined)?.some((r) => r.status === "running") ? 2000 : false,
  });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [billingScope, setBillingScope] = useState("");
  const [principals, setPrincipals] = useState<Record<string, string>>({});
  const [hierarchy, setHierarchy] = useState(false);
  const [cancelVended, setCancelVended] = useState(true);
  const [confirmDestroy, setConfirmDestroy] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const r = readiness.data;
  const list = runs.data ?? [];
  const latest = list[0];
  const busy = latest?.status === "running";
  const lastPlan = list.find((x) => x.action === "plan");
  const lastApply = list.find((x) => x.action === "apply" || x.action === "destroy");
  const canApply =
    !!lastPlan &&
    lastPlan.status === "succeeded" &&
    (!lastApply || new Date(lastApply.created_at) < new Date(lastPlan.created_at));

  // Default each platform subscription to what's already deployed, otherwise a new one.
  useEffect(() => {
    if (!r) return;
    setChoices((c) => {
      const next = { ...c };
      for (const t of r.targets) {
        if (next[t.key]) continue;
        const existing = r.deployment.targets?.[t.key as keyof typeof r.deployment.targets];
        next[t.key] = existing ? { mode: "existing", subscriptionId: existing } : { mode: "new" };
      }
      return next;
    });
    if (!billingScope && (r.deployment.billingScope || r.billingScopes[0]))
      setBillingScope(r.deployment.billingScope ?? r.billingScopes[0]!.id);
  }, [r, billingScope]);

  const start = useMutation({
    mutationFn: useServerFn(startDeployRun),
    onSuccess: (x: { runId: string }) => {
      setOpen(x.runId);
      void queryClient.invalidateQueries({ queryKey: ["deploy-runs", foundationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (latest && latest.status !== "running") {
      void queryClient.invalidateQueries({ queryKey: ["foundation", foundationId] });
      void queryClient.invalidateQueries({ queryKey: ["deploy-readiness", foundationId] });
    }
  }, [latest?.status, latest, foundationId, queryClient]);

  if (readiness.isLoading)
    return <p className="text-sm text-muted-foreground">Checking your Azure access…</p>;
  if (!r) return <p className="text-sm text-danger">Couldn't check Azure access.</p>;

  const blocking = r.checks.some((c) => c.level === "fail");
  const needsScope = r.needsBillingScope || Object.values(choices).some((c) => c.mode === "new");
  const missingPrincipals = r.principals.filter(
    (p) => !/^[0-9a-f-]{36}$/i.test(principals[p] ?? ""),
  );
  const canPlan =
    !dirty && !blocking && !busy && (!needsScope || !!billingScope) && !missingPrincipals.length;
  const payload = (action: "plan" | "apply" | "destroy") => ({
    data: {
      foundationId,
      action,
      targets: choices,
      billingScope: needsScope ? billingScope : "",
      principals,
      applyHierarchySettings: hierarchy,
      cancelVended,
      startedBy: r.identity?.name || "Platform engineer",
    },
  });
  const shown = list.find((x) => x.id === open) ?? latest;

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div>
            <h2 className="text-[13px] font-semibold">Deploy to Azure</h2>
            <p className="text-xs text-muted-foreground">
              Real deployment of the saved design with Terraform (ALZ {r.libraryRef}) into tenant{" "}
              <span className="font-mono">{r.tenantId ?? "—"}</span>.
            </p>
          </div>
          <Pill tone={r.status === "deployed" ? "success" : "neutral"}>
            {r.status === "deployed" ? "Deployed" : "Not deployed"}
          </Pill>
        </header>
        <ul className="divide-y divide-border">
          {r.checks.map((c) => (
            <li key={c.id} className="flex gap-2 px-4 py-2">
              {LEVEL[c.level]}
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium">{c.title}</p>
                <p className="font-mono text-[11px] break-all text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h3 className="text-[13px] font-semibold">Platform subscriptions</h3>
        <p className="text-xs text-muted-foreground">
          Each platform subscription is moved into its management group and gets the landing zone's
          policies. Use empty subscriptions — policies apply to everything already in them.
        </p>
        <div className="mt-3 space-y-2">
          {r.targets.map((t) => {
            const c = choices[t.key];
            const value = !c ? "" : c.mode === "new" ? "new" : c.subscriptionId;
            const sub = r.subscriptions.find(
              (s) => c?.mode === "existing" && s.id === c.subscriptionId,
            );
            return (
              <div
                key={t.key}
                className="grid items-center gap-2 sm:grid-cols-[140px_minmax(0,1fr)]"
              >
                <Label className="text-[12.5px]">{t.label}</Label>
                <div>
                  <Select
                    value={value}
                    onValueChange={(v) =>
                      setChoices({
                        ...choices,
                        [t.key]:
                          v === "new" ? { mode: "new" } : { mode: "existing", subscriptionId: v },
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Create a new subscription (vending)</SelectItem>
                      {r.subscriptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} · {s.id.slice(0, 8)}… · {s.resourceGroups} resource group
                          {s.resourceGroups === 1 ? "" : "s"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sub && sub.resourceGroups > 2 && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                      <ShieldAlert className="size-3" /> {sub.resourceGroups} resource groups
                      already in this subscription — landing zone policies will apply to them.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {needsScope && (
            <div className="grid items-center gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
              <Label className="text-[12.5px]">Billing scope</Label>
              <Select value={billingScope} onValueChange={setBillingScope}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="No billing scope found" />
                </SelectTrigger>
                <SelectContent>
                  {r.billingScopes.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {r.principals.map((p) => (
            <div key={p} className="grid items-center gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
              <Label className="text-[12.5px]">
                {p.replace(/_principal_id$/, "").replace(/_/g, " ")}
              </Label>
              <Input
                className="h-8 font-mono text-xs"
                placeholder="Microsoft Entra group object ID"
                value={principals[p] ?? ""}
                onChange={(e) => setPrincipals({ ...principals, [p]: e.target.value.trim() })}
              />
            </div>
          ))}
          {r.hierarchySettings && (
            <label className="flex items-center justify-between gap-3 rounded-sm border border-warning/40 bg-warning/5 px-3 py-2">
              <span className="text-xs">
                <b className="font-medium">Tenant-wide hierarchy settings</b> — new subscriptions
                default to the design's group, and creating management groups needs permission.
                Affects the whole tenant.
              </span>
              <Switch checked={hierarchy} onCheckedChange={setHierarchy} />
            </label>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={!canPlan || start.isPending}
            onClick={() => start.mutate(payload("plan"))}
          >
            <Play className="size-3.5" /> Plan
          </Button>
          <Button
            variant={canApply ? "default" : "outline"}
            disabled={!canApply || busy || start.isPending}
            onClick={() => start.mutate(payload("apply"))}
          >
            <Rocket className="size-3.5" /> Apply plan
          </Button>
          {dirty && <span className="text-xs text-warning">Save the design first.</span>}
          {!canApply && !busy && lastPlan?.status === "succeeded" && (
            <span className="text-xs text-muted-foreground">
              Plan again to apply the latest design.
            </span>
          )}
        </div>
      </section>

      {shown && <RunPanel run={shown} />}

      {list.length > 1 && (
        <section className="rounded-md border border-border bg-card">
          <p className="border-b border-border px-4 py-2 text-[13px] font-semibold">Runs</p>
          <ul className="divide-y divide-border">
            {list.map((x) => (
              <li key={x.id}>
                <button
                  onClick={() => setOpen(x.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[12.5px] hover:bg-muted/40",
                    shown?.id === x.id && "bg-accent/40",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <StatusIcon status={x.status} />
                    <b className="font-medium capitalize">{x.action}</b>
                    <span className="text-muted-foreground">by {x.started_by}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{relative(x.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.status === "deployed" || r.deployment.targets ? (
        <section className="rounded-md border border-danger/30 bg-card p-4">
          <h3 className="text-[13px] font-semibold text-danger">Tear down</h3>
          <p className="text-xs text-muted-foreground">
            terraform destroy removes everything this landing zone created: management groups,
            policy and role assignments, and platform resources.
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <Switch checked={cancelVended} onCheckedChange={setCancelVended} />
            Also cancel the subscriptions this app created
            {r.deployment.vended?.length ? ` (${r.deployment.vended.length})` : ""}
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-64 text-xs"
              placeholder='Type "destroy" to confirm'
              value={confirmDestroy}
              onChange={(e) => setConfirmDestroy(e.target.value)}
            />
            <Button
              variant="outline"
              className="border-danger/40 text-danger"
              disabled={confirmDestroy !== "destroy" || busy || start.isPending}
              onClick={() => {
                setConfirmDestroy("");
                start.mutate(payload("destroy"));
              }}
            >
              <Trash2 className="size-3.5" /> Destroy
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: DeployRun["status"] }) {
  return status === "running" ? (
    <Loader2 className="size-3.5 animate-spin text-warning" />
  ) : status === "succeeded" ? (
    <CheckCircle2 className="size-3.5 text-success" />
  ) : status === "failed" ? (
    <CircleX className="size-3.5 text-danger" />
  ) : (
    <Loader2 className="size-3.5 text-muted-foreground" />
  );
}

function RunPanel({ run }: { run: DeployRun }) {
  const s = (run.summary ?? {}) as Summary;
  const ref = useRef<HTMLPreElement | null>(null);
  const lines = useMemo(() => run.log.split("\n"), [run.log]);
  useEffect(() => {
    if (run.status === "running" && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, run.status]);
  const types = Object.entries(s.byType ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <StatusIcon status={run.status} />
          <span className="capitalize">{run.action}</span>
          <span className="font-normal text-muted-foreground">
            · {run.status === "running" ? "running" : run.status} · started{" "}
            {relative(run.created_at)}
          </span>
        </p>
        {run.action === "plan" && run.status === "succeeded" && (
          <p className="font-mono text-xs">
            <span className="text-success">+{s.add ?? 0}</span> ·{" "}
            <span className="text-warning">~{s.change ?? 0}</span> ·{" "}
            <span className="text-danger">-{s.destroy ?? 0}</span>
          </p>
        )}
      </header>
      {run.action === "plan" && run.status === "succeeded" && (
        <div className="grid gap-3 border-b border-border px-4 py-3 text-xs sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Management groups created</p>
            <p className="mt-0.5 font-mono">{s.managementGroups?.join(", ") || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Policy assignments</p>
            <p className="mt-0.5 font-mono text-[15px] font-semibold">{s.policyAssignments ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Role assignments</p>
            <p className="mt-0.5 font-mono text-[15px] font-semibold">{s.roleAssignments ?? 0}</p>
          </div>
          <div className="sm:col-span-3">
            <p className="text-muted-foreground">Resources by type</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {types.slice(0, 16).map(([t, n]) => (
                <span
                  key={t}
                  className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10.5px]"
                >
                  {t.replace(/^Microsoft\./, "")} {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {s.error && (
        <p className="border-b border-border bg-danger/5 px-4 py-2 text-xs text-danger">
          {s.error}
        </p>
      )}
      <pre
        ref={ref}
        className="max-h-[420px] overflow-auto bg-[#0f1b2d] px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[#d5deea]"
      >
        {lines.slice(-600).join("\n") || "Starting…"}
      </pre>
    </section>
  );
}
