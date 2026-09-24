import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Lock, Minus, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { type JobStatus, PipelineGraph } from "@/components/architecture/PipelineGraph";
import { CodeBlock } from "@/components/CodeBlock";
import { EmptyState, Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type Answers,
  DEFAULT_ANSWERS,
  LANDING_ZONE_LABEL,
  LATEST_REF,
  LIBRARIES,
  type MgNode,
  QUESTIONS,
  changesFor,
  diffLibraries,
  hierarchy,
  libraryFor,
  platformSubscriptions,
  requiredDefaults,
  shortRef,
  terraformFor,
  vendingFor,
} from "@/lib/alz/engine";
import { type Placement, placements, placementsFor } from "@/lib/alz/placement";
import {
  deployFoundation,
  pinFoundationLibrary,
  saveFoundationAnswers,
} from "@/lib/factory.functions";
import { relative } from "@/lib/format";
import type { Stage } from "@/lib/pipeline";
import { customersQuery, foundationQuery, offeringsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type View = "hierarchy" | "setup" | "policies" | "version" | "iac" | "deploy";

export const Route = createFileRoute("/foundations/$foundationId")({
  validateSearch: (s: Record<string, unknown>): { view?: View } =>
    typeof s["view"] === "string" ? { view: s["view"] as View } : {},
  head: () => ({ meta: [{ title: "Landing zone · Cloud Delivery" }] }),
  component: FoundationDetail,
});

/** What each management group is for, from Microsoft's Cloud Adoption Framework. */
const PURPOSE: Record<string, string> = {
  alz: "Intermediate root under the tenant root group. Parent of everything below; only truly universal policy lives here.",
  platform:
    "Parent of the shared platform subscriptions. Common platform policy and platform-team access.",
  management: "Central monitoring and operations — the Log Analytics workspace and its solutions.",
  connectivity:
    "Networking the platform owns: hub or Virtual WAN, Azure Firewall, private DNS zones, gateways.",
  identity:
    "Identity infrastructure such as domain controllers or Entra Domain Services, when workloads need it.",
  security: "Security and SIEM tooling, such as Microsoft Sentinel.",
  landingzones:
    "Parent of all workload subscriptions. Workload-agnostic guardrails every landing zone inherits.",
  corp: "Workloads that connect to the corporate network through the hub. Public endpoints are denied.",
  online: "Workloads that serve the internet directly or don't need a virtual network.",
  local: "Workloads on Azure Local clusters, and the clusters themselves. Different policy needs.",
  sandbox: "Isolated experimentation with a lighter set of policies.",
  decommissioned: "Cancelled subscriptions waiting to be deleted after 30–60 days.",
};

function FoundationDetail() {
  const { foundationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const foundation = useQuery(foundationQuery(foundationId));
  const customers = useQuery(customersQuery);
  const offerings = useQuery(offeringsQuery);
  const f = foundation.data;
  const saved = useMemo(
    () => ({ ...DEFAULT_ANSWERS, ...((f?.answers ?? {}) as Partial<Answers>) }),
    [f],
  );
  const [answers, setAnswers] = useState<Answers>(saved);
  useEffect(() => setAnswers(saved), [saved]);
  const [focus, setFocus] = useState<string | null>(null);

  if (foundation.isLoading) return <EmptyState title="Loading landing zone…" />;
  if (!f) return <EmptyState title="Landing zone not found." />;

  const managed = f.mode === "managed";
  const view: View = managed
    ? (search.view ?? "hierarchy")
    : search.view === "policies"
      ? "policies"
      : "hierarchy";
  const lib = libraryFor(f.library_ref);
  const tree = hierarchy(lib, managed ? answers : saved);
  const placed = placementsFor(placements(customers.data ?? [], offerings.data ?? []), f);
  const dirty = JSON.stringify(answers) !== JSON.stringify(saved);
  const tabs: [View, string][] = managed
    ? [
        ["hierarchy", "Hierarchy"],
        ["setup", "Setup"],
        ["policies", "Policies"],
        ["version", "ALZ version"],
        ["iac", "Infrastructure as code"],
        ["deploy", "Deploy"],
      ]
    : [
        ["hierarchy", "Where your product lands"],
        ["policies", "Reference policies"],
      ];

  return (
    <div className="-mx-4 -my-6 lg:-mx-8">
      <div className="border-b border-border bg-card px-4 pt-4 lg:px-6">
        <p className="text-xs text-muted-foreground">
          <Link to="/foundations" className="hover:underline">
            Landing zones
          </Link>{" "}
          / {f.customers?.name ?? "Your hosting tenant"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-semibold">{f.name}</h1>
          {managed ? (
            <>
              <Pill tone="neutral">
                <span className="font-mono">ALZ {shortRef(f.library_ref)}</span>
              </Pill>
              {f.deployed_ref && f.deployed_ref !== f.library_ref && (
                <Pill tone="warning">deployed {shortRef(f.deployed_ref)}</Pill>
              )}
              <Pill
                tone={
                  f.status === "deployed" ? "success" : f.status === "draft" ? "neutral" : "warning"
                }
              >
                {f.status === "deployed"
                  ? "Deployed"
                  : f.status === "draft"
                    ? "Not deployed yet"
                    : "Changes to deploy"}
              </Pill>
            </>
          ) : (
            <Pill tone="info">
              <Lock className="size-3" /> Customer-owned · read-only
            </Pill>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {managed
            ? `${tree.length} management groups under ${answers.intermediateRootName || "the intermediate root"} · ${placed.length} customer install${placed.length === 1 ? "" : "s"} placed${f.last_deployed_at ? ` · last deployed ${relative(f.last_deployed_at)}` : ""}`
            : `Discovered from ${String((f.discovered as Record<string, unknown>)?.["source"] ?? "Azure Resource Graph")} · follows the ALZ reference architecture · owned by ${f.customers?.name}'s platform team`}
        </p>
        <nav className="mt-3 -mb-px flex gap-4 text-[13px]">
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
        {view === "hierarchy" && (
          <HierarchyView
            tree={tree}
            focus={focus}
            onFocus={setFocus}
            answers={saved}
            placed={placed}
            managed={managed}
            lib={lib}
          />
        )}
        {view === "setup" && (
          <SetupView
            foundationId={f.id}
            answers={answers}
            setAnswers={setAnswers}
            dirty={dirty}
            libraryRef={f.library_ref}
          />
        )}
        {view === "policies" && <PoliciesView tree={tree} />}
        {view === "version" && (
          <VersionView foundationId={f.id} pinned={f.library_ref} deployed={f.deployed_ref} />
        )}
        {view === "iac" && <IacView libraryRef={f.library_ref} answers={saved} placed={placed} />}
        {view === "deploy" && (
          <DeployView
            foundationId={f.id}
            status={f.status}
            libraryRef={f.library_ref}
            deployedRef={f.deployed_ref}
            answers={saved}
            dirty={dirty}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hierarchy */

function HierarchyView({
  tree,
  focus,
  onFocus,
  answers,
  placed,
  managed,
  lib,
}: {
  tree: MgNode[];
  focus: string | null;
  onFocus: (id: string | null) => void;
  answers: Answers;
  placed: Placement[];
  managed: boolean;
  lib: ReturnType<typeof libraryFor>;
}) {
  const root = tree.find((n) => n.parentId === null);
  const selected =
    tree.find((n) => n.id === focus) ??
    tree.find((n) => n.libraryId === (managed ? "landingzones" : "corp")) ??
    root;
  const subs = platformSubscriptions(answers);
  if (!root) return null;

  const card = (n: MgNode) => {
    const sub = subs.find((s) => s.managementGroup === n.libraryId);
    const here = placed.filter((p) => p.landingZone === n.libraryId);
    const removed = n.here.filter((h) => h.removed).length;
    const target = !managed && n.libraryId === "corp";
    return (
      <button
        onClick={() => onFocus(n.id)}
        className={cn(
          "w-[8.5rem] rounded-md border bg-card p-2 text-left transition-colors hover:border-border-strong",
          selected?.id === n.id ? "border-primary ring-2 ring-primary/20" : "border-border",
          target && "border-success/60 ring-2 ring-success/15",
        )}
      >
        <p className="truncate text-[12.5px] font-semibold">{n.displayName}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">{n.id}</p>
        <p className="mt-1.5 text-[11px]">
          <b className="font-mono">{n.enforced}</b>{" "}
          <span className="text-muted-foreground">here ·</span>{" "}
          <b className="font-mono">{n.inherited}</b>{" "}
          <span className="text-muted-foreground">inherited</span>
        </p>
        {removed > 0 && (
          <p className="text-[10.5px] text-warning">{removed} removed for your setup</p>
        )}
        {sub && (
          <p
            className={cn(
              "mt-1 truncate text-[10.5px]",
              sub.created ? "text-cat-networking" : "text-muted-foreground",
            )}
          >
            {sub.created ? `${sub.name} subscription` : "No subscription"}
          </p>
        )}
        {["corp", "online", "local", "sandbox"].includes(n.libraryId) && (
          <p
            className={cn(
              "mt-1 truncate text-[10.5px]",
              here.length ? "text-success" : "text-muted-foreground",
            )}
          >
            {target
              ? "Your product lands here"
              : here.length
                ? `${here.length} install${here.length === 1 ? "" : "s"}`
                : "No installs"}
          </p>
        )}
      </button>
    );
  };

  const branch = (n: MgNode): React.ReactNode => {
    const kids = tree.filter((k) => k.parentId === n.id);
    return (
      <div className="flex flex-col items-center">
        {card(n)}
        {kids.length > 0 && (
          <>
            <span className="h-4 w-px bg-border-strong" />
            <div className="flex">
              {kids.map((k, i) => (
                <div key={k.id} className="relative flex flex-col items-center px-1 pt-4">
                  {i > 0 && (
                    <span className="absolute top-0 left-0 w-1/2 border-t border-border-strong" />
                  )}
                  {i < kids.length - 1 && (
                    <span className="absolute top-0 right-0 w-1/2 border-t border-border-strong" />
                  )}
                  <span className="absolute top-0 left-1/2 h-4 border-l border-border-strong" />
                  {branch(k)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  const ancestors: MgNode[] = [];
  let p = tree.find((n) => n.id === selected?.parentId);
  while (p) {
    ancestors.unshift(p);
    p = tree.find((n) => n.id === p?.parentId);
  }
  const here = selected ? placed.filter((x) => x.landingZone === selected.libraryId) : [];

  return (
    <div className="space-y-4">
      <div className="canvas-grid overflow-x-auto rounded-md border border-border p-5">
        <div className="flex min-w-max justify-center">
          <div className="flex flex-col items-center">
            <div className="mb-1 rounded-sm border border-dashed border-border-strong px-3 py-1 text-[11px] text-muted-foreground">
              Tenant root group
            </div>
            <span className="h-4 w-px bg-border-strong" />
            {branch(root)}
          </div>
        </div>
      </div>

      {selected && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-md border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px] font-semibold">{selected.displayName}</h2>
                <span className="font-mono text-[11px] text-muted-foreground">
                  archetype: {selected.archetype}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{PURPOSE[selected.libraryId]}</p>
            </header>
            <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
              {selected.here.map((h) => (
                <li
                  key={h.name}
                  className={cn(
                    "flex items-start justify-between gap-3 px-4 py-2",
                    h.removed && "bg-warning/5",
                  )}
                >
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-[13px] font-medium",
                        h.removed && "text-muted-foreground line-through",
                      )}
                    >
                      {h.assignment?.displayName ?? h.name}
                    </p>
                    <p className="font-mono text-[10.5px] text-muted-foreground">
                      {h.name} · {h.assignment?.kind === "initiative" ? "initiative" : "policy"} ·{" "}
                      {h.assignment?.source === "builtin" ? "built-in" : "ALZ custom"}
                    </p>
                    {h.removed && (
                      <p className="mt-0.5 text-[11.5px] text-warning">{h.removed.reason}</p>
                    )}
                  </div>
                  <Pill tone={h.removed ? "warning" : effectTone(h.assignment?.effect)}>
                    {h.removed ? "Removed" : effectLabel(h.assignment?.effect)}
                  </Pill>
                </li>
              ))}
              {!selected.here.length && (
                <li className="px-4 py-5 text-sm text-muted-foreground">
                  Nothing is assigned directly here in ALZ {shortRef(lib.ref)} — everything is
                  inherited from the groups above.
                </li>
              )}
            </ul>
          </section>
          <aside className="space-y-3">
            <div className="rounded-md border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">Inherited from</p>
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {ancestors.map((a) => (
                  <li key={a.id} className="flex justify-between">
                    <span>{a.displayName}</span>
                    <span className="font-mono text-muted-foreground">{a.enforced}</span>
                  </li>
                ))}
                {!ancestors.length && (
                  <li className="text-muted-foreground">Nothing — this is the top.</li>
                )}
              </ul>
            </div>
            {["corp", "online", "local", "sandbox"].includes(selected.libraryId) && (
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground">Customer installs here</p>
                <ul className="mt-1.5 space-y-1 text-[13px]">
                  {here.slice(0, 8).map((x) => (
                    <li
                      key={`${x.customerId}-${x.environment}`}
                      className="flex justify-between gap-2"
                    >
                      <span className="truncate">{x.customerName}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {x.environment}
                      </span>
                    </li>
                  ))}
                  {here.length > 8 && (
                    <li className="text-xs text-muted-foreground">+{here.length - 8} more</li>
                  )}
                  {!here.length && <li className="text-muted-foreground">None yet.</li>}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
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

/* -------------------------------------------------------------------- setup */

function SetupView({
  foundationId,
  answers,
  setAnswers,
  dirty,
  libraryRef,
}: {
  foundationId: string;
  answers: Answers;
  setAnswers: (a: Answers) => void;
  dirty: boolean;
  libraryRef: string;
}) {
  const queryClient = useQueryClient();
  const lib = libraryFor(libraryRef);
  const changes = changesFor(lib, answers);
  const defaults = requiredDefaults(lib, answers);
  const save = useMutation({
    mutationFn: useServerFn(saveFoundationAnswers),
    onSuccess: () => {
      toast.success("Saved. Review the infrastructure as code, then deploy.");
      void queryClient.invalidateQueries({ queryKey: ["foundation", foundationId] });
      void queryClient.invalidateQueries({ queryKey: ["foundations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-[13px] font-semibold">Name and region</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Top management group ID</Label>
              <Input
                className="mt-1 font-mono text-xs"
                value={answers.intermediateRootId}
                onChange={(e) => setAnswers({ ...answers, intermediateRootId: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used as the prefix for every group, e.g. {answers.intermediateRootId}-corp
              </p>
            </div>
            <div>
              <Label className="text-xs">Display name</Label>
              <Input
                className="mt-1 text-xs"
                value={answers.intermediateRootName}
                onChange={(e) => setAnswers({ ...answers, intermediateRootName: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Primary region</Label>
              <Input
                className="mt-1 font-mono text-xs"
                value={answers.primaryRegion}
                onChange={(e) => setAnswers({ ...answers, primaryRegion: e.target.value })}
              />
            </div>
          </div>
        </section>

        {QUESTIONS.map((q) => (
          <section key={q.key} className="rounded-md border border-border bg-card p-4">
            <h2 className="text-[13px] font-semibold">{q.question}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{q.help}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {q.options.map((o) => {
                const on = answers[q.key] === o.value;
                return (
                  <button
                    key={o.value}
                    onClick={() => setAnswers({ ...answers, [q.key]: o.value } as Answers)}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors",
                      on
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                      {on && <Check className="size-3.5 text-primary" />}
                      {o.label}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{o.body}</p>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-[13px] font-semibold">Security contact</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Microsoft Defender for Cloud sends security alerts here.
          </p>
          <Input
            className="mt-2 max-w-sm text-xs"
            placeholder="secops@example.com"
            value={answers.securityContactEmail}
            onChange={(e) => setAnswers({ ...answers, securityContactEmail: e.target.value })}
          />
        </section>

        <div className="flex justify-end">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ data: { foundationId, answers } })}
          >
            {save.isPending ? "Saving…" : "Save setup"}
          </Button>
        </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-16 xl:h-fit">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-[13px] font-semibold">What your answers change</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Everything else is the Microsoft ALZ {shortRef(libraryRef)} reference, unchanged.
            Changes are made the way Microsoft documents — an archetype override in a custom
            library, never an edited copy.
          </p>
          <ul className="mt-3 space-y-2">
            {groupChanges(changes).map((g) => (
              <li
                key={g.assignment}
                className="rounded-sm border border-warning/40 bg-warning/5 p-2.5"
              >
                <p className="text-[12.5px] font-medium">
                  Remove <span className="font-mono">{g.assignment}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">from {g.groups.join(", ")}</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">{g.reason}</p>
              </li>
            ))}
            {!changes.length && (
              <li className="text-sm text-muted-foreground">
                No changes — the full reference applies.
              </li>
            )}
          </ul>
        </section>
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-[13px] font-semibold">Values filled in for you</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Policy parameters the library needs, and where each comes from.
          </p>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {defaults.map((d) => (
              <li key={d.name} className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px]">{d.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{d.from}</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

const groupChanges = (changes: ReturnType<typeof changesFor>) =>
  Object.values(
    changes.reduce<Record<string, { assignment: string; groups: string[]; reason: string }>>(
      (acc, c) => {
        acc[c.assignment] = acc[c.assignment] ?? {
          assignment: c.assignment,
          groups: [],
          reason: c.reason,
        };
        acc[c.assignment]!.groups.push(c.managementGroup);
        return acc;
      },
      {},
    ),
  );

/* ----------------------------------------------------------------- policies */

function PoliciesView({ tree }: { tree: MgNode[] }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "removed" | "deny">("all");
  const rows = tree.flatMap((n) => n.here.map((h) => ({ mg: n, ...h })));
  const shown = rows.filter((r) => {
    if (only === "removed" && !r.removed) return false;
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
        {(["all", "deny", "removed"] as const).map((o) => (
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
            {o === "all" ? "All" : o === "deny" ? "Deny effects" : "Removed for your setup"}
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
                  {r.removed ? (
                    <Pill tone="warning">Removed</Pill>
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
              detail={`${m.id}, under ${m.parentId} · archetype ${m.archetypes.join(", ")}. ${PURPOSE[m.id] ?? ""}`}
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
}: {
  libraryRef: string;
  answers: Answers;
  placed: Placement[];
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

function DeployView({
  foundationId,
  status,
  libraryRef,
  deployedRef,
  answers,
  dirty,
}: {
  foundationId: string;
  status: string;
  libraryRef: string;
  deployedRef: string | null;
  answers: Answers;
  dirty: boolean;
}) {
  const queryClient = useQueryClient();
  const [replay, setReplay] = useState<number | null>(null);
  const subs = platformSubscriptions(answers).filter((s) => s.created);
  const stages: Stage[] = [
    {
      id: "validate",
      name: "Validate",
      jobs: [
        { id: "tf-validate", name: "terraform validate", detail: "Modules and provider resolve" },
        {
          id: "library",
          name: `Resolve ALZ ${shortRef(libraryRef)}`,
          detail: "platform/alz + custom overrides",
        },
        { id: "defaults", name: "Policy default values", detail: "Every required value is set" },
      ],
    },
    {
      id: "plan",
      name: "Plan",
      jobs: [
        {
          id: "tf-plan",
          name: "terraform plan",
          detail: "Management groups, policy, subscriptions",
        },
      ],
    },
    {
      id: "approve",
      name: "Approve",
      jobs: [
        {
          id: "approval",
          name: "Platform owner approval",
          detail: "Tenant-level change",
          gate: true,
        },
      ],
    },
    {
      id: "deploy-mg",
      name: "Deploy · Governance",
      jobs: [
        { id: "mgs", name: "Management groups", detail: `${answers.intermediateRootId} hierarchy` },
        { id: "defs", name: "Policy & role definitions", detail: "At the intermediate root" },
        {
          id: "assign",
          name: "Policy assignments",
          detail: "Per archetype, with managed identities",
        },
      ],
    },
    {
      id: "deploy-platform",
      name: "Deploy · Platform subscriptions",
      jobs: subs.map((s) => ({ id: `sub-${s.managementGroup}`, name: s.name, detail: s.purpose })),
    },
    {
      id: "verify",
      name: "Verify",
      jobs: [
        {
          id: "compliance",
          name: "Policy compliance scan",
          detail: "Initial evaluation of every scope",
        },
      ],
    },
  ];
  const upToDate = status === "deployed" && deployedRef === libraryRef && !dirty;
  const order = stages.flatMap((s) => s.jobs.map((j) => j.id));
  const deploy = useMutation({
    mutationFn: useServerFn(deployFoundation),
    onSuccess: () => {
      setReplay(0);
      void queryClient.invalidateQueries({ queryKey: ["foundation", foundationId] });
      void queryClient.invalidateQueries({ queryKey: ["foundations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (replay === null) return;
    if (replay > order.length) {
      setReplay(null);
      toast.success(
        `Landing zone deployed on ALZ ${shortRef(libraryRef)} (demo engine — no Azure calls).`,
      );
      return;
    }
    const t = setTimeout(() => setReplay((r) => (r === null ? null : r + 1)), 420);
    return () => clearTimeout(t);
  }, [replay, order.length, libraryRef]);

  const jobStatus = (job: { id: string }): JobStatus => {
    const i = order.indexOf(job.id);
    if (replay !== null) return i < replay ? "succeeded" : i === replay ? "running" : "queued";
    if (upToDate) return "succeeded";
    return job.id === "approval" ? "waiting" : "queued";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold">
            {upToDate
              ? `Deployed on ALZ ${shortRef(libraryRef)}`
              : `Ready to deploy ALZ ${shortRef(libraryRef)}`}
          </h2>
          <p className="text-xs text-muted-foreground">
            {dirty
              ? "Save your setup first — the deployment uses the saved answers."
              : upToDate
                ? "The tenant matches the saved setup and pinned library."
                : "Runs the generated Terraform through the platform pipeline. Tenant-level changes need approval."}
          </p>
        </div>
        <Button
          disabled={dirty || upToDate || deploy.isPending || replay !== null}
          onClick={() => deploy.mutate({ data: { foundationId, approvedBy: "Sarah Chen" } })}
        >
          {deploy.isPending || replay !== null ? "Deploying…" : "Approve & deploy"}
        </Button>
      </div>
      <PipelineGraph stages={stages} status={jobStatus} />
    </div>
  );
}
