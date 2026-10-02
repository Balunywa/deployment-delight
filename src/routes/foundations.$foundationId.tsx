import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  FileCode2,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tag,
  Waypoints,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { CodeBlock } from "@/components/CodeBlock";
import { AssessmentView, snapshotFor } from "@/components/lz/Assessment";
import { TrafficSimulator } from "@/components/lz/TrafficSimulator";
import { LandingZoneDesigner } from "@/components/lz/Designer";
import { GuidedDesign } from "@/components/lz/Guided";
import { TrafficStory } from "@/components/lz/traffic/TrafficStory";
import { alternativesFor } from "@/lib/alz/alternatives";
import { ChangeBar, ReviewView, StepBar } from "@/components/lz/Flow";
import { RealDeploy } from "@/components/lz/RealDeploy";
import { describeChanges } from "@/lib/alz/changes";
import { assess } from "@/lib/alz/assess";
import { UnitLink } from "@/components/delivery/UnitCard";
import { EmptyState, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type Answers,
  LANDING_ZONE_LABEL,
  LATEST_REF,
  LIBRARIES,
  MG_PURPOSE,
  type MgNode,
  diffLibraries,
  hierarchy,
  libraryFor,
  shortRef,
  terraformFor,
  vendingFor,
  withDefaults,
} from "@/lib/alz/engine";
import { type Placement, placements, placementsFor } from "@/lib/alz/placement";
import { sceneExtras, spokesFor } from "@/lib/alz/scene";
import { pinFoundationLibrary, saveFoundationAnswers } from "@/lib/factory.functions";
import { relative } from "@/lib/format";
import { customersQuery, foundationQuery, offeringsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type View =
  "design" | "assessment" | "review" | "policies" | "version" | "iac" | "deploy" | "traffic";

export const Route = createFileRoute("/foundations/$foundationId")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { view?: View; flow?: string; mode?: "guided" | "canvas"; lens?: "story" | "hops" } => {
    const v = s["view"];
    const flow = typeof s["flow"] === "string" ? { flow: s["flow"] } : {};
    const m = s["mode"];
    const mode: { mode?: "guided" | "canvas"; lens?: "story" | "hops" } =
      m === "guided" || m === "canvas" ? { mode: m } : {};
    if (s["lens"] === "story" || s["lens"] === "hops") mode.lens = s["lens"];
    if (v === "hierarchy" || v === "setup") return { view: "design", ...mode };
    return typeof v === "string" ? { view: v as View, ...flow, ...mode } : mode;
  },
  head: () => ({ meta: [{ title: "Landing zone · Cloud Delivery" }] }),
  component: FoundationDetail,
});

const TAB_ICON: Partial<Record<View, typeof Waypoints>> = {
  traffic: Waypoints,
  policies: ShieldCheck,
  version: Tag,
  iac: FileCode2,
};

function FoundationDetail() {
  const { foundationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const foundation = useQuery(foundationQuery(foundationId));
  const customers = useQuery(customersQuery);
  const offerings = useQuery(offeringsQuery);
  const f = foundation.data;
  const saved = useMemo(() => withDefaults(f?.answers), [f]);
  const [answers, setAnswers] = useState<Answers>(saved);
  const [compare, setCompare] = useState("");
  useEffect(() => setAnswers(saved), [saved]);
  const save = useMutation({
    mutationFn: useServerFn(saveFoundationAnswers),
    onSuccess: () => {
      toast.success("Design saved. Here's what it changes.");
      void navigate({ search: { view: "review" } });
      void queryClient.invalidateQueries({ queryKey: ["foundation", foundationId] });
      void queryClient.invalidateQueries({ queryKey: ["foundations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (foundation.isLoading) return <EmptyState title="Loading landing zone…" />;
  if (!f) return <EmptyState title="Landing zone not found." />;

  const managed = f.mode === "managed";
  const view: View = managed
    ? (search.view ?? "design")
    : search.view === "policies" || search.view === "design"
      ? search.view
      : "assessment";
  const lib = libraryFor(f.library_ref);
  // New landing zones start guided; deployed ones open on the canvas, where everything is visible at once.
  const mode = search.mode ?? (f.status === "draft" ? "guided" : "canvas");
  const lens = search.lens ?? (search.flow ? "hops" : "story");
  const current = managed ? answers : saved;
  const tree = hierarchy(lib, current);
  const placed = placementsFor(placements(customers.data ?? [], offerings.data ?? []), f);
  const dirty = JSON.stringify(answers) !== JSON.stringify(saved);
  const snapshot = snapshotFor(f, libraryFor(f.library_ref));
  const assessment = snapshot ? assess(snapshot, libraryFor(f.library_ref)) : null;
  const applied = (f as unknown as { deployment?: { appliedAnswers?: unknown } | null }).deployment
    ?.appliedAnswers;
  const deployedAnswers = applied ? withDefaults(applied) : null;
  const baselineUnknown = !applied && f.status !== "draft";
  const unsaved = describeChanges(saved, answers).length;
  const pending = deployedAnswers ? describeChanges(deployedAnswers, saved).length : 0;
  const stepStatus = {
    assessment: assessment
      ? { text: `${assessment.overall}% aligned`, tone: "success" as const }
      : { text: "Scan an existing tenant first", tone: "muted" as const },
    design: unsaved
      ? { text: `${unsaved} unsaved change${unsaved === 1 ? "" : "s"}`, tone: "warning" as const }
      : { text: "Saved", tone: "success" as const },
    review: baselineUnknown
      ? { text: "Compare with Azure in the plan", tone: "muted" as const }
      : !deployedAnswers
        ? { text: "Everything is new", tone: "muted" as const }
        : pending
          ? {
              text: `${pending} change${pending === 1 ? "" : "s"} to deploy`,
              tone: "warning" as const,
            }
          : { text: "Matches Azure", tone: "success" as const },
    deploy:
      f.status === "deployed"
        ? { text: "Deployed", tone: "success" as const }
        : f.status === "draft"
          ? { text: "Not deployed yet", tone: "muted" as const }
          : { text: "Changes to deploy", tone: "warning" as const },
  };
  // The one thing to do next, so the flow is obvious from anywhere on the page.
  const next: { label: string; run: () => void } | null = !managed
    ? null
    : dirty
      ? {
          label: "Save your changes",
          run: () => save.mutate({ data: { foundationId: f.id, answers } }),
        }
      : f.status !== "deployed" || pending > 0
        ? view === "review"
          ? {
              label: "Continue to deploy",
              run: () => void navigate({ search: { view: "deploy" } }),
            }
          : view === "deploy"
            ? null
            : {
                label: f.status === "draft" ? "Review, then deploy" : "Review changes",
                run: () => void navigate({ search: { view: "review" } }),
              }
        : f.library_ref !== LATEST_REF
          ? {
              label: `Upgrade to ALZ ${shortRef(LATEST_REF)}`,
              run: () => void navigate({ search: { view: "version" } }),
            }
          : null;
  const tabs: [View, string][] = managed
    ? [
        ["traffic", "Traffic flows"],
        ["policies", "Policies"],
        ["version", "ALZ version"],
        ["iac", "Terraform"],
      ]
    : [
        ["assessment", assessment ? `Assessment · ${assessment.overall}%` : "Assessment"],
        ["design", "Where your product lands"],
        ["policies", "Reference policies"],
      ];

  return (
    <div className="-mx-4 -my-6 lg:-mx-8">
      <div className="border-b border-border bg-gradient-to-b from-card to-muted/40 px-4 pt-4 lg:px-6">
        <p className="text-xs text-muted-foreground">
          <Link to="/foundations" className="hover:underline">
            Landing zones
          </Link>{" "}
          / {f.customers?.name ?? "Your hosting tenant"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">{f.name}</h1>
          {managed ? (
            <>
              <Pill tone="neutral">
                <span className="font-mono">ALZ {shortRef(f.library_ref)}</span>
              </Pill>
              <UnitLink link={{ foundationId: f.id }} />
              {f.deployed_ref && f.deployed_ref !== f.library_ref && (
                <Pill tone="warning">deployed {shortRef(f.deployed_ref)}</Pill>
              )}
              <Pill
                tone={
                  dirty
                    ? "warning"
                    : f.status === "deployed"
                      ? "success"
                      : f.status === "draft"
                        ? "neutral"
                        : "warning"
                }
              >
                {dirty
                  ? "Unsaved design changes"
                  : f.status === "deployed"
                    ? "Deployed"
                    : f.status === "draft"
                      ? "Not deployed yet"
                      : "Changes to deploy"}
              </Pill>
            </>
          ) : (
            <Pill tone="info">Customer-owned · read-only</Pill>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {managed
            ? `${tree.length} management groups under ${current.intermediateRootName || "the intermediate root"} · ${placed.length} customer install${placed.length === 1 ? "" : "s"} placed${f.last_deployed_at ? ` · last deployed ${relative(f.last_deployed_at)}` : ""}`
            : `Discovered from ${String((f.discovered as Record<string, unknown>)?.["source"] ?? "Azure Resource Graph")} · follows the ALZ reference architecture · owned by ${f.customers?.name}'s platform team`}
        </p>
        {managed && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <StepBar
                view={view}
                onGo={(v) => void navigate({ search: { view: v } })}
                status={stepStatus}
              />
              {next ? (
                <Button size="sm" disabled={save.isPending} onClick={next.run}>
                  Next: {next.label} <ArrowRight className="size-3.5" />
                </Button>
              ) : (
                f.status === "deployed" &&
                !dirty && <span className="text-[12px] text-success">Up to date with Azure</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 text-[12.5px] shadow-sm">
              {tabs.map(([id, label]) => {
                const Icon = TAB_ICON[id];
                return (
                  <button
                    key={id}
                    onClick={() => navigate({ search: { view: id } })}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors",
                      view === id
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                  >
                    {Icon && <Icon className="size-3.5" aria-hidden />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <nav className={cn("mt-3 -mb-px flex gap-4 text-[13px]", managed && "hidden")}>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => navigate({ search: { view: id } })}
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
      </div>

      <div className="p-4 lg:p-6">
        {view === "design" && managed && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Design mode"
              className="inline-flex rounded-lg border border-border bg-card p-1 text-[12.5px] shadow-sm"
            >
              {(
                [
                  ["guided", "Guided", "Decide step by step"],
                  ["canvas", "Canvas", "See and edit everything"],
                ] as const
              ).map(([m, label, hint]) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  title={hint}
                  onClick={() => void navigate({ search: { view: "design", mode: m } })}
                  className={cn(
                    "rounded-md px-3 py-1.5 transition-colors",
                    mode === m
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[12px] text-muted-foreground">
              Both edit the same design. Nothing is deployed until you save, review and deploy.
            </span>
          </div>
        )}
        {view === "design" && managed && mode === "guided" && (
          <GuidedDesign
            lib={lib}
            answers={answers}
            setAnswers={setAnswers}
            placed={placed}
            onCanvas={() => void navigate({ search: { view: "design", mode: "canvas" } })}
            onTraffic={() => void navigate({ search: { view: "traffic" } })}
          />
        )}
        {view === "design" && (!managed || mode === "canvas") && (
          <LandingZoneDesigner
            lib={lib}
            answers={current}
            setAnswers={managed ? setAnswers : undefined}
            dirty={dirty}
            placed={placed}
            readOnlyOwner={managed ? undefined : (f.customers?.name ?? "the customer")}
            name={f.name}
            assessment={assessment}
            baseline={saved}
          />
        )}
        {view === "design" && managed && (
          <ChangeBar
            lib={lib}
            saved={saved}
            answers={answers}
            saving={save.isPending}
            onDiscard={() => setAnswers(saved)}
            onSave={() => save.mutate({ data: { foundationId: f.id, answers } })}
          />
        )}
        {view === "review" && managed && (
          <ReviewView
            lib={lib}
            deployed={deployedAnswers}
            saved={saved}
            status={f.status}
            dirty={dirty}
            baselineUnknown={baselineUnknown}
            onBackToDesign={() => void navigate({ search: { view: "design" } })}
            onDeploy={() => void navigate({ search: { view: "deploy" } })}
            onTerraform={() => void navigate({ search: { view: "iac" } })}
          />
        )}
        {view === "assessment" && (
          <AssessmentView
            foundationId={f.id}
            name={f.name}
            lib={lib}
            snapshot={snapshot}
            answers={current}
            placed={placed}
            managed={managed}
            onUseDesign={
              managed
                ? (a) => {
                    setAnswers(a);
                    void navigate({ search: { view: "design" } });
                    toast.success("Design updated from the tenant — review it, then save.");
                  }
                : undefined
            }
          />
        )}
        {view === "traffic" && managed && (
          <div className="px-4 py-4 lg:px-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">Traffic, end to end</h2>
                <p className="text-[12.5px] text-muted-foreground">
                  Every path through the network this design deploys, computed from its route
                  tables, NSGs and firewall: what works, what needs a rule, and what breaks.
                  {dirty && " Showing your unsaved design."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lens === "story" && (
                  <select
                    aria-label="Compare with"
                    className="h-8 rounded-md border border-input bg-background px-2 text-[12.5px]"
                    value={compare}
                    onChange={(e) => setCompare(e.target.value)}
                  >
                    <option value="">Compare with…</option>
                    {alternativesFor(answers).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                )}
                <div
                  role="tablist"
                  aria-label="Traffic view"
                  className="inline-flex rounded-lg border border-border bg-card p-1 text-[12.5px] shadow-sm"
                >
                  {(
                    [
                      ["story", "Overview"],
                      ["hops", "Hop by hop"],
                    ] as const
                  ).map(([l, label]) => (
                    <button
                      key={l}
                      role="tab"
                      aria-selected={lens === l}
                      onClick={() => void navigate({ search: { view: "traffic", lens: l } })}
                      className={cn(
                        "rounded-md px-3 py-1.5 transition-colors",
                        lens === l
                          ? "bg-primary/10 font-semibold text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {lens === "story" ? (
              <TrafficStory
                input={{ lib, answers, placed }}
                compareWith={alternativesFor(answers).find((x) => x.id === compare)}
                onTrace={(id) =>
                  void navigate({ search: { view: "traffic", lens: "hops", flow: id } })
                }
              />
            ) : (
              <TrafficSimulator
                answers={answers}
                spokes={spokesFor(
                  ["corp", "online", "local", "sandbox"].filter((g) =>
                    tree.some((n) => n.libraryId === g),
                  ),
                  placed,
                )}
                extras={sceneExtras(answers, lib, tree)}
                tree={tree}
                initial={search.flow}
                set={setAnswers ? (p) => setAnswers({ ...answers, ...p }) : undefined}
              />
            )}
          </div>
        )}
        {view === "policies" && <PoliciesView tree={tree} />}
        {view === "version" && (
          <VersionView foundationId={f.id} pinned={f.library_ref} deployed={f.deployed_ref} />
        )}
        {view === "iac" && (
          <IacView libraryRef={f.library_ref} answers={answers} placed={placed} dirty={dirty} />
        )}
        {view === "deploy" && <DeployView foundationId={f.id} dirty={dirty} />}
      </div>
    </div>
  );
}

/** Effects as Azure Policy spells them; assignments without an effect parameter use the definition's default. */
const effectLabel = (effect: string | null | undefined) => {
  if (!effect) return "Definition default";
  const known: Record<string, string> = {
    deny: "Deny",
    audit: "Audit",
    auditifnotexists: "AuditIfNotExists",
    deployifnotexists: "DeployIfNotExists",
    modify: "Modify",
    append: "Append",
    disabled: "Disabled",
    denyaction: "DenyAction",
    manual: "Manual",
  };
  return known[effect.toLowerCase()] ?? effect;
};

const effectTone = (effect: string | null | undefined) => {
  const e = (effect ?? "").toLowerCase();
  if (e.startsWith("deny")) return "danger" as const;
  if (e.startsWith("deploy") || e === "modify" || e === "append") return "info" as const;
  if (e.startsWith("audit")) return "neutral" as const;
  return "neutral" as const;
};

/* ----------------------------------------------------------------- policies */

function PoliciesView({ tree }: { tree: MgNode[] }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "changed" | "deny">("all");
  const rows = tree.flatMap((n) => n.here.map((h) => ({ mg: n, ...h })));
  const shown = rows.filter((r) => {
    if (only === "changed" && !r.change) return false;
    if (only === "deny" && !(r.assignment?.effect ?? "").toLowerCase().startsWith("deny"))
      return false;
    const text = `${r.name} ${r.assignment?.displayName ?? ""} ${r.mg.displayName}`.toLowerCase();
    return !q || text.includes(q.toLowerCase());
  });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search assignments…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(["all", "deny", "changed"] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOnly(o)}
            className={cn(
              "rounded-sm border px-2.5 py-1 text-[11px] font-medium",
              only === o
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {o === "all" ? "All" : o === "deny" ? "Deny effects" : "Changed in your design"}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">{shown.length} assignments</span>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Management group</th>
              <th>Assignment</th>
              <th>Effect</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.mg.id}-${r.name}`}>
                <td className="whitespace-nowrap text-muted-foreground">{r.mg.displayName}</td>
                <td>
                  <p className="font-medium">{r.assignment?.displayName ?? r.name}</p>
                  <p className="font-mono text-[10.5px] text-muted-foreground">{r.name}</p>
                </td>
                <td>
                  <Pill tone={effectTone(r.assignment?.effect)}>
                    {effectLabel(r.assignment?.effect)}
                  </Pill>
                </td>
                <td className="text-xs text-muted-foreground">
                  {r.assignment?.source === "builtin" ? "Built-in" : "ALZ custom"}{" "}
                  {r.assignment?.kind === "initiative" ? "initiative" : "policy"}
                </td>
                <td>
                  {r.change?.action === "remove" ? (
                    <Pill tone="warning">Removed</Pill>
                  ) : r.change?.action === "audit" ? (
                    <Pill tone="neutral">Audit only</Pill>
                  ) : (
                    <Pill tone="success">Enforced</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ version */

function VersionView({
  foundationId,
  pinned,
  deployed,
}: {
  foundationId: string;
  pinned: string;
  deployed: string | null;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState(pinned === LATEST_REF ? pinned : LATEST_REF);
  const from = libraryFor(deployed ?? pinned);
  const to = libraryFor(target);
  const diff = diffLibraries(from, to);
  const pin = useMutation({
    mutationFn: useServerFn(pinFoundationLibrary),
    onSuccess: () => {
      toast.success(`Pinned to ALZ ${shortRef(target)}. Deploy it from the Deploy tab.`);
      void queryClient.invalidateQueries({ queryKey: ["foundation", foundationId] });
      void queryClient.invalidateQueries({ queryKey: ["foundations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const nothing =
    !diff.managementGroupsAdded.length &&
    !diff.managementGroupsRemoved.length &&
    !diff.assignmentChanges.length &&
    !diff.changed.length;

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <section className="h-fit rounded-md border border-border bg-card p-4">
        <h2 className="text-[13px] font-semibold">Pinned library version</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Microsoft recommends pinning the ALZ Library, because policy names, parameters and
          structure can change between releases.
        </p>
        <dl className="mt-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Deployed</dt>
            <dd className="font-mono">{deployed ? shortRef(deployed) : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Pinned</dt>
            <dd className="font-mono">{shortRef(pinned)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Latest</dt>
            <dd className="font-mono">{shortRef(LATEST_REF)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs font-medium text-muted-foreground">Compare with</p>
        <div className="mt-1 space-y-1">
          {LIBRARIES.map((l) => (
            <button
              key={l.ref}
              onClick={() => setTarget(l.ref)}
              className={cn(
                "flex w-full items-center justify-between rounded-sm border px-2.5 py-1.5 text-xs",
                target === l.ref ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <span className="font-mono">{shortRef(l.ref)}</span>
              {l.ref === LATEST_REF && (
                <span className="text-[10.5px] text-muted-foreground">latest</span>
              )}
            </button>
          ))}
        </div>
        <Button
          className="mt-4 w-full"
          disabled={target === pinned || pin.isPending}
          onClick={() => pin.mutate({ data: { foundationId, libraryRef: target } })}
        >
          <RefreshCw className="size-3.5" />
          {target === pinned ? "Already pinned" : `Pin ALZ ${shortRef(target)}`}
        </Button>
        <a
          href={to.source}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center text-[11px] text-primary hover:underline"
        >
          View {shortRef(target)} on GitHub
        </a>
      </section>

      <section className="rounded-md border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-semibold">
          <span className="font-mono">{shortRef(from.ref)}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <span className="font-mono">{shortRef(to.ref)}</span>
          <span className="font-normal text-muted-foreground">— what changes in your tenant</span>
        </header>
        <div className="space-y-4 p-4">
          {nothing && <p className="text-sm text-muted-foreground">No differences.</p>}
          {diff.managementGroupsAdded.map((m) => (
            <DiffRow
              key={m.id}
              kind="add"
              title={`New management group: ${m.displayName}`}
              detail={`${m.id}, under ${m.parentId} · archetype ${m.archetypes.join(", ")}. ${MG_PURPOSE[m.id] ?? ""}`}
            />
          ))}
          {diff.managementGroupsRemoved.map((m) => (
            <DiffRow
              key={m.id}
              kind="remove"
              title={`Management group removed: ${m.displayName}`}
              detail={m.id}
            />
          ))}
          {diff.assignmentChanges.flatMap((c) => [
            ...c.added.map((a) => (
              <DiffRow
                key={`${c.archetype}+${a}`}
                kind="add"
                title={to.assignments[a]?.displayName ?? a}
                detail={`${a} · new in the ${c.archetype} archetype`}
              />
            )),
            ...c.removed.map((a) => (
              <DiffRow
                key={`${c.archetype}-${a}`}
                kind="remove"
                title={from.assignments[a]?.displayName ?? a}
                detail={`${a} · removed from the ${c.archetype} archetype`}
              />
            )),
          ])}
          {diff.changed.map((a) => (
            <DiffRow
              key={a}
              kind="change"
              title={to.assignments[a]?.displayName ?? a}
              detail={`${a} · definition or parameters changed`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function DiffRow({
  kind,
  title,
  detail,
}: {
  kind: "add" | "remove" | "change";
  title: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
          kind === "add"
            ? "bg-success/15 text-success"
            : kind === "remove"
              ? "bg-danger/10 text-danger"
              : "bg-info/10 text-info",
        )}
      >
        {kind === "add" ? (
          <Plus className="size-3" />
        ) : kind === "remove" ? (
          <Minus className="size-3" />
        ) : (
          <RefreshCw className="size-3" />
        )}
      </span>
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- iac */

function IacView({
  libraryRef,
  answers,
  placed,
  dirty,
}: {
  libraryRef: string;
  answers: Answers;
  placed: Placement[];
  dirty: boolean;
}) {
  const files = terraformFor(libraryRef, answers);
  const [file, setFile] = useState(files[0]?.path ?? "");
  const current = files.find((x) => x.path === file) ?? files[0];
  const vending = placed.slice(0, 2).map((p) =>
    vendingFor(answers, {
      name: `${p.customerName} ${p.environment}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      archetype: p.landingZone,
      region: answers.primaryRegion,
    }),
  );
  return (
    <div className="space-y-4">
      {dirty && (
        <p className="rounded-sm border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          Showing your unsaved design. Save it on the Design tab before deploying.
        </p>
      )}
      <p className="max-w-3xl text-xs text-muted-foreground">
        Generated for Microsoft's Azure Verified Modules:{" "}
        <span className="font-mono">Azure/avm-ptn-alz</span> with the{" "}
        <span className="font-mono">Azure/alz</span> provider pinned to ALZ {shortRef(libraryRef)},
        plus the management and connectivity pattern modules. Your changes live in a small custom
        library of archetype overrides, so upgrading the ALZ Library never overwrites them. Every
        change to this generator is checked in CI with{" "}
        <span className="font-mono">terraform validate</span> and composed with Microsoft&apos;s{" "}
        <span className="font-mono">alzlibtool</span>, which must produce exactly the assignments
        shown here.
      </p>
      <div className="flex flex-wrap gap-1">
        {files.map((x) => (
          <button
            key={x.path}
            onClick={() => setFile(x.path)}
            className={cn(
              "rounded-sm border px-2 py-1 font-mono text-[11px]",
              current?.path === x.path
                ? "border-primary bg-primary/5"
                : "border-border text-muted-foreground",
            )}
          >
            {x.path}
          </button>
        ))}
      </div>
      {current && <CodeBlock title={current.path} code={current.content} />}
      {vending.length > 0 && (
        <>
          <div>
            <h2 className="text-[13px] font-semibold">
              Subscription vending for customer installs
            </h2>
            <p className="text-xs text-muted-foreground">
              Each customer install gets its own subscription from{" "}
              <span className="font-mono">Azure/avm-ptn-alz-sub-vending</span>, placed under its
              landing zone management group — e.g.{" "}
              {LANDING_ZONE_LABEL[placed[0]!.landingZone]?.title}.
            </p>
          </div>
          <CodeBlock title="vending.tf" code={vending.join("\n\n")} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- deploy */

function DeployView({ foundationId, dirty }: { foundationId: string; dirty: boolean }) {
  return <RealDeploy foundationId={foundationId} dirty={dirty} />;
}
