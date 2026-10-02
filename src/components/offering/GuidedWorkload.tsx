/*
 * Guided workload design: an architecture design session as ten decisions, in the order an SE or CSA runs one.
 * Requirements first (they're what every Well-Architected check is judged against), then a starting point from
 * Microsoft's reference architectures or a blank page, then edge, compute, data, integration, network, identity and
 * observability, then the review. Every add or remove says what it changed: flows, roles, private endpoints, DNS,
 * diagnostics, inputs, cost and findings. It edits the same design as the canvas.
 */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Lightbulb,
  Lock,
  Plus,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { ServiceIcon } from "@/components/architecture/ServiceIcon";
import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import type { Architecture } from "@/lib/architecture";
import { SERVICE_BY_ID, type Topology, monthlyEstimate, withDefaults } from "@/lib/catalog";
import { designDocument, findingsCsv } from "@/lib/offering/design-doc";
import { impactOf, workloadFlows } from "@/lib/offering/flows";
import { REFERENCE_DESIGNS } from "@/lib/offering/templates";
import {
  DEFAULT_WORKLOAD,
  type Finding,
  GUIDE_BY_SERVICE,
  type Workload,
  applyFix,
  review as reviewOf,
  reviewDelta,
} from "@/lib/waf";
import { cn } from "@/lib/utils";

import { TemplatePicker } from "./TemplatePicker";
import { WafLink } from "./WafGuide";
import { WafFindings, WafScorecard } from "./WafReview";
import { type Lens, WorkloadStory } from "./WorkloadStory";

type StepId =
  | "requirements"
  | "start"
  | "edge"
  | "compute"
  | "data"
  | "integration"
  | "network"
  | "identity"
  | "observability"
  | "review";

const STEPS: { id: StepId; title: string; question: string; lens?: Lens; pillar?: string }[] = [
  { id: "requirements", title: "Requirements", question: "What must this workload achieve?" },
  {
    id: "start",
    title: "Starting point",
    question: "Start from a reference architecture, or from scratch?",
  },
  {
    id: "edge",
    title: "Edge & ingress",
    question: "How do users and callers reach it?",
    lens: "traffic",
  },
  { id: "compute", title: "Compute", question: "Where does the code run?", lens: "traffic" },
  {
    id: "data",
    title: "Data & AI",
    question: "Where does it keep data, and which AI does it use?",
    lens: "traffic",
  },
  {
    id: "integration",
    title: "Integration",
    question: "How do parts talk asynchronously?",
    lens: "traffic",
  },
  {
    id: "network",
    title: "Network & landing zone",
    question: "Where does it run, and how private is it?",
    lens: "traffic",
  },
  {
    id: "identity",
    title: "Identity & security",
    question: "Which identities reach what, and what protects it?",
    lens: "identity",
  },
  {
    id: "observability",
    title: "Observability",
    question: "How do you know it's healthy?",
    lens: "logging",
  },
  { id: "review", title: "Review", question: "Is it well-architected, and ready to release?" },
];

const SERVICES_FOR: Partial<Record<StepId, string[]>> = {
  edge: ["front-door", "app-gateway", "apim"],
  compute: [
    "app-service",
    "container-apps",
    "aks",
    "functions",
    "web-vmss",
    "app-vmss",
    "vm",
    "container-instances",
    "container-registry",
  ],
  data: [
    "sql",
    "postgres",
    "cosmos",
    "storage",
    "redis",
    "ai-foundry",
    "ai-search",
    "data-explorer",
    "iot-hub",
    "fabric",
    "databricks",
    "adme",
    "adme-connection",
  ],
  integration: ["service-bus", "event-hubs", "event-grid", "app-configuration"],
  identity: ["managed-identity", "key-vault", "defender", "security-baseline"],
  observability: ["monitoring", "app-insights", "budget"],
};

/** Why a service is suggested for this workload, if it is. Heuristics stated plainly, never hidden. */
function suggestion(id: string, arch: Architecture, w: Workload): string | undefined {
  const has = (x: string) => arch.selected.some((s) => s.id === x);
  const external = w.audience !== "internal";
  const multi = arch.topology.regions.length > 1;
  const compute = ["app-service", "container-apps", "aks", "functions", "web-vmss", "vm"].some(has);
  switch (id) {
    case "front-door":
      return external && multi
        ? "External users across more than one region: a global entry point with WAF."
        : undefined;
    case "app-gateway":
      return external && !multi && !has("front-door")
        ? "External users in one region: a regional entry point with a web application firewall."
        : undefined;
    case "key-vault":
      return "Secrets, keys and certificates outside code; the workload identity reads them.";
    case "app-insights":
      return compute
        ? "Application telemetry for the code you run: requests, dependencies, failures."
        : undefined;
    case "defender":
      return w.data !== "public"
        ? `${w.data} data: threat protection on every resource.`
        : undefined;
    case "budget":
      return "Cost visibility from the first deployment.";
    case "redis":
      return has("sql") || has("postgres") || has("cosmos")
        ? "A cache in front of the database for hot reads."
        : undefined;
    case "container-registry":
      return has("aks") || has("container-apps")
        ? "Container images for AKS or Container Apps, pulled privately."
        : undefined;
    default:
      return undefined;
  }
}

export function GuidedWorkload({
  name,
  arch,
  set,
  onCanvas,
}: {
  name: string;
  arch: Architecture;
  set: (next: Partial<Architecture>) => void;
  onCanvas: () => void;
}) {
  const [step, setStep] = useState<StepId>("requirements");
  const [template, setTemplate] = useState("");
  const [last, setLast] = useState<{
    label: string;
    impact: ReturnType<typeof impactOf>;
    delta: ReturnType<typeof reviewDelta>;
    added: string[];
  } | null>(null);
  const workload = arch.workload ?? DEFAULT_WORKLOAD;
  const review = useMemo(() => reviewOf(arch), [arch]);
  const idx = STEPS.findIndex((s) => s.id === step);
  const meta = STEPS[idx]!;
  const go = (id: StepId) => setStep(id);

  /** Make a change and remember what it did. */
  const change = (label: string, after: Architecture) => {
    const added = after.selected
      .filter((s) => !arch.selected.some((x) => x.id === s.id))
      .map((s) => s.id);
    setLast({ label, impact: impactOf(arch, after), delta: reviewDelta(arch, after), added });
    set(after);
  };
  const toggle = (id: string) => {
    const def = SERVICE_BY_ID.get(id);
    if (!def || def.locked) return;
    const on = arch.selected.some((s) => s.id === id);
    change(`${on ? "Removed" : "Added"} ${def.name}`, {
      ...arch,
      selected: on
        ? arch.selected.filter((s) => s.id !== id)
        : [...arch.selected, withDefaults(id)],
    });
  };
  const fix = (f: Finding) => f.fix && change(f.fix.label, applyFix(arch, f.fix, f.service));
  const setWorkload = (patch: Partial<Workload>) => set({ workload: { ...workload, ...patch } });
  const setTopology = (patch: Partial<Topology>) =>
    change("Changed where it runs", { ...arch, topology: { ...arch.topology, ...patch } });
  const marks = useMemo(
    () => new Map((last?.added ?? []).map((id) => [id, "added" as const])),
    [last],
  );

  const download = (kind: "doc" | "csv") => {
    const text =
      kind === "doc"
        ? designDocument(name, arch, review, workloadFlows(arch, arch.workload))
        : findingsCsv(review);
    const blob = new Blob([text], { type: kind === "doc" ? "text/markdown" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${kind === "doc" ? "design.md" : "well-architected.csv"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid items-start gap-5 p-4 xl:grid-cols-[220px_minmax(0,1fr)_320px] lg:p-6">
      <nav aria-label="Design steps" className="space-y-1 xl:sticky xl:top-4">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          return (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                active ? "bg-primary/[0.08] ring-1 ring-primary/25" : "hover:bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : i < idx
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i < idx ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="text-[13px] font-semibold">{s.title}</span>
            </button>
          );
        })}
      </nav>

      <section aria-label={meta.title} className="min-w-0 space-y-4">
        <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <header className="border-b border-border px-6 pt-5 pb-4">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
              Step {idx + 1} of {STEPS.length} · {meta.title}
            </p>
            <h2 className="mt-2 text-[21px] leading-snug font-semibold tracking-tight">
              {meta.question}
            </h2>
          </header>
          <div className="space-y-5 px-6 py-5">
            {step === "requirements" && <Requirements w={workload} set={setWorkload} />}
            {step === "start" && (
              <div className="space-y-3">
                <p className="text-[12.5px] text-muted-foreground">
                  Each reference design is adapted from Microsoft's Azure Architecture Center and
                  opens as an editable design, with its requirements, already checked. Picking one
                  replaces what's on the canvas.
                </p>
                <TemplatePicker
                  value={template}
                  onChange={(id) => {
                    const d = REFERENCE_DESIGNS.find((x) => x.id === id);
                    if (!d) return;
                    setTemplate(id);
                    change(`Started from ${d.title}`, { ...d.architecture, workload: d.workload });
                  }}
                />
              </div>
            )}
            {SERVICES_FOR[step] && (
              <ServiceCards
                ids={SERVICES_FOR[step]!}
                arch={arch}
                w={workload}
                findings={review.findings}
                onToggle={toggle}
                onFix={fix}
              />
            )}
            {step === "network" && <Network t={arch.topology} set={setTopology} />}
            {step === "review" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => download("doc")}>
                    <Download className="size-4" /> Download design document
                  </Button>
                  <Button variant="outline" onClick={() => download("csv")}>
                    <FileSpreadsheet className="size-4" /> Findings as CSV
                  </Button>
                  <Button variant="outline" onClick={onCanvas}>
                    See it on the canvas
                  </Button>
                </div>
                <WafFindings review={review} onFix={fix} />
                <p className="text-[12px] text-muted-foreground">
                  When it reads right: save it as a draft release, run Review and a test deploy,
                  then publish. Publishing makes the release immutable and available to onboarding
                  and the delivery pipeline.
                </p>
              </div>
            )}
          </div>
          <footer className="flex items-center justify-between gap-2 border-t border-border px-6 py-3.5">
            <Button
              variant="ghost"
              disabled={idx === 0}
              onClick={() => go(STEPS[Math.max(0, idx - 1)]!.id)}
            >
              <ArrowLeft className="size-4" /> Back
            </Button>
            <span className="text-[12px] text-muted-foreground">
              Changes apply to the canvas, the Terraform and the pipeline.
            </span>
            {idx < STEPS.length - 1 ? (
              <Button onClick={() => go(STEPS[idx + 1]!.id)}>
                {STEPS[idx + 1]!.title} <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button variant="outline" onClick={onCanvas}>
                See it on the canvas
              </Button>
            )}
          </footer>
        </div>
        {meta.lens && (
          <div>
            <p className="mb-2 text-[12.5px] font-medium">
              {meta.lens === "identity"
                ? "Who reaches what, with which role, computed from the design"
                : meta.lens === "logging"
                  ? "Where every diagnostic ends up, computed from the design"
                  : "The traffic this design carries, computed from it"}
            </p>
            <WorkloadStory arch={arch} lens={meta.lens} compact marks={marks} />
          </div>
        )}
      </section>

      <aside className="space-y-4 xl:sticky xl:top-4">
        <WafScorecard review={review} compact />
        <Impact last={last} />
        <section className="rounded-xl border border-border bg-card p-4 text-[12.5px]">
          <p className="font-semibold">Estimated list price</p>
          <p className="mt-1 text-[20px] font-bold">
            ${Math.round(monthlyEstimate(arch.selected)).toLocaleString()}
            <span className="text-[12px] font-normal text-muted-foreground">
              {" "}
              /month per production install
            </span>
          </p>
          <p className="text-muted-foreground">
            ${Math.round(monthlyEstimate(arch.selected, "dev")).toLocaleString()} per dev/test
            install
          </p>
        </section>
      </aside>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- pieces */

function Choice({
  title,
  body,
  selected,
  onSelect,
  extra,
}: {
  title: ReactNode;
  body: ReactNode;
  selected: boolean;
  onSelect?: (() => void) | undefined;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      disabled={!onSelect}
      className={cn(
        "flex h-full w-full flex-col rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/[0.05] ring-1 ring-primary/25"
          : "border-border bg-card hover:border-primary/30",
      )}
    >
      <span className="flex items-start justify-between gap-2 text-[14px] font-semibold">
        {title}
        <span
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-full border",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
          )}
        >
          {selected && <Check className="size-3" />}
        </span>
      </span>
      <span className="mt-1.5 block text-[12.5px] text-muted-foreground">{body}</span>
      {extra}
    </button>
  );
}

function Requirements({ w, set }: { w: Workload; set: (p: Partial<Workload>) => void }) {
  const crit: [Workload["criticality"], string, string][] = [
    [
      "mission-critical",
      "Mission-critical",
      "The business stops without it. Expect zone and region redundancy, and the strictest checks.",
    ],
    [
      "business-critical",
      "Business-critical",
      "A serious impact if it's down. Zone-redundant in one region is the usual baseline.",
    ],
    ["standard", "Standard", "Downtime is tolerable. Optimise for cost; the checks are lighter."],
  ];
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        {crit.map(([id, title, body]) => (
          <Choice
            key={id}
            title={title}
            body={body}
            selected={w.criticality === id}
            onSelect={() => set({ criticality: id })}
          />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <Field label="Availability target">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={w.slo}
            onChange={(e) => set({ slo: e.target.value })}
          >
            {["99", "99.5", "99.9", "99.95", "99.99"].map((x) => (
              <option key={x} value={x}>
                {x}%
              </option>
            ))}
          </select>
        </Field>
        <Field label="Recovery time (RTO)">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={w.rtoMinutes}
            onChange={(e) => set({ rtoMinutes: Number(e.target.value) })}
          >
            {[15, 60, 240, 480, 1440].map((x) => (
              <option key={x} value={x}>
                {x < 60 ? `${x} min` : `${x / 60} h`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Data loss (RPO)">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={w.rpoMinutes}
            onChange={(e) => set({ rpoMinutes: Number(e.target.value) })}
          >
            {[0, 5, 15, 60, 240, 1440].map((x) => (
              <option key={x} value={x}>
                {x === 0 ? "None" : x < 60 ? `${x} min` : `${x / 60} h`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Data classification">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={w.data}
            onChange={(e) => set({ data: e.target.value as Workload["data"] })}
          >
            {["public", "internal", "confidential", "regulated"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Who uses it">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={w.audience}
            onChange={(e) => set({ audience: e.target.value as Workload["audience"] })}
          >
            <option value="external">External users</option>
            <option value="internal">Internal users</option>
            <option value="both">Both</option>
          </select>
        </Field>
      </div>
      <p className="flex gap-2 rounded-lg bg-muted/50 px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
        Every Well-Architected check reads these: zone and region redundancy against criticality and
        recovery targets, private access against data classification, edge protection against the
        audience.
      </p>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function ServiceCards({
  ids,
  arch,
  w,
  findings,
  onToggle,
  onFix,
}: {
  ids: string[];
  arch: Architecture;
  w: Workload;
  findings: Finding[];
  onToggle: (id: string) => void;
  onFix: (f: Finding) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {ids
        .filter((id) => SERVICE_BY_ID.has(id))
        .map((id) => {
          const def = SERVICE_BY_ID.get(id)!;
          const on = arch.selected.some((s) => s.id === id);
          const mine = findings.filter((f) => f.service === id);
          const fails = mine.filter((f) => f.result === "fail").length;
          const warns = mine.filter((f) => f.result === "warn").length;
          const tip = !on ? suggestion(id, arch, w) : undefined;
          const guide = GUIDE_BY_SERVICE.get(id);
          return (
            <div
              key={id}
              className={cn(
                "flex flex-col rounded-xl border p-4",
                on
                  ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/20"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-start gap-3">
                <ServiceIcon id={id} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{def.name}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{def.blurb}</p>
                </div>
                {def.locked ? (
                  <Pill>
                    <Lock className="size-3" /> Always on
                  </Pill>
                ) : (
                  <Button
                    size="sm"
                    variant={on ? "outline" : "default"}
                    className="h-7 shrink-0"
                    onClick={() => onToggle(id)}
                    aria-label={`${on ? "Remove" : "Add"} ${def.name}`}
                  >
                    {on ? (
                      "Remove"
                    ) : (
                      <>
                        <Plus className="size-3.5" /> Add
                      </>
                    )}
                  </Button>
                )}
              </div>
              {tip && (
                <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-success">
                  <Sparkles className="mt-px size-3 shrink-0" />
                  <span>
                    <span className="font-semibold">Suggested.</span> {tip}
                  </span>
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[11.5px]">
                {on && (fails || warns) ? (
                  <span className="text-muted-foreground">
                    {fails > 0 && <span className="font-semibold text-danger">{fails} fail </span>}
                    {warns > 0 && (
                      <span className="font-semibold text-warning">{warns} to consider</span>
                    )}
                  </span>
                ) : on && mine.length ? (
                  <span className="font-medium text-success">Passes its checks</span>
                ) : null}
                {guide && (
                  <WafLink
                    topic={id}
                    findings={findings}
                    onFix={onFix}
                    className="ml-auto font-medium text-primary hover:underline"
                  >
                    Well-Architected guide ({guide.recs.length})
                  </WafLink>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}

function Network({ t, set }: { t: Topology; set: (p: Partial<Topology>) => void }) {
  const where: [Topology["landing"], string, string][] = [
    [
      "existing-customer-hub",
      "Customer's landing zone",
      "Peered to the customer's hub: egress through their firewall, private DNS and logs from their platform.",
    ],
    [
      "dedicated-spoke",
      "Its own network",
      "A dedicated network in the customer's Azure, for customers without a platform landing zone.",
    ],
    [
      "isv-hosted",
      "Hosted in your Azure",
      "You run it for the customer in your landing zone; they need no Azure of their own.",
    ],
  ];
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        {where.map(([id, title, body]) => (
          <Choice
            key={id}
            title={title}
            body={body}
            selected={t.landing === id}
            onSelect={() => set({ landing: id })}
          />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Choice
          title="Private only"
          body="Public network access off; data services reached through private endpoints and private DNS."
          selected={!t.publicAccess && t.privateEndpoints}
          onSelect={() => set({ publicAccess: false, privateEndpoints: true })}
        />
        <Choice
          title="Public endpoints allowed"
          body="Simpler to reach, but data services keep a public endpoint. Not for confidential or regulated data."
          selected={t.publicAccess}
          onSelect={() => set({ publicAccess: true })}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {(["corp", "online", "local", "sandbox"] as const).map((z) => (
          <Choice
            key={z}
            title={z[0]!.toUpperCase() + z.slice(1)}
            body={
              z === "corp"
                ? "Private, through the hub"
                : z === "online"
                  ? "Internet-facing"
                  : z === "local"
                    ? "Azure Local"
                    : "Experiments"
            }
            selected={t.landingZone === z}
            onSelect={() => set({ landingZone: z })}
          />
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Regions ({t.regions.join(", ")}) and environments ({t.environments.join(", ")}) are set on
        the canvas. More than one region makes the review expect geo-redundant data.
      </p>
    </>
  );
}

function Impact({
  last,
}: {
  last: {
    label: string;
    impact: ReturnType<typeof impactOf>;
    delta: ReturnType<typeof reviewDelta>;
  } | null;
}) {
  if (!last)
    return (
      <section className="rounded-xl border border-dashed border-border bg-card p-4 text-[12.5px] text-muted-foreground">
        Add or remove a service and this shows exactly what it changed: flows, roles, private
        endpoints, DNS zones, diagnostics, customer inputs, cost and findings.
      </section>
    );
  const { impact: i, delta: d } = last;
  const rows: [string, string[]][] = [
    ["New flows", i.added.map((f) => f.title)],
    ["Removed flows", i.removed.map((f) => f.title)],
    ["Roles", i.roles],
    ["Private endpoints", i.privateEndpoints],
    ["Private DNS zones", i.dnsZones],
    ["Diagnostics", i.diagnostics],
    ["Customer inputs", i.inputs],
  ];
  return (
    <section
      aria-label="What changed"
      className="rounded-xl border border-border bg-card p-4 text-[12.5px]"
    >
      <p className="text-[13px] font-semibold">What changed: {last.label}</p>
      <p className="mt-1 text-muted-foreground">
        {i.monthlyDelta === 0
          ? "No change to the estimate."
          : `${i.monthlyDelta > 0 ? "+" : "−"}$${Math.abs(Math.round(i.monthlyDelta)).toLocaleString()}/month per production install.`}
        {d.worse.length > 0 && (
          <span className="text-danger">
            {" "}
            {d.worse.length} new finding{d.worse.length === 1 ? "" : "s"}.
          </span>
        )}
        {d.better.length > 0 && <span className="text-success"> {d.better.length} cleared.</span>}
      </p>
      <dl className="mt-2.5 space-y-2">
        {rows
          .filter(([, v]) => v.length)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {k}
              </dt>
              <dd className="mt-0.5 space-y-0.5">
                {v.slice(0, 5).map((x) => (
                  <p key={x} className="leading-snug">
                    {x}
                  </p>
                ))}
                {v.length > 5 && <p className="text-muted-foreground">and {v.length - 5} more</p>}
              </dd>
            </div>
          ))}
      </dl>
      {d.worse.slice(0, 3).map((f) => (
        <p key={`${f.service}:${f.rec.id}`} className="mt-2 text-[12px] text-danger">
          {SERVICE_BY_ID.get(f.service ?? "")?.short ?? "Workload"}: {f.rec.title}
        </p>
      ))}
    </section>
  );
}
