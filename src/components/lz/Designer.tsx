/*
 * Landing zone designer: Microsoft's reference architecture as a canvas. Tick what the platform needs, open
 * any management group or subscription for its policies and access, trace traffic, and ask the advisor.
 * Every choice maps to the Terraform on the Infrastructure as code tab.
 */
import {
  ArrowRight,
  Boxes,
  Check,
  CircleAlert,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Route,
  ShieldCheck,
  Lightbulb,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { ArchitectureDiagram } from "@/components/lz/ArchitectureDiagram";
import { AccessPanel, AdvisorPanel, PolicyAddsPanel } from "@/components/lz/Panels";
import type { Assessment } from "@/lib/alz/assess";
import { designContext } from "@/lib/alz/context";
import { PERSONAS } from "@/lib/alz/governance";
import { WORKLOADS } from "@/lib/alz/workloads";
import { Pill } from "@/components/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  type AlzLibrary,
  type Answers,
  type Change,
  type MgNode,
  type OptionalGroup,
  LANDING_ZONE_LABEL,
  MG_PURPOSE,
  REMOVABLE_GROUPS,
  type CustomGroup,
  type RemovableGroup,
  changesFor,
  effectivePolicies,
  hasHub,
  hierarchy,
  includedGroups,
  mgIdFor,
  on,
  platformResources,
  platformSubscriptions,
  shortRef,
} from "@/lib/alz/engine";
import type { Placement } from "@/lib/alz/placement";
import { type Flow, type Sel, type Spoke, flowsFor, spokesFor } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

type Lens = "build" | "traffic";

/** What each platform resource is, in plain words, and the ALZ assignments that act on or depend on it. */
const RESOURCE_INFO: Record<string, { what: string; policies: string[] }> = {
  hubvnet: {
    what: "The central virtual network. Shared services live here, and every Corp spoke peers to it. Peering is not transitive, so spokes only reach each other through the hub.",
    policies: ["Enable-DDoS-VNET"],
  },
  vhub: {
    what: "A Microsoft-managed virtual hub router. Spokes attach with hub connections; routing between them, branches and gateways is automatic.",
    policies: ["Enable-DDoS-VNET"],
  },
  vwan: {
    what: "The Virtual WAN resource that owns the hubs. Add hubs in more regions later and they mesh automatically.",
    policies: [],
  },
  sidecar: {
    what: "A small virtual network attached to the virtual hub for services that can't live inside the hub itself — Bastion and the DNS resolver.",
    policies: [],
  },
  firewall: {
    what: "A managed, stateful firewall. Spoke egress, spoke-to-spoke and on-premises traffic is routed through it.",
    policies: [],
  },
  vpngw: {
    what: "Encrypted site-to-site IPsec tunnels to offices and data centers over the internet.",
    policies: ["Deny-HybridNetworking"],
  },
  ergw: {
    what: "Connects a private ExpressRoute circuit from a connectivity provider — traffic never crosses the internet.",
    policies: ["Deny-HybridNetworking"],
  },
  bastion: {
    what: "Browser-based RDP and SSH to VMs over their private IPs. VMs never need public IPs.",
    policies: ["Deny-MgmtPorts-Internet", "Deny-Public-IP-On-NIC"],
  },
  dnsresolver: {
    what: "Inbound and outbound DNS endpoints in the hub, so on-premises servers can resolve private endpoints and Azure can resolve on-premises names.",
    policies: ["Deploy-Private-DNS-Zones"],
  },
  dnszones: {
    what: "The privatelink.* private DNS zones, linked to the hub. Policy writes a record here whenever a private endpoint is created.",
    policies: ["Deploy-Private-DNS-Zones", "Audit-PeDnsZones", "Deny-Public-Endpoints"],
  },
  ddos: {
    what: "Azure DDoS Network Protection. One plan covers the tenant; policy enrolls every virtual network in it.",
    policies: ["Enable-DDoS-VNET"],
  },
  law: {
    what: "The central Log Analytics workspace. Platform and workload logs, activity logs and security signals land here.",
    policies: ["Deploy-AzActivity-Log", "Deploy-Diag-LogsCat", "Deploy-VM-Monitoring"],
  },
  dcr: {
    what: "Rules that tell the Azure Monitor Agent what to collect: VM insights, change tracking and Defender for SQL.",
    policies: ["Deploy-VM-Monitoring", "Deploy-VM-ChangeTrack", "Deploy-MDFC-DefSQL-AMA"],
  },
  ama: {
    what: "A user-assigned managed identity that policy gives every VM so the Azure Monitor Agent can send data.",
    policies: ["Deploy-VM-Monitoring", "Deploy-VMSS-Monitoring"],
  },
  sentinel: {
    what: "Microsoft Sentinel on the central workspace — detections, incidents and hunting for the security team.",
    policies: [],
  },
};

const NAMES: Record<string, string> = {
  sidecar: "Sidecar virtual network",
  hubvnet: "Hub virtual network",
  hubvnet2: "Hub virtual network (second region)",
  vhub: "Virtual hub",
  vhub2: "Virtual hub (second region)",
};

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

const FIREWALL_TIERS: { value: Answers["firewall"]; label: string; body: string }[] = [
  { value: "none", label: "None", body: "No central inspection" },
  { value: "Basic", label: "Basic", body: "Small estates, fixed throughput" },
  { value: "Standard", label: "Standard", body: "Threat intel, FQDN rules, autoscale" },
  { value: "Premium", label: "Premium", body: "Adds TLS inspection, IDPS, URL filtering" },
];

export function LandingZoneDesigner({
  lib,
  answers,
  setAnswers,
  dirty,
  onSave,
  onDiscard,
  saving,
  placed,
  readOnlyOwner,
  name = "",
  assessment = null,
}: {
  lib: AlzLibrary;
  answers: Answers;
  setAnswers?: ((a: Answers) => void) | undefined;
  dirty: boolean;
  onSave?: (() => void) | undefined;
  onDiscard?: (() => void) | undefined;
  saving?: boolean | undefined;
  placed: Placement[];
  /** Set for customer-owned landing zones: the design can be explored but not changed. */
  readOnlyOwner?: string | undefined;
  name?: string;
  assessment?: Assessment | null;
}) {
  const editable = !!setAnswers && !readOnlyOwner;
  const [panel, setPanel] = useState<"design" | "details" | "traffic" | "access" | "advisor">(
    editable ? "design" : "details",
  );
  const [sel, setSel] = useState<Sel | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [full, setFull] = useState(false);
  const [open, setOpen] = useState(true);

  const tree = useMemo(() => hierarchy(lib, answers), [lib, answers]);
  const spokes = useMemo(
    () =>
      spokesFor(
        ["corp", "online", "local", "sandbox"].filter((g) => tree.some((t) => t.libraryId === g)),
        placed,
      ),
    [tree, placed],
  );
  const flows = useMemo(() => flowsFor({ spokes }, answers), [spokes, answers]);
  const changes = useMemo(() => changesFor(lib, answers), [lib, answers]);
  const flow = panel === "traffic" ? (flows.find((f) => f.id === flowId) ?? null) : null;

  useEffect(() => setStep(0), [flowId, answers]);
  useEffect(() => {
    if (!playing || !flow?.available) return;
    const t = setInterval(() => setStep((s) => (s + 1) % flow.steps.length), 2600);
    return () => clearInterval(t);
  }, [playing, flow]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const set = (patch: Partial<Answers>) => setAnswers?.({ ...answers, ...patch });
  const select = (s: Sel | null) => {
    setSel(s);
    if (s) {
      setPanel("details");
      setOpen(true);
    }
  };
  const omitted = lib.managementGroups.length - includedGroups(lib, answers).length;
  const changeCount =
    groupChanges(changes.filter((c) => c.action === "remove")).length +
    changes.filter((c) => c.action === "audit").length +
    omitted;
  const topology =
    answers.connectivity === "virtual_wan"
      ? "Virtual WAN"
      : answers.connectivity === "hub_and_spoke"
        ? "Hub & spoke"
        : "No central network";

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
      <div>
        <p className="text-[13px] font-semibold">
          Azure landing zone — {topology}
          <span className="ml-2 font-normal text-muted-foreground">
            ALZ {shortRef(lib.ref)} ·{" "}
            {changeCount
              ? `${changeCount} change${changeCount === 1 ? "" : "s"} from Microsoft's reference`
              : "Microsoft's reference, unchanged"}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        {editable && dirty && (
          <>
            <span className="text-warning">Unsaved changes</span>
            <Button size="sm" variant="ghost" className="h-7" onClick={onDiscard}>
              Discard
            </Button>
            <Button size="sm" className="h-7" disabled={saving} onClick={onSave}>
              {saving ? "Saving…" : "Save design"}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-[#8661c5]/40 text-[#5c2e91]"
          onClick={() => {
            setPanel("advisor");
            setOpen(true);
          }}
        >
          <Sparkles className="size-3.5" /> Ask the advisor
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide panel" : "Show panel"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => setFull((f) => !f)}
          aria-label={full ? "Exit full screen" : "Full screen"}
        >
          {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>
    </div>
  );

  const inspector = (
    <Inspector
      lens={panel === "traffic" ? "traffic" : "build"}
      sel={sel}
      setSel={select}
      lib={lib}
      tree={tree}
      answers={answers}
      set={editable ? set : undefined}
      changes={changes}
      placed={placed}
      flows={flows}
      flow={flow}
      setFlowId={(id) => {
        setFlowId(id);
        setPlaying(true);
        setPanel("traffic");
      }}
      step={step}
      setStep={(i) => {
        setStep(i);
        setPlaying(false);
      }}
      playing={playing}
      setPlaying={setPlaying}
      spokes={spokes}
      omitted={omitted}
    />
  );

  return (
    <div
      className={cn(
        "grid border-border bg-card",
        full ? "fixed inset-0 z-50" : "rounded-md border",
        open && (full ? "grid-cols-[minmax(0,1fr)_340px]" : "xl:grid-cols-[minmax(0,1fr)_340px]"),
      )}
    >
      <section className={cn("flex min-w-0 flex-col", full && "h-screen")}>
        {header}
        <div
          className={cn("overflow-x-auto", full && "min-h-0 flex-1 overflow-y-auto")}
          onClick={() => setSel(null)}
        >
          <ArchitectureDiagram
            lib={lib}
            tree={tree}
            answers={answers}
            set={editable ? set : undefined}
            spokes={spokes}
            sel={sel}
            onSelect={select}
            flow={flow}
            step={step}
          />
        </div>
      </section>
      <aside
        className={cn(
          "flex min-h-0 flex-col border-t border-border xl:border-t-0 xl:border-l",
          !open && "hidden",
          full ? "h-screen" : "self-start xl:sticky xl:top-0 xl:h-[calc(100vh-1rem)]",
        )}
      >
        <div className="flex border-b border-border px-2 pt-2">
          {(
            [
              ["design", editable ? "Design" : "About"],
              ["details", "Details"],
              ["traffic", "Traffic"],
              ["access", "Access"],
              ["advisor", "✦ Advisor"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setPanel(id);
                if (id === "traffic" && !flowId)
                  setFlowId(flows.find((f) => f.available)?.id ?? null);
              }}
              className={cn(
                "-mb-px border-b-2 px-2 pb-2 text-[12.5px] whitespace-nowrap transition-colors",
                id === "advisor" && "text-[#8661c5]",
                panel === id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {id === "design" && editable && dirty && (
                <span className="ml-1.5 inline-block size-1.5 rounded-full bg-warning align-middle" />
              )}
            </button>
          ))}
        </div>
        {panel === "design" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {editable ? (
              <Palette
                lib={lib}
                answers={answers}
                set={set}
                placed={placed}
                dirty={dirty}
                onSave={onSave}
                onDiscard={onDiscard}
                saving={saving}
                changes={changeCount}
              />
            ) : (
              <ReadOnlyPanel owner={readOnlyOwner ?? "the customer"} placed={placed} />
            )}
          </div>
        ) : panel === "access" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AccessPanel tree={tree} answers={answers} set={editable ? set : undefined} />
          </div>
        ) : panel === "advisor" ? (
          <div className="min-h-0 flex-1">
            <AdvisorPanel
              answers={answers}
              set={editable ? (p) => setAnswers?.({ ...answers, ...p }) : undefined}
              assessed={!!assessment}
              context={() =>
                designContext(lib, answers, placed, { name, owner: readOnlyOwner, assessment })
              }
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">{inspector}</div>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ palette */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-3">
      <h3 className="mb-2 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  disabled,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
  disabled?: boolean | undefined;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", disabled && "opacity-45")}>
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium">{label}</p>
        {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        "flex rounded-md border border-border bg-muted/40 p-0.5",
        disabled && "pointer-events-none opacity-45",
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-2 py-1 text-[11.5px] font-medium whitespace-nowrap transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Palette({
  lib,
  answers,
  set,
  placed,
  dirty,
  onSave,
  onDiscard,
  saving,
  changes,
}: {
  lib: AlzLibrary;
  answers: Answers;
  set: (p: Partial<Answers>) => void;
  placed: Placement[];
  dirty: boolean;
  onSave?: (() => void) | undefined;
  onDiscard?: (() => void) | undefined;
  saving?: boolean | undefined;
  changes: number;
}) {
  const hub = hasHub(answers);
  const yn = (v: boolean) => (v ? "yes" : "no") as "yes" | "no";
  const toggleGroup = (g: OptionalGroup, v: boolean) =>
    set({
      landingZones: v
        ? [...new Set([...answers.landingZones, g])]
        : answers.landingZones.filter((x) => x !== g),
    });

  return (
    <>
      <p className="border-b border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        Every change rebuilds the picture and the Terraform.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Tenant">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted-foreground">
              Prefix
              <Input
                className="mt-0.5 h-7 font-mono text-xs"
                value={answers.intermediateRootId}
                onChange={(e) => set({ intermediateRootId: e.target.value.toLowerCase() })}
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Region
              <select
                className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-1.5 font-mono text-xs"
                value={answers.primaryRegion}
                onChange={(e) => set({ primaryRegion: e.target.value })}
              >
                {[...new Set([answers.primaryRegion, ...REGIONS])].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-[11px] text-muted-foreground">
            New subscriptions go to
            <select
              className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs"
              value={answers.defaultGroup}
              onChange={(e) => set({ defaultGroup: e.target.value })}
            >
              <option value="">Tenant root (Azure default)</option>
              {hierarchy(lib, answers).map((n) => (
                <option key={n.id} value={n.libraryId}>
                  {n.displayName}
                </option>
              ))}
            </select>
            {answers.defaultGroup !== "sandbox" && (
              <span className="mt-1 flex gap-1 text-[11px] text-[#5c4400]">
                <Lightbulb className="mt-px size-3 shrink-0 text-[#c08b00]" />
                Microsoft recommends Sandbox, so stray subscriptions never land under the root.
              </span>
            )}
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Display name
            <Input
              className="mt-0.5 h-7 text-xs"
              value={answers.intermediateRootName}
              onChange={(e) => set({ intermediateRootName: e.target.value })}
            />
          </label>
        </Section>

        <Section title="Environments">
          <p className="text-[11.5px] text-muted-foreground">
            Each customer install gets one subscription per environment, in its Corp or Online
            group.
          </p>
          <div className="flex flex-wrap gap-1">
            {answers.environments.map((e) => (
              <span
                key={e}
                className="flex items-center gap-1 rounded-sm border border-[#e8c65b] bg-[#fff4ce] px-1.5 py-0.5 text-[11.5px]"
              >
                {e}
                {answers.environments.length > 1 && (
                  <button
                    className="text-muted-foreground hover:text-danger"
                    onClick={() =>
                      set({ environments: answers.environments.filter((x) => x !== e) })
                    }
                    aria-label={`Remove ${e}`}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            <EnvAdd
              onAdd={(e) => set({ environments: [...new Set([...answers.environments, e])] })}
            />
          </div>
          <p className="flex gap-1.5 rounded-sm border border-[#f3d27a] bg-[#fff8e1] px-2 py-1.5 text-[11px] text-[#5c4400]">
            <Lightbulb className="mt-px size-3.5 shrink-0 text-[#c08b00]" />
            CAF: environments are separate subscriptions in the same group, not separate management
            groups. Dev and test inherit the same guardrails as prod.
          </p>
        </Section>

        <Section title="Landing zones">
          {(["corp", "online", "local", "sandbox"] as const).map((g) => {
            const exists = lib.managementGroups.some((m) => m.id === g);
            const count = placed.filter((p) => p.landingZone === g).length;
            const included = answers.landingZones.includes(g);
            return (
              <Row
                key={g}
                label={LANDING_ZONE_LABEL[g]?.title ?? g}
                hint={
                  !exists
                    ? `Not in ALZ ${shortRef(lib.ref)} — added in 2026.08.1`
                    : count
                      ? `${count} install${count === 1 ? "" : "s"} live here — can't remove`
                      : LANDING_ZONE_LABEL[g]?.body
                }
                disabled={!exists}
              >
                <Switch
                  checked={exists && included}
                  disabled={!exists || (included && count > 0)}
                  onCheckedChange={(v) => toggleGroup(g, v)}
                />
              </Row>
            );
          })}
          {answers.landingZones.includes("corp") && !hub && (
            <Warn>Corp workloads connect through a hub. Add a central network, or use Online.</Warn>
          )}
        </Section>

        <Section title="Network">
          <Seg
            value={answers.connectivity}
            onChange={(v) => set({ connectivity: v })}
            options={[
              {
                value: "hub_and_spoke",
                label: "Hub & spoke",
                title: "A hub virtual network you control",
              },
              {
                value: "virtual_wan",
                label: "Virtual WAN",
                title: "Microsoft-managed hubs and routing",
              },
              { value: "none", label: "None", title: "Cloud-only, internet-facing" },
            ]}
          />
          <div className={cn("space-y-2.5", !hub && "pointer-events-none opacity-45")}>
            <div>
              <p className="mb-1 text-[12.5px] font-medium">Azure Firewall</p>
              <Seg
                value={answers.firewall}
                onChange={(v) => set({ firewall: v })}
                options={FIREWALL_TIERS.map((t) => ({
                  value: t.value,
                  label: t.label,
                  title: t.body,
                }))}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {FIREWALL_TIERS.find((t) => t.value === answers.firewall)?.body}
              </p>
            </div>
            <Row label="Azure Bastion" hint="Admin access without public IPs">
              <Switch
                checked={on(answers.bastion)}
                onCheckedChange={(v) => set({ bastion: yn(v) })}
              />
            </Row>
            <Row label="VPN gateway" hint="Site-to-site to offices">
              <Switch
                checked={on(answers.vpnGateway)}
                onCheckedChange={(v) => set({ vpnGateway: yn(v) })}
              />
            </Row>
            <Row label="ExpressRoute gateway" hint="Private circuit to a data center">
              <Switch
                checked={on(answers.expressRoute)}
                onCheckedChange={(v) => set({ expressRoute: yn(v) })}
              />
            </Row>
            <Row
              label="Private DNS for private endpoints"
              hint="Zones + DNS Private Resolver in the hub"
            >
              <Switch
                checked={answers.privateDns === "platform"}
                onCheckedChange={(v) => set({ privateDns: v ? "platform" : "none" })}
              />
            </Row>
            <Row
              label="DDoS Network Protection"
              hint={
                on(answers.ddosPlan)
                  ? "Plan created; policy enrolls VNets"
                  : "Off — the DDoS policy is removed"
              }
            >
              <Switch
                checked={on(answers.ddosPlan)}
                onCheckedChange={(v) => set({ ddosPlan: yn(v) })}
              />
            </Row>
            <Row label="Second hub region" hint="Region N hub, peered to region 1">
              <select
                className="h-7 max-w-[130px] rounded-md border border-input bg-background px-1.5 font-mono text-xs"
                value={answers.secondaryRegion}
                onChange={(e) => set({ secondaryRegion: e.target.value })}
              >
                <option value="">None</option>
                {REGIONS.filter((r) => r !== answers.primaryRegion).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Row>
          </div>
        </Section>

        <Section title="In every subscription">
          {(
            [
              [
                "defender",
                "Defender for Cloud",
                "Plans, security contact, export to the workspace",
              ],
              ["updateManager", "Azure Update Manager", "Periodic assessment of missing updates"],
              ["vmBackup", "VM backup", "Enroll VMs in a Recovery Services vault"],
              ["serviceHealth", "Service Health alerts", "Alert rules and action groups"],
            ] as const
          ).map(([key, label, hint]) => (
            <Row key={key} label={label} hint={hint}>
              <Switch checked={on(answers[key])} onCheckedChange={(v) => set({ [key]: yn(v) })} />
            </Row>
          ))}
        </Section>

        <Section title="Extra policy and compliance">
          <PolicyAddsPanel tree={hierarchy(lib, answers)} answers={answers} set={set} />
        </Section>

        <Section title="Operations">
          <div>
            <p className="mb-1 text-[12.5px] font-medium">Monitoring</p>
            <Seg
              value={answers.monitoring}
              onChange={(v) => set({ monitoring: v })}
              options={[
                { value: "azure_monitor", label: "Azure Monitor" },
                { value: "third_party", label: "Third-party tool" },
              ]}
            />
          </div>
          <Row label="Log retention" hint="Central workspace">
            <select
              className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
              value={answers.logRetentionDays}
              onChange={(e) => set({ logRetentionDays: Number(e.target.value) })}
            >
              {[30, 60, 90, 180, 365, 730].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </Row>
          <Row label="Microsoft Sentinel" hint="SIEM on the central workspace">
            <Switch
              checked={answers.siem === "sentinel"}
              onCheckedChange={(v) => set({ siem: v ? "sentinel" : "other" })}
            />
          </Row>
          <Row label="Identity subscription" hint="Only if workloads need domain controllers">
            <Switch
              checked={on(answers.identity)}
              onCheckedChange={(v) => set({ identity: yn(v) })}
            />
          </Row>
          <label className="block text-[11px] text-muted-foreground">
            Security alerts go to
            <Input
              className="mt-0.5 h-7 text-xs"
              placeholder="secops@example.com"
              value={answers.securityContactEmail}
              onChange={(e) => set({ securityContactEmail: e.target.value })}
            />
          </label>
        </Section>
      </div>
      <div className="border-t border-border bg-card px-4 py-3">
        <p className="mb-2 text-[11.5px] text-muted-foreground">
          {changes
            ? `${changes} change${changes === 1 ? "" : "s"} from Microsoft's ALZ ${shortRef(lib.ref)} policy reference`
            : `Microsoft's ALZ ${shortRef(lib.ref)} policy reference, unchanged`}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!dirty} onClick={onDiscard}>
            <Undo2 className="size-3.5" /> Discard
          </Button>
          <Button size="sm" className="flex-1" disabled={!dirty || saving} onClick={onSave}>
            {saving ? "Saving…" : dirty ? "Save design" : "Saved"}
          </Button>
        </div>
      </div>
    </>
  );
}

function EnvAdd({ onAdd }: { onAdd: (e: string) => void }) {
  const [v, setV] = useState("");
  const commit = () => {
    const e = v
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    if (e) onAdd(e);
    setV("");
  };
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      onBlur={commit}
      placeholder="+ qa, uat, staging…"
      className="h-6 w-28 rounded-sm border border-dashed border-border bg-transparent px-1.5 text-[11.5px]"
    />
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-1.5 rounded-sm border border-warning/40 bg-warning/8 px-2 py-1.5 text-[11.5px] text-warning">
      <CircleAlert className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ReadOnlyPanel({ owner, placed }: { owner: string; placed: Placement[] }) {
  return (
    <div className="space-y-3 p-4 text-[12.5px]">
      <Pill tone="info">
        <Lock className="size-3" /> Owned by {owner}
      </Pill>
      <p className="text-muted-foreground">
        This landing zone belongs to the customer's platform team. You can explore it — structure,
        traffic and policy — but not change it. Your product lands in it as spoke subscriptions.
      </p>
      <div className="rounded-md border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">Your installs here</p>
        <ul className="mt-1.5 space-y-1">
          {placed.map((p) => (
            <li key={`${p.customerId}-${p.environment}`} className="flex justify-between gap-2">
              <span className="truncate">{p.offering}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {p.environment} · {LANDING_ZONE_LABEL[p.landingZone]?.title}
              </span>
            </li>
          ))}
          {!placed.length && <li className="text-muted-foreground">None yet.</li>}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- inspector */

function Inspector(props: {
  lens: Lens;
  sel: Sel | null;
  setSel: (s: Sel | null) => void;
  lib: AlzLibrary;
  tree: MgNode[];
  answers: Answers;
  set?: ((p: Partial<Answers>) => void) | undefined;
  changes: Change[];
  placed: Placement[];
  flows: Flow[];
  flow: Flow | null;
  setFlowId: (id: string) => void;
  step: number;
  setStep: (i: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  spokes: Spoke[];
  omitted: number;
}) {
  const { lens, sel } = props;
  if (lens === "traffic") return <TrafficPanel {...props} />;
  if (!sel) return <Overview {...props} />;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <p className="text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
          {sel.kind === "mg"
            ? "Management group"
            : sel.kind === "sub"
              ? "Subscription"
              : sel.kind === "spoke"
                ? "Customer install"
                : sel.kind === "ext"
                  ? "Outside Azure"
                  : "Platform resource"}
        </p>
        <button
          onClick={() => props.setSel(null)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {(sel.kind === "mg" || sel.kind === "sub") && <GroupTabs key={sel.id} {...props} sel={sel} />}
      {sel.kind === "res" && <ResourceDetail id={sel.id} {...props} />}
      {sel.kind === "spoke" && <SpokeDetail id={sel.id} {...props} />}
      {sel.kind === "ext" && <ExtDetail id={sel.id} {...props} />}
    </div>
  );
}

type IP = Parameters<typeof Inspector>[0];

/** Management group or subscription: what it is, every policy that reaches it, and who has access. */
function GroupTabs(props: IP & { sel: Sel }) {
  const [tab, setTab] = useState<"overview" | "policies" | "access">("overview");
  const mg = props.sel.id;
  const n = props.tree.find((t) => t.libraryId === mg);
  const chain: MgNode[] = [];
  let cur = n;
  while (cur) {
    chain.unshift(cur);
    cur = props.tree.find((t) => t.id === cur?.parentId);
  }
  const inherited = props.answers.rbac.filter((r) => chain.some((c) => c.libraryId === r.scope));
  return (
    <div>
      <div className="flex gap-1 border-b border-border px-3 pt-2">
        {(
          [
            ["overview", "Overview"],
            ["policies", `Policies${n ? ` · ${n.enforced + n.inherited}` : ""}`],
            ["access", `Access${inherited.length ? ` · ${inherited.length}` : ""}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-2 pb-1.5 text-[12px]",
              tab === id
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" &&
        (props.sel.kind === "mg" ? (
          <MgDetail id={mg} {...props} />
        ) : (
          <SubDetail id={mg} {...props} />
        ))}
      {tab === "policies" && (
        <>
          <PolicyPanel {...props} sel={{ kind: "mg", id: mg }} />
          {n && (
            <div className="border-t border-border p-4">
              <p className="mb-2 text-[12.5px] font-semibold">
                Add Microsoft built-ins at {n.displayName}
              </p>
              <PolicyAddsPanel
                tree={props.tree}
                answers={props.answers}
                set={props.set}
                scope={mg}
              />
            </div>
          )}
        </>
      )}
      {tab === "access" && (
        <div>
          {n && (
            <div className="border-b border-border px-4 py-3 text-[12px]">
              <p className="font-semibold">Effective access at {n.displayName}</p>
              {inherited.length ? (
                <ul className="mt-1 space-y-0.5">
                  {inherited.map((r) => (
                    <li key={r.persona} className="flex justify-between gap-2">
                      <span>{PERSONAS.find((p) => p.id === r.persona)?.label}</span>
                      <span className="text-muted-foreground">
                        {r.role}
                        {r.scope !== mg
                          ? ` · from ${props.tree.find((t) => t.libraryId === r.scope)?.displayName}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No roles assigned in this design yet.</p>
              )}
            </div>
          )}
          <AccessPanel tree={props.tree} answers={props.answers} set={props.set} focusScope={mg} />
        </div>
      )}
    </div>
  );
}

function Overview({ answers, tree, changes, lib, omitted, setSel, set }: IP) {
  const subs = platformSubscriptions(answers);
  const res = platformResources(answers);
  const removed = changes.filter((c) => c.action === "remove");
  const audit = changes.filter((c) => c.action === "audit");
  const skipped = lib.managementGroups.filter((m) => !tree.some((t) => t.libraryId === m.id));
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-[14px] font-semibold">
          {set ? "What this builds" : "What's in this landing zone"}
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Click any block in the picture for details. Switch lens to trace traffic or see which
          policies apply where.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Management groups" value={tree.length} />
        <Stat label="Platform subscriptions" value={subs.filter((s) => s.created).length} />
        <Stat label="Platform resources" value={res.length} />
        <Stat label="Policy assignments" value={tree.reduce((a, n) => a + n.enforced, 0)} />
      </div>
      <ul className="space-y-2">
        {subs.map((s) => (
          <li
            key={s.managementGroup}
            className={cn(
              "rounded-md border border-border p-2.5",
              !s.created && "border-dashed opacity-60",
            )}
          >
            <button
              className="w-full text-left"
              onClick={() => setSel({ kind: "sub", id: s.managementGroup })}
            >
              <p className="flex items-center justify-between text-[12.5px] font-semibold">
                {s.name} subscription
                {!s.created && (
                  <span className="text-[11px] font-normal text-muted-foreground">not created</span>
                )}
              </p>
            </button>
            <div className="mt-1 flex flex-wrap gap-1">
              {res
                .filter((r) => r.subscription === s.managementGroup)
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSel({ kind: "res", id: r.id })}
                    className="rounded-sm border border-border bg-muted/40 px-1.5 py-px text-[11px] hover:border-border-strong"
                  >
                    {r.name}
                  </button>
                ))}
              {!res.some((r) => r.subscription === s.managementGroup) && (
                <span className="text-[11px] text-muted-foreground">{s.purpose}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div>
        <h3 className="text-[12.5px] font-semibold">Changes from Microsoft's policy reference</h3>
        {!changes.length && !omitted && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            None — ALZ {shortRef(lib.ref)} applies exactly as Microsoft ships it.
          </p>
        )}
        <ul className="mt-1.5 space-y-1.5">
          {skipped.map((m) => (
            <li key={m.id} className="rounded-sm border border-border p-2 text-[11.5px]">
              <b>{m.displayName}</b> management group left out
            </li>
          ))}
          {groupChanges(removed).map((g) => (
            <li
              key={g.assignment}
              className="rounded-sm border border-warning/40 bg-warning/5 p-2 text-[11.5px]"
            >
              <p>
                Remove <span className="font-mono">{g.assignment}</span>{" "}
                <span className="text-muted-foreground">from {g.groups.join(", ")}</span>
              </p>
              <p className="mt-0.5 text-muted-foreground">{g.reason}</p>
            </li>
          ))}
          {audit.map((c) => (
            <li
              key={`${c.managementGroup}/${c.assignment}`}
              className="rounded-sm border border-info/40 bg-info/5 p-2 text-[11.5px]"
            >
              Audit only: <span className="font-mono">{c.assignment}</span>{" "}
              <span className="text-muted-foreground">at {c.managementGroup}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const groupChanges = (changes: Change[]) =>
  Object.values(
    changes.reduce<Record<string, { assignment: string; groups: string[]; reason: string }>>(
      (acc, c) => {
        const g = (acc[c.assignment] ??= {
          assignment: c.assignment,
          groups: [],
          reason: c.reason,
        });
        g.groups.push(c.managementGroup);
        return acc;
      },
      {},
    ),
  );

function PolicyChips({ names, tree, lib }: { names: string[]; tree: MgNode[]; lib: AlzLibrary }) {
  const rows = names
    .map((n) => {
      const where = tree.filter((t) => t.here.some((h) => h.name === n));
      const item = where[0]?.here.find((h) => h.name === n);
      return { n, where, item, a: lib.assignments[n] };
    })
    .filter((r) => r.a);
  if (!rows.length) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">Related ALZ policy</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.n} className="rounded-sm border border-border px-2 py-1.5">
            <p
              className={cn(
                "text-[12px] font-medium",
                r.item?.change?.action === "remove" && "line-through opacity-60",
              )}
            >
              {r.a!.displayName}
            </p>
            <p className="font-mono text-[10.5px] text-muted-foreground">
              {r.n} ·{" "}
              {r.where.length
                ? r.where.map((w) => w.displayName).join(", ")
                : "not assigned in this design"}
              {r.item?.change &&
                ` · ${r.item.change.action === "remove" ? "removed" : "audit only"}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange?: ((v: boolean) => void) | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="text-[12.5px] font-medium">{label}</span>
      <Switch
        checked={checked}
        disabled={disabled || !onChange}
        onCheckedChange={(v) => onChange?.(v)}
      />
    </div>
  );
}

function ResourceDetail({ id, answers, set, tree, lib, flows, setFlowId }: IP & { id: string }) {
  const r = platformResources(answers).find((x) => x.id === id);
  const info = RESOURCE_INFO[id];
  const yn = (v: boolean) => (v ? "yes" : "no") as "yes" | "no";
  const control = (() => {
    switch (id) {
      case "firewall":
        return (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Tier</p>
            <Seg
              value={answers.firewall}
              onChange={(v) => set?.({ firewall: v })}
              disabled={!set}
              options={FIREWALL_TIERS.map((t) => ({
                value: t.value,
                label: t.label,
                title: t.body,
              }))}
            />
          </div>
        );
      case "vpngw":
        return (
          <Toggle
            label="VPN gateway"
            checked={on(answers.vpnGateway)}
            onChange={set && ((v) => set({ vpnGateway: yn(v) }))}
          />
        );
      case "ergw":
        return (
          <Toggle
            label="ExpressRoute gateway"
            checked={on(answers.expressRoute)}
            onChange={set && ((v) => set({ expressRoute: yn(v) }))}
          />
        );
      case "bastion":
        return (
          <Toggle
            label="Azure Bastion"
            checked={on(answers.bastion)}
            onChange={set && ((v) => set({ bastion: yn(v) }))}
          />
        );
      case "dnszones":
      case "dnsresolver":
        return (
          <Toggle
            label="Central private DNS"
            checked={answers.privateDns === "platform"}
            onChange={set && ((v) => set({ privateDns: v ? "platform" : "none" }))}
          />
        );
      case "ddos":
        return (
          <Toggle
            label="DDoS Network Protection"
            checked={on(answers.ddosPlan)}
            onChange={set && ((v) => set({ ddosPlan: yn(v) }))}
          />
        );
      case "sentinel":
        return (
          <Toggle
            label="Microsoft Sentinel"
            checked={answers.siem === "sentinel"}
            onChange={set && ((v) => set({ siem: v ? "sentinel" : "other" }))}
          />
        );
      case "dcr":
      case "ama":
        return (
          <Toggle
            label="Azure Monitor Agent"
            checked={answers.monitoring === "azure_monitor"}
            onChange={set && ((v) => set({ monitoring: v ? "azure_monitor" : "third_party" }))}
          />
        );
      case "hubvnet":
      case "vhub":
      case "vwan":
        return (
          <Seg
            value={answers.connectivity}
            onChange={(v) => set?.({ connectivity: v })}
            disabled={!set}
            options={[
              { value: "hub_and_spoke", label: "Hub & spoke" },
              { value: "virtual_wan", label: "Virtual WAN" },
              { value: "none", label: "None" },
            ]}
          />
        );
      default:
        return null;
    }
  })();
  const related = flows.filter((f) => f.available && f.steps.some((s) => s.at === id));
  const name = r?.name ?? (id === "sidecar" ? "Sidecar virtual network" : (NAMES[id] ?? id));
  return (
    <div className="space-y-3 p-4">
      <div>
        <h2 className="text-[15px] font-semibold">{name}</h2>
        {r && (
          <p className="text-[12px] text-muted-foreground">
            {r.detail} · {r.subscription} subscription
          </p>
        )}
      </div>
      {info && <p className="text-[12.5px]">{info.what}</p>}
      {control}
      {related.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Traffic through it</p>
          <div className="flex flex-wrap gap-1">
            {related.map((f) => (
              <button
                key={f.id}
                onClick={() => setFlowId(f.id)}
                className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] hover:border-border-strong"
                style={{ borderLeft: `3px solid ${f.color}` }}
              >
                {f.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {info && <PolicyChips names={info.policies} tree={tree} lib={lib} />}
      {r && (
        <p className="rounded-sm bg-muted/60 px-2 py-1.5 font-mono text-[10.5px] text-muted-foreground">
          Terraform: {r.terraform}
        </p>
      )}
    </div>
  );
}

function MgDetail({ id, tree, answers, set, placed, lib }: IP & { id: string }) {
  const n = tree.find((t) => t.libraryId === id);
  if (!n) return null;
  const count = placed.filter((p) => p.landingZone === id).length;
  const deny = n.here.filter(
    (h) =>
      (h.assignment?.effect ?? "").toLowerCase().startsWith("deny") &&
      h.change?.action !== "remove",
  );
  return (
    <div className="space-y-3 p-4">
      <div>
        <h2 className="text-[15px] font-semibold">{n.displayName}</h2>
        <p className="font-mono text-[11px] text-muted-foreground">
          {n.id} · archetype {n.archetype}
        </p>
      </div>
      <p className="text-[12.5px]">
        {MG_PURPOSE[id] ??
          (n.archetype === "inherit"
            ? "Added by you. Adds no policy of its own — everything is inherited from the groups above."
            : `Added by you, with the ALZ ${n.archetype} policy set.`)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Assigned here" value={n.enforced} />
        <Stat label="Inherited" value={n.inherited} />
      </div>
      {set && <GroupEditor id={id} tree={tree} answers={answers} set={set} placedCount={count} />}
      {deny.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Blocks at this level</p>
          <ul className="space-y-0.5 text-[12px]">
            {deny.slice(0, 6).map((d) => (
              <li key={d.name}>· {d.assignment?.displayName}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        From Microsoft's ALZ {shortRef(lib.ref)}. Every assignment that applies here is listed below
        — keep it, set it to audit only, or remove it.
      </p>
    </div>
  );
}

/** Rename, change the policy basis, choose workload landing zones and manage subscriptions for one group. */
function GroupEditor({
  id,
  tree,
  answers,
  set,
  placedCount,
}: {
  id: string;
  tree: MgNode[];
  answers: Answers;
  set: (p: Partial<Answers>) => void;
  placedCount: number;
}) {
  const n = tree.find((t) => t.libraryId === id)!;
  const custom = answers.customGroups.find((c) => c.id === id);
  const underLz = (() => {
    let x: MgNode | undefined = n;
    while (x) {
      if (x.libraryId === "landingzones") return x.libraryId !== id;
      x = tree.find((t) => t.id === x?.parentId);
    }
    return false;
  })();
  const chosen = answers.workloads.filter((w) => w.group === id).map((w) => w.id);
  const subs = answers.extraSubscriptions.filter((x) => x.group === id);
  const removable =
    !!custom ||
    (REMOVABLE_GROUPS as readonly string[]).includes(id) ||
    (["corp", "online", "local", "sandbox"].includes(id) && !placedCount);
  const remove = () => {
    if (custom) {
      const gone = new Set([id]);
      for (let i = 0; i < 6; i++)
        for (const c of answers.customGroups) if (gone.has(c.parent)) gone.add(c.id);
      set({
        customGroups: answers.customGroups.filter((c) => !gone.has(c.id)),
        workloads: answers.workloads.filter((w) => !gone.has(w.group)),
        extraSubscriptions: answers.extraSubscriptions.filter((x) => !gone.has(x.group)),
        rbac: answers.rbac.filter((r) => !gone.has(r.scope)),
        policyAdds: answers.policyAdds.filter((p) => !gone.has(p.scope)),
      });
    } else if ((REMOVABLE_GROUPS as readonly string[]).includes(id))
      set({ removedGroups: [...new Set([...answers.removedGroups, id as RemovableGroup])] });
    else set({ landingZones: answers.landingZones.filter((g) => g !== id) });
  };
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <label className="block text-[11px] font-medium text-muted-foreground">
        Display name
        <Input
          className="mt-0.5 h-7 text-xs"
          value={custom ? custom.name : (answers.groupNames[id] ?? n.displayName)}
          disabled={id === "alz"}
          onChange={(e) =>
            custom
              ? set({
                  customGroups: answers.customGroups.map((c) =>
                    c.id === id ? { ...c, name: e.target.value } : c,
                  ),
                })
              : set({ groupNames: { ...answers.groupNames, [id]: e.target.value } })
          }
        />
      </label>
      {custom && (
        <label className="block text-[11px] font-medium text-muted-foreground">
          Policy
          <select
            className="mt-0.5 h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs"
            value={custom.archetype}
            onChange={(e) =>
              set({
                customGroups: answers.customGroups.map((c) =>
                  c.id === id ? { ...c, archetype: e.target.value as CustomGroup["archetype"] } : c,
                ),
              })
            }
          >
            <option value="inherit">Inherit only (no extra policy)</option>
            <option value="corp">Corp policy set</option>
            <option value="online">Online policy set</option>
            <option value="sandbox">Sandbox policy set</option>
            <option value="local">Local policy set</option>
          </select>
        </label>
      )}
      {(underLz || ["corp", "online", "local"].includes(id)) && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">
            Workload landing zones here
          </p>
          <div className="space-y-1.5">
            {WORKLOADS.map((w) => {
              const isOn = chosen.includes(w.id);
              const unmet = isOn ? w.needs(answers).filter((x) => !x.ok) : [];
              return (
                <div
                  key={w.id}
                  className={cn(
                    "rounded-md border px-2 py-1.5",
                    isOn ? "border-primary/40 bg-primary/5" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium">{w.name}</p>
                      {isOn && (
                        <p className="text-[11px] text-muted-foreground">
                          Deploys {w.deploys.join(", ")}.{" "}
                          <a
                            className="text-primary hover:underline"
                            href={`https://github.com/${w.repo}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {w.repo}
                          </a>
                          {w.module && <span className="font-mono"> · {w.module.source}</span>}
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={isOn}
                      onCheckedChange={(v) =>
                        set({
                          workloads: v
                            ? [...answers.workloads, { group: id, id: w.id }]
                            : answers.workloads.filter((x) => !(x.group === id && x.id === w.id)),
                        })
                      }
                    />
                  </div>
                  {isOn &&
                    w.archetype !== (custom?.archetype ?? id) &&
                    ["corp", "online"].includes(w.archetype) && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Microsoft's accelerator assumes a{" "}
                        {w.archetype === "corp" ? "Corp" : "Online"} landing zone.
                      </p>
                    )}
                  {unmet.map((u) => (
                    <p
                      key={u.text}
                      className="mt-1 flex items-start justify-between gap-2 text-[11px] text-warning"
                    >
                      <span>Needs {u.text}</span>
                      {u.patch && (
                        <button
                          className="shrink-0 font-medium text-primary hover:underline"
                          onClick={() => set(u.patch!)}
                        >
                          Fix
                        </button>
                      )}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">
          Subscriptions you added here
        </p>
        {subs.length ? (
          <ul className="space-y-1">
            {subs.map((x) => (
              <li
                key={x.id}
                className="flex items-center justify-between rounded-sm border border-border px-2 py-1 text-[12px]"
              >
                <span>
                  {x.name} <span className="text-muted-foreground">· {x.environment}</span>
                </span>
                <button
                  className="text-muted-foreground hover:text-danger"
                  onClick={() =>
                    set({
                      extraSubscriptions: answers.extraSubscriptions.filter((y) => y.id !== x.id),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">
            None. Hover the group on the canvas and choose “+ sub”.
          </p>
        )}
      </div>
      {removable && id !== "alz" && (
        <Button size="sm" variant="outline" className="text-danger" onClick={remove}>
          {custom
            ? "Remove this group"
            : (REMOVABLE_GROUPS as readonly string[]).includes(id)
              ? "Remove — its subscription moves to Platform"
              : "Leave this group out"}
        </Button>
      )}
      {!removable && placedCount > 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          {placedCount} customer install subscription{placedCount === 1 ? "" : "s"} live here, so it
          can't be removed.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-[17px] font-semibold">{value}</p>
    </div>
  );
}

function SubDetail({ id, answers, set, setSel }: IP & { id: string }) {
  const s = platformSubscriptions(answers).find((x) => x.managementGroup === id);
  const res = platformResources(answers).filter((r) => r.subscription === id);
  const yn = (v: boolean) => (v ? "yes" : "no") as "yes" | "no";
  if (!s)
    return (
      <div className="space-y-2 p-4">
        <h2 className="text-[15px] font-semibold">Cancelled subscriptions</h2>
        <p className="text-[12.5px]">
          When a customer leaves, their subscription is moved to Decommissioned and held 30–60 days
          before deletion. Policy there denies creating anything new.
        </p>
      </div>
    );
  return (
    <div className="space-y-3 p-4">
      <div>
        <h2 className="text-[15px] font-semibold">{s.name} subscription</h2>
        <p className="text-[12px] text-muted-foreground">
          In the {s.name} management group · {s.created ? "created" : "not created"}
        </p>
      </div>
      <p className="text-[12.5px]">{MG_PURPOSE[id]}</p>
      {id === "identity" && (
        <Toggle
          label="Create an Identity subscription"
          checked={on(answers.identity)}
          onChange={set && ((v) => set({ identity: yn(v) }))}
        />
      )}
      {id === "security" && (
        <Toggle
          label="Security subscription (with Sentinel)"
          checked={answers.siem === "sentinel"}
          onChange={set && ((v) => set({ siem: v ? "sentinel" : "other" }))}
        />
      )}
      {id === "connectivity" && (
        <Seg
          value={answers.connectivity}
          onChange={(v) => set?.({ connectivity: v })}
          disabled={!set}
          options={[
            { value: "hub_and_spoke", label: "Hub & spoke" },
            { value: "virtual_wan", label: "Virtual WAN" },
            { value: "none", label: "None" },
          ]}
        />
      )}
      {res.length > 0 && (
        <ul className="space-y-1">
          {res.map((r) => (
            <li key={r.id}>
              <button
                className="flex w-full items-center justify-between rounded-sm border border-border px-2 py-1.5 text-left hover:border-border-strong"
                onClick={() => setSel({ kind: "res", id: r.id })}
              >
                <span>
                  <span className="block text-[12.5px] font-medium">{r.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{r.detail}</span>
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {s.created && (
        <p className="rounded-sm bg-muted/60 px-2 py-1.5 font-mono text-[10.5px] text-muted-foreground">
          Placed by module.alz subscription_placement.{id}
        </p>
      )}
    </div>
  );
}

function SpokeDetail({ id, spokes, tree, answers, flows, setFlowId }: IP & { id: string }) {
  const s = spokes.find((x) => x.id === id);
  if (!s) return null;
  const n = tree.find((t) => t.libraryId === s.group);
  const eff = effectivePolicies(tree, s.group).filter((e) => e.item.change?.action !== "remove");
  const denies = eff.filter((e) =>
    (e.item.assignment?.effect ?? "").toLowerCase().startsWith("deny"),
  );
  const related = flows.filter((f) => f.available && f.steps.some((st) => st.at === `spoke:${id}`));
  const more = spokes.filter((x) => x.group === s.group && x.placement).length;
  return (
    <div className="space-y-3 p-4">
      <div>
        <h2 className="text-[15px] font-semibold">
          {s.placement ? s.placement.customerName : s.ghost ? "Next install" : `${more} installs`}
        </h2>
        <p className="text-[12px] text-muted-foreground">
          {s.placement ? `${s.placement.offering} · ${s.placement.environment} · ` : ""}
          {LANDING_ZONE_LABEL[s.group]?.title} landing zone
        </p>
      </div>
      <p className="text-[12.5px]">
        {s.ghost
          ? `The next customer install placed in ${LANDING_ZONE_LABEL[s.group]?.title} gets its own subscription here, vended into ${mgIdFor(answers, s.group)}.`
          : `Its own subscription in ${mgIdFor(answers, s.group)}. ${s.group === "corp" ? "Its virtual network peers to the hub." : s.group === "online" ? "Isolated — not connected to the hub or other installs." : ""}`}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Policies that apply" value={eff.length} />
        <Stat label="Of which deny" value={denies.length} />
      </div>
      {n && (
        <p className="text-[11.5px] text-muted-foreground">
          {n.enforced} from {n.displayName}, {n.inherited} inherited from above.
        </p>
      )}
      {related.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Traffic paths</p>
          <div className="flex flex-wrap gap-1">
            {related.map((f) => (
              <button
                key={f.id}
                onClick={() => setFlowId(f.id)}
                className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] hover:border-border-strong"
                style={{ borderLeft: `3px solid ${f.color}` }}
              >
                {f.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ExtDetail({ id }: IP & { id: string }) {
  const text: Record<string, [string, string]> = {
    internet: [
      "Internet",
      "Where Corp egress ends up after the firewall, and where Online installs are reached from.",
    ],
    users: [
      "Your customers' users",
      "People using the product. They reach Online installs directly over their public endpoints.",
    ],
    operator: [
      "Operators",
      "Your platform and support engineers. They sign in with Microsoft Entra ID and reach VMs through Bastion.",
    ],
    onprem: [
      "Head office / data center",
      "Networks outside Azure. They connect through the VPN or ExpressRoute gateway in the hub.",
    ],
  };
  const [title, body] = text[id] ?? [id, ""];
  return (
    <div className="space-y-2 p-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="text-[12.5px]">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ traffic */

function TrafficPanel({
  flows,
  flow,
  setFlowId,
  step,
  setStep,
  playing,
  setPlaying,
  set,
  answers,
}: IP) {
  const fix = (f: Flow): { label: string; patch: Partial<Answers> } | null => {
    if (!set) return null;
    if (!hasHub(answers) && f.id !== "ingress" && f.id !== "telemetry")
      return { label: "Add a hub network", patch: { connectivity: "hub_and_spoke" } };
    if (!answers.landingZones.includes("corp") && f.id !== "ingress" && f.id !== "telemetry")
      return {
        label: "Add the Corp landing zone",
        patch: { landingZones: [...answers.landingZones, "corp"] },
      };
    switch (f.id) {
      case "egress":
      case "eastwest":
        return { label: "Add Azure Firewall Standard", patch: { firewall: "Standard" } };
      case "hybrid":
        return { label: "Add a VPN gateway", patch: { vpnGateway: "yes" } };
      case "private-endpoint":
        return { label: "Turn on central private DNS", patch: { privateDns: "platform" } };
      case "bastion":
        return { label: "Add Azure Bastion", patch: { bastion: "yes" } };
      case "telemetry":
        return { label: "Use Azure Monitor", patch: { monitoring: "azure_monitor" } };
      default:
        return null;
    }
  };
  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold">Traffic flows</h2>
        <p className="text-[12px] text-muted-foreground">
          Paths that exist in this design, hop by hop. Change the design and they change with it.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {flows.map((f) => {
          const active = flow?.id === f.id;
          const fx = !f.available ? fix(f) : null;
          return (
            <li key={f.id} className={cn(active && "bg-muted/40")}>
              <button
                onClick={() => setFlowId(f.id)}
                className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left"
              >
                <span
                  className="mt-1 size-2.5 shrink-0 rounded-full"
                  style={{
                    background: f.available ? f.color : "transparent",
                    border: `2px solid ${f.color}`,
                  }}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[12.5px] font-medium",
                      !f.available && "text-muted-foreground",
                    )}
                  >
                    {f.title}
                  </span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {f.available ? f.summary : f.reason}
                  </span>
                </span>
              </button>
              {active && !f.available && fx && (
                <div className="px-4 pb-3 pl-9">
                  <Button size="sm" variant="outline" onClick={() => set?.(fx.patch)}>
                    {fx.label}
                  </Button>
                </div>
              )}
              {active && f.available && (
                <div className="px-4 pb-3 pl-9">
                  <div className="mb-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => setPlaying(!playing)}
                    >
                      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      {playing ? "Pause" : "Play"}
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Step {step + 1} of {f.steps.length}
                    </span>
                  </div>
                  <ol className="space-y-1.5">
                    {f.steps.map((s, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setStep(i)}
                          className={cn(
                            "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                            i === step
                              ? "border-transparent bg-card shadow-sm ring-1"
                              : "border-border opacity-75 hover:opacity-100",
                          )}
                          style={
                            i === step
                              ? ({ ["--tw-ring-color" as string]: f.color } as React.CSSProperties)
                              : undefined
                          }
                        >
                          <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                            <span
                              className="grid size-4 place-items-center rounded-full text-[9.5px] text-white"
                              style={{ background: f.color }}
                            >
                              {i + 1}
                            </span>
                            {s.title}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{s.body}</p>
                          {s.policy && (
                            <p className="mt-1 flex gap-1 text-[11px] text-foreground/80">
                              <ShieldCheck className="mt-px size-3 shrink-0 text-success" />
                              {s.policy}
                            </p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------- policy */

const effectLabel = (effect: string | null | undefined) => {
  if (!effect) return "Default effect";
  const e = effect.toLowerCase();
  const known: Record<string, string> = {
    deny: "Deny",
    audit: "Audit",
    auditifnotexists: "AuditIfNotExists",
    deployifnotexists: "DeployIfNotExists",
    modify: "Modify",
    append: "Append",
    disabled: "Disabled",
    denyaction: "DenyAction",
  };
  return known[e] ?? effect;
};

const effectTone = (effect: string | null | undefined) => {
  const e = (effect ?? "").toLowerCase();
  if (e.startsWith("deny")) return "danger" as const;
  if (e.startsWith("deploy") || e === "modify" || e === "append") return "info" as const;
  return "neutral" as const;
};

function PolicyPanel({ sel, tree, answers, set, setSel, spokes }: IP) {
  const [q, setQ] = useState("");
  const [effect, setEffect] = useState<"all" | "deny" | "deploy" | "audit">("all");
  const mgId =
    sel?.kind === "mg" || sel?.kind === "sub"
      ? sel.id
      : sel?.kind === "spoke"
        ? (spokes.find((s) => s.id === sel.id)?.group ?? null)
        : null;
  const target = tree.find((t) => t.libraryId === (mgId ?? "")) ?? null;
  if (!target)
    return (
      <div className="space-y-3 p-4">
        <h2 className="text-[14px] font-semibold">Policy flow</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Policy assigned to a management group applies to everything below it. Pick a group — in
          the picture or here — to see what reaches it and where each rule comes from.
        </p>
        <ul className="space-y-1">
          {tree.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => setSel({ kind: "mg", id: n.libraryId })}
                className="flex w-full items-center justify-between rounded-sm border border-border px-2 py-1.5 text-left hover:border-border-strong"
                style={{ paddingLeft: 8 + n.depth * 12 }}
              >
                <span className="text-[12.5px]">{n.displayName}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {n.enforced} + {n.inherited}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  const eff = effectivePolicies(tree, target.libraryId).filter(({ item }) => {
    const e = (item.assignment?.effect ?? "").toLowerCase();
    if (effect === "deny" && !e.startsWith("deny")) return false;
    if (effect === "deploy" && !(e.startsWith("deploy") || e === "modify")) return false;
    if (effect === "audit" && !e.startsWith("audit")) return false;
    if (!q) return true;
    const t = `${item.name} ${item.assignment?.displayName ?? ""}`.toLowerCase();
    return t.includes(q.toLowerCase());
  });
  const groups = [...new Set(eff.map((e) => e.from.libraryId))];
  const setOverride = (mg: string, name: string, v: "enforce" | "audit" | "remove") => {
    const next = { ...answers.policyOverrides };
    if (v === "enforce") delete next[`${mg}/${name}`];
    else next[`${mg}/${name}`] = v;
    set?.({ policyOverrides: next });
  };
  const all = effectivePolicies(tree, target.libraryId);
  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <button
          onClick={() => setSel(null)}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          All management groups
        </button>
        <h2 className="text-[14px] font-semibold">What applies at {target.displayName}</h2>
        <p className="text-[12px] text-muted-foreground">
          {all.filter((e) => e.item.change?.action !== "remove").length} assignments:{" "}
          {target.enforced} here, {target.inherited} inherited.
        </p>
        <Input
          className="mt-2 h-7 text-xs"
          placeholder="Search policies"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-2">
          <Seg
            value={effect}
            onChange={setEffect}
            options={[
              { value: "all", label: "All" },
              { value: "deny", label: "Deny" },
              { value: "deploy", label: "Deploy" },
              { value: "audit", label: "Audit" },
            ]}
          />
        </div>
      </div>
      {groups.map((g) => {
        const from = tree.find((t) => t.libraryId === g)!;
        const items = eff.filter((e) => e.from.libraryId === g);
        return (
          <section key={g} className="border-b border-border">
            <p className="sticky top-0 z-[1] flex items-center justify-between bg-muted/80 px-4 py-1.5 text-[11px] font-semibold backdrop-blur">
              <span>
                {g === target.libraryId
                  ? `Assigned at ${from.displayName}`
                  : `Inherited from ${from.displayName}`}
              </span>
              <span className="font-mono text-muted-foreground">{items.length}</span>
            </p>
            <ul className="divide-y divide-border">
              {items.map(({ item }) => {
                const state = item.change?.action ?? "enforce";
                const byDesign = item.change?.origin === "design";
                return (
                  <li
                    key={item.name}
                    className={cn("px-4 py-2", state === "remove" && "bg-warning/5")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          "text-[12px] font-medium",
                          state === "remove" && "line-through opacity-60",
                        )}
                      >
                        {item.assignment?.displayName ?? item.name}
                      </p>
                      <Pill
                        tone={state === "audit" ? "neutral" : effectTone(item.assignment?.effect)}
                      >
                        {state === "audit" ? "Audit only" : effectLabel(item.assignment?.effect)}
                      </Pill>
                    </div>
                    <p className="font-mono text-[10.5px] text-muted-foreground">{item.name}</p>
                    {item.change && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {item.change.reason}
                      </p>
                    )}
                    {set && !byDesign && (
                      <div className="mt-1.5 flex gap-1">
                        {(["enforce", "audit", "remove"] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => setOverride(g, item.name, v)}
                            className={cn(
                              "rounded-sm border px-1.5 py-px text-[10.5px]",
                              state === v
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {v === "enforce" ? (
                              <>
                                <Check className="mr-0.5 inline size-2.5" />
                                As Microsoft ships it
                              </>
                            ) : v === "audit" ? (
                              "Audit only"
                            ) : (
                              "Remove"
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!eff.length && (
        <p className="p-4 text-[12px] text-muted-foreground">No matching assignments.</p>
      )}
    </div>
  );
}
