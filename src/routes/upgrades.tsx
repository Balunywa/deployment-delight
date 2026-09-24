import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  GitBranch,
  Loader2,
  Minus,
  PenLine,
  Plus,
  Rocket,
  Search,
  Tag,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fromManifest } from "@/lib/architecture";
import { SERVICE_BY_ID } from "@/lib/catalog";
import { createRollout, planUpgrades, startWave } from "@/lib/factory.functions";
import { releaseLabel, semverCompare } from "@/lib/fleet";
import { relative, shortDate } from "@/lib/format";
import { ENV_META, type EnvKey } from "@/lib/onboarding";
import { BUSINESS_LINES, modelOf, productOf } from "@/lib/product-catalog";
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
  created_at?: string | null;
  created_by?: string | null;
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
  { name: "Ring 0 · internal test", hint: "Soak before anyone else" },
  { name: "Ring 1 · pilot customers", hint: "Opt-in early adopters" },
  { name: "Ring 2 · broad", hint: "Most of the base" },
  { name: "Ring 3 · remaining", hint: "Everyone else" },
];
// Version colors for the adoption bar, newest first.
const SWATCH = ["#1a7f37", "#0969da", "#8250df", "#bf8700", "#cf222e", "#57606a"];

const modules = (m: unknown) =>
  new Map(
    ((m as { modules?: { name: string; version: string }[] })?.modules ?? []).map((x) => [
      x.name,
      x.version,
    ]),
  );
const moduleName = (id: string) => SERVICE_BY_ID.get(id)?.name ?? id;

function Releases() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { offerings, installs, releases } = useFleet();
  const waves = useQuery(wavesQuery);
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<Version | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

  const offering =
    offerings.find((o) => o.id === search.offering) ??
    offerings
      .filter((o) => o.offering_type === "enterprise_private")
      .sort((a, b) => (b.environments ?? []).length - (a.environments ?? []).length)[0] ??
    offerings[0];

  const versions = useMemo(
    () =>
      ((offering?.offering_versions ?? []) as unknown as Version[])
        .slice()
        .sort((a, b) => semverCompare(b.version, a.version)),
    [offering],
  );
  const preferred = offering ? releases.get(offering.id)?.preferred : undefined;
  const mine = installs.filter((i) => i.offeringId === offering?.id);
  const live = mine.filter((i) => i.actual);

  const plan = useMutation({
    mutationFn: useServerFn(planUpgrades),
    onSuccess: (r: PlanResult) => setResult(r),
    onError: (e: Error) => toast.error(e.message),
  });
  const rollout = useMutation({
    mutationFn: useServerFn(createRollout),
    onSuccess: () => {
      toast.success("Rollout created. Start Ring 0 when you're ready.");
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

  const latest = versions.find((v) => v.version === preferred);
  const behind = live.filter((i) => i.actual !== preferred);
  const offeringWaves = (waves.data ?? []).filter((w) =>
    versions.some((v) => v.id === w.offering_version_id),
  );
  const rolloutsByVersion = [...new Set(offeringWaves.map((w) => w.offering_version_id))].map(
    (vid) => ({
      version: versions.find((v) => v.id === vid)!,
      waves: offeringWaves
        .filter((w) => w.offering_version_id === vid)
        .sort((a, b) => a.sequence - b.sequence),
    }),
  );
  const activeRollouts = rolloutsByVersion.filter((r) =>
    r.waves.some((w) => w.status !== "completed"),
  ).length;
  const planFor = (v: Version) => {
    setTarget(v);
    plan.mutate({ data: { offeringVersionId: v.id } });
  };
  const productName = productOf(offering.name) || offering.products?.name || offering.name;

  return (
    <div className="-mx-4 -my-6 grid min-h-[calc(100vh-49px)] lg:-mx-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <PipelineList
        offerings={offerings}
        installs={installs}
        releases={releases}
        selected={offering.id}
        q={q}
        onQ={setQ}
        onSelect={(id) => {
          setResult(null);
          setTarget(null);
          void navigate({ search: { offering: id } });
        }}
      />

      <main className="min-w-0 space-y-5 p-4 lg:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Releases / {offering.products?.category ?? "Products"}
            </p>
            <h1 className="mt-0.5 text-[22px] font-semibold">
              {productName}
              <span className="font-normal text-muted-foreground"> · {modelOf(offering.name)}</span>
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every release is immutable. Roll it out ring by ring — each install gets a plan that
              needs approval, so nothing upgrades silently.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/offerings" search={{ offering: offering.id }}>
                <PenLine className="size-3.5" /> Draft a new release
              </Link>
            </Button>
            {latest && (
              <Button size="sm" disabled={plan.isPending} onClick={() => planFor(latest)}>
                <Rocket className="size-3.5" /> Roll out v{latest.version}
              </Button>
            )}
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="Latest release"
            value={latest ? `v${latest.version}` : "—"}
            hint={
              latest?.published_at
                ? `Published ${shortDate(latest.published_at)}`
                : "Nothing published"
            }
          />
          <Stat
            label="On latest"
            value={`${live.length - behind.length} / ${live.length}`}
            hint={
              live.length
                ? `${Math.round(((live.length - behind.length) / live.length) * 100)}% of live installs`
                : "No live installs"
            }
            tone={behind.length ? "warning" : "success"}
          />
          <Stat
            label="Behind"
            value={String(behind.length)}
            hint={
              behind.length
                ? `on ${new Set(behind.map((b) => b.actual)).size} older release(s)`
                : "Everyone is current"
            }
            tone={behind.length ? "warning" : "success"}
          />
          <Stat
            label="Active rollouts"
            value={String(activeRollouts)}
            hint={`${rolloutsByVersion.length} rollout(s) in total`}
          />
        </div>

        <Adoption versions={versions} installs={live} />

        {target && (plan.isPending || result) && (
          <Planner
            productName={productName}
            model={modelOf(offering.name)}
            target={target}
            result={result}
            resources={fromManifest(offering, target.manifest_json).selected.length}
            creating={rollout.isPending}
            onCancel={() => {
              setTarget(null);
              setResult(null);
            }}
            onCreate={(ringIds) =>
              rollout.mutate({
                data: {
                  offeringVersionId: target.id,
                  waves: ringIds
                    .map((ids, i) => ({ name: RINGS[i]!.name, environmentIds: ids }))
                    .filter((w) => w.environmentIds.length),
                },
              })
            }
          />
        )}

        {rolloutsByVersion.length > 0 && (
          <section className="overflow-hidden rounded-md border border-border bg-card">
            <header className="border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Rollouts</h2>
            </header>
            <ul className="divide-y divide-border">
              {rolloutsByVersion.map((r) => (
                <li key={r.version.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                  <div className="w-36 shrink-0">
                    <p className="font-mono text-[13px] font-semibold">v{r.version.version}</p>
                    <p className="text-[11px] text-muted-foreground">
                      created {relative(r.waves[0]!.created_at)}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-y-2">
                    {r.waves.map((w, i) => {
                      const ids = (w.environment_ids ?? []) as string[];
                      const done = mine.filter(
                        (m) => ids.includes(m.id) && m.actual === r.version.version,
                      ).length;
                      const prevDone = i === 0 || r.waves[i - 1]!.status !== "planned";
                      return (
                        <Fragment key={w.id}>
                          {i > 0 && <span className="h-px w-5 bg-border-strong" />}
                          <div
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                              w.status === "completed"
                                ? "border-success/40 bg-success/5"
                                : w.status === "in_progress"
                                  ? "border-info/40 bg-info/5"
                                  : "border-border bg-background",
                            )}
                          >
                            {w.status === "completed" ? (
                              <CheckCircle2 className="size-3.5 text-success" />
                            ) : w.status === "in_progress" ? (
                              <Loader2 className="size-3.5 animate-spin text-info" />
                            ) : (
                              <Circle className="size-3.5 text-muted-foreground/60" />
                            )}
                            <span className="text-[12px] font-medium">
                              {w.name.split(" · ")[0]}
                            </span>
                            <span className="font-mono text-[10.5px] text-muted-foreground">
                              {done}/{ids.length}
                            </span>
                            {w.status === "planned" && (
                              <button
                                disabled={!prevDone || start.isPending}
                                onClick={() => start.mutate({ data: { waveId: w.id } })}
                                className="rounded-sm bg-primary px-1.5 py-0.5 text-[10.5px] font-medium text-primary-foreground disabled:opacity-40"
                                title={
                                  prevDone
                                    ? "Create plans for this ring"
                                    : "Start the previous ring first"
                                }
                              >
                                Start
                              </button>
                            )}
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-[13px] font-semibold">
            Releases <span className="font-normal text-muted-foreground">· {versions.length}</span>
          </h2>
          <ol className="space-y-4">
            {versions.map((v, i) => (
              <ReleaseItem
                key={v.id}
                v={v}
                prev={versions[i + 1]}
                tone={releaseLabel(v.version, v.status, preferred)}
                installs={mine.filter((x) => x.actual === v.version)}
                offeringId={offering.id}
                planning={plan.isPending && target?.id === v.id}
                onPlan={() => planFor(v)}
              />
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

type FleetData = ReturnType<typeof useFleet>;

function PipelineList({
  offerings,
  installs,
  releases,
  selected,
  q,
  onQ,
  onSelect,
}: {
  offerings: FleetData["offerings"];
  installs: FleetData["installs"];
  releases: FleetData["releases"];
  selected: string;
  q: string;
  onQ: (v: string) => void;
  onSelect: (id: string) => void;
}) {
  const match = (o: (typeof offerings)[number]) => o.name.toLowerCase().includes(q.toLowerCase());
  const active = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const lines = [
    ...BUSINESS_LINES.map((l) => l.name),
    ...new Set(offerings.map((o) => o.products?.category ?? "Other")),
  ].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <aside className="border-b border-border bg-card lg:sticky lg:top-[49px] lg:h-[calc(100vh-49px)] lg:overflow-y-auto lg:border-r lg:border-b-0">
      <div className="border-b border-border p-3">
        <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Release pipelines
        </p>
        <div className="relative">
          <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Filter products"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>
      <nav className="p-2">
        {lines.map((line) => {
          const inLine = offerings.filter(
            (o) => (o.products?.category ?? "Other") === line && match(o),
          );
          if (!inLine.length) return null;
          const products = [
            ...new Set(inLine.map((o) => productOf(o.name) || o.products?.name || "")),
          ];
          return (
            <div key={line} className="mb-3">
              <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                {line}
              </p>
              {products.map((p) => (
                <div key={p} className="mb-1">
                  <p className="truncate px-2 pt-1 text-[12px] font-medium">{p}</p>
                  {inLine
                    .filter((o) => (productOf(o.name) || o.products?.name) === p)
                    .map((o) => {
                      const pref = releases.get(o.id)?.preferred;
                      const liveHere = installs.filter((i) => i.offeringId === o.id && i.actual);
                      const behind = liveHere.filter((i) => i.actual !== pref).length;
                      return (
                        <button
                          key={o.id}
                          ref={o.id === selected ? active : undefined}
                          onClick={() => onSelect(o.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-sm py-1 pr-2 pl-4 text-left text-[12px] transition-colors",
                            o.id === selected
                              ? "bg-accent font-medium text-accent-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <GitBranch className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{modelOf(o.name)}</span>
                          <span className="font-mono text-[10px]">{pref ? `v${pref}` : "—"}</span>
                          {behind > 0 && (
                            <span
                              className="rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning"
                              title={`${behind} install(s) behind`}
                            >
                              {behind}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "warning";
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3.5 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-mono text-[20px] font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Adoption({
  versions,
  installs,
}: {
  versions: Version[];
  installs: FleetData["installs"];
}) {
  const counts = versions
    .map((v, i) => ({
      v,
      n: installs.filter((x) => x.actual === v.version).length,
      color: SWATCH[i % SWATCH.length]!,
    }))
    .filter((x) => x.n);
  const total = installs.length;
  if (!total) return null;
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Where the installed base is</h2>
        <p className="text-[11px] text-muted-foreground">{total} live installs</p>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
        {counts.map((c) => (
          <span
            key={c.v.id}
            style={{ width: `${(c.n / total) * 100}%`, background: c.color }}
            title={`v${c.v.version}: ${c.n}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        {counts.map((c) => (
          <span key={c.v.id} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: c.color }} />
            <span className="font-mono">v{c.v.version}</span>
            <span className="text-muted-foreground">
              {c.n} · {Math.round((c.n / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}

function ReleaseItem({
  v,
  prev,
  tone,
  installs,
  offeringId,
  planning,
  onPlan,
}: {
  v: Version;
  prev: Version | undefined;
  tone: ReturnType<typeof releaseLabel>;
  installs: FleetData["installs"];
  offeringId: string;
  planning: boolean;
  onPlan: () => void;
}) {
  const a = modules(prev?.manifest_json);
  const b = modules(v.manifest_json);
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const updated = [...b.entries()].filter(([k, ver]) => a.has(k) && a.get(k) !== ver);
  const draft = v.status === "draft";
  const byEnv = Object.entries(
    installs.reduce<Record<string, number>>((acc, i) => {
      acc[i.environmentType] = (acc[i.environmentType] ?? 0) + 1;
      return acc;
    }, {}),
  );
  const customers = [...new Set(installs.map((i) => i.customer.name))];
  return (
    <li className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
      <div className="pt-3 text-xs text-muted-foreground md:text-right">
        <p className="flex items-center gap-1 font-mono text-[13px] font-semibold text-foreground md:justify-end">
          <Tag className="size-3.5" /> v{v.version}
        </p>
        <p className="mt-1">
          {v.published_at ? shortDate(v.published_at) : draft ? "Not published" : "—"}
        </p>
        <p>{v.created_by ?? "Sarah Chen"}</p>
      </div>
      <article
        className={cn(
          "rounded-md border bg-card",
          draft ? "border-dashed border-border-strong" : "border-border",
          tone === "preferred" && "border-success/40",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-[16px] font-semibold">v{v.version}</h3>
            {tone === "preferred" ? (
              <Pill tone="success">Latest</Pill>
            ) : draft ? (
              <Pill tone="warning">Draft</Pill>
            ) : tone === "deprecated" ? (
              <Pill tone="danger">Deprecated</Pill>
            ) : (
              <Pill tone="neutral">Supported</Pill>
            )}
          </div>
          <div className="flex gap-2">
            {draft ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/offerings" search={{ offering: offeringId, view: "review" }}>
                  Review & publish
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/offerings" search={{ offering: offeringId }}>
                    Architecture
                  </Link>
                </Button>
                {tone !== "deprecated" && (
                  <Button
                    size="sm"
                    variant={tone === "preferred" ? "default" : "outline"}
                    disabled={planning}
                    onClick={onPlan}
                  >
                    {planning ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Rocket className="size-3.5" />
                    )}
                    Plan rollout
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="space-y-3 px-4 py-3">
          {v.release_notes && <p className="text-[13px] leading-relaxed">{v.release_notes}</p>}
          <div>
            <p className="mb-1 text-[12px] font-semibold">What's changed</p>
            {prev ? (
              added.length + removed.length + updated.length ? (
                <ul className="space-y-0.5 text-[12.5px]">
                  {added.map((k) => (
                    <li key={k} className="flex items-center gap-1.5">
                      <Plus className="size-3.5 text-success" /> Added{" "}
                      <b className="font-medium">{moduleName(k)}</b>
                    </li>
                  ))}
                  {removed.map((k) => (
                    <li key={k} className="flex items-center gap-1.5">
                      <Minus className="size-3.5 text-danger" /> Removed{" "}
                      <b className="font-medium">{moduleName(k)}</b>
                    </li>
                  ))}
                  {updated.map(([k, ver]) => (
                    <li key={k} className="flex items-center gap-1.5">
                      <ArrowRight className="size-3.5 text-info" />
                      <b className="font-medium">{moduleName(k)}</b>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {a.get(k)} → {ver}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">
                  Settings only — no module changes.
                </p>
              )
            ) : (
              <p className="text-[12.5px] text-muted-foreground">First release.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5 text-[12px]">
          <div className="flex items-center gap-2">
            {customers.length ? (
              <>
                <div className="flex -space-x-1.5">
                  {customers.slice(0, 6).map((c) => (
                    <span
                      key={c}
                      title={c}
                      className="grid size-6 place-items-center rounded-full border-2 border-card bg-accent text-[9px] font-semibold text-accent-foreground"
                    >
                      {c
                        .split(/\s+/)
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                  ))}
                </div>
                <span className="text-muted-foreground">
                  Running on {installs.length} install{installs.length === 1 ? "" : "s"} ·{" "}
                  {customers.length} customer{customers.length === 1 ? "" : "s"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {draft ? "Not released yet" : "No installs on this release"}
              </span>
            )}
          </div>
          {byEnv.length > 0 && (
            <div className="flex gap-1.5">
              {byEnv.map(([env, n]) => (
                <span
                  key={env}
                  className="rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px]"
                >
                  {ENV_META[env as EnvKey]?.short ?? env} {n}
                </span>
              ))}
            </div>
          )}
        </div>
      </article>
    </li>
  );
}

function Planner({
  productName,
  model,
  target,
  result,
  resources,
  creating,
  onCancel,
  onCreate,
}: {
  productName: string;
  model: string;
  target: Version;
  result: PlanResult | null;
  resources: number;
  creating: boolean;
  onCancel: () => void;
  onCreate: (rings: string[][]) => void;
}) {
  if (!result)
    return (
      <section className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm">
        <Loader2 className="size-4 animate-spin text-info" /> Checking every install against v
        {target.version}…
      </section>
    );
  const ids = result.compatible;
  const size = Math.max(1, Math.ceil(ids.length / 4));
  const rings = [
    ids.slice(0, 1),
    ids.slice(1, 1 + size),
    ids.slice(1 + size, 1 + size * 3),
    ids.slice(1 + size * 3),
  ];
  const name = (id: string) => {
    const e = result.environments.find((x) => x.id === id);
    return e ? `${e.customers?.name ?? "Customer"} · ${e.name}` : id.slice(0, 8);
  };
  return (
    <section className="rounded-md border border-primary/40 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">
            New rollout · {productName} {model} v{result.targetVersion}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {result.current.length} already current · {result.compatible.length} can upgrade ·{" "}
            {result.manualReview.length} need review · {resources} resources per install
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={creating || !ids.length} onClick={() => onCreate(rings)}>
            Create rollout
          </Button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto p-4">
        {rings.map((r, i) => (
          <Fragment key={i}>
            {i > 0 && <ArrowRight className="mt-6 size-4 shrink-0 text-muted-foreground" />}
            <div className="w-52 shrink-0 rounded-md border border-border bg-background p-2.5">
              <p className="text-[11.5px] font-semibold">{RINGS[i]!.name}</p>
              <p className="mb-2 text-[11px] text-muted-foreground">{RINGS[i]!.hint}</p>
              <ul className="space-y-1">
                {r.map((id) => (
                  <li
                    key={id}
                    className="truncate rounded-sm border border-border bg-card px-2 py-1 text-xs"
                  >
                    {name(id)}
                  </li>
                ))}
                {!r.length && <li className="text-xs text-muted-foreground">—</li>}
              </ul>
            </div>
          </Fragment>
        ))}
        <div className="w-60 shrink-0 rounded-md border border-dashed border-warning/50 bg-warning/5 p-2.5">
          <p className="text-[11.5px] font-semibold text-warning">Needs review · not in a ring</p>
          <ul className="mt-2 space-y-1.5">
            {result.manualReview.map((m) => (
              <li key={m.id} className="text-xs">
                <p className="truncate font-medium">{name(m.id)}</p>
                <p className="text-muted-foreground">{m.reason}</p>
              </li>
            ))}
            {!result.manualReview.length && <li className="text-xs text-muted-foreground">None</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
