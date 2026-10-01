/*
 * Deploying an engagement's chosen solution for its customer: the proof, then production. It uses the customer's
 * existing record and Azure connection and the same plan → approve → run path as every install. Where it runs is
 * suggested from what the customer confirmed in the conversation.
 */
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ExternalLink, Lightbulb, Rocket, Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Pill, statusLabel } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Engagement } from "@/lib/engagements";
import type { EngagementInstall } from "@/lib/engagements.functions";
import { deployForEngagement } from "@/lib/factory.functions";
import { cn } from "@/lib/utils";

import type { CatalogProduct } from "./Prove";

const WHERE: Record<string, { label: string; body: string }> = {
  customer_hosted: {
    label: "In their Azure tenant",
    body: "Installed in the customer's own subscription and billed to their Azure.",
  },
  saas_connected: {
    label: "Hosted for them",
    body: "Runs outside their tenant, in the hosting subscription; nothing installed in theirs.",
  },
};

const day = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function DeployStatus({
  e,
  product,
  installs,
  kind,
  blocked,
}: {
  e: Engagement;
  product: CatalogProduct;
  installs: EngagementInstall[];
  kind: "proof" | "production";
  /** Why it can't be deployed yet, if it can't. */
  blocked?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const envs = installs.filter(
    (i) =>
      i.product_id === product.id &&
      (kind === "production"
        ? i.environment_type === "production"
        : i.environment_type !== "production"),
  );
  const live = envs.filter((i) => i.version);
  const pending = envs.find((i) => !i.version);
  const action = kind === "proof" ? "Deploy the proof" : "Deploy to production";
  return (
    <div className="mt-2 space-y-2">
      {live.map((r) => (
        <p key={r.id} className="flex flex-wrap items-center gap-2 text-[12px]">
          <Pill tone="success">
            <Server className="size-3" /> {kind === "proof" ? "Proof running" : "In production"}
          </Pill>
          <span className="text-muted-foreground">
            {r.name} · v{r.version} · {r.status} · since {day(r.created_at)}
          </span>
        </p>
      ))}
      {!live.length && pending && (
        <p className="flex flex-wrap items-center gap-2 text-[12px]">
          <Pill tone="warning">
            {pending.deployment_status ? statusLabel(pending.deployment_status) : "Not planned"}
          </Pill>
          <span className="text-muted-foreground">{pending.name}</span>
          {pending.deployment_id && (
            <Link
              to="/deployments/$deploymentId"
              params={{ deploymentId: pending.deployment_id }}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3" /> Open the run
            </Link>
          )}
        </p>
      )}
      {!live.length && !pending && (
        <>
          <p className="text-[12px] text-muted-foreground">
            {kind === "proof" ? "No proof deployed yet." : "Not in production yet."}
          </p>
          {blocked && <p className="text-[12px] text-muted-foreground">{blocked}</p>}
          <Button size="sm" disabled={!!blocked} onClick={() => setOpen(true)}>
            <Rocket className="size-3.5" /> {action}
          </Button>
          <DeployDialog open={open} onOpenChange={setOpen} e={e} product={product} kind={kind} />
        </>
      )}
    </div>
  );
}

function DeployDialog({
  open,
  onOpenChange,
  e,
  product,
  kind,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  e: Engagement;
  product: CatalogProduct;
  kind: "proof" | "production";
}) {
  const navigate = useNavigate();
  const choices = product.offerings.filter((o) => o.version);
  // A confirmed constraint about where data lives decides the default, and is shown as the reason.
  const tenantRule = e.findings.find((f) => f.kind === "confirmed" && /tenant/i.test(f.text));
  const preferred =
    choices.find((o) => o.offering_type === "customer_hosted") ?? choices[0] ?? null;
  const [pick, setPick] = useState(preferred?.id ?? "");
  const chosen = choices.find((o) => o.id === pick);
  const conflicts = !!tenantRule && chosen?.offering_type === "saas_connected";
  const deploy = useMutation({
    mutationFn: useServerFn(deployForEngagement),
    onSuccess: (r: { deploymentId: string; status: string }) => {
      toast.success(
        r.status === "VALIDATION_FAILED"
          ? "Planned, but preflight failed. The run shows why."
          : kind === "proof"
            ? "Proof planned. Review the plan, then run it."
            : "Production planned. It waits for security approval.",
      );
      void navigate({ to: "/deployments/$deploymentId", params: { deploymentId: r.deploymentId } });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {kind === "proof" ? "Deploy the proof" : "Deploy to production"}: {product.name}
          </DialogTitle>
          <DialogDescription>
            For {e.customer_name ?? "the customer"}, using their validated Azure connection and the
            pinned release.
          </DialogDescription>
        </DialogHeader>
        {choices.length ? (
          <div className="space-y-2">
            <p className="text-[12.5px] font-medium">Where it runs</p>
            {choices.map((o) => {
              const w = WHERE[o.offering_type] ?? { label: o.name, body: "" };
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={pick === o.id}
                  onClick={() => setPick(o.id)}
                  className={cn(
                    "w-full rounded-lg border px-3.5 py-2.5 text-left",
                    pick === o.id
                      ? "border-primary/50 bg-primary/[0.05] ring-1 ring-primary/25"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
                    {w.label}
                    <span className="text-[11.5px] font-normal text-muted-foreground">
                      v{o.version}
                    </span>
                  </span>
                  {w.body && (
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">{w.body}</span>
                  )}
                </button>
              );
            })}
            {tenantRule && !conflicts && preferred?.id === pick && (
              <p className="flex items-start gap-1.5 text-[12px] text-primary">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                Suggested because they confirmed: “{tenantRule.text}”
              </p>
            )}
            {conflicts && (
              <p className="flex items-start gap-1.5 text-[12px] text-[oklch(0.5_0.12_70)]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                This goes against what they confirmed: “{tenantRule!.text}”
              </p>
            )}
            <p className="rounded-md bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
              {kind === "proof"
                ? "Creates one environment, PROOF. A platform engineer reviews the plan, then the pipeline runs."
                : "Creates PROD. Security approves it before it runs. Every step is in the audit log."}
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            This solution has no published release to deploy yet.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!chosen || deploy.isPending}
            onClick={() => deploy.mutate({ data: { engagementId: e.id, offeringId: pick, kind } })}
          >
            <Rocket className="size-4" /> {deploy.isPending ? "Planning…" : "Plan the deployment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
