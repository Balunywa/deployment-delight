import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { fromManifest } from "@/lib/architecture";
import { createRollout, planUpgrades, startWave } from "@/lib/factory.functions";
import { RELEASE_TONE, releaseLabel, semverCompare } from "@/lib/fleet";
import { relative, shortDate } from "@/lib/format";
import { wavesQuery } from "@/lib/queries";
import { useFleet } from "@/lib/use-fleet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/upgrades")({
  validateSearch: (s: Record<string, unknown>): { offering?: string } =>
    typeof s["offering"] === "string" ? { offering: s["offering"] } : {},
  head: () => ({
    meta: [
      { title: "Releases · Cloud Delivery" },
      {
        name: "description",
        content:
          "Every release of every offering, which customers run it, and ring-based rollouts across the installed base.",
      },
      { property: "og:title", content: "Releases · Cloud Delivery" },
      { property: "og:description", content: "Release adoption and ring rollouts." },
    ],
  }),
  component: Releases,
});

type Version = {
  id: string;
  version: string;
  status: string;
  release_notes: string | null;
  published_at: string | null;
  manifest_json: unknown;
};
type PlanResult = {
  targetVersion: string;
  current: string[];
  compatible: string[];
  manualReview: { id: string; reason: string }[];
  environments: {
    id: string;
    name: string;
    environment_type: string;
    customers: { name: string } | null;
  }[];
};

const RINGS = [
  "Ring 0 · internal test",
  "Ring 1 · pilot customers",
  "Ring 2 · broad",
  "Ring 3 · remaining",
];
const LABEL = {
  preferred: "Preferred",
  supported: "Supported",
  deprecated: "Deprecated",
  draft: "Draft",
} as const;

function Releases() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { offerings, installs, releases } = useFleet();
  const waves = useQuery(wavesQuery);
  const queryClient = useQueryClient();
  const offering =
    offerings.find((o) => o.id === search.offering) ??
    offerings.find((o) => o.offering_type === "enterprise_private") ??
    offerings[0];
  const [target, setTarget] = useState<Version | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

  const versions = useMemo(
    () =>
      ((offering?.offering_versions ?? []) as unknown as Version[])
        .slice()
        .sort((a, b) => semverCompare(b.version, a.version)),
    [offering],
  );
  const preferred = offering ? releases.get(offering.id)?.preferred : undefined;
  const mine = installs.filter((i) => i.offeringId === offering?.id && i.actual);

  const plan = useMutation({
    mutationFn: useServerFn(planUpgrades),
    onSuccess: (r: PlanResult) => setResult(r),
    onError: (e: Error) => toast.error(e.message),
  });
  const rollout = useMutation({
    mutationFn: useServerFn(createRollout),
    onSuccess: () => {
      toast.success(
        "Rollout created. Start Ring 0 when you're ready — every ring produces plans that need approval.",
      );
      setResult(null);
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["waves"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const start = useMutation({
    mutationFn: useServerFn(startWave),
    onSuccess: (r: { created: number }) => {
      toast.success(`${r.created} pipeline run(s) created and waiting for approval.`);
      for (const k of [["waves"], ["deployments"], ["customers"], ["estate"]])
        void queryClient.invalidateQueries({ queryKey: k });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!offering) return <p className="text-sm text-muted-foreground">Loading releases…</p>;

  const name = (id: string) => {
    const e = result?.environments.find((x) => x.id === id);
    return e ? `${e.customers?.name ?? "Customer"} · ${e.name}` : id.slice(0, 8);
  };
  const rings = (() => {
    const ids = result?.compatible ?? [];
    const size = Math.max(1, Math.ceil(ids.length / 4));
    return [
      ids.slice(0, 1),
      ids.slice(1, 1 + size),
      ids.slice(1 + size, 1 + size * 3),
      ids.slice(1 + size * 3),
    ];
  })();
  const offeringWaves = (waves.data ?? [])
    .filter((w) => versions.some((v) => v.id === w.offering_version_id))
    .sort((a, b) => a.sequence - b.sequence);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Product / Releases</p>
          <h1 className="mt-0.5 text-[22px] font-semibold">Releases</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A release is an immutable version of an offering. Roll it out in rings; every install
            gets a plan that needs approval — nothing upgrades silently.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {offerings.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setResult(null);
                setTarget(null);
                void navigate({ search: { offering: o.id } });
              }}
              className={cn(
                "rounded-sm px-2 py-1 text-xs",
                o.id === offering.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {o.name}
            </button>
          ))}
        </div>
      </div>

      <section className="mb-5 overflow-hidden rounded-md border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Release</th>
              <th>Standing</th>
              <th>Changes</th>
              <th>Installs running it</th>
              <th>Published</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.map((v, i) => {
              const tone = releaseLabel(v.version, v.status, preferred);
              const on = mine.filter((x) => x.actual === v.version);
              const prev = versions[i + 1];
              const mods = (x: unknown) =>
                new Map(
                  ((x as { modules?: { name: string; version: string }[] })?.modules ?? []).map(
                    (m) => [m.name, m.version],
                  ),
                );
              const a = mods(prev?.manifest_json);
              const b = mods(v.manifest_json);
              const changes = [
                ...[...b.keys()].filter((k) => !a.has(k)).map((k) => `+${k}`),
                ...[...a.keys()].filter((k) => !b.has(k)).map((k) => `−${k}`),
                ...[...b.entries()]
                  .filter(([k, ver]) => a.has(k) && a.get(k) !== ver)
                  .map(([k, ver]) => `${k} ${a.get(k)}→${ver}`),
              ];
              return (
                <tr key={v.id} className={cn(target?.id === v.id && "bg-accent/40")}>
                  <td>
                    <p className="font-mono text-[13px] font-semibold">v{v.version}</p>
                    {v.release_notes && (
                      <p
                        className="max-w-sm truncate text-xs text-muted-foreground"
                        title={v.release_notes}
                      >
                        {v.release_notes}
                      </p>
                    )}
                  </td>
                  <td>
                    <Pill tone={RELEASE_TONE[tone]}>{LABEL[tone]}</Pill>
                  </td>
                  <td className="max-w-xs">
                    <div className="flex flex-wrap gap-1 font-mono text-[10.5px]">
                      {prev ? (
                        changes.length ? (
                          changes.slice(0, 5).map((c) => (
                            <span
                              key={c}
                              className={cn(
                                "rounded-sm px-1 py-px",
                                c.startsWith("+")
                                  ? "bg-success/10 text-success"
                                  : c.startsWith("−")
                                    ? "bg-danger/10 text-danger"
                                    : "bg-info/10 text-info",
                              )}
                            >
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">settings only</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">initial</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            "block h-full",
                            tone === "preferred"
                              ? "bg-success"
                              : tone === "deprecated"
                                ? "bg-danger"
                                : "bg-warning",
                          )}
                          style={{ width: `${(on.length / Math.max(mine.length, 1)) * 100}%` }}
                        />
                      </span>
                      <span className="mono-num text-xs">{on.length}</span>
                    </div>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {v.published_at ? shortDate(v.published_at) : "—"}
                  </td>
                  <td className="text-right">
                    {v.status === "published" ? (
                      <Button
                        size="sm"
                        variant={tone === "preferred" ? "default" : "outline"}
                        disabled={plan.isPending}
                        onClick={() => {
                          setTarget(v);
                          plan.mutate({ data: { offeringVersionId: v.id } });
                        }}
                      >
                        Plan rollout
                      </Button>
                    ) : v.status === "draft" ? (
                      <Link
                        to="/offerings"
                        search={{ offering: offering.id }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Open draft
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {target && result && (
        <section className="mb-5 rounded-md border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold">
                Roll out {offering.name} v{result.targetVersion}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {result.current.length} already current · {result.compatible.length}{" "}
                upgrade-compatible · {result.manualReview.length} need review ·{" "}
                {fromManifest(offering, target.manifest_json).selected.length} resources per install
              </p>
            </div>
            <Button
              disabled={rollout.isPending || !result.compatible.length}
              onClick={() =>
                rollout.mutate({
                  data: {
                    offeringVersionId: target.id,
                    waves: rings
                      .map((ids, i) => ({ name: RINGS[i] as string, environmentIds: ids }))
                      .filter((w) => w.environmentIds.length),
                  },
                })
              }
            >
              Create rollout
            </Button>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto">
            {rings.map((ids, i) => (
              <div
                key={i}
                className="w-56 shrink-0 rounded-md border border-border bg-background p-2.5"
              >
                <p className="text-[11px] font-semibold text-muted-foreground">{RINGS[i]}</p>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {i === 0
                    ? "Soak before anyone else"
                    : i === 1
                      ? "Opt-in early adopters"
                      : i === 2
                        ? "Most of the base"
                        : "Everyone else"}
                </p>
                <ul className="space-y-1">
                  {ids.map((id) => (
                    <li
                      key={id}
                      className="truncate rounded-sm border border-border bg-card px-2 py-1 text-xs"
                    >
                      {name(id)}
                    </li>
                  ))}
                  {!ids.length && <li className="text-xs text-muted-foreground">—</li>}
                </ul>
              </div>
            ))}
            <div className="w-64 shrink-0 rounded-md border border-dashed border-warning/50 bg-warning/5 p-2.5">
              <p className="text-[11px] font-semibold text-warning">Needs review · not in a ring</p>
              <ul className="mt-2 space-y-1.5">
                {result.manualReview.map((m) => (
                  <li key={m.id} className="text-xs">
                    <p className="truncate font-medium">{name(m.id)}</p>
                    <p className="text-muted-foreground">{m.reason}</p>
                  </li>
                ))}
                {!result.manualReview.length && (
                  <li className="text-xs text-muted-foreground">None</li>
                )}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-md border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Rollouts · {offering.name}</h2>
        </header>
        <ul className="divide-y divide-border">
          {offeringWaves.map((w) => {
            const v = w.offering_versions as { version: string } | null;
            return (
              <li
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <div>
                  <p className="text-[13px] font-medium">
                    {w.name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">→ v{v?.version}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(w.environment_ids ?? []).length} install(s) · created {relative(w.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill
                    tone={
                      w.status === "completed"
                        ? "success"
                        : w.status === "in_progress"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {w.status === "in_progress"
                      ? "In progress"
                      : w.status === "planned"
                        ? "Planned"
                        : "Completed"}
                  </Pill>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={w.status !== "planned" || start.isPending}
                    onClick={() => start.mutate({ data: { waveId: w.id } })}
                  >
                    {w.status === "planned" ? "Start ring" : "Started"}
                  </Button>
                </div>
              </li>
            );
          })}
          {!offeringWaves.length && (
            <li className="px-4 py-6 text-sm text-muted-foreground">
              No rollouts for this offering yet. Plan one from a published release above.
            </li>
          )}
        </ul>
      </section>
    </>
  );
}
