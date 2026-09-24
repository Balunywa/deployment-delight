import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, GitBranch, Lock, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ArchitectureCanvas } from "@/components/architecture/ArchitectureCanvas";
import { PipelineGraph } from "@/components/architecture/PipelineGraph";
import { CodeBlock } from "@/components/CodeBlock";
import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { EmptyState, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  type Architecture,
  LANDING_LABEL,
  fromManifest,
  semverBump,
  slugOf,
  toManifest,
} from "@/lib/architecture";
import { LANDING_ZONE_LABEL } from "@/lib/alz/engine";
import {
  CATEGORIES,
  CUSTOMER_PLATFORM,
  SERVICES,
  SERVICE_BY_ID,
  type Topology,
  inputsFor,
  monthlyEstimate,
  normalise,
  withDefaults,
} from "@/lib/catalog";
import {
  createOfferingVersion,
  draftBlueprintFromDescription,
  publishOfferingVersion,
  updateDraftVersion,
} from "@/lib/factory.functions";
import { semverCompare } from "@/lib/fleet";
import { currency, shortDate } from "@/lib/format";
import { bicepFor, pipelineFor, workflowFor } from "@/lib/pipeline";
import { verdict, reviewOffering, ENV_KEYS, ENV_META, type EnvKey } from "@/lib/onboarding";
import { foundationsQuery, offeringsQuery } from "@/lib/queries";
import {
  NewOfferingDialog,
  RegionPicker,
  ReviewPanel,
} from "@/components/onboarding/OfferingReview";
import { cn } from "@/lib/utils";

type View = "architecture" | "review" | "pipeline" | "iac" | "inputs" | "releases";

export const Route = createFileRoute("/offerings")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { offering?: string; view?: View; new?: boolean } => ({
    ...(typeof s["offering"] === "string" ? { offering: s["offering"] } : {}),
    ...(typeof s["view"] === "string" ? { view: s["view"] as View } : {}),
    ...(s["new"] === true || s["new"] === "true" ? { new: true } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Offerings · Cloud Delivery" },
      {
        name: "description",
        content:
          "Design each offering once: pick Azure services, see the architecture, and get the IaC, pipeline and customer inputs generated.",
      },
      { property: "og:title", content: "Offerings · Cloud Delivery" },
      {
        property: "og:description",
        content: "Architecture designer for productized Azure deployments.",
      },
    ],
  }),
  component: Designer,
});

type Version = {
  id: string;
  version: string;
  status: string;
  release_notes: string | null;
  published_at: string | null;
  manifest_json: unknown;
  ai_generated: boolean;
};

function Designer() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/offerings" });
  const offerings = useQuery(offeringsQuery);
  const foundations = useQuery(foundationsQuery);
  const hostingAnswers = (foundations.data ?? []).find((f) => !f.customer_id)?.answers ?? {};
  const list = offerings.data ?? [];
  const offering =
    list.find((o) => o.id === search.offering) ??
    list.find((o) => o.offering_type === "enterprise_private") ??
    list[0];
  const view: View = search.view ?? "architecture";

  const versions = useMemo(
    () =>
      ((offering?.offering_versions ?? []) as unknown as Version[])
        .slice()
        .sort((a, b) => semverCompare(b.version, a.version)),
    [offering],
  );
  const [versionId, setVersionId] = useState<string | null>(null);
  const base =
    versions.find((v) => v.id === versionId) ??
    versions.find((v) => v.status === "published") ??
    versions[0];

  const loaded = useMemo<Architecture | null>(
    () => (offering && base ? fromManifest(offering, base.manifest_json) : null),
    [offering, base],
  );
  const [arch, setArch] = useState<Architecture | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [flavour, setFlavour] = useState<"github-actions" | "azure-devops">("github-actions");

  useEffect(() => {
    setArch(loaded);
    setFocus(null);
  }, [loaded]);
  useEffect(() => setVersionId(null), [offering?.id]);

  const queryClient = useQueryClient();
  const publish = useMutation({
    mutationFn: useServerFn(publishOfferingVersion),
    onSuccess: (v: { version: string }) => {
      toast.success(`v${v.version} published. It is now immutable and available for onboarding.`);
      queryClient.invalidateQueries({ queryKey: ["offerings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (offerings.isLoading || !arch || !offering || !base)
    return <EmptyState title="Loading offerings…" />;

  const slug = slugOf(offering.name);
  const dirty = JSON.stringify(arch) !== JSON.stringify(loaded);
  const editable = base.status === "draft";
  const topology = arch.topology;
  const selected = arch.selected;
  const set = (next: Partial<Architecture>) => {
    const t = next.topology ?? topology;
    setArch({ topology: t, selected: normalise(next.selected ?? selected, t) });
  };
  const toggle = (id: string) => {
    const def = SERVICE_BY_ID.get(id);
    if (!def || def.locked) return;
    if (selected.some((s) => s.id === id)) {
      set({ selected: selected.filter((s) => s.id !== id) });
      if (focus === id) setFocus(null);
    } else {
      set({ selected: [...selected, withDefaults(id)] });
      setFocus(id);
    }
  };

  const stages = pipelineFor(selected, topology);
  const inputs = inputsFor(selected, topology);
  const monthly = monthlyEstimate(selected);
  const privateCount = selected.filter((s) => SERVICE_BY_ID.get(s.id)?.privateLink).length;
  const maxVersion = versions[0]?.version ?? "1.0.0";
  const review = reviewOffering({ selected, topology, hostingAnswers });
  const reviewState = verdict(review);
  const templates = list.flatMap((o) => {
    const v = ((o.offering_versions ?? []) as unknown as Version[])
      .filter((x) => x.status === "published")
      .sort((a, b) => semverCompare(b.version, a.version))[0];
    return v ? [{ id: o.id, name: o.name, arch: fromManifest(o, v.manifest_json) }] : [];
  });

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-49px)] flex-col lg:-mx-8">
      {/* Resource header */}
      <div className="border-b border-border bg-card px-4 pt-4 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {(offering.products as { name?: string } | null)?.name ?? "Product"} / Offerings
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold">{offering.name}</h1>
              <Select value={base.id} onValueChange={setVersionId}>
                <SelectTrigger className="h-7 w-auto gap-2 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="font-mono text-xs">
                      v{v.version} · {v.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Pill
                tone={
                  base.status === "published"
                    ? "success"
                    : base.status === "draft"
                      ? "warning"
                      : "neutral"
                }
              >
                {base.status === "published" ? <Lock className="size-3" /> : null}
                {base.status === "published" ? "Published · immutable" : base.status}
              </Pill>
              {base.ai_generated && <Pill tone="warning">AI draft — review required</Pill>}
              {dirty && <Pill tone="info">Unsaved changes</Pill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate({ search: (s) => ({ ...s, new: true }) })}
            >
              <Plus className="size-3.5" /> New offering
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIntakeOpen(true)}>
              <Sparkles className="size-3.5" /> Describe architecture
            </Button>
            <Button size="sm" variant="outline" disabled={!dirty} onClick={() => setArch(loaded)}>
              Discard
            </Button>
            <Button
              size="sm"
              variant={editable && !dirty ? "outline" : "default"}
              disabled={!dirty}
              onClick={() => setSaveOpen(true)}
            >
              {editable ? "Save draft" : `Save as v${semverBump(maxVersion)} draft`}
            </Button>
            {editable && (
              <Button
                size="sm"
                disabled={dirty || publish.isPending || reviewState === "fail"}
                title={
                  reviewState === "fail"
                    ? "Architecture review has failing checks"
                    : dirty
                      ? "Save the draft first"
                      : undefined
                }
                onClick={() => publish.mutate({ data: { versionId: base.id } })}
              >
                Publish v{base.version}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <nav className="-mb-px flex gap-4 text-[13px]">
            {(
              [
                ["architecture", "Architecture"],
                [
                  "review",
                  reviewState === "pass"
                    ? "Review ✓"
                    : reviewState === "warn"
                      ? "Review · warnings"
                      : `Review · ${review.filter((c) => c.level === "fail").length} failing`,
                ],
                ["pipeline", "Pipeline"],
                ["iac", "Infrastructure as code"],
                ["inputs", `Customer inputs · ${inputs.length}`],
                ["releases", `Releases · ${versions.length}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => navigate({ search: (s) => ({ ...s, view: id }) })}
                className={cn(
                  "border-b-2 pb-2 transition-colors",
                  view === id
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="-mb-px flex gap-1 pb-1.5">
            {list.map((o) => (
              <button
                key={o.id}
                onClick={() => navigate({ search: { offering: o.id, view } })}
                className={cn(
                  "rounded-sm px-2 py-1 text-xs transition-colors",
                  o.id === offering.id
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "architecture" && (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
          {/* Palette */}
          <aside className="border-b border-border bg-card lg:border-r lg:border-b-0">
            <div className="border-b border-border p-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Where it runs</p>
              <div className="space-y-1">
                {(Object.keys(LANDING_LABEL) as Topology["landing"][]).map((l) => (
                  <button
                    key={l}
                    onClick={() => set({ topology: { ...topology, landing: l } })}
                    title={LANDING_LABEL[l].body}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left text-[12px] transition-colors",
                      topology.landing === l
                        ? "border-primary bg-primary/5 font-medium"
                        : "border-transparent hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full border",
                        topology.landing === l
                          ? "border-primary bg-primary"
                          : "border-border-strong",
                      )}
                    />
                    {LANDING_LABEL[l].title}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3">
              <div className="relative mb-2">
                <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search Azure services"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <div className="max-h-[calc(100vh-330px)] space-y-3 overflow-y-auto pr-1">
                {CATEGORIES.map((cat) => {
                  const items = SERVICES.filter(
                    (s) =>
                      s.category === cat &&
                      s.id !== "private-endpoints" &&
                      `${s.name} ${s.short}`.toLowerCase().includes(q.toLowerCase()),
                  );
                  if (!items.length) return null;
                  return (
                    <div key={cat}>
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{cat}</p>
                      {items.map((s) => {
                        const on = selected.some((x) => x.id === s.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => (on ? setFocus(s.id) : toggle(s.id))}
                            title={s.blurb}
                            className="group flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-muted"
                          >
                            <ServiceIcon id={s.id} size="sm" />
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate text-[12px]",
                                on && "font-medium",
                              )}
                            >
                              {s.name}
                            </span>
                            {s.locked ? (
                              <Lock className="size-3 text-muted-foreground/60" />
                            ) : on ? (
                              <Check className="size-3.5 text-success" />
                            ) : (
                              <Plus className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Canvas */}
          <section className="flex min-w-0 flex-col p-4">
            <ArchitectureCanvas
              selected={selected}
              topology={topology}
              focus={focus}
              onFocus={setFocus}
              onRemove={toggle}
              installName={`${offering.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-{customer}`}
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                <b className="font-medium text-foreground">{selected.length}</b> resources
              </span>
              <span>
                <b className="font-medium text-foreground">{privateCount}</b> private endpoints
              </span>
              <span>
                <b className="font-medium text-foreground">{inputs.length}</b> customer inputs
              </span>
              <span>
                <b className="font-medium text-foreground">{stages.length}</b> pipeline stages ·{" "}
                {stages.reduce((n, s) => n + s.jobs.length, 0)} jobs
              </span>
              <span className="ml-auto">
                ≈ <b className="font-medium text-foreground">{currency(monthly)}</b> / month per
                production install (list-price estimate)
              </span>
            </div>
          </section>

          {/* Inspector */}
          <aside className="border-t border-border bg-card lg:border-t-0 lg:border-l">
            <Inspector arch={arch} focus={focus} onChange={set} onToggle={toggle} />
          </aside>
        </div>
      )}

      {view === "review" && (
        <ReviewPanel
          arch={arch}
          hostingAnswers={hostingAnswers}
          version={base.version}
          status={base.status}
        />
      )}

      <NewOfferingDialog
        open={!!search.new}
        onOpenChange={(v) =>
          !v &&
          navigate({
            search: ({ new: _n, ...rest }) => rest,
          })
        }
        templates={templates}
        hostingAnswers={hostingAnswers}
        onCreated={(id) => navigate({ search: { offering: id, view: "review" } })}
      />

      {view === "pipeline" && (
        <div className="space-y-4 p-4 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Delivery pipeline</h2>
              <p className="text-xs text-muted-foreground">
                Generated from the architecture. Every customer install runs this same pipeline —
                only parameters differ.
              </p>
            </div>
            <div className="flex rounded-sm border border-border p-0.5 text-xs">
              {(["github-actions", "azure-devops"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFlavour(f)}
                  className={cn(
                    "rounded-sm px-2 py-1",
                    flavour === f
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {f === "github-actions" ? "GitHub Actions" : "Azure DevOps"}
                </button>
              ))}
            </div>
          </div>
          <PipelineGraph stages={stages} />
          <CodeBlock
            title={
              flavour === "github-actions"
                ? `.github/workflows/deliver-${slug}.yml`
                : `azure-pipelines/deliver-${slug}.yml`
            }
            code={workflowFor(slug, selected, topology, flavour)}
          />
        </div>
      )}

      {view === "iac" && (
        <div className="space-y-3 p-4 lg:p-6">
          <div>
            <h2 className="text-sm font-semibold">Infrastructure as code</h2>
            <p className="text-xs text-muted-foreground">
              One Bicep entry point composed from Azure Verified Modules. Customer differences are
              parameters — no per-customer repository.
            </p>
          </div>
          <CodeBlock
            title={`offerings/${slug}/main.bicep`}
            code={bicepFor(slug, selected, topology)}
          />
        </div>
      )}

      {view === "inputs" && (
        <div className="space-y-3 p-4 lg:p-6">
          <div>
            <h2 className="text-sm font-semibold">What onboarding asks each customer</h2>
            <p className="text-xs text-muted-foreground">
              Derived from the architecture. Customer-owned values are collected through the
              customer's install link and discovered where possible.
            </p>
          </div>
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Parameter</th>
                  <th>Supplied by</th>
                  <th>Introduced by</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((i) => (
                  <tr key={i.key}>
                    <td className="font-medium">{i.label}</td>
                    <td className="font-mono text-xs">{i.key}</td>
                    <td>
                      <Pill tone={i.source === "customer" ? "info" : "neutral"}>
                        {i.source === "customer" ? "Customer admin" : "Your team"}
                      </Pill>
                    </td>
                    <td className="text-muted-foreground">{i.from}</td>
                    <td className="text-xs text-muted-foreground">{i.help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "releases" && (
        <Releases
          versions={versions}
          offering={offering}
          onOpen={(id) => {
            setVersionId(id);
            navigate({ search: (s) => ({ ...s, view: "architecture" }) });
          }}
        />
      )}

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        offeringId={offering.id}
        base={base}
        nextVersion={editable ? base.version : semverBump(maxVersion)}
        manifest={toManifest(slug, editable ? base.version : semverBump(maxVersion), arch, {
          repository: "github.com/gridworks/grid-analytics-infra",
          path: `offerings/${slug}`,
          iac: "bicep",
          pipeline: flavour,
        })}
        onSaved={(id) => setVersionId(id)}
      />
      <IntakeDialog
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        offering={offering}
        onApply={(m) => {
          setArch(fromManifest(offering, m));
          navigate({ search: (s) => ({ ...s, view: "architecture" }) });
        }}
      />
    </div>
  );
}

function Inspector({
  arch,
  focus,
  onChange,
  onToggle,
}: {
  arch: Architecture;
  focus: string | null;
  onChange: (a: Partial<Architecture>) => void;
  onToggle: (id: string) => void;
}) {
  const { topology, selected } = arch;
  const def = focus ? SERVICE_BY_ID.get(focus) : undefined;
  const platform = CUSTOMER_PLATFORM.find((p) => p.id === focus);
  const current = selected.find((s) => s.id === focus);

  if (platform) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <ServiceIcon id={platform.id} size="lg" />
          <div>
            <p className="text-sm font-semibold">{platform.name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{platform.type}</p>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Owned by the customer's platform team. Your product consumes it — it is never created,
          modified or replaced.
        </p>
        <KV k="Bound through input" v={platform.input} mono />
        <KV k="Resolved" v="Discovered from the customer's install link" />
      </div>
    );
  }

  if (def && current) {
    const inputs = def.inputs ?? [];
    return (
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <ServiceIcon id={def.id} size="lg" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{def.name}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {def.resourceType}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">{def.blurb}</p>

        {def.options.length > 0 && (
          <div className="mt-4 space-y-3">
            {def.options.map((o) => (
              <div key={o.key}>
                <Label className="text-xs">{o.label}</Label>
                <Select
                  value={current.settings[o.key] ?? o.default}
                  onValueChange={(v) =>
                    onChange({
                      selected: selected.map((s) =>
                        s.id === def.id ? { ...s, settings: { ...s.settings, [o.key]: v } } : s,
                      ),
                    })
                  }
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {o.choices.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-0 border-t border-border pt-3">
          <KV k="Module" v={`br/public:${def.avm}:${def.version}`} mono />
          <KV
            k="Pipeline"
            v={def.id === "security-baseline" ? "Verify stage" : `Deploy wave ${def.wave}`}
          />
          <KV
            k="Network access"
            v={
              def.privateLink
                ? topology.privateEndpoints
                  ? "Private endpoint only"
                  : "Public (exception)"
                : "—"
            }
          />
          <KV k="Est. monthly" v={def.monthly ? currency(def.monthly) : "Included"} />
        </div>

        {inputs.length > 0 && (
          <div className="mt-3 rounded-sm border border-border bg-muted/40 p-2.5">
            <p className="text-[11px] font-medium">Adds to onboarding</p>
            {inputs.map((i) => (
              <p key={i.key} className="mt-1 text-xs text-muted-foreground">
                {i.label} · <span className="font-mono">{i.key}</span> (
                {i.source === "customer" ? "customer" : "your team"})
              </p>
            ))}
          </div>
        )}

        {def.locked ? (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" /> Required by your architecture policy
          </p>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-4 w-full"
            onClick={() => onToggle(def.id)}
          >
            Remove from architecture
          </Button>
        )}
      </div>
    );
  }

  const inputs = inputsFor(selected, topology);
  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-sm font-semibold">Architecture settings</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Select a resource on the canvas to configure it.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Guardrails</p>
        <ToggleRow
          label="Private endpoints for data services"
          checked={topology.privateEndpoints}
          onChange={(v) => onChange({ topology: { ...topology, privateEndpoints: v } })}
        />
        <ToggleRow
          label="Allow public network access"
          checked={topology.publicAccess}
          onChange={(v) => onChange({ topology: { ...topology, publicAccess: v } })}
          warn={topology.publicAccess}
        />
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" /> Managed identity, diagnostics and the policy pack are always
          on
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Landing zone</p>
        <div className="grid grid-cols-2 gap-1">
          {(["corp", "online", "local", "sandbox"] as const).map((lz) => (
            <button
              key={lz}
              onClick={() => onChange({ topology: { ...topology, landingZone: lz } })}
              title={LANDING_ZONE_LABEL[lz]?.body}
              className={cn(
                "rounded-sm border px-2 py-1 text-left text-[12px] transition-colors",
                topology.landingZone === lz
                  ? "border-primary bg-primary/5 font-medium"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {LANDING_ZONE_LABEL[lz]?.title}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {LANDING_ZONE_LABEL[topology.landingZone]?.body} Installs are placed under this management
          group of the{" "}
          <Link to="/foundations" className="text-primary hover:underline">
            platform landing zone
          </Link>
          .
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Supported regions</p>
        <RegionPicker
          selected={selected}
          value={topology.regions}
          onChange={(regions) => regions.length && onChange({ topology: { ...topology, regions } })}
        />
      </div>
      <ChipGroup
        label="Environments per customer"
        values={[...ENV_KEYS]}
        labels={Object.fromEntries(ENV_KEYS.map((e) => [e, ENV_META[e as EnvKey].label]))}
        selected={topology.environments}
        onChange={(environments) =>
          environments.length && onChange({ topology: { ...topology, environments } })
        }
      />

      <div className="rounded-sm border border-border bg-muted/40 p-2.5 text-xs">
        <p className="font-medium">{LANDING_LABEL[topology.landing].title}</p>
        <p className="mt-0.5 text-muted-foreground">{LANDING_LABEL[topology.landing].body}</p>
        <p className="mt-2 text-muted-foreground">
          Onboarding will ask each customer for <b className="text-foreground">{inputs.length}</b>{" "}
          values —{" "}
          {
            inputs.filter((i) => i.from === "Customer platform" || i.key === "subscriptionId")
              .length
          }{" "}
          discovered automatically.
        </p>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  warn,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  warn?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-2 rounded-sm border px-2.5 py-1.5 text-xs",
        warn ? "border-warning/50 bg-warning/5" : "border-border",
      )}
    >
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ChipGroup({
  label,
  values,
  labels,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  labels?: Record<string, string>;
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              onClick={() => onChange(on ? selected.filter((x) => x !== v) : [...selected, v])}
              className={cn(
                "rounded-sm border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
                on
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {labels?.[v] ?? v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("truncate text-right", mono && "font-mono text-[11px]")} title={v}>
        {v}
      </span>
    </div>
  );
}

function Releases({
  versions,
  offering,
  onOpen,
}: {
  versions: Version[];
  offering: { name: string; network_profile: string | null };
  onOpen: (id: string) => void;
}) {
  return (
    <div className="p-4 lg:p-6">
      <ol className="relative space-y-3 border-l border-border pl-5">
        {versions.map((v, i) => {
          const prev = versions[i + 1];
          const now = fromManifest(offering, v.manifest_json).selected;
          const before = prev ? fromManifest(offering, prev.manifest_json).selected : [];
          const beforeIds = new Set(before.map((s) => s.id));
          const nowIds = new Set(now.map((s) => s.id));
          const added = now.filter((s) => !beforeIds.has(s.id));
          const removed = before.filter((s) => !nowIds.has(s.id));
          const moduleDiff = (() => {
            const m = (x: unknown) =>
              new Map(
                ((x as { modules?: { name: string; version: string }[] })?.modules ?? []).map(
                  (mm) => [mm.name, mm.version],
                ),
              );
            const a = m(prev?.manifest_json);
            return [...m(v.manifest_json).entries()]
              .filter(([n, ver]) => a.has(n) && a.get(n) !== ver)
              .map(([n, ver]) => `${n} ${a.get(n)} → ${ver}`);
          })();
          return (
            <li key={v.id} className="relative rounded-md border border-border bg-card p-3">
              <span
                className={cn(
                  "absolute top-4 -left-[26px] size-2.5 rounded-full ring-4 ring-background",
                  v.status === "published"
                    ? "bg-success"
                    : v.status === "draft"
                      ? "bg-warning"
                      : "bg-muted-foreground",
                )}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  <span className="font-mono text-sm font-semibold">v{v.version}</span>
                  <Pill
                    tone={
                      v.status === "published"
                        ? "success"
                        : v.status === "draft"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {v.status}
                  </Pill>
                  <span className="text-xs text-muted-foreground">
                    {v.published_at ? `Published ${shortDate(v.published_at)}` : "Not published"}
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => onOpen(v.id)}>
                  Open in designer
                </Button>
              </div>
              {v.release_notes && (
                <p className="mt-2 text-[13px] text-muted-foreground">{v.release_notes}</p>
              )}
              {(added.length > 0 || removed.length > 0 || moduleDiff.length > 0) && prev && (
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]">
                  {added.map((s) => (
                    <span
                      key={s.id}
                      className="rounded-sm bg-success/10 px-1.5 py-0.5 text-success"
                    >
                      + {s.id}
                    </span>
                  ))}
                  {removed.map((s) => (
                    <span key={s.id} className="rounded-sm bg-danger/10 px-1.5 py-0.5 text-danger">
                      − {s.id}
                    </span>
                  ))}
                  {moduleDiff.map((d) => (
                    <span key={d} className="rounded-sm bg-info/10 px-1.5 py-0.5 text-info">
                      ~ {d}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SaveDialog({
  open,
  onClose,
  offeringId,
  base,
  nextVersion,
  manifest,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  offeringId: string;
  base: Version;
  nextVersion: string;
  manifest: ReturnType<typeof toManifest>;
  onSaved: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const done = (v: { id: string; version: string }) => {
    toast.success(`Draft v${v.version} saved. Publish it when it's ready to onboard customers.`);
    queryClient.invalidateQueries({ queryKey: ["offerings"] });
    onSaved(v.id);
    onClose();
  };
  const create = useMutation({
    mutationFn: useServerFn(createOfferingVersion),
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: useServerFn(updateDraftVersion),
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });
  const isDraft = base.status === "draft";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isDraft ? `Save draft v${nextVersion}` : `Create draft v${nextVersion}`}
          </DialogTitle>
          <DialogDescription>
            {isDraft
              ? "Updates the draft in place. Nothing reaches customers until it is published and rolled out."
              : `v${base.version} is published and immutable, so your changes become a new draft release.`}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Release notes</Label>
          <Textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 text-sm"
            placeholder="What changed and why"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || update.isPending}
            onClick={() =>
              isDraft
                ? update.mutate({
                    data: {
                      versionId: base.id,
                      manifestJson: JSON.stringify(manifest),
                      ...(notes ? { releaseNotes: notes } : {}),
                    },
                  })
                : create.mutate({
                    data: {
                      offeringId,
                      manifestJson: JSON.stringify(manifest),
                      ...(notes ? { releaseNotes: notes } : {}),
                    },
                  })
            }
          >
            {create.isPending || update.isPending ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IntakeDialog({
  open,
  onClose,
  offering,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  offering: { id: string; name: string };
  onApply: (manifest: Record<string, unknown>) => void;
}) {
  const [description, setDescription] = useState(
    "Our application runs on AKS and PostgreSQL. Customers need dedicated subscriptions. All services must be private. AKS connects to PostgreSQL using managed identity. We need Event Hubs Premium for telemetry. Logs should go to the customer's existing Log Analytics workspace. We support East US 2 and Central US. Production needs zone redundancy. Customers should be able to use their existing hub network.",
  );
  const [issues, setIssues] = useState<{ level: string; message: string }[] | null>(null);
  const generate = useMutation({
    mutationFn: useServerFn(draftBlueprintFromDescription),
    onSuccess: (r: {
      manifestJson: string;
      validation: { schema: string; issues: string[] };
      policyIssues: { level: string; message: string }[];
    }) => {
      const all = [
        ...r.validation.issues.map((m) => ({ level: "BLOCKING", message: m })),
        ...r.policyIssues,
      ];
      setIssues(all);
      onApply(JSON.parse(r.manifestJson) as Record<string, unknown>);
      toast.info(
        "AI draft placed on the canvas. Review every resource, then save it as a draft release.",
      );
      if (!all.some((i) => i.level === "BLOCKING")) onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Describe the {offering.name} architecture</DialogTitle>
          <DialogDescription>
            The assistant drafts the architecture onto the canvas. Deterministic schema and policy
            validation run next, and a human saves and publishes. The assistant never touches Azure.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={8}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="text-sm"
        />
        {issues && issues.length > 0 && (
          <ul className="space-y-1 rounded-sm border border-border p-2.5 text-xs">
            {issues.map((i) => (
              <li
                key={i.message}
                className={i.level === "BLOCKING" ? "text-danger" : "text-warning"}
              >
                {i.level === "BLOCKING" ? "Blocking" : "Warning"} · {i.message}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={generate.isPending || description.trim().length < 30}
            onClick={() => generate.mutate({ data: { description, offeringId: offering.id } })}
          >
            <Sparkles className="size-4" />
            {generate.isPending ? "Drafting…" : "Draft onto canvas"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
