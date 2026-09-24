/*
 * The landing zone drawn the way Microsoft draws it (CAF "Azure landing zone — Hub & Spoke"): the management
 * group tree with its subscriptions, then the Management, Security, Identity, Connectivity, landing zone and
 * Sandbox subscriptions with what's inside them and the governance toolset every subscription gets.
 *
 * Everything in Microsoft's reference is always drawn. What the design leaves out is shown dashed, so the
 * customer sees exactly what they chose not to have — and can put it back with one click.
 */
import {
  Activity,
  AppWindow,
  BellRing,
  Blocks,
  BrickWall,
  Building2,
  Cable,
  CalendarCheck,
  Check,
  DatabaseBackup,
  Fingerprint,
  Filter,
  Globe,
  KeyRound,
  Network,
  Radar,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Signpost,
  SquareTerminal,
  UserCog,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import {
  type AlzLibrary,
  type Answers,
  LANDING_ZONE_LABEL,
  type MgNode,
  type OptionalGroup,
  effectivePolicies,
  hasFirewall,
  hasHub,
  on,
  platformResources,
} from "@/lib/alz/engine";
import type { Flow, Sel, Spoke } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

type Patch = (p: Partial<Answers>) => void;

/** Governance capabilities Microsoft draws in every subscription, and the ALZ assignment that provides each. */
const TOOLS: {
  id: string;
  label: string;
  icon: LucideIcon;
  assignment: string;
  answer?: keyof Answers;
  offValue?: string;
  onValue?: string;
  body: string;
}[] = [
  {
    id: "defender",
    label: "Defender for Cloud",
    icon: ShieldCheck,
    assignment: "Deploy-MDFC-Config-H224",
    answer: "defender",
    body: "Defender for Cloud plans, security contact and export to the central workspace.",
  },
  {
    id: "ama",
    label: "Monitoring agent",
    icon: Activity,
    assignment: "Deploy-VM-Monitoring",
    answer: "monitoring",
    onValue: "azure_monitor",
    offValue: "third_party",
    body: "Azure Monitor Agent on every VM, sending to the central workspace.",
  },
  {
    id: "updates",
    label: "Update Manager",
    icon: CalendarCheck,
    assignment: "Enable-AUM-CheckUpdates",
    answer: "updateManager",
    body: "Periodic assessment of missing OS updates by Azure Update Manager.",
  },
  {
    id: "backup",
    label: "Backup",
    icon: DatabaseBackup,
    assignment: "Deploy-VM-Backup",
    answer: "vmBackup",
    body: "VMs are enrolled in a Recovery Services vault by policy.",
  },
  {
    id: "alerts",
    label: "Service Health alerts",
    icon: BellRing,
    assignment: "Deploy-SvcHealth-BuiltIn",
    answer: "serviceHealth",
    body: "Service Health alert rules and action groups in every subscription.",
  },
  {
    id: "activity",
    label: "Activity logs",
    icon: ScrollText,
    assignment: "Deploy-AzActivity-Log",
    body: "Subscription activity logs are sent to the central workspace.",
  },
];

const toolOn = (t: (typeof TOOLS)[number], a: Answers) =>
  !t.answer ? true : t.onValue ? a[t.answer] === t.onValue : a[t.answer] === "yes";

const toggleTool = (t: (typeof TOOLS)[number], a: Answers): Partial<Answers> =>
  !t.answer
    ? {}
    : ({
        [t.answer]: toolOn(t, a) ? (t.offValue ?? "no") : (t.onValue ?? "yes"),
      } as Partial<Answers>);

const ICON: Record<string, LucideIcon> = {
  firewall: BrickWall,
  vpngw: KeyRound,
  ergw: Cable,
  bastion: SquareTerminal,
  dnsresolver: Signpost,
  dnszones: Network,
  ddos: ShieldAlert,
  law: ScrollText,
  dcr: Filter,
  ama: Fingerprint,
  sentinel: Radar,
  vwan: Waypoints,
};

const TONE: Record<string, string> = {
  firewall: "#d13438",
  vpngw: "#8661c5",
  ergw: "#5c2e91",
  bastion: "#038387",
  dnsresolver: "#0078d4",
  dnszones: "#0078d4",
  ddos: "#ca5010",
  law: "#8661c5",
  dcr: "#8661c5",
  ama: "#5c2e91",
  sentinel: "#0078d4",
  vwan: "#0078d4",
};

type Ctx = {
  answers: Answers;
  tree: MgNode[];
  lib: AlzLibrary;
  set?: Patch | undefined;
  sel: Sel | null;
  onSelect: (s: Sel) => void;
  involved: Set<string> | null;
  /** For an assessed tenant: the management groups actually found. */
  present?: Set<string> | undefined;
  asIs?: AsIsInfo | undefined;
};

/** Drawing today's tenant: what was actually found, so nothing is shown that isn't there. */
export type AsIsInfo = { parts: Set<string>; counts: Record<string, string> };

export function ArchitectureDiagram({
  lib,
  tree,
  answers,
  set,
  spokes,
  sel,
  onSelect,
  flow,
  step,
  present,
  asIs,
}: {
  present?: Set<string> | undefined;
  asIs?: AsIsInfo | undefined;
  lib: AlzLibrary;
  tree: MgNode[];
  answers: Answers;
  set?: Patch | undefined;
  spokes: Spoke[];
  sel: Sel | null;
  onSelect: (s: Sel) => void;
  flow: Flow | null;
  step: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{
    w: number;
    h: number;
    links: { d: string; kind: "peering" | "onprem" | "flow" }[];
    hops: { x: number; y: number }[];
  }>({ w: 0, h: 0, links: [], hops: [] });

  const involved =
    flow?.available && flow.steps.length ? new Set(flow.steps.map((s) => s.at)) : null;
  const ctx: Ctx = { answers, tree, lib, set, sel, onSelect, involved, present, asIs };
  const wan = answers.connectivity === "virtual_wan";
  const hub = hasHub(answers);
  const second =
    hub && !!answers.secondaryRegion && answers.secondaryRegion !== answers.primaryRegion;
  const res = new Set(platformResources(answers).map((r) => r.id));
  const has = (id: string) => tree.some((n) => n.libraryId === id);
  const exists = (id: string) => lib.managementGroups.some((m) => m.id === id);
  const shown = spokes.filter(
    (s) => s.group === "corp" || s.group === "online" || s.group === "local",
  );

  const linkKey = JSON.stringify([answers, spokes.length, flow?.id, flow?.available, step]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const rect = (id: string) => {
        const n = el.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id)}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      };
      const curve = (
        a: NonNullable<ReturnType<typeof rect>>,
        b: NonNullable<ReturnType<typeof rect>>,
      ) => {
        const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
        const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const horizontal = Math.abs(bc.x - ac.x) > Math.abs(bc.y - ac.y);
        if (horizontal) {
          const p1 = { x: bc.x > ac.x ? a.x + a.w : a.x, y: ac.y };
          const p2 = { x: bc.x > ac.x ? b.x : b.x + b.w, y: bc.y };
          const dx = (p2.x - p1.x) / 2;
          return {
            d: `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`,
            p1,
            p2,
          };
        }
        const p1 = { x: ac.x, y: bc.y > ac.y ? a.y + a.h : a.y };
        const p2 = { x: bc.x, y: bc.y > ac.y ? b.y : b.y + b.h };
        const dy = (p2.y - p1.y) / 2;
        return {
          d: `M${p1.x},${p1.y} C${p1.x},${p1.y + dy} ${p2.x},${p2.y - dy} ${p2.x},${p2.y}`,
          p1,
          p2,
        };
      };
      const links: { d: string; kind: "peering" | "onprem" | "flow" }[] = [];
      const hubAnchor = wan ? "vhub" : "hubvnet";
      const hubRect = rect(hubAnchor);
      if (hubRect) {
        for (const s of shown.filter((x) => x.group === "corp" && !x.ghost)) {
          const r = rect(`spoke:${s.id}`);
          if (r) links.push({ d: curve(r, hubRect).d, kind: "peering" });
        }
        const idn = on(answers.identity) ? rect("identityvnet") : null;
        if (idn) links.push({ d: curve(idn, hubRect).d, kind: "peering" });
        const h2 = rect(wan ? "vhub2" : "hubvnet2");
        if (h2) links.push({ d: curve(hubRect, h2).d, kind: "peering" });
      }
      const hops: { x: number; y: number }[] = [];
      if (flow?.available) {
        const rs = flow.steps.map((s) => rect(s.at));
        rs.forEach((r, i) => {
          if (!r) return;
          hops.push({ x: r.x + r.w - 4, y: r.y - 6 });
          const next = rs[i + 1];
          if (next && next !== r) links.push({ d: curve(r, next).d, kind: "flow" });
        });
      }
      setGeo({ w: el.scrollWidth, h: el.scrollHeight, links, hops });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  const firewallDetail = hasFirewall(answers) ? `${answers.firewall} · with policy` : undefined;
  const hubParts = (region: 1 | 2) => (
    <>
      <Part
        ctx={ctx}
        id={region === 1 ? "firewall" : "firewall2"}
        label="Azure Firewall"
        detail={firewallDetail}
        icon={BrickWall}
        tone={TONE["firewall"]!}
        on={hasFirewall(answers)}
        toggle={set && (() => set({ firewall: hasFirewall(answers) ? "none" : "Standard" }))}
        select={{ kind: "res", id: "firewall" }}
      />
      <Part
        ctx={ctx}
        id={region === 1 ? "vpngw" : "vpngw2"}
        label="VPN gateway"
        icon={KeyRound}
        tone={TONE["vpngw"]!}
        on={on(answers.vpnGateway)}
        toggle={set && (() => set({ vpnGateway: on(answers.vpnGateway) ? "no" : "yes" }))}
        select={{ kind: "res", id: "vpngw" }}
      />
      <Part
        ctx={ctx}
        id={region === 1 ? "ergw" : "ergw2"}
        label="ExpressRoute gateway"
        icon={Cable}
        tone={TONE["ergw"]!}
        on={on(answers.expressRoute)}
        toggle={set && (() => set({ expressRoute: on(answers.expressRoute) ? "no" : "yes" }))}
        select={{ kind: "res", id: "ergw" }}
      />
      {!wan && (
        <>
          <Part
            ctx={ctx}
            id={region === 1 ? "bastion" : "bastion2"}
            label="Azure Bastion"
            icon={SquareTerminal}
            tone={TONE["bastion"]!}
            on={on(answers.bastion)}
            toggle={set && (() => set({ bastion: on(answers.bastion) ? "no" : "yes" }))}
            select={{ kind: "res", id: "bastion" }}
          />
          <Part
            ctx={ctx}
            id={region === 1 ? "dnsresolver" : "dnsresolver2"}
            label="DNS Private Resolver"
            icon={Signpost}
            tone={TONE["dnsresolver"]!}
            on={answers.privateDns === "platform"}
            toggle={
              set &&
              (() => set({ privateDns: answers.privateDns === "platform" ? "none" : "platform" }))
            }
            select={{ kind: "res", id: "dnsresolver" }}
          />
        </>
      )}
    </>
  );
  const sidecar = (region: 1 | 2) => (
    <Vnet
      title={`Sidecar virtual network · region ${region === 1 ? 1 : "N"}`}
      anchor={region === 1 ? "sidecar" : "sidecar2"}
    >
      <Part
        ctx={ctx}
        id={region === 1 ? "bastion" : "bastion2"}
        label="Azure Bastion"
        icon={SquareTerminal}
        tone={TONE["bastion"]!}
        on={on(answers.bastion)}
        toggle={set && (() => set({ bastion: on(answers.bastion) ? "no" : "yes" }))}
        select={{ kind: "res", id: "bastion" }}
      />
      <Part
        ctx={ctx}
        id={region === 1 ? "dnsresolver" : "dnsresolver2"}
        label="DNS Private Resolver"
        icon={Signpost}
        tone={TONE["dnsresolver"]!}
        on={answers.privateDns === "platform"}
        toggle={
          set &&
          (() => set({ privateDns: answers.privateDns === "platform" ? "none" : "platform" }))
        }
        select={{ kind: "res", id: "dnsresolver" }}
      />
    </Vnet>
  );

  return (
    <div ref={box} className="relative min-w-[880px] space-y-4 bg-white p-4 text-[#1b1b1b]">
      <svg
        className="pointer-events-none absolute inset-0 z-10"
        width={geo.w}
        height={geo.h}
        aria-hidden
      >
        {geo.links.map((l, i) =>
          l.kind === "flow" ? (
            <g key={i}>
              <path
                d={l.d}
                fill="none"
                stroke={flow?.color}
                strokeOpacity={0.25}
                strokeWidth={9}
                strokeLinecap="round"
              />
              <path
                d={l.d}
                fill="none"
                stroke={flow?.color}
                strokeWidth={2.5}
                strokeDasharray="7 6"
                className="lz-dash"
              />
            </g>
          ) : (
            <g key={i}>
              <path
                d={l.d}
                fill="none"
                stroke={l.kind === "onprem" ? "#7a7574" : "#0078d4"}
                strokeWidth={1.4}
                strokeDasharray={l.kind === "onprem" ? "5 4" : undefined}
                opacity={involved ? 0.35 : 0.9}
              />
            </g>
          ),
        )}
      </svg>
      {geo.hops.map((h, i) => (
        <span
          key={i}
          className={cn(
            "absolute z-20 grid size-5 place-items-center rounded-full text-[10.5px] font-bold text-white shadow",
            i === step && "ring-4 ring-offset-0",
          )}
          style={{
            left: h.x,
            top: h.y,
            background: flow?.color,
            ["--tw-ring-color" as string]: `${flow?.color}55`,
          }}
        >
          {i + 1}
        </span>
      ))}

      {/* C — management groups and subscriptions */}
      <Area letter="C" title="Management groups and subscriptions">
        <OrgChart ctx={ctx} spokes={spokes} exists={exists} />
      </Area>

      {/* Outside Azure */}
      <div className="flex flex-wrap items-stretch gap-2">
        <span className="self-center text-[11px] font-semibold tracking-wide text-[#605e5c] uppercase">
          Outside Azure
        </span>
        <External
          ctx={ctx}
          id="onprem"
          label="On-premises systems"
          detail={
            on(answers.expressRoute)
              ? "ExpressRoute circuit"
              : on(answers.vpnGateway)
                ? "Site-to-site VPN"
                : "Not connected"
          }
          icon={Building2}
        />
        <External
          ctx={ctx}
          id="users"
          label="Your customers' users"
          detail="Reach Online installs"
          icon={Users}
        />
        <External
          ctx={ctx}
          id="internet"
          label="Internet"
          detail={hasFirewall(answers) ? "Egress via the firewall" : "Default outbound"}
          icon={Globe}
        />
        <External
          ctx={ctx}
          id="operator"
          label="Operators"
          detail="Microsoft Entra ID sign-in"
          icon={UserCog}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* D — management, security, identity */}
        <div className="space-y-4">
          <Subscription ctx={ctx} letter="D" id="management" title="Management subscription" on>
            <div className="grid grid-cols-2 gap-1.5">
              <Part
                ctx={ctx}
                id="law"
                label="Log Analytics workspace"
                detail={`Platform logs · ${answers.logRetentionDays} days`}
                icon={ScrollText}
                tone={TONE["law"]!}
                on
              />
              <Part
                ctx={ctx}
                id="dcr"
                label="Data collection rules"
                detail="VM insights, change tracking"
                icon={Filter}
                tone={TONE["dcr"]!}
                on={answers.monitoring === "azure_monitor"}
                toggle={
                  set &&
                  (() =>
                    set({
                      monitoring:
                        answers.monitoring === "azure_monitor" ? "third_party" : "azure_monitor",
                    }))
                }
              />
              <Part
                ctx={ctx}
                id="ama"
                label="AMA managed identity"
                icon={Fingerprint}
                tone={TONE["ama"]!}
                on={answers.monitoring === "azure_monitor"}
                toggle={
                  set &&
                  (() =>
                    set({
                      monitoring:
                        answers.monitoring === "azure_monitor" ? "third_party" : "azure_monitor",
                    }))
                }
              />
              <Part
                ctx={ctx}
                id="sentinel"
                label="Microsoft Sentinel"
                detail="On the central workspace"
                icon={Radar}
                tone={TONE["sentinel"]!}
                on={answers.siem === "sentinel"}
                toggle={
                  set && (() => set({ siem: answers.siem === "sentinel" ? "other" : "sentinel" }))
                }
              />
            </div>
          </Subscription>
          <div className="grid grid-cols-2 gap-4">
            <Subscription
              ctx={ctx}
              id="security"
              title="Security subscription"
              on={on(answers.securitySubscription)}
              toggle={
                set &&
                (() =>
                  set({ securitySubscription: on(answers.securitySubscription) ? "no" : "yes" }))
              }
              note="For the security team's own tools"
            >
              <p className="text-[11.5px] text-[#605e5c]">
                Placed under the Security management group. Security tools, services and resources.
              </p>
            </Subscription>
            <Subscription
              ctx={ctx}
              id="identity"
              title="Identity subscription"
              on={on(answers.identity)}
              toggle={set && (() => set({ identity: on(answers.identity) ? "no" : "yes" }))}
              note="Only if workloads need domain controllers"
            >
              <Vnet
                title="Virtual network · peered to the hub"
                anchor="identityvnet"
                dim={!on(answers.identity)}
              >
                <p className="col-span-2 text-[11.5px] text-[#605e5c]">
                  Domain controllers or Microsoft Entra Domain Services — you deploy these.
                </p>
              </Vnet>
            </Subscription>
          </div>
        </div>

        {/* E — connectivity */}
        <Subscription
          ctx={ctx}
          letter="E"
          id="connectivity"
          title="Connectivity subscription"
          on={hub}
          note={hub ? (wan ? "Azure Virtual WAN" : "Hub and spoke") : "No central network"}
          headerExtra={
            set && (
              <select
                className="h-6 rounded border border-[#c8c6c4] bg-white px-1 text-[11px]"
                value={answers.connectivity}
                onChange={(e) => set({ connectivity: e.target.value as Answers["connectivity"] })}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="hub_and_spoke">Hub and spoke</option>
                <option value="virtual_wan">Virtual WAN</option>
                <option value="none">No central network</option>
              </select>
            )
          }
        >
          <div className="grid grid-cols-2 gap-1.5">
            <Part
              ctx={ctx}
              id="ddos"
              label="DDoS Network Protection"
              icon={ShieldAlert}
              tone={TONE["ddos"]!}
              on={hub && on(answers.ddosPlan)}
              toggle={
                set && hub
                  ? () => set({ ddosPlan: on(answers.ddosPlan) ? "no" : "yes" })
                  : undefined
              }
            />
            <Part
              ctx={ctx}
              id="dnszones"
              label="Private DNS zones"
              detail="privatelink.* for private endpoints"
              icon={Network}
              tone={TONE["dnszones"]!}
              on={hub && answers.privateDns === "platform"}
              toggle={
                set && hub
                  ? () =>
                      set({ privateDns: answers.privateDns === "platform" ? "none" : "platform" })
                  : undefined
              }
            />
            {wan && (
              <Part
                ctx={ctx}
                id="vwan"
                label="Virtual WAN"
                detail="Standard"
                icon={Waypoints}
                tone={TONE["vwan"]!}
                on={hub}
              />
            )}
          </div>
          <Vnet
            title={
              wan
                ? `Virtual hub · region 1 · ${answers.primaryRegion}`
                : `Hub virtual network · region 1 · ${answers.primaryRegion}`
            }
            anchor={wan ? "vhub" : "hubvnet"}
            dim={!hub}
            onClick={() => onSelect({ kind: "res", id: wan ? "vhub" : "hubvnet" })}
          >
            {hubParts(1)}
          </Vnet>
          {wan && sidecar(1)}
          {hub && second ? (
            <>
              <p className="-my-1 text-center text-[10.5px] text-[#0078d4]">
                {wan ? "Hubs mesh automatically" : "Global virtual network peering"}
              </p>
              <Vnet
                title={
                  wan
                    ? `Virtual hub · region N · ${answers.secondaryRegion}`
                    : `Hub virtual network · region N · ${answers.secondaryRegion}`
                }
                anchor={wan ? "vhub2" : "hubvnet2"}
                onClick={() => onSelect({ kind: "res", id: wan ? "vhub2" : "hubvnet2" })}
              >
                {hubParts(2)}
              </Vnet>
              {wan && sidecar(2)}
            </>
          ) : (
            hub && (
              <button
                disabled={!set}
                onClick={() =>
                  set?.({
                    secondaryRegion:
                      answers.primaryRegion === "centralus" ? "eastus2" : "centralus",
                  })
                }
                className="w-full rounded-md border border-dashed border-[#a19f9d] px-3 py-2 text-left text-[11.5px] text-[#605e5c] enabled:hover:border-[#0078d4] enabled:hover:text-[#0078d4]"
              >
                {set ? "+ Add a hub in a second region" : "Single region"}
              </button>
            )
          )}
          {!hub && (
            <p className="text-[11.5px] text-[#605e5c]">
              Workloads are internet-facing and not connected to each other or to on-premises.
              Choose a topology to add a hub.
            </p>
          )}
        </Subscription>
      </div>

      {/* F / H — landing zones and sandbox */}
      <div className="space-y-4">
        <Area letter="F" title="Landing zone subscriptions — one per customer install">
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${(["corp", "online", "local"] as const).filter(exists).length}, minmax(0, 1fr))`,
            }}
          >
            {(["corp", "online", "local"] as const).map((g) => (
              <LandingGroup
                key={g}
                ctx={ctx}
                group={g}
                spokes={shown.filter((s) => s.group === g)}
                included={has(g)}
                exists={exists(g)}
              />
            ))}
          </div>
        </Area>
        <div className="grid grid-cols-2 gap-3">
          <Subscription
            ctx={ctx}
            letter="H"
            id="sandbox"
            title="Sandbox"
            on={has("sandbox")}
            toggle={set && (() => toggleGroup(set, answers, "sandbox"))}
            note="Isolated experiments"
            compact
          >
            <Part
              ctx={ctx}
              id="sandboxapps"
              label="Applications"
              detail="Not connected to the hub"
              icon={AppWindow}
              tone="#0078d4"
              on={has("sandbox")}
              select={{ kind: "mg", id: "sandbox" }}
            />
          </Subscription>
          <Subscription
            ctx={ctx}
            id="decommissioned"
            title="Decommissioned"
            on
            note="Cancelled subscriptions, 30–60 days"
            compact
          >
            <p className="text-[11px] text-[#605e5c]">
              Customers who leave. Nothing new can be created.
            </p>
          </Subscription>
        </div>
      </div>
      <p className="text-[10.5px] text-[#8a8886]">
        Layout follows Microsoft's Azure landing zone reference architecture (Cloud Adoption
        Framework, hub and spoke). Solid = in your design · dashed = left out · tick or untick
        anything to change it. {res.size} platform resources.
      </p>
    </div>
  );
}

const toggleGroup = (set: Patch, a: Answers, g: OptionalGroup) =>
  set({
    landingZones: a.landingZones.includes(g)
      ? a.landingZones.filter((x) => x !== g)
      : [...a.landingZones, g],
  });

/* ------------------------------------------------------------------ pieces */

function Letter({ l }: { l: string }) {
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#107c10] text-[10.5px] font-bold text-white">
      {l}
    </span>
  );
}

function Area({ letter, title, children }: { letter: string; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold">
        <Letter l={letter} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Subscription({
  ctx,
  letter,
  id,
  title,
  on: isOn,
  toggle,
  note,
  headerExtra,
  compact,
  children,
}: {
  ctx: Ctx;
  letter?: string;
  id: string;
  title: string;
  on: boolean;
  toggle?: (() => void) | undefined;
  note?: string;
  headerExtra?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  const selected = ctx.sel?.kind === "sub" && ctx.sel.id === id;
  return (
    <section
      data-anchor={`sub:${id}`}
      onClick={() => ctx.onSelect({ kind: "sub", id })}
      className={cn(
        "cursor-pointer rounded-lg border p-3 transition-colors",
        isOn ? "border-[#c7e0f4] bg-[#eff6fc]" : "border-dashed border-[#a19f9d] bg-white",
        selected && "ring-2 ring-[#0078d4]",
        ctx.involved && "opacity-70",
      )}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {letter && <Letter l={letter} />}
          <KeyRound className="size-4 shrink-0 text-[#e8a900]" />
          <div className="min-w-0">
            <p className={cn("truncate text-[13px] font-semibold", !isOn && "text-[#605e5c]")}>
              {title}
            </p>
            {note && (
              <p className="truncate text-[10.5px] text-[#605e5c]">
                {isOn ? note : ctx.asIs ? "Not found in the tenant" : "Left out of this design"}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {headerExtra}
          {toggle && <Tick on={isOn} onClick={toggle} />}
        </div>
      </header>
      <div className={cn("space-y-2", !isOn && "opacity-55")}>{children}</div>
      {!compact && <Toolset ctx={ctx} mg={id} dim={!isOn} />}
    </section>
  );
}

function Toolset({ ctx, mg, dim }: { ctx: Ctx; mg: string; dim: boolean }) {
  const eff = effectivePolicies(ctx.tree, mg);
  if (!eff.length || ctx.asIs) return null;
  const items = TOOLS.map((t) => {
    const hit = eff.filter((e) => e.item.name === t.assignment);
    if (!hit.length) return null;
    const active = hit.some((e) => e.item.change?.action !== "remove");
    return { t, active };
  }).filter(Boolean) as { t: (typeof TOOLS)[number]; active: boolean }[];
  const count = eff.filter((e) => e.item.change?.action !== "remove").length;
  return (
    <div
      className={cn(
        "mt-2.5 flex flex-wrap gap-1 border-t border-[#c7e0f4] pt-2",
        dim && "opacity-50",
      )}
    >
      {items.map(({ t, active }) => (
        <button
          key={t.id}
          title={`${t.label}: ${t.body} Assigned by policy (${t.assignment}) — ${active ? "click to leave out" : "click to add back"} everywhere it applies.`}
          disabled={!ctx.set || !t.answer}
          onClick={(e) => {
            e.stopPropagation();
            ctx.set?.(toggleTool(t, ctx.answers));
          }}
          className={cn(
            "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] transition-colors",
            active
              ? "border-[#c7e0f4] bg-white text-[#323130]"
              : "border-dashed border-[#a19f9d] text-[#8a8886] line-through",
            ctx.set && t.answer && "hover:border-[#0078d4]",
          )}
        >
          <t.icon className={cn("size-3", active ? "text-[#0078d4]" : "text-[#a19f9d]")} />
          {t.label}
        </button>
      ))}
      <button
        onClick={(e) => {
          e.stopPropagation();
          ctx.onSelect({ kind: "mg", id: mg });
        }}
        className="flex items-center gap-1 rounded border border-[#c7e0f4] bg-white px-1.5 py-0.5 text-[10.5px] text-[#323130] hover:border-[#0078d4]"
        title="Every policy assignment that reaches this subscription"
      >
        <ShieldCheck className="size-3 text-[#107c10]" />
        Policy · {count}
      </button>
    </div>
  );
}

function Vnet({
  title,
  anchor,
  dim,
  onClick,
  children,
}: {
  title: string;
  anchor: string;
  dim?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-anchor={anchor}
      onClick={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded-md border bg-white/70 p-2",
        dim ? "border-dashed border-[#a19f9d]" : "border-[#8dc8e8]",
      )}
    >
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#005a9e]">
        <span className="font-mono text-[#0078d4]">‹··›</span>
        {title}
      </p>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

function Tick({
  on: isOn,
  onClick,
  locked,
}: {
  on: boolean;
  onClick: () => void;
  locked?: string | undefined;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!locked) onClick();
      }}
      disabled={!!locked}
      title={locked ?? (isOn ? "Leave out of the design" : "Add to the design")}
      aria-pressed={isOn}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[3px] border transition-colors",
        isOn
          ? "border-[#0078d4] bg-[#0078d4] text-white"
          : "border-[#8a8886] bg-white hover:border-[#0078d4]",
        locked && "cursor-not-allowed opacity-60",
      )}
    >
      {isOn && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}

function Part({
  ctx,
  id,
  label,
  detail,
  icon: Icon,
  tone,
  on: initiallyOn,
  toggle,
  select,
}: {
  ctx: Ctx;
  id: string;
  label: string;
  detail?: string | undefined;
  icon: LucideIcon;
  tone: string;
  on: boolean;
  toggle?: (() => void) | undefined;
  select?: Sel;
}) {
  let isOn = initiallyOn;
  const s = select ?? { kind: "res" as const, id };
  if (ctx.asIs && !["sandboxapps"].includes(id))
    isOn = isOn && ctx.asIs.parts.has(id.replace(/2$/, ""));
  const selected = ctx.sel?.kind === s.kind && ctx.sel.id === s.id;
  const lit = !ctx.involved || ctx.involved.has(id);
  return (
    <div
      data-anchor={id}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onSelect(s);
      }}
      className={cn(
        "relative flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 pr-6 transition",
        isOn
          ? "border-[#e1dfdd] bg-white hover:border-[#0078d4]"
          : "border-dashed border-[#a19f9d] bg-transparent",
        selected && "ring-2 ring-[#0078d4]",
        !lit && "opacity-35",
      )}
    >
      <span
        className="grid size-7 shrink-0 place-items-center rounded"
        style={{ background: isOn ? `${tone}18` : "#f3f2f1", color: isOn ? tone : "#a19f9d" }}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-[11.5px] leading-tight font-semibold",
            !isOn && "text-[#8a8886] line-through",
          )}
        >
          {label}
        </span>
        {(detail || !isOn) && (
          <span className="block truncate text-[10.5px] leading-tight text-[#605e5c]">
            {isOn ? detail : ctx.asIs ? "Not found" : "Left out"}
          </span>
        )}
      </span>
      {toggle && (
        <span className="absolute top-1 right-1">
          <Tick on={isOn} onClick={toggle} />
        </span>
      )}
    </div>
  );
}

function External({
  ctx,
  id,
  label,
  detail,
  icon: Icon,
}: {
  ctx: Ctx;
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
}) {
  const lit = !ctx.involved || ctx.involved.has(id);
  return (
    <div
      data-anchor={id}
      onClick={() => ctx.onSelect({ kind: "ext", id })}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border border-[#c8c6c4] bg-[#f3f2f1] px-2.5 py-1.5 hover:border-[#605e5c]",
        !lit && "opacity-35",
      )}
    >
      <Icon className="size-4 text-[#605e5c]" />
      <span>
        <span className="block text-[11.5px] leading-tight font-semibold">{label}</span>
        <span className="block text-[10.5px] leading-tight text-[#605e5c]">{detail}</span>
      </span>
    </div>
  );
}

function LandingGroup({
  ctx,
  group,
  spokes,
  included,
  exists,
}: {
  ctx: Ctx;
  group: OptionalGroup;
  spokes: Spoke[];
  included: boolean;
  exists: boolean;
}) {
  const installs = spokes.filter((s) => !s.ghost);
  const visible = spokes.slice(0, installs.length > 3 ? 2 : 3);
  const more = installs.length > 3 ? installs.length - 2 : 0;
  const selected = ctx.sel?.kind === "mg" && ctx.sel.id === group;
  if (!exists) return null;
  return (
    <div
      onClick={() => ctx.onSelect({ kind: "mg", id: group })}
      className={cn(
        "cursor-pointer rounded-lg border p-2.5",
        included ? "border-[#c7e0f4] bg-[#eff6fc]" : "border-dashed border-[#a19f9d] bg-white",
        selected && "ring-2 ring-[#0078d4]",
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className={cn("text-[12px] font-semibold", !included && "text-[#8a8886]")}>
          {LANDING_ZONE_LABEL[group]?.title}{" "}
          <span className="font-normal text-[#605e5c]">
            ·{" "}
            {included
              ? group === "corp"
                ? "peered to the hub"
                : group === "online"
                  ? "internet-facing, not peered"
                  : "Azure Local"
              : "left out"}
          </span>
        </p>
        {ctx.set && (
          <Tick
            on={included}
            locked={
              included && installs.length
                ? `${installs.length} install${installs.length === 1 ? "" : "s"} live here — move them before removing ${LANDING_ZONE_LABEL[group]?.title}`
                : undefined
            }
            onClick={() => toggleGroup(ctx.set!, ctx.answers, group)}
          />
        )}
      </div>
      {included && (
        <div className="grid grid-cols-1 gap-1.5">
          {visible.map((s) => (
            <Install key={s.id} ctx={ctx} spoke={s} />
          ))}
          {more > 0 && (
            <div className="grid place-items-center rounded-md border border-[#e1dfdd] bg-white px-2 py-1.5 text-[11px] text-[#605e5c]">
              +{more} more installs
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Install({ ctx, spoke }: { ctx: Ctx; spoke: Spoke }) {
  const selected = ctx.sel?.kind === "spoke" && ctx.sel.id === spoke.id;
  const lit = !ctx.involved || ctx.involved.has(`spoke:${spoke.id}`);
  return (
    <div
      data-anchor={`spoke:${spoke.id}`}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onSelect({ kind: "spoke", id: spoke.id });
      }}
      className={cn(
        "min-w-0 rounded-md border px-2 py-1.5 transition",
        spoke.ghost
          ? "border-dashed border-[#a19f9d] bg-transparent"
          : "border-[#e1dfdd] bg-white hover:border-[#0078d4]",
        selected && "ring-2 ring-[#0078d4]",
        !lit && "opacity-35",
      )}
    >
      <p className="flex items-center gap-1 truncate text-[11.5px] font-semibold">
        <KeyRound className="size-3 shrink-0 text-[#e8a900]" />
        <span className="truncate">
          {spoke.placement ? spoke.placement.customerName : "Next install lands here"}
        </span>
      </p>
      <p className="truncate text-[10.5px] text-[#605e5c]">
        {spoke.placement
          ? `${spoke.placement.environment} · ${spoke.placement.offering}`
          : "Vended on onboarding"}
      </p>
      {!spoke.ghost && (
        <p className="mt-1 flex gap-1">
          {(spoke.group === "online" ? ["VNet", "NSGs", "WAF"] : ["VNet", "NSGs", "UDRs"]).map(
            (c) => (
              <span
                key={c}
                className="rounded-sm border border-[#e1dfdd] px-1 text-[9.5px] text-[#605e5c]"
              >
                {c}
              </span>
            ),
          )}
          <Blocks className="ml-auto size-3 text-[#0078d4]" />
        </p>
      )}
    </div>
  );
}

function OrgChart({ ctx, exists }: { ctx: Ctx; spokes: Spoke[]; exists: (id: string) => boolean }) {
  const { tree, answers } = ctx;
  const node = (id: string) => tree.find((n) => n.libraryId === id);
  const root = node("alz");
  const optional = (id: string) => ["corp", "online", "local", "sandbox"].includes(id);
  const subsFor: Record<string, { label: string; on: boolean }[]> = {
    security: [{ label: "Subscription", on: on(answers.securitySubscription) }],
    management: [{ label: "Subscription", on: true }],
    identity: [{ label: "Subscription", on: on(answers.identity) }],
    connectivity: [{ label: "Subscription", on: hasHub(answers) }],
    decommissioned: [{ label: "Cancelled subs", on: true }],
  };
  const mgBox = (id: string, label?: string) => {
    const n = node(id);
    const included = !!n && (!ctx.present || ctx.present.has(id));
    if (!exists(id) && id !== "alz") return null;
    const selected = ctx.sel?.kind === "mg" && ctx.sel.id === id;
    return (
      <div key={id} className="flex flex-col items-center gap-1">
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect({ kind: "mg", id });
          }}
          className={cn(
            "relative min-w-[88px] rounded border px-2 py-1 text-center transition",
            included
              ? "border-[#c8c6c4] bg-white hover:border-[#0078d4]"
              : "border-dashed border-[#a19f9d] bg-transparent text-[#8a8886]",
            selected && "ring-2 ring-[#0078d4]",
          )}
          title={
            included
              ? `${n!.enforced} assigned here · ${n!.inherited} inherited`
              : "Left out of this design"
          }
        >
          <span className={cn("block text-[11.5px] font-semibold", !included && "line-through")}>
            {label ?? n?.displayName ?? id}
          </span>
          <span className="block font-mono text-[9.5px] text-[#605e5c]">
            {included
              ? (ctx.asIs?.counts[id] ?? `${n!.enforced} + ${n!.inherited}`)
              : ctx.present
                ? "not in tenant"
                : "left out"}
          </span>
          {ctx.set && optional(id) && (
            <span className="absolute -top-1.5 -right-1.5">
              <Tick
                on={included}
                onClick={() => toggleGroup(ctx.set!, answers, id as OptionalGroup)}
              />
            </span>
          )}
        </div>
        {included &&
          subsFor[id]?.map((s) => (
            <span
              key={s.label}
              className={cn(
                "rounded-sm border px-1.5 py-0.5 text-[10px]",
                s.on
                  ? "border-[#e8c65b] bg-[#fff4ce]"
                  : "border-dashed border-[#a19f9d] text-[#8a8886] line-through",
              )}
            >
              {s.label}
            </span>
          ))}
      </div>
    );
  };
  const branch = (parent: string, kids: string[]) => (
    <div className="flex flex-col items-center">
      {mgBox(parent)}
      <span className="h-3 w-px bg-[#8a8886]" />
      <div className="flex gap-2 border-t border-[#8a8886] px-2 pt-3">
        {kids.map((k) => mgBox(k))}
      </div>
    </div>
  );
  if (!root) return null;
  return (
    <div
      className="overflow-x-auto rounded-lg border border-[#c7e0f4] bg-[#eff6fc] p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-max flex-col items-center">
        <span className="rounded-sm border border-dashed border-[#8a8886] bg-white px-2 py-0.5 text-[10.5px] text-[#605e5c]">
          Tenant root group
        </span>
        <span className="h-3 w-px bg-[#8a8886]" />
        {mgBox("alz", root.displayName)}
        <span className="h-3 w-px bg-[#8a8886]" />
        <div className="flex items-start gap-4 border-t border-[#8a8886] px-4 pt-3">
          {branch("platform", ["security", "management", "identity", "connectivity"])}
          {branch("landingzones", ["corp", "online", "local"])}
          {mgBox("sandbox")}
          {mgBox("decommissioned")}
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-[#605e5c]">
        Numbers: policy assignments made here + inherited from above. Click a group to see and
        change them.
      </p>
    </div>
  );
}
