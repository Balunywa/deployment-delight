import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Metric, PageHeader, Panel, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createRollout, planUpgrades, startWave } from "@/lib/factory.functions";
import { relative, titleize } from "@/lib/format";
import { offeringsQuery, wavesQuery } from "@/lib/queries";

export const Route = createFileRoute("/upgrades")({
  head: () => ({
    meta: [
      { title: "Upgrades · Azure ISV Deployment Factory" },
      {
        name: "description",
        content: "Classify every environment against a published version, then roll it out in waves — internal test, pilots, then the remainder.",
      },
      { property: "og:title", content: "Upgrades · Azure ISV Deployment Factory" },
      { property: "og:description", content: "Version rollout classification and wave-based upgrade execution." },
    ],
  }),
  component: Upgrades,
});

type PlanResult = {
  targetVersion: string;
  offeringName: string;
  current: string[];
  compatible: string[];
  manualReview: { id: string; reason: string }[];
  environments: {
    id: string;
    name: string;
    environment_type: string;
    compliance_score: number;
    customers: { name: string } | null;
    actual: { version?: string } | null;
  }[];
};

function Upgrades() {
  const offerings = useQuery(offeringsQuery);
  const waves = useQuery(wavesQuery);
  const queryClient = useQueryClient();
  const [versionId, setVersionId] = useState<string>("");
  const [result, setResult] = useState<PlanResult | null>(null);

  const versions = (offerings.data ?? []).flatMap((o) =>
    ((o.offering_versions ?? []) as { id: string; version: string; status: string }[])
      .filter((v) => v.status === "published")
      .map((v) => ({ id: v.id, label: `${o.name} · v${v.version}` })),
  );

  const plan = useMutation({
    mutationFn: useServerFn(planUpgrades),
    onSuccess: (r: PlanResult) => {
      setResult(r);
      toast.success(`${r.compatible.length} environment(s) are upgrade-compatible for v${r.targetVersion}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollout = useMutation({
    mutationFn: useServerFn(createRollout),
    onSuccess: () => {
      toast.success("Rollout waves created. Start wave 1 when you are ready.");
      queryClient.invalidateQueries({ queryKey: ["waves"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const start = useMutation({
    mutationFn: useServerFn(startWave),
    onSuccess: (r: { created: number }) => {
      toast.success(`${r.created} deployment(s) created and awaiting approval. Nothing deployed silently.`);
      queryClient.invalidateQueries({ queryKey: ["waves"] });
      queryClient.invalidateQueries({ queryKey: ["deployments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const name = (id: string) => {
    const env = result?.environments.find((e) => e.id === id);
    return env ? `${env.customers?.name ?? "Customer"} · ${env.name}` : id;
  };

  const buildWaves = () => {
    if (!result || !versionId) return;
    const ids = result.compatible;
    const size = Math.max(1, Math.ceil(ids.length / 4));
    const groups = [
      { name: "Wave 1 — internal test", ids: ids.slice(0, Math.min(1, ids.length)) },
      { name: "Wave 2 — pilot customers", ids: ids.slice(1, 1 + size) },
      { name: "Wave 3 — broad rollout", ids: ids.slice(1 + size, 1 + size * 3) },
      { name: "Wave 4 — remaining estate", ids: ids.slice(1 + size * 3) },
    ].filter((g) => g.ids.length > 0);
    rollout.mutate({ data: { offeringVersionId: versionId, waves: groups.map((g) => ({ name: g.name, environmentIds: g.ids })) } });
  };

  return (
    <>
      <PageHeader
        title="Upgrades"
        description="Publish a version, classify the estate against it, then roll out in waves. Environments are never upgraded silently — each wave creates plans that require approval."
      />

      <Panel title="Plan a rollout" description="Select a published offering version to classify the estate.">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={versionId} onValueChange={setVersionId}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select a published version" />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={!versionId || plan.isPending} onClick={() => plan.mutate({ data: { offeringVersionId: versionId } })}>
            {plan.isPending ? "Classifying…" : "Classify estate"}
          </Button>
          {result && (
            <Button variant="outline" disabled={rollout.isPending || !result.compatible.length} onClick={buildWaves}>
              Create rollout waves
            </Button>
          )}
        </div>
      </Panel>

      {result && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric label={`Already on v${result.targetVersion}`} value={result.current.length} tone="success" />
            <Metric label="Upgrade compatible" value={result.compatible.length} tone="info" />
            <Metric label="Manual review required" value={result.manualReview.length} tone="warning" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Upgrade compatible" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {result.compatible.map((id) => (
                  <li key={id} className="px-4 py-2.5 text-[13px]">
                    {name(id)}
                  </li>
                ))}
                {!result.compatible.length && <li className="px-4 py-5 text-xs text-muted-foreground">None.</li>}
              </ul>
            </Panel>
            <Panel title="Manual review required" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {result.manualReview.map((m) => (
                  <li key={m.id} className="px-4 py-2.5">
                    <p className="text-[13px] font-medium">{name(m.id)}</p>
                    <p className="text-xs text-warning">{m.reason}</p>
                  </li>
                ))}
                {!result.manualReview.length && <li className="px-4 py-5 text-xs text-muted-foreground">None.</li>}
              </ul>
            </Panel>
          </div>
        </>
      )}

      <div className="mt-4">
        <Panel title="Rollout waves" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {(waves.data ?? []).map((w) => {
              const version = w.offering_versions as { version: string; offerings: { name: string } } | null;
              return (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-medium">
                      {w.name} · {version?.offerings?.name} v{version?.version}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(w.environment_ids ?? []).length} environments · created {relative(w.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone={w.status === "completed" ? "success" : w.status === "in_progress" ? "info" : "neutral"}>
                      {titleize(w.status)}
                    </Pill>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={w.status !== "planned" || start.isPending}
                      onClick={() => start.mutate({ data: { waveId: w.id } })}
                    >
                      {w.status === "planned" ? "Start wave" : "Started"}
                    </Button>
                  </div>
                </li>
              );
            })}
            {!(waves.data ?? []).length && (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No rollout waves yet. Classify the estate, then create waves.
              </li>
            )}
          </ul>
        </Panel>
      </div>

      {!versions.length && !offerings.isLoading && <EmptyState title="Publish an offering version before planning upgrades." />}
    </>
  );
}
