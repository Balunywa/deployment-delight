/*
 * Guided design: the landing zone as a sequence of decisions, in the order an architect makes them. Each step asks
 * one question, shows the options as cards with what each means, what's suggested and why, and why an option isn't
 * available when it isn't. It edits the same design as the canvas, and a readiness check says what still needs
 * attention before deploying. The knowledge guides open beside it, not instead of it.
 */
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Cloud,
  FileDown,
  Globe,
  Info,
  KeyRound,
  Lightbulb,
  Lock,
  Map as MapIcon,
  Network,
  Route,
  Server,
  ShieldCheck,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AlzLibrary,
  type Answers,
  type OptionalGroup,
  LANDING_ZONE_LABEL,
  MG_PURPOSE,
  type RemovableGroup,
  hasFirewall,
  hasHub,
  hierarchy,
  on,
  shortRef,
} from "@/lib/alz/engine";
import { checkIpPlan, ipPlan } from "@/lib/alz/ipplan";
import type { Placement } from "@/lib/alz/placement";
import { cn } from "@/lib/utils";

import { GuideLink } from "./Guide";
import { IpPlanPanel } from "./IpPlan";

type StepId =
  "scope" | "groups" | "network" | "edge" | "hybrid" | "dns" | "ip" | "security" | "review";

type Issue = {
  step: StepId;
  level: "error" | "warning" | "info";
  text: string;
  fix?: { label: string; patch: Partial<Answers> } | undefined;
};

const STEPS: { id: StepId; title: string; question: string; icon: typeof Cloud; topic?: string }[] =
  [
    {
      id: "scope",
      title: "Scope",
      question: "Where does this landing zone live, and how is it named?",
      icon: Building2,
    },
    {
      id: "groups",
      title: "Management groups",
      question: "Which kinds of workloads will land here?",
      icon: Waypoints,
      topic: "management-groups",
    },
    {
      id: "network",
      title: "Network model",
      question: "How should workloads connect to each other and to shared services?",
      icon: Network,
      topic: "hub-and-spoke-vs-virtual-wan",
    },
    {
      id: "edge",
      title: "Outbound internet",
      question: "How do workloads reach the internet, and what inspects that traffic?",
      icon: Globe,
      topic: "outbound-internet",
    },
    {
      id: "hybrid",
      title: "On-premises",
      question: "Does Azure need to reach offices or data centers, and how?",
      icon: Server,
      topic: "hybrid-connectivity",
    },
    {
      id: "dns",
      title: "DNS & admin access",
      question: "How do names resolve privately, and how do admins reach VMs?",
      icon: KeyRound,
      topic: "dns-private-link",
    },
    {
      id: "ip",
      title: "IP plan",
      question: "Which address ranges does each network use?",
      icon: MapIcon,
      topic: "ip-planning",
    },
    {
      id: "security",
      title: "Security & operations",
      question: "What does every subscription get for security, monitoring and backup?",
      icon: ShieldCheck,
    },
    {
      id: "review",
      title: "Review",
      question: "Is the design ready to save and deploy?",
      icon: Check,
    },
  ];

const REGIONS = [
  "eastus",
  "eastus2",
  "centralus",
  "westus2",
  "westus3",
  "canadacentral",
  "northeurope",
  "westeurope",
  "uksouth",
  "swedencentral",
  "australiaeast",
  "southeastasia",
  "japaneast",
  "southafricanorth",
];

const yn = (v: boolean) => (v ? "yes" : "no") as "yes" | "no";

/** What still needs attention, per step. Errors block a sensible deploy; warnings are judgment calls. */
function readiness(lib: AlzLibrary, a: Answers): Issue[] {
  const out: Issue[] = [];
  const hub = hasHub(a);
  const corp = a.landingZones.includes("corp");
  if (!a.intermediateRootId.trim())
    out.push({ step: "scope", level: "error", text: "The landing zone needs a prefix." });
  if (corp && !hub)
    out.push({
      step: "network",
      level: "error",
      text: "Corp landing zones connect through a hub, but there's no network model.",
      fix: { label: "Use hub and spoke", patch: { connectivity: "hub_and_spoke" } },
    });
  if (corp && hub && !hasFirewall(a))
    out.push({
      step: "edge",
      level: "warning",
      text: "Corp workloads can't reach the internet: their subnets are private and nothing in the hub provides outbound access.",
      fix: { label: "Add Azure Firewall Standard", patch: { firewall: "Standard" } },
    });
  if (a.defaultGroup !== "sandbox")
    out.push({
      step: "groups",
      level: "warning",
      text: "New subscriptions won't land in Sandbox. Microsoft recommends Sandbox so stray subscriptions never sit under the root.",
      fix: { label: "Default to Sandbox", patch: { defaultGroup: "sandbox" } },
    });
  if ((on(a.vpnGateway) || on(a.expressRoute)) && !hub)
    out.push({
      step: "hybrid",
      level: "error",
      text: "Gateways live in the hub, and there isn't one.",
    });
  if (corp && hub && a.privateDns === "none")
    out.push({
      step: "dns",
      level: "warning",
      text: "Private endpoints in Corp won't resolve centrally without the platform's private DNS zones.",
      fix: { label: "Add private DNS", patch: { privateDns: "platform" } },
    });
  if (on(a.defender) && !a.securityContactEmail.trim())
    out.push({
      step: "security",
      level: "warning",
      text: "No security contact: Defender for Cloud alerts would go to the placeholder security@example.com.",
    });
  // General notes (like Azure's 5 reserved addresses per subnet) stay in the IP plan, not in readiness.
  for (const i of checkIpPlan(a, lib).filter((x) => x.level !== "info"))
    out.push({
      step: "ip",
      level: i.level,
      text: i.text,
      ...(i.fix ? { fix: { label: "Fix it", patch: i.fix } } : {}),
    });
  return out;
}

export function GuidedDesign({
  lib,
  answers,
  setAnswers,
  placed,
  onCanvas,
  onTraffic,
}: {
  lib: AlzLibrary;
  answers: Answers;
  setAnswers?: ((a: Answers) => void) | undefined;
  placed: Placement[];
  onCanvas: () => void;
  onTraffic: () => void;
}) {
  const [step, setStep] = useState<StepId>("scope");
  const [seen, setSeen] = useState<Set<StepId>>(() => new Set(["scope"]));
  const editable = !!setAnswers;
  const set = (patch: Partial<Answers>) => setAnswers?.({ ...answers, ...patch });
  const issues = useMemo(() => readiness(lib, answers), [lib, answers]);
  const idx = STEPS.findIndex((s) => s.id === step);
  const meta = STEPS[idx]!;
  const go = (id: StepId) => {
    setStep(id);
    setSeen((s) => new Set([...s, id]));
  };
  const stepIssues = (id: StepId) => issues.filter((i) => i.step === id);
  const blocking = issues.filter((i) => i.level === "error").length;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[230px_minmax(0,1fr)_330px]">
      <nav aria-label="Design steps" className="space-y-1 xl:sticky xl:top-4">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const own = stepIssues(s.id);
          const err = own.some((x) => x.level === "error");
          const warn = own.some((x) => x.level === "warning");
          const done = seen.has(s.id) && !err && !active;
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
                    : err
                      ? "bg-danger/15 text-danger"
                      : done
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground",
                )}
              >
                {err ? "!" : done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{s.title}</span>
              </span>
              {warn && !err && <span className="size-1.5 rounded-full bg-warning" />}
            </button>
          );
        })}
      </nav>

      <section aria-label={meta.title} className="min-w-0">
        <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <header className="border-b border-border px-6 pt-5 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-primary uppercase">
                Step {idx + 1} of {STEPS.length} · {meta.title}
              </p>
              {meta.topic && (
                <GuideLink topic={meta.topic}>
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                    <Lightbulb className="size-3.5" /> How to decide
                  </span>
                </GuideLink>
              )}
            </div>
            <h2 className="mt-2 text-[21px] leading-snug font-semibold tracking-tight">
              {meta.question}
            </h2>
            {!editable && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Lock className="size-3" /> Read-only: this landing zone is owned by the customer's
                platform team.
              </p>
            )}
          </header>
          <div className="space-y-5 px-6 py-5">
            {step === "scope" && <ScopeStep a={answers} set={set} editable={editable} />}
            {step === "groups" && (
              <GroupsStep lib={lib} a={answers} set={set} editable={editable} placed={placed} />
            )}
            {step === "network" && <NetworkStep a={answers} set={set} editable={editable} />}
            {step === "edge" && (
              <EdgeStep a={answers} set={set} editable={editable} onTraffic={onTraffic} />
            )}
            {step === "hybrid" && <HybridStep a={answers} set={set} editable={editable} />}
            {step === "dns" && <DnsStep a={answers} set={set} editable={editable} />}
            {step === "ip" && (
              <IpPlanPanel answers={answers} lib={lib} set={editable ? set : undefined} />
            )}
            {step === "security" && <SecurityStep a={answers} set={set} editable={editable} />}
            {step === "review" && (
              <ReviewStep
                lib={lib}
                a={answers}
                issues={issues}
                go={go}
                set={editable ? set : undefined}
                onCanvas={onCanvas}
                onTraffic={onTraffic}
              />
            )}
            {step !== "review" && step !== "ip" && stepIssues(step).length > 0 && (
              <Issues items={stepIssues(step)} set={editable ? set : undefined} />
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
              Changes apply to the canvas and the Terraform as you go.
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
      </section>

      <aside className="space-y-4 xl:sticky xl:top-4">
        <AtAGlance lib={lib} a={answers} />
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Readiness</h3>
            <Pill tone={blocking ? "danger" : issues.length ? "warning" : "success"}>
              {blocking
                ? `${blocking} to fix`
                : issues.length
                  ? `${issues.length} to consider`
                  : "Ready"}
            </Pill>
          </div>
          {issues.length ? (
            <ul className="mt-2.5 space-y-2">
              {issues.slice(0, 6).map((i) => (
                <li key={i.text}>
                  <button
                    onClick={() => go(i.step)}
                    className="flex w-full items-start gap-2 text-left text-[12px] leading-snug hover:text-foreground"
                  >
                    <LevelIcon level={i.level} />
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {STEPS.find((s) => s.id === i.step)?.title}:
                      </span>{" "}
                      {i.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Nothing blocks this design. Save it, then review the plan before deploying.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------------------------------- building blocks */

function Choice({
  title,
  body,
  selected,
  onSelect,
  suggested,
  disabled,
  icon,
  multi,
}: {
  title: string;
  body: string;
  selected: boolean;
  onSelect?: (() => void) | undefined;
  /** Why this is the suggested option, when it is. */
  suggested?: string | undefined;
  /** Why it can't be chosen, when it can't. */
  disabled?: string | undefined;
  icon?: ReactNode;
  multi?: boolean;
}) {
  const off = !!disabled || !onSelect;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={off}
      onClick={onSelect}
      className={cn(
        "flex h-full w-full flex-col rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/[0.05] ring-1 ring-primary/25"
          : "border-border bg-card",
        !off && !selected && "hover:border-primary/30 hover:bg-muted/30",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          {icon}
          {title}
        </span>
        <span
          className={cn(
            "grid size-4 shrink-0 place-items-center border",
            multi ? "rounded" : "rounded-full",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
          )}
        >
          {selected && <Check className="size-3" />}
        </span>
      </span>
      <span className="mt-1.5 block text-[12.5px] leading-relaxed text-muted-foreground">
        {body}
      </span>
      {suggested && !disabled && (
        <span className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-success">
          <Lightbulb className="mt-px size-3 shrink-0" />
          <span>
            <span className="font-semibold">Suggested.</span> {suggested}
          </span>
        </span>
      )}
      {disabled && (
        <span className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
          <Lock className="mt-px size-3 shrink-0" />
          {disabled}
        </span>
      )}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-medium">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint && <span className="mt-1 block text-[11.5px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  return (
    <p
      className={cn(
        "flex gap-2 rounded-lg px-3.5 py-2.5 text-[12.5px] leading-relaxed",
        tone === "warning"
          ? "border border-warning/30 bg-warning/[0.08] text-foreground"
          : "bg-muted/50 text-muted-foreground",
      )}
    >
      {tone === "warning" ? (
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
      ) : (
        <Info className="mt-0.5 size-3.5 shrink-0" />
      )}
      <span>{children}</span>
    </p>
  );
}

function LevelIcon({ level }: { level: Issue["level"] }) {
  return level === "error" ? (
    <CircleAlert className="mt-px size-3.5 shrink-0 text-danger" />
  ) : level === "warning" ? (
    <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
  ) : (
    <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
  );
}

function Issues({
  items,
  set,
}: {
  items: Issue[];
  set?: ((p: Partial<Answers>) => void) | undefined;
}) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li
          key={i.text}
          className={cn(
            "flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-[12.5px]",
            i.level === "error"
              ? "border-danger/30 bg-danger/[0.05]"
              : i.level === "warning"
                ? "border-warning/30 bg-warning/[0.07]"
                : "border-border bg-muted/40",
          )}
        >
          <span className="flex min-w-0 flex-1 gap-2">
            <LevelIcon level={i.level} />
            {i.text}
          </span>
          {i.fix && set && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => set(i.fix!.patch)}>
              {i.fix.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

type StepProps = { a: Answers; set: (p: Partial<Answers>) => void; editable: boolean };

/* ------------------------------------------------------------------------------------------------- steps */

function ScopeStep({ a, set, editable }: StepProps) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Prefix"
          hint="Short, lowercase. Every management group id starts with it, e.g. contoso-corp."
        >
          <Input
            className="font-mono"
            disabled={!editable}
            value={a.intermediateRootId}
            onChange={(e) =>
              set({ intermediateRootId: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
            }
          />
        </Field>
        <Field label="Display name" hint="What people see in the portal for the top group.">
          <Input
            disabled={!editable}
            value={a.intermediateRootName}
            onChange={(e) => set({ intermediateRootName: e.target.value })}
          />
        </Field>
        <Field
          label="Primary region"
          hint="Where the hub, the Log Analytics workspace and platform resources are deployed."
        >
          <select
            disabled={!editable}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={a.primaryRegion}
            onChange={(e) => set({ primaryRegion: e.target.value })}
          >
            {[...new Set([a.primaryRegion, ...REGIONS])].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Environments"
          hint="Each workload gets one subscription per environment, in the same management group."
        >
          <Input
            disabled={!editable}
            value={a.environments.join(", ")}
            onChange={(e) =>
              set({
                environments: [
                  ...new Set(
                    e.target.value
                      .split(",")
                      .map((x) => x.trim().toLowerCase())
                      .filter(Boolean),
                  ),
                ],
              })
            }
          />
        </Field>
      </div>
      <Note>
        Environments are subscriptions, not management groups. Dev and test get the same guardrails
        as production, so what you test is what you run (Cloud Adoption Framework).
      </Note>
    </>
  );
}

function GroupsStep({
  lib,
  a,
  set,
  editable,
  placed,
}: StepProps & { lib: AlzLibrary; placed: Placement[] }) {
  const toggle = (g: OptionalGroup, v: boolean) =>
    set({
      landingZones: v
        ? [...new Set([...a.landingZones, g])]
        : a.landingZones.filter((x) => x !== g),
    });
  const platform: { id: RemovableGroup; label: string }[] = [
    { id: "management", label: "Management" },
    { id: "connectivity", label: "Connectivity" },
    { id: "identity", label: "Identity" },
    { id: "security", label: "Security" },
    { id: "decommissioned", label: "Decommissioned" },
  ];
  return (
    <>
      <div>
        <p className="mb-2 text-[12.5px] font-medium">Landing zones (pick all that apply)</p>
        <div className="grid gap-3 md:grid-cols-2">
          {(["corp", "online", "local", "sandbox"] as const).map((g) => {
            const exists = lib.managementGroups.some((m) => m.id === g);
            const live = placed.filter((p) => p.landingZone === g).length;
            const included = exists && a.landingZones.includes(g);
            return (
              <Choice
                key={g}
                multi
                title={LANDING_ZONE_LABEL[g]?.title ?? g}
                body={LANDING_ZONE_LABEL[g]?.body ?? ""}
                selected={included}
                onSelect={editable ? () => toggle(g, !included) : undefined}
                suggested={
                  g === "corp"
                    ? "Part of the ALZ reference: private workloads behind the hub."
                    : g === "online"
                      ? "Part of the ALZ reference: internet-facing workloads."
                      : g === "sandbox"
                        ? "Somewhere safe to experiment, away from production."
                        : undefined
                }
                disabled={
                  !exists
                    ? `Not in ALZ ${shortRef(lib.ref)}. Upgrade the ALZ version to use it.`
                    : included && live
                      ? `${live} install${live === 1 ? " is" : "s are"} placed here, so it can't be removed.`
                      : undefined
                }
              />
            );
          })}
        </div>
      </div>
      <Field
        label="Where new subscriptions land"
        hint="A subscription created without a target lands here."
      >
        <select
          disabled={!editable}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px] md:w-80"
          value={a.defaultGroup}
          onChange={(e) => set({ defaultGroup: e.target.value })}
        >
          <option value="">Tenant root (Azure's default)</option>
          {hierarchy(lib, a).map((n) => (
            <option key={n.id} value={n.libraryId}>
              {n.displayName}
              {n.libraryId === "sandbox" ? " (recommended)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <div>
        <p className="mb-2 text-[12.5px] font-medium">Platform groups</p>
        <div className="grid gap-2 md:grid-cols-2">
          {platform.map((p) => {
            const kept = !a.removedGroups.includes(p.id);
            return (
              <label
                key={p.id}
                className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  disabled={!editable}
                  checked={kept}
                  onChange={(e) =>
                    set({
                      removedGroups: e.target.checked
                        ? a.removedGroups.filter((x) => x !== p.id)
                        : [...a.removedGroups, p.id],
                    })
                  }
                />
                <span>
                  <span className="block text-[13px] font-medium">{p.label}</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {MG_PURPOSE[p.id] ?? ""}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Keep them unless you have a reason not to: removing a group moves its subscriptions up to
          the parent, where they inherit broader policy. Add your own groups on the canvas.
        </p>
      </div>
    </>
  );
}

function NetworkStep({ a, set, editable }: StepProps) {
  const corp = a.landingZones.includes("corp");
  const many = !!a.secondaryRegion || (on(a.vpnGateway) && on(a.expressRoute));
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Choice
          icon={<Network className="size-4 text-primary" />}
          title="Hub and spoke"
          body="A hub virtual network you run: firewall, gateways and DNS live there, and each workload network peers to it. Full control of routing."
          selected={a.connectivity === "hub_and_spoke"}
          onSelect={editable ? () => set({ connectivity: "hub_and_spoke" }) : undefined}
          suggested={
            !many ? "One region and a few connections: a hub you control is simplest." : undefined
          }
        />
        <Choice
          icon={<Route className="size-4 text-primary" />}
          title="Virtual WAN"
          body="Microsoft-managed hubs that route between workloads, branches and regions for you. Less to operate, less to customize."
          selected={a.connectivity === "virtual_wan"}
          onSelect={editable ? () => set({ connectivity: "virtual_wan" }) : undefined}
          suggested={
            many
              ? "More than one region or several connection types: managed routing pays off."
              : undefined
          }
        />
        <Choice
          icon={<Cloud className="size-4 text-primary" />}
          title="No central network"
          body="Every workload brings its own network and internet access. Only for estates with nothing private to connect."
          selected={a.connectivity === "none"}
          onSelect={editable ? () => set({ connectivity: "none" }) : undefined}
          disabled={
            corp
              ? "Corp landing zones need a hub. Remove Corp in Management groups first."
              : undefined
          }
        />
      </div>
      {hasHub(a) && (
        <Field
          label="Second region"
          hint="Adds a second hub in another region; the hubs connect to each other. Leave empty for one region."
        >
          <select
            disabled={!editable}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px] md:w-80"
            value={a.secondaryRegion}
            onChange={(e) => set({ secondaryRegion: e.target.value })}
          >
            <option value="">None</option>
            {REGIONS.filter((r) => r !== a.primaryRegion).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

const TIERS: { value: Answers["firewall"]; title: string; body: string }[] = [
  {
    value: "Basic",
    title: "Firewall Basic",
    body: "For small estates: network and application rules, threat intelligence alerts, fixed throughput.",
  },
  {
    value: "Standard",
    title: "Firewall Standard",
    body: "Network and FQDN rules, threat intelligence filtering, autoscale. The common choice for central egress.",
  },
  {
    value: "Premium",
    title: "Firewall Premium",
    body: "Adds TLS inspection, IDPS and URL filtering for regulated or sensitive workloads.",
  },
  {
    value: "none",
    title: "No firewall",
    body: "Nothing in the hub inspects or provides outbound access. Workloads need their own NAT gateway or public IP.",
  },
];

function EdgeStep({ a, set, editable, onTraffic }: StepProps & { onTraffic: () => void }) {
  const hub = hasHub(a);
  const corp = a.landingZones.includes("corp");
  const online = a.landingZones.includes("online");
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {TIERS.map((t) => (
          <Choice
            key={t.value}
            title={t.title}
            body={t.body}
            selected={a.firewall === t.value && hub}
            onSelect={editable && hub ? () => set({ firewall: t.value }) : undefined}
            suggested={
              t.value === "Standard" && corp
                ? "Gives Corp workloads a controlled way out; choose Premium if you need TLS inspection or IDPS."
                : undefined
            }
            disabled={!hub ? "Needs a hub. Choose a network model first." : undefined}
          />
        ))}
      </div>
      <div className="rounded-xl border border-border p-4">
        <p className="text-[13px] font-semibold">How traffic leaves Azure in this design</p>
        <ul className="mt-2 space-y-2 text-[12.5px]">
          {corp && (
            <li className="flex gap-2">
              <Waypoints className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium">Corp:</span>{" "}
                {hasFirewall(a)
                  ? "each spoke subnet's route table sends 0.0.0.0/0 to the hub firewall, which allows or denies by rule and leaves through its own public IP."
                  : "spoke subnets are private and nothing in the hub provides a way out, so Corp workloads can't reach the internet."}
              </span>
            </li>
          )}
          {online && (
            <li className="flex gap-2">
              <Globe className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium">Online:</span> not routed through the hub. Each
                workload brings its own outbound and inbound (for example a NAT gateway, load
                balancer or Application Gateway).
              </span>
            </li>
          )}
          {!corp && !online && (
            <li className="text-muted-foreground">
              No Corp or Online landing zones in the design.
            </li>
          )}
        </ul>
        <Button size="sm" variant="outline" className="mt-3" onClick={onTraffic}>
          <Waypoints className="size-3.5" /> Trace it hop by hop
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
        <span>
          <span className="block text-[13px] font-medium">DDoS Network Protection</span>
          <span className="block text-[11.5px] text-muted-foreground">
            One plan for the tenant; policy enrolls every virtual network. Worth it when public
            endpoints matter to the business.
          </span>
        </span>
        <input
          type="checkbox"
          aria-label="DDoS Network Protection"
          className="size-4"
          disabled={!editable || !hub}
          checked={on(a.ddosPlan)}
          onChange={(e) => set({ ddosPlan: yn(e.target.checked) })}
        />
      </div>
    </>
  );
}

function HybridStep({ a, set, editable }: StepProps) {
  const hub = hasHub(a);
  const need = !hub ? "Gateways live in the hub. Choose a network model first." : undefined;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Choice
          multi
          title="VPN gateway"
          body="Encrypted site-to-site tunnels over the internet. Quick to set up; throughput depends on the internet path."
          selected={on(a.vpnGateway)}
          onSelect={editable ? () => set({ vpnGateway: yn(!on(a.vpnGateway)) }) : undefined}
          disabled={need}
        />
        <Choice
          multi
          title="ExpressRoute gateway"
          body="A private circuit from a connectivity provider; traffic never crosses the internet. Predictable latency."
          selected={on(a.expressRoute)}
          onSelect={editable ? () => set({ expressRoute: yn(!on(a.expressRoute)) }) : undefined}
          disabled={need}
        />
        <Choice
          title="Cloud only"
          body="Nothing to connect on-premises. You can add a gateway later without redesigning."
          selected={!on(a.vpnGateway) && !on(a.expressRoute)}
          onSelect={editable ? () => set({ vpnGateway: "no", expressRoute: "no" }) : undefined}
        />
      </div>
      <Note>
        On-premises address ranges are set in the IP plan, so they're checked for overlaps with
        every Azure network.
      </Note>
    </>
  );
}

function DnsStep({ a, set, editable }: StepProps) {
  const hub = hasHub(a);
  const need = !hub ? "Needs a hub. Choose a network model first." : undefined;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Choice
          title="Platform private DNS"
          body="The privatelink.* zones live in the connectivity subscription, linked to the hub, with a DNS Private Resolver. Policy registers every private endpoint automatically."
          selected={a.privateDns === "platform" && hub}
          onSelect={editable && hub ? () => set({ privateDns: "platform" }) : undefined}
          suggested={
            a.landingZones.includes("corp")
              ? "Corp denies public endpoints, so private endpoints have to resolve centrally."
              : undefined
          }
          disabled={need}
        />
        <Choice
          title="Workloads manage DNS"
          body="No central zones. Each team resolves its own private endpoints, and on-premises can't resolve them through the hub."
          selected={a.privateDns === "none" || !hub}
          onSelect={editable && hub ? () => set({ privateDns: "none" }) : undefined}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Choice
          multi
          title="Azure Bastion"
          body="Browser-based RDP and SSH to VMs over their private IPs, so VMs never need public IPs or open management ports."
          selected={on(a.bastion) && hub}
          onSelect={editable && hub ? () => set({ bastion: yn(!on(a.bastion)) }) : undefined}
          disabled={need}
        />
        <Choice
          multi
          title="Identity subscription"
          body="A separate subscription for domain controllers or Entra Domain Services, when workloads need them."
          selected={on(a.identity)}
          onSelect={editable ? () => set({ identity: yn(!on(a.identity)) }) : undefined}
        />
      </div>
    </>
  );
}

function SecurityStep({ a, set, editable }: StepProps) {
  const toggles: [keyof Answers, string, string][] = [
    ["defender", "Defender for Cloud", "Posture and threat protection on every subscription."],
    ["updateManager", "Update Manager", "Periodic assessment of missing patches on every VM."],
    ["serviceHealth", "Service Health alerts", "Know about Azure incidents that affect you."],
    ["vmBackup", "VM backup", "Policy enables Azure Backup on VMs that are tagged for it."],
  ];
  return (
    <>
      <div className="grid gap-2 md:grid-cols-2">
        {toggles.map(([k, label, hint]) => (
          <label
            key={k}
            className="flex items-start gap-2.5 rounded-lg border border-border px-3.5 py-3"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              disabled={!editable}
              checked={on(a[k] as "yes" | "no")}
              onChange={(e) => set({ [k]: yn(e.target.checked) } as Partial<Answers>)}
            />
            <span>
              <span className="block text-[13px] font-medium">{label}</span>
              <span className="block text-[11.5px] text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Security contact" hint="Defender for Cloud sends alerts here.">
          <Input
            type="email"
            disabled={!editable}
            placeholder="secops@contoso.com"
            value={a.securityContactEmail}
            onChange={(e) => set({ securityContactEmail: e.target.value })}
          />
        </Field>
        <Field label="SIEM" hint="Where security signals are analyzed.">
          <select
            disabled={!editable}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={a.siem}
            onChange={(e) => set({ siem: e.target.value as Answers["siem"] })}
          >
            <option value="sentinel">Microsoft Sentinel</option>
            <option value="other">Another SIEM</option>
          </select>
        </Field>
        <Field label="Log retention" hint="In the central Log Analytics workspace.">
          <select
            disabled={!editable}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            value={a.logRetentionDays}
            onChange={(e) => set({ logRetentionDays: Number(e.target.value) })}
          >
            {[...new Set([a.logRetentionDays, 30, 90, 180, 365, 730])]
              .sort((x, y) => x - y)
              .map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
          </select>
        </Field>
      </div>
    </>
  );
}

function ReviewStep({
  lib,
  a,
  issues,
  go,
  set,
  onCanvas,
  onTraffic,
}: {
  lib: AlzLibrary;
  a: Answers;
  issues: Issue[];
  go: (s: StepId) => void;
  set?: ((p: Partial<Answers>) => void) | undefined;
  onCanvas: () => void;
  onTraffic: () => void;
}) {
  const rows: [StepId, string, string][] = [
    ["scope", "Scope", `${a.intermediateRootName} (${a.intermediateRootId}) · ${a.primaryRegion}`],
    [
      "groups",
      "Landing zones",
      a.landingZones.map((g) => LANDING_ZONE_LABEL[g]?.title ?? g).join(", ") || "None",
    ],
    [
      "network",
      "Network model",
      a.connectivity === "hub_and_spoke"
        ? `Hub and spoke${a.secondaryRegion ? `, second hub in ${a.secondaryRegion}` : ""}`
        : a.connectivity === "virtual_wan"
          ? `Virtual WAN${a.secondaryRegion ? `, second hub in ${a.secondaryRegion}` : ""}`
          : "No central network",
    ],
    [
      "edge",
      "Outbound internet",
      hasFirewall(a) ? `Azure Firewall ${a.firewall}` : "No central egress",
    ],
    [
      "hybrid",
      "On-premises",
      [on(a.vpnGateway) && "VPN", on(a.expressRoute) && "ExpressRoute"]
        .filter(Boolean)
        .join(" + ") || "Cloud only",
    ],
    [
      "dns",
      "DNS & admin access",
      [
        a.privateDns === "platform" && hasHub(a) ? "Platform private DNS" : "Workload DNS",
        on(a.bastion) && hasHub(a) && "Bastion",
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    [
      "ip",
      "IP plan",
      `Hub ${a.hubAddressSpace}${a.onPremRanges.length ? ` · on-premises ${a.onPremRanges.join(", ")}` : ""}`,
    ],
    [
      "security",
      "Security & operations",
      [
        on(a.defender) && "Defender",
        a.siem === "sentinel" && "Sentinel",
        `${a.logRetentionDays}-day logs`,
      ]
        .filter(Boolean)
        .join(" · "),
    ],
  ];
  return (
    <>
      <dl className="divide-y divide-border rounded-xl border border-border">
        {rows.map(([id, k, v]) => (
          <div key={id} className="flex items-start justify-between gap-4 px-4 py-2.5">
            <dt className="w-44 shrink-0 text-[12.5px] text-muted-foreground">{k}</dt>
            <dd className="min-w-0 flex-1 text-[13px]">{v}</dd>
            <button
              onClick={() => go(id)}
              className="shrink-0 text-[12px] font-medium text-primary hover:underline"
            >
              Change
            </button>
          </div>
        ))}
      </dl>
      {issues.length ? (
        <Issues items={issues} set={set} />
      ) : (
        <Note>Nothing blocks this design.</Note>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            const blob = new Blob([designDocument(lib, a, issues, a.intermediateRootName)], {
              type: "text/markdown",
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${a.intermediateRootId || "landing-zone"}-design.md`;
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <FileDown className="size-4" /> Download design document
        </Button>
        <Button variant="outline" onClick={onCanvas}>
          See it on the canvas
        </Button>
        <Button variant="outline" onClick={onTraffic}>
          <Waypoints className="size-4" /> Trace the traffic
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Save with the button at the top. Saving shows exactly what changes against what's deployed
        before anything is deployed. {hierarchy(lib, a).length} management groups in this design.
      </p>
    </>
  );
}

/* --------------------------------------------------------------------------------- design document */

function designDocument(lib: AlzLibrary, a: Answers, issues: Issue[], name: string) {
  const plan = ipPlan(a, lib);
  const tree = hierarchy(lib, a);
  const zones = a.landingZones.map((g) => LANDING_ZONE_LABEL[g]?.title ?? g).join(", ") || "None";
  const egress = !hasHub(a)
    ? "No central network: each workload provides its own outbound access."
    : hasFirewall(a)
      ? `Corp spoke subnets send 0.0.0.0/0 to Azure Firewall ${a.firewall} in the hub, which allows or denies by rule. Online workloads aren't routed through the hub and bring their own outbound.`
      : "No firewall: Corp spoke subnets are private and have no way out until a firewall or NAT gateway is added.";
  const lines = [
    `# Landing zone design: ${name}`,
    "",
    `Generated by Cloud Delivery on ${new Date().toISOString().slice(0, 10)} from Azure Landing Zones library ${shortRef(lib.ref)}.`,
    "",
    "## Decisions",
    "",
    "| Area | Decision |",
    "| --- | --- |",
    `| Scope | ${a.intermediateRootName} (\`${a.intermediateRootId}\`), primary region ${a.primaryRegion}, environments ${a.environments.join(", ")} |`,
    `| Landing zones | ${zones}; new subscriptions land in ${a.defaultGroup || "the tenant root"} |`,
    `| Network model | ${a.connectivity === "hub_and_spoke" ? "Hub and spoke" : a.connectivity === "virtual_wan" ? "Virtual WAN" : "No central network"}${a.secondaryRegion ? `, second hub in ${a.secondaryRegion}` : ""} |`,
    `| Outbound internet | ${hasFirewall(a) ? `Azure Firewall ${a.firewall}` : "No central egress"}${on(a.ddosPlan) ? ", DDoS Network Protection" : ""} |`,
    `| On-premises | ${[on(a.vpnGateway) && "VPN gateway", on(a.expressRoute) && "ExpressRoute gateway"].filter(Boolean).join(" + ") || "Cloud only"} |`,
    `| DNS & access | ${a.privateDns === "platform" && hasHub(a) ? "Platform private DNS zones with DNS Private Resolver" : "Workload-managed DNS"}${on(a.bastion) && hasHub(a) ? "; Azure Bastion" : ""}${on(a.identity) ? "; identity subscription" : ""} |`,
    `| Security & operations | ${[on(a.defender) && "Defender for Cloud", a.siem === "sentinel" ? "Microsoft Sentinel" : "external SIEM", `${a.logRetentionDays}-day log retention`, on(a.updateManager) && "Update Manager", on(a.vmBackup) && "VM backup"].filter(Boolean).join(", ")} |`,
    "",
    "## How traffic leaves Azure",
    "",
    egress,
    "",
    "## Management groups",
    "",
    ...tree.map((n) => `${"  ".repeat(n.depth)}- ${n.displayName} (\`${n.id}\`)`),
    "",
    "## IP plan",
    "",
    "| Range | CIDR | Purpose |",
    "| --- | --- | --- |",
    ...plan.blocks.map((b) => `| ${b.label} | ${b.cidr} | ${b.purpose} |`),
    "| Customer installs | 10.60.0.0/19 | Offerings' default network, one /22 per install |",
    "",
    "## Readiness",
    "",
    ...(issues.length
      ? issues.map(
          (i) => `- **${i.level}** (${STEPS.find((x) => x.id === i.step)?.title}): ${i.text}`,
        )
      : ["- Nothing blocks this design."]),
    "",
    "## Sources",
    "",
    "- Azure landing zone design areas: https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/design-areas",
    "- Default outbound access: https://learn.microsoft.com/azure/virtual-network/ip-services/default-outbound-access",
    "- Hub-spoke network topology: https://learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke",
    "",
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------------------------- at a glance */

function AtAGlance({ lib, a }: { lib: AlzLibrary; a: Answers }) {
  const tree = hierarchy(lib, a);
  const hub = hasHub(a);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-[13px] font-semibold">At a glance</h3>
      <p className="mt-2.5 text-[10.5px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        Management groups
      </p>
      <ul className="mt-1 space-y-0.5 text-[12px]">
        {tree.slice(0, 14).map((n) => (
          <li
            key={n.id}
            style={{ paddingLeft: n.depth * 12 }}
            className={cn("truncate", n.depth === 0 && "font-semibold")}
          >
            {n.depth > 0 && <span className="mr-1 text-muted-foreground">└</span>}
            {n.displayName}
          </li>
        ))}
        {tree.length > 14 && <li className="text-muted-foreground">and {tree.length - 14} more</li>}
      </ul>
      <p className="mt-3.5 text-[10.5px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        Network
      </p>
      <div className="mt-1.5 space-y-1.5 text-[12px]">
        <Lane icon={<Globe className="size-3.5" />} label="Internet" />
        <Arrow />
        <Lane
          icon={<ShieldCheck className="size-3.5" />}
          label={hasFirewall(a) ? `Azure Firewall ${a.firewall}` : "No central firewall"}
          muted={!hasFirewall(a)}
        />
        <Arrow />
        <Lane
          icon={<Network className="size-3.5" />}
          label={
            !hub
              ? "No hub"
              : `${a.connectivity === "virtual_wan" ? "Virtual hub" : "Hub"} · ${a.primaryRegion} · ${a.hubAddressSpace}`
          }
          muted={!hub}
        />
        {hub && a.secondaryRegion && (
          <Lane
            icon={<Network className="size-3.5" />}
            label={`Second hub · ${a.secondaryRegion} · ${a.secondaryHubAddressSpace}`}
          />
        )}
        {hub && (on(a.vpnGateway) || on(a.expressRoute)) && (
          <Lane
            icon={<Server className="size-3.5" />}
            label={`On-premises via ${[on(a.vpnGateway) && "VPN", on(a.expressRoute) && "ExpressRoute"].filter(Boolean).join(" + ")}`}
          />
        )}
        <Arrow />
        <Lane
          icon={<Waypoints className="size-3.5" />}
          label={
            a.landingZones.map((g) => LANDING_ZONE_LABEL[g]?.title ?? g).join(" · ") ||
            "No landing zones"
          }
        />
      </div>
    </section>
  );
}

function Lane({ icon, label, muted }: { icon: ReactNode; label: string; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5",
        muted ? "border-dashed border-border text-muted-foreground" : "border-border bg-muted/30",
      )}
    >
      <span className="text-primary">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

function Arrow() {
  return <div className="ml-4 h-2 w-px bg-border" />;
}
