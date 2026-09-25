/*
 * The landing zone laid out like Microsoft's reference diagram (CAF "Azure landing zone (ALZ) — Hub & Spoke"):
 * security, management and identity on the left; billing, identity and access, and the management group and
 * subscription organization across the top; connectivity and the landing zones in the middle; on-premises,
 * DevOps and the sandbox on the right. Every box and item is live: click it for details, tick it in or out,
 * add subscriptions, regions and groups where they belong. Connectors and traffic flows are drawn from the
 * actual design.
 */
import {
  Boxes,
  Building2,
  CreditCard,
  GitBranch,
  Globe,
  KeyRound,
  Plus,
  ShieldHalf,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import {
  type AlzLibrary,
  type Answers,
  type MgNode,
  type OptionalGroup,
  hasFirewall,
  hasHub,
  on,
  platformResources,
} from "@/lib/alz/engine";
import type { Flow, Sel, Spoke } from "@/lib/alz/scene";
import { AZURE_REGIONS } from "@/lib/regions";
import { cn } from "@/lib/utils";

import { ICON, TONE, TOOLS, toggleTool, toolOn } from "./ArchitectureDiagram";
import { type Adding, AddDialog } from "./HierarchyEditor";

type Patch = (p: Partial<Answers>) => void;
type Link = {
  from: string;
  to: string;
  kind: "org" | "peering" | "onprem" | "logs" | "deploy";
  label?: string;
};

const W = 1400;

export function ReferenceCanvas({
  lib,
  tree,
  answers,
  set,
  spokes,
  sel,
  onSelect,
  flow,
  step,
}: {
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
  void lib;
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // "fit" scales the whole drawing to the width; a number is a fixed zoom with scrolling.
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [height, setHeight] = useState(900);
  const [hover, setHover] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);
  const [geo, setGeo] = useState<{
    links: (Link & { d: string; mid: { x: number; y: number } })[];
    flow: string[];
    hops: { x: number; y: number }[];
  }>({ links: [], flow: [], hops: [] });

  const wan = answers.connectivity === "virtual_wan";
  const hub = hasHub(answers);
  const fw = hasFirewall(answers);
  const second =
    hub && !!answers.secondaryRegion && answers.secondaryRegion !== answers.primaryRegion;
  const res = new Set(platformResources(answers).map((r) => r.id));
  const has = (id: string) => tree.some((n) => n.libraryId === id);
  const corp = spokes.filter((s) => s.group === "corp");
  const online = spokes.filter((s) => s.group === "online");
  const liveCorp = corp.filter((s) => !s.ghost);
  const edit = !!set;

  const pick = (s: Sel) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(s);
  };
  const isSel = (kind: Sel["kind"], id: string) => sel?.kind === kind && sel.id === id;
  const flowAt = new Set(flow?.available ? flow.steps.map((s) => s.at) : []);

  const links: Link[] = [
    { from: "entra", to: "mg-root", kind: "org" },
    { from: "billing", to: "subs-row", kind: "org", label: "Subscriptions" },
    { from: "onprem", to: "entra", kind: "onprem", label: "Directory sync" },
    { from: "devops", to: "mg-box", kind: "deploy", label: "Deploys" },
    ...(on(answers.securitySubscription)
      ? [{ from: "chip:security", to: "sub:security", kind: "org" as const }]
      : []),
    { from: "chip:management", to: "sub:management", kind: "org" },
    ...(on(answers.identity)
      ? [{ from: "chip:identity", to: "sub:identity", kind: "org" as const }]
      : []),
    ...(hub ? [{ from: "chip:connectivity", to: "sub:connectivity", kind: "org" as const }] : []),
    ...(has("corp") ? [{ from: "chip:corp", to: "sub:corp", kind: "org" as const }] : []),
    ...(has("online") ? [{ from: "chip:online", to: "sub:online", kind: "org" as const }] : []),
    ...(has("sandbox") ? [{ from: "chip:sandbox", to: "sub:sandbox", kind: "org" as const }] : []),
    ...(on(answers.securitySubscription)
      ? [{ from: "law", to: "seclaw", kind: "logs" as const, label: "Subset" }]
      : []),
    ...(hub
      ? [
          ...(on(answers.identity)
            ? [{ from: "hub1", to: "identityvnet", kind: "peering" as const, label: "Peering" }]
            : []),
          ...liveCorp.slice(0, 3).map((s) => ({
            from: "hub1",
            to: `spoke:${s.id}`,
            kind: "peering" as const,
            label: "Peering",
          })),
          ...(second
            ? [{ from: "hub1", to: "hub2", kind: "peering" as const, label: "Global peering" }]
            : []),
          ...(on(answers.vpnGateway) || on(answers.expressRoute)
            ? [
                {
                  from: "onprem",
                  to: on(answers.expressRoute) ? "ergw" : "vpngw",
                  kind: "onprem" as const,
                  label: on(answers.expressRoute) ? "ExpressRoute" : "VPN",
                },
              ]
            : []),
        ]
      : []),
  ];

  const key = JSON.stringify([answers, spokes.length, flow?.id, flow?.available]);
  useLayoutEffect(() => {
    const o = outer.current;
    const el = inner.current;
    if (!o || !el) return;
    const measure = () => {
      const s = zoom === "fit" ? Math.min(1, o.clientWidth / W) : zoom;
      setScale(s);
      setHeight(el.scrollHeight);
      const base = el.getBoundingClientRect();
      const rect = (id: string) => {
        const n = el.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(id)}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return {
          x: (r.left - base.left) / s,
          y: (r.top - base.top) / s,
          w: r.width / s,
          h: r.height / s,
        };
      };
      const route = (
        a: NonNullable<ReturnType<typeof rect>>,
        b: NonNullable<ReturnType<typeof rect>>,
      ) => {
        const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
        const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const horizontal = Math.abs(bc.x - ac.x) > Math.abs(bc.y - ac.y) * 1.2;
        const p1 = horizontal
          ? { x: bc.x > ac.x ? a.x + a.w : a.x, y: ac.y }
          : { x: ac.x, y: bc.y > ac.y ? a.y + a.h : a.y };
        const p2 = horizontal
          ? { x: bc.x > ac.x ? b.x : b.x + b.w, y: bc.y }
          : { x: bc.x, y: bc.y > ac.y ? b.y : b.y + b.h };
        const d = horizontal
          ? `M${p1.x},${p1.y} C${(p1.x + p2.x) / 2},${p1.y} ${(p1.x + p2.x) / 2},${p2.y} ${p2.x},${p2.y}`
          : `M${p1.x},${p1.y} C${p1.x},${(p1.y + p2.y) / 2} ${p2.x},${(p1.y + p2.y) / 2} ${p2.x},${p2.y}`;
        return { d, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
      };
      const out: (Link & { d: string; mid: { x: number; y: number } })[] = [];
      for (const l of links) {
        const a = rect(l.from);
        const b = rect(l.to);
        if (a && b) out.push({ ...l, ...route(a, b) });
      }
      const flowPaths: string[] = [];
      const hops: { x: number; y: number }[] = [];
      if (flow?.available) {
        const rs = flow.steps.map((x) => rect(x.at));
        rs.forEach((r, i) => {
          if (!r) return;
          hops.push({ x: r.x + r.w - 6, y: r.y - 8 });
          const n = rs[i + 1];
          if (n && n !== r) flowPaths.push(route(r, n).d);
        });
      }
      setGeo({ links: out, flow: flowPaths, hops });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, zoom]);

  const related = (l: Link) =>
    !!hover &&
    (l.from === hover ||
      l.to === hover ||
      l.from.endsWith(`:${hover}`) ||
      l.to.endsWith(`:${hover}`));

  /* --------------------------------------------------------------- pieces */

  const Item = ({
    id,
    label,
    detail,
    icon,
    tone,
    isOn,
    toggle,
    select,
  }: {
    id: string;
    label: string;
    detail?: string | undefined;
    icon: LucideIcon;
    tone: string;
    isOn: boolean;
    toggle?: (() => void) | undefined;
    select?: Sel;
  }) => {
    const Icon = icon;
    const s = select ?? { kind: "res" as const, id };
    return (
      <div
        data-anchor={id}
        onClick={pick(s)}
        className={cn(
          "group relative flex cursor-pointer items-center gap-1.5 rounded border bg-white px-1.5 py-1 text-[10.5px] transition",
          isOn
            ? "border-[#c8c6c4] hover:border-[#0078d4]"
            : "border-dashed border-[#a19f9d] text-[#8a8886]",
          isSel(s.kind, s.id) && "ring-2 ring-[#0078d4]",
          flowAt.has(id) && "ring-2 ring-offset-1",
        )}
        style={flowAt.has(id) ? { ["--tw-ring-color" as string]: flow?.color } : undefined}
      >
        <span
          className="grid size-5 shrink-0 place-items-center rounded"
          style={{ background: isOn ? `${tone}18` : "#f3f2f1" }}
        >
          <Icon className="size-3.5" style={{ color: isOn ? tone : "#a19f9d" }} />
        </span>
        <span className="min-w-0 leading-tight">
          <span className={cn("block truncate font-medium", !isOn && "line-through")}>{label}</span>
          {detail && isOn && (
            <span className="block truncate text-[9.5px] text-[#605e5c]">{detail}</span>
          )}
        </span>
        {toggle && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            title={isOn ? "Leave it out" : "Add it"}
            className={cn(
              "ml-auto grid size-3.5 shrink-0 place-items-center rounded-sm border text-[9px] leading-none",
              isOn
                ? "border-[#0078d4] bg-[#0078d4] text-white"
                : "border-[#8a8886] bg-white text-transparent group-hover:text-[#8a8886]",
            )}
          >
            ✓
          </button>
        )}
      </div>
    );
  };

  const Toolset = ({ scope }: { scope: string }) => (
    <div className="mt-2 flex flex-wrap gap-1 border-t border-[#dfe7ef] pt-1.5">
      {TOOLS.map((t) => {
        const onNow = toolOn(t, answers);
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            title={`${t.label} — ${t.body}${edit && t.answer ? " Click to turn it " + (onNow ? "off." : "on.") : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (set && t.answer) set(toggleTool(t, answers));
              else onSelect({ kind: "tool", id: t.id });
            }}
            className={cn(
              "flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[9px]",
              onNow
                ? "border-[#c7e0f4] bg-white text-[#323130]"
                : "border-dashed border-[#a19f9d] text-[#a19f9d] line-through",
            )}
            data-scope={scope}
          >
            <Icon className="size-3" />
            {t.label}
          </button>
        );
      })}
    </div>
  );

  const Box = ({
    anchor,
    letter,
    title,
    subtitle,
    isOn = true,
    toggle,
    select,
    className,
    tone = "sub",
    children,
  }: {
    anchor: string;
    letter?: string;
    title: string;
    subtitle?: string;
    isOn?: boolean;
    toggle?: (() => void) | undefined;
    select?: Sel;
    className?: string;
    tone?: "sub" | "plain" | "ext";
    children?: ReactNode;
  }) => (
    <section
      data-anchor={anchor}
      onClick={select ? pick(select) : undefined}
      onMouseEnter={() => setHover(anchor)}
      onMouseLeave={() => setHover(null)}
      className={cn(
        "relative rounded-md border p-2.5 transition",
        select && "cursor-pointer",
        tone === "sub" &&
          (isOn ? "border-[#c7e0f4] bg-[#eff6fc]" : "border-dashed border-[#a19f9d] bg-white"),
        tone === "plain" && "border-[#d2d0ce] bg-[#f8f8f8]",
        tone === "ext" && "border-[#c8c6c4] bg-[#edebe9]",
        select && isSel(select.kind, select.id) && "ring-2 ring-[#0078d4]",
        className,
      )}
    >
      <header className="mb-1.5 flex items-start gap-1.5">
        {letter && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#107c10] text-[10px] font-bold text-white">
            {letter}
          </span>
        )}
        {tone === "sub" && <KeyRound className="mt-0.5 size-3.5 shrink-0 text-[#e8a900]" />}
        <div className="min-w-0 flex-1">
          <p className={cn("text-[12px] leading-tight font-semibold", !isOn && "text-[#8a8886]")}>
            {title}
          </p>
          {subtitle && (
            <p className="truncate text-[10px] text-[#605e5c]">
              {isOn ? subtitle : "Left out of this design"}
            </p>
          )}
        </div>
        {toggle && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            title={isOn ? "Leave this out" : "Add it"}
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-sm border text-[10px] leading-none",
              isOn
                ? "border-[#0078d4] bg-[#0078d4] text-white"
                : "border-[#8a8886] bg-white text-[#8a8886]",
            )}
          >
            {isOn ? "✓" : "+"}
          </button>
        )}
      </header>
      {isOn && children}
    </section>
  );

  const Vnet = ({
    anchor,
    title,
    select,
    children,
  }: {
    anchor: string;
    title: string;
    select: Sel;
    children: ReactNode;
  }) => (
    <div
      data-anchor={anchor}
      onClick={pick(select)}
      className={cn(
        "cursor-pointer rounded border border-[#8ac7ea] bg-[#e5f4fc] p-1.5",
        isSel(select.kind, select.id) && "ring-2 ring-[#0078d4]",
      )}
    >
      <p className="mb-1 text-[10px] font-semibold text-[#0078d4]">‹···› {title}</p>
      {children}
    </div>
  );

  const AddButton = ({ label, onClick }: { label: string; onClick: () => void }) =>
    edit ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-dashed border-[#8a8886] py-1 text-[10px] text-[#605e5c] hover:border-[#0078d4] hover:text-[#0078d4]"
      >
        <Plus className="size-3" /> {label}
      </button>
    ) : null;

  const firewallDetail = fw ? `${answers.firewall} · with policy` : undefined;
  const hubItems = (n: 1 | 2) => (
    <div className="grid grid-cols-2 gap-1">
      <Item
        id={n === 1 ? "firewall" : "firewall2"}
        label="Azure Firewall"
        detail={firewallDetail}
        icon={ICON["firewall"]!}
        tone={TONE["firewall"]!}
        isOn={fw}
        toggle={set && (() => set({ firewall: fw ? "none" : "Standard" }))}
        select={{ kind: "res", id: "firewall" }}
      />
      <Item
        id={n === 1 ? "vpngw" : "vpngw2"}
        label="VPN gateway"
        icon={ICON["vpngw"]!}
        tone={TONE["vpngw"]!}
        isOn={on(answers.vpnGateway)}
        toggle={set && (() => set({ vpnGateway: on(answers.vpnGateway) ? "no" : "yes" }))}
        select={{ kind: "res", id: "vpngw" }}
      />
      <Item
        id={n === 1 ? "ergw" : "ergw2"}
        label="ExpressRoute gateway"
        icon={ICON["ergw"]!}
        tone={TONE["ergw"]!}
        isOn={on(answers.expressRoute)}
        toggle={set && (() => set({ expressRoute: on(answers.expressRoute) ? "no" : "yes" }))}
        select={{ kind: "res", id: "ergw" }}
      />
      <Item
        id={n === 1 ? "dnsresolver" : "dnsresolver2"}
        label="DNS Private Resolver"
        icon={ICON["dnsresolver"]!}
        tone={TONE["dnsresolver"]!}
        isOn={answers.privateDns === "platform"}
        toggle={
          set &&
          (() => set({ privateDns: answers.privateDns === "platform" ? "none" : "platform" }))
        }
        select={{ kind: "res", id: "dnsresolver" }}
      />
      {!wan && (
        <Item
          id={n === 1 ? "bastion" : "bastion2"}
          label="Azure Bastion"
          icon={ICON["bastion"]!}
          tone={TONE["bastion"]!}
          isOn={on(answers.bastion)}
          toggle={set && (() => set({ bastion: on(answers.bastion) ? "no" : "yes" }))}
          select={{ kind: "res", id: "bastion" }}
        />
      )}
    </div>
  );

  const nextRegion =
    AZURE_REGIONS.find(
      (r) =>
        r.name !== answers.primaryRegion &&
        r.geo === AZURE_REGIONS.find((x) => x.name === answers.primaryRegion)?.geo,
    )?.name ?? "centralus";
  const toggleLz = (g: OptionalGroup) =>
    set?.({
      landingZones: answers.landingZones.includes(g)
        ? answers.landingZones.filter((x) => x !== g)
        : [...answers.landingZones, g],
    });

  /* ------------------------------------------------------ org chart (C) */
  const kids = (id: string | null) => tree.filter((n) => n.parentId === id);
  const mgBox = (n: MgNode): ReactNode => (
    <div key={n.id} className="flex flex-col items-center">
      <button
        data-anchor={n.parentId ? `mg:${n.libraryId}` : "mg-root"}
        onClick={pick({ kind: "mg", id: n.libraryId })}
        onMouseEnter={() => setHover(n.libraryId)}
        onMouseLeave={() => setHover(null)}
        className={cn(
          "rounded border bg-white px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap hover:border-[#0078d4]",
          isSel("mg", n.libraryId) ? "border-[#0078d4] ring-2 ring-[#0078d4]" : "border-[#c8c6c4]",
        )}
        title={`${n.enforced} policy assignments here · ${n.inherited} inherited`}
      >
        {n.displayName}
      </button>
      {kids(n.id).length > 0 && (
        <>
          <span className="h-2 w-px bg-[#8a8886]" />
          <div className="flex items-start gap-1 border-t border-[#8a8886] px-1 pt-2">
            {kids(n.id).map(mgBox)}
          </div>
        </>
      )}
    </div>
  );
  const roots = kids(null);
  const chips: { id: string; label: string; on: boolean }[] = [
    { id: "security", label: "Security subscription", on: on(answers.securitySubscription) },
    { id: "management", label: "Management subscription", on: true },
    { id: "identity", label: "Identity subscription", on: on(answers.identity) },
    { id: "connectivity", label: "Connectivity subscription", on: hub },
    {
      id: "corp",
      label: `Corp · ${liveCorp.length} install${liveCorp.length === 1 ? "" : "s"}`,
      on: has("corp"),
    },
    {
      id: "online",
      label: `Online · ${online.filter((s) => !s.ghost).length} installs`,
      on: has("online"),
    },
    { id: "sandbox", label: "Sandbox subscriptions", on: has("sandbox") },
    ...answers.extraSubscriptions.map((x) => ({ id: `extra-${x.id}`, label: x.name, on: true })),
  ];

  const spokeCard = (s: Spoke, i: number) => (
    <div
      key={`${s.id}-${i}`}
      data-anchor={`spoke:${s.id}`}
      onClick={pick({ kind: "spoke", id: s.id })}
      className={cn(
        "cursor-pointer rounded border bg-white p-1.5",
        s.ghost ? "border-dashed border-[#a19f9d]" : "border-[#c8c6c4] hover:border-[#0078d4]",
        isSel("spoke", s.id) && "ring-2 ring-[#0078d4]",
        flowAt.has(`spoke:${s.id}`) && "ring-2",
      )}
      style={
        flowAt.has(`spoke:${s.id}`) ? { ["--tw-ring-color" as string]: flow?.color } : undefined
      }
    >
      <p className="truncate text-[10.5px] font-semibold">
        {s.placement
          ? `${s.placement.customerName} · ${s.placement.environment}`
          : "Next customer install"}
      </p>
      <div className="mt-1 flex gap-1 text-[9px]">
        {["Virtual network", "DNS", "UDRs", "NSGs"].map((x) => (
          <span key={x} className="rounded-sm border border-[#c7e0f4] bg-[#f3f9fd] px-1">
            {x}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative w-full bg-white">
      <div className="flex items-center justify-end gap-1 border-b border-[#edebe9] bg-white px-3 py-1 text-[11px]">
        <span className="mr-auto text-[#605e5c]">
          Hover a subscription to see where it lives · click anything for details · ✓ / + to change
          the design
        </span>
        {(["fit", 0.75, 1] as const).map((z) => (
          <button
            key={String(z)}
            onClick={(e) => {
              e.stopPropagation();
              setZoom(z);
            }}
            className={cn(
              "rounded-sm border px-1.5 py-0.5",
              zoom === z
                ? "border-[#0078d4] bg-[#eff6fc] text-[#0078d4]"
                : "border-[#c8c6c4] text-[#605e5c]",
            )}
          >
            {z === "fit" ? "Fit" : `${Math.round(z * 100)}%`}
          </button>
        ))}
      </div>
      <div
        ref={outer}
        className={cn(
          "relative w-full bg-white",
          zoom === "fit" ? "overflow-hidden" : "overflow-auto",
        )}
        style={{ height: zoom === "fit" ? height * scale : Math.min(height * scale, 860) }}
      >
        {zoom !== "fit" && <div style={{ width: W * scale, height: height * scale }} />}
        <div
          ref={inner}
          className="absolute top-0 left-0 origin-top-left p-3 text-[#1b1b1b]"
          style={{ width: W, transform: `scale(${scale})` }}
        >
          <svg
            className="pointer-events-none absolute inset-0 z-10 overflow-visible"
            width={W}
            height={height}
            aria-hidden
          >
            <defs>
              <marker
                id="rc-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="#605e5c" />
              </marker>
            </defs>
            {geo.links.map((l, i) => {
              const hot = related(l);
              // Subscription placement arrows would cross everything; they appear when you hover either end.
              if (l.kind === "org" && l.from.startsWith("chip:") && !hot) return null;
              const color =
                l.kind === "peering"
                  ? "#0078d4"
                  : l.kind === "onprem"
                    ? "#8661c5"
                    : l.kind === "logs"
                      ? "#ca5010"
                      : "#8a8886";
              return (
                <g key={i} opacity={hover && !hot ? 0.2 : flow?.available ? 0.3 : 1}>
                  <path
                    d={l.d}
                    fill="none"
                    stroke={color}
                    strokeWidth={hot ? 2.4 : 1.3}
                    strokeDasharray={l.kind === "onprem" || l.kind === "deploy" ? "5 4" : undefined}
                    markerEnd={
                      l.kind === "org" || l.kind === "logs" || l.kind === "deploy"
                        ? "url(#rc-arrow)"
                        : undefined
                    }
                    className={l.kind === "peering" && hot ? "lz-dash" : undefined}
                  />
                  {l.label && (hot || l.kind !== "org") && (
                    <text
                      x={l.mid.x}
                      y={l.mid.y - 3}
                      textAnchor="middle"
                      fontSize="9.5"
                      fill={color}
                      className="font-sans"
                    >
                      {l.label}
                    </text>
                  )}
                </g>
              );
            })}
            {flow?.available &&
              geo.flow.map((d, i) => (
                <g key={`f${i}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={flow.color}
                    strokeOpacity={0.25}
                    strokeWidth={9}
                    strokeLinecap="round"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={flow.color}
                    strokeWidth={2.5}
                    strokeDasharray="7 6"
                    className="lz-dash"
                  />
                </g>
              ))}
          </svg>
          {geo.hops.map((h, i) => (
            <span
              key={i}
              className={cn(
                "absolute z-20 grid size-5 place-items-center rounded-full text-[10px] font-bold text-white shadow",
                i === step && "ring-4",
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

          <div className="grid grid-cols-[330px_minmax(0,1fr)_360px] gap-4">
            {/* ---------------------------------------------------------- left */}
            <div className="space-y-4">
              <Box
                anchor="sub:security"
                title="Security subscription"
                subtitle="Security team tooling and logs"
                isOn={on(answers.securitySubscription)}
                toggle={
                  set &&
                  (() =>
                    set({ securitySubscription: on(answers.securitySubscription) ? "no" : "yes" }))
                }
                select={{ kind: "sub", id: "security" }}
              >
                <div className="grid grid-cols-2 gap-1">
                  <Item
                    id="seclaw"
                    label="Log Analytics workspace"
                    detail="For security logs"
                    icon={ICON["law"]!}
                    tone={TONE["law"]!}
                    isOn={answers.siem === "sentinel"}
                    select={{ kind: "res", id: "law" }}
                  />
                  <Item
                    id="sentinel"
                    label="Microsoft Sentinel"
                    detail="SIEM on the workspace"
                    icon={ICON["sentinel"]!}
                    tone={TONE["sentinel"]!}
                    isOn={answers.siem === "sentinel"}
                    toggle={
                      set &&
                      (() => set({ siem: answers.siem === "sentinel" ? "other" : "sentinel" }))
                    }
                  />
                </div>
                <Toolset scope="security" />
              </Box>
              <Box
                anchor="sub:management"
                letter="D"
                title="Management subscription"
                subtitle="Platform logs and monitoring"
                select={{ kind: "sub", id: "management" }}
              >
                <div className="grid grid-cols-2 gap-1">
                  <Item
                    id="law"
                    label="Log Analytics workspace"
                    detail={`Platform logs · ${answers.logRetentionDays} days`}
                    icon={ICON["law"]!}
                    tone={TONE["law"]!}
                    isOn={res.has("law")}
                  />
                  <Item
                    id="dcr"
                    label="Data collection rules"
                    detail="VM insights, change tracking"
                    icon={ICON["dcr"]!}
                    tone={TONE["dcr"]!}
                    isOn={res.has("dcr")}
                  />
                  <Item
                    id="ama"
                    label="AMA managed identity"
                    icon={ICON["ama"]!}
                    tone={TONE["ama"]!}
                    isOn={res.has("ama")}
                    toggle={
                      set &&
                      (() =>
                        set({
                          monitoring:
                            answers.monitoring === "azure_monitor"
                              ? "third_party"
                              : "azure_monitor",
                        }))
                    }
                  />
                  <Item
                    id="dashboards"
                    label="Dashboards (Azure portal)"
                    detail="Queries, alerting, inventory"
                    icon={Boxes}
                    tone="#0078d4"
                    isOn
                    select={{ kind: "sub", id: "management" }}
                  />
                </div>
                <Toolset scope="management" />
              </Box>
              <Box
                anchor="sub:identity"
                title="Identity subscription"
                subtitle="Domain controllers, peered to the hub"
                isOn={on(answers.identity)}
                toggle={set && (() => set({ identity: on(answers.identity) ? "no" : "yes" }))}
                select={{ kind: "sub", id: "identity" }}
              >
                <Vnet
                  anchor="identityvnet"
                  title={`Virtual network · ${answers.primaryRegion}`}
                  select={{ kind: "sub", id: "identity" }}
                >
                  <div className="flex flex-wrap gap-1 text-[9.5px]">
                    {[
                      "DNS",
                      "UDRs",
                      "NSGs/ASGs",
                      "DC1 · DC2 · DC3 or Entra Domain Services",
                      "Recovery Services vault",
                    ].map((x) => (
                      <span key={x} className="rounded-sm border border-[#c7e0f4] bg-white px-1">
                        {x}
                      </span>
                    ))}
                  </div>
                </Vnet>
                <Toolset scope="identity" />
              </Box>
            </div>

            {/* -------------------------------------------------------- center */}
            <div className="space-y-4">
              <div className="grid grid-cols-[1fr_150px_190px] gap-3">
                <Box
                  anchor="iam"
                  letter="B"
                  title="Identity and access management"
                  tone="plain"
                  select={{ kind: "ext", id: "operator" }}
                >
                  <ul className="grid grid-cols-2 gap-x-2 text-[9.5px] text-[#323130]">
                    {[
                      "Approval workflow",
                      "Multifactor authentication",
                      "Access reviews",
                      "Audit reports",
                    ].map((x) => (
                      <li key={x}>· {x}</li>
                    ))}
                  </ul>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="rounded-sm bg-[#c7e0f4] px-1 text-[9.5px]">
                      Privileged Identity Management
                    </span>
                    <span className="rounded-sm border border-[#c8c6c4] bg-white px-1 text-[9.5px]">
                      {answers.rbac.length} role assignment{answers.rbac.length === 1 ? "" : "s"} in
                      the design
                    </span>
                  </div>
                </Box>
                <Box
                  anchor="entra"
                  title="Microsoft Entra ID"
                  tone="plain"
                  select={{ kind: "ext", id: "operator" }}
                >
                  <ul className="text-[9.5px] text-[#323130]">
                    <li>· Service principals</li>
                    <li>· Security groups</li>
                    <li>· Users</li>
                  </ul>
                </Box>
                <Box
                  anchor="billing"
                  letter="A"
                  title="EA / Microsoft Customer Agreement"
                  tone="plain"
                >
                  <div className="space-y-0.5 text-[9.5px]">
                    {["Billing account", "Billing profile", "Invoice section"].map((x) => (
                      <div
                        key={x}
                        className="rounded-sm border border-[#c8c6c4] bg-white px-1 text-center"
                      >
                        {x}
                      </div>
                    ))}
                    <div className="rounded-sm bg-[#fff4ce] px-1 text-center">
                      Subscription vending
                    </div>
                  </div>
                </Box>
              </div>

              <Box
                anchor="mg-box"
                letter="C"
                title="Management group and subscription organization"
                tone="plain"
              >
                <div className="overflow-x-auto rounded border border-[#c7e0f4] bg-[#eff6fc] p-2">
                  <div className="flex min-w-max justify-center">
                    <div className="flex flex-col items-center">
                      <span className="rounded border border-dashed border-[#8a8886] bg-white px-1.5 text-[9.5px] text-[#605e5c]">
                        Tenant root group
                      </span>
                      <span className="h-2 w-px bg-[#8a8886]" />
                      {roots.map(mgBox)}
                    </div>
                  </div>
                  {edit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAdding({ kind: "group", parent: "landingzones" });
                      }}
                      className="mt-2 flex items-center gap-1 text-[10px] text-[#0078d4] hover:underline"
                    >
                      <Plus className="size-3" /> Add a management group
                    </button>
                  )}
                </div>
                <div
                  data-anchor="subs-row"
                  className="mt-2 flex flex-wrap gap-1 rounded border border-[#e8c65b]/60 bg-[#fffbeb] p-1.5"
                >
                  <span className="mr-1 flex items-center gap-1 text-[10px] font-semibold text-[#8a6d00]">
                    <KeyRound className="size-3 text-[#e8a900]" /> Subscriptions
                  </span>
                  {chips.map((c) => (
                    <button
                      key={c.id}
                      data-anchor={`chip:${c.id}`}
                      onClick={pick({ kind: "sub", id: c.id })}
                      onMouseEnter={() => setHover(c.id)}
                      onMouseLeave={() => setHover(null)}
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 text-[9.5px]",
                        c.on
                          ? "border-[#e8c65b] bg-[#fff4ce] hover:border-[#0078d4]"
                          : "border-dashed border-[#a19f9d] text-[#8a8886] line-through",
                        isSel("sub", c.id) && "ring-2 ring-[#0078d4]",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </Box>

              <div className="grid grid-cols-2 gap-3">
                <Box
                  anchor="sub:connectivity"
                  letter="E"
                  title="Connectivity subscription"
                  subtitle={wan ? "Virtual WAN" : "Hub and spoke"}
                  isOn={hub}
                  toggle={set && (() => set({ connectivity: hub ? "none" : "hub_and_spoke" }))}
                  select={{ kind: "sub", id: "connectivity" }}
                >
                  <div className="mb-1.5 grid grid-cols-2 gap-1">
                    <Item
                      id="ddos"
                      label="DDoS Network Protection"
                      icon={ICON["ddos"]!}
                      tone={TONE["ddos"]!}
                      isOn={on(answers.ddosPlan)}
                      toggle={set && (() => set({ ddosPlan: on(answers.ddosPlan) ? "no" : "yes" }))}
                    />
                    <Item
                      id="dnszones"
                      label="Private DNS zones"
                      icon={ICON["dnszones"]!}
                      tone={TONE["dnszones"]!}
                      isOn={answers.privateDns === "platform"}
                      toggle={
                        set &&
                        (() =>
                          set({
                            privateDns: answers.privateDns === "platform" ? "none" : "platform",
                          }))
                      }
                    />
                  </div>
                  <Vnet
                    anchor="hub1"
                    select={{ kind: "res", id: wan ? "vhub" : "hubvnet" }}
                    title={`${wan ? "Virtual hub" : "Hub virtual network"} · ${answers.primaryRegion}`}
                  >
                    {hubItems(1)}
                  </Vnet>
                  {second ? (
                    <div className="mt-1.5">
                      <Vnet
                        anchor="hub2"
                        select={{ kind: "res", id: wan ? "vhub2" : "hubvnet2" }}
                        title={`${wan ? "Virtual hub" : "Hub virtual network"} · ${answers.secondaryRegion}`}
                      >
                        {hubItems(2)}
                      </Vnet>
                      {edit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            set?.({ secondaryRegion: "" });
                          }}
                          className="mt-1 text-[10px] text-[#a4262c] hover:underline"
                        >
                          Remove the second region
                        </button>
                      )}
                    </div>
                  ) : (
                    <AddButton
                      label="Add a hub in a second region"
                      onClick={() => set?.({ secondaryRegion: nextRegion })}
                    />
                  )}
                  <Toolset scope="connectivity" />
                </Box>

                <Box
                  anchor="sub:corp"
                  letter="F"
                  title="Corp landing zones"
                  subtitle="Peered to the hub · egress through the firewall"
                  isOn={has("corp")}
                  toggle={set && (() => toggleLz("corp"))}
                  select={{ kind: "mg", id: "corp" }}
                >
                  <div className="space-y-1">
                    {corp.slice(0, 4).map(spokeCard)}
                    {corp.length > 4 && (
                      <p className="text-[10px] text-[#605e5c]">+{corp.length - 4} more installs</p>
                    )}
                  </div>
                  <AddButton
                    label="Add a subscription"
                    onClick={() => setAdding({ kind: "subscription", parent: "corp" })}
                  />
                  <Toolset scope="corp" />
                </Box>
              </div>

              <Box
                anchor="sub:online"
                letter="F"
                title="Online landing zones"
                subtitle="Internet-facing, not peered to the hub"
                isOn={has("online")}
                toggle={set && (() => toggleLz("online"))}
                select={{ kind: "mg", id: "online" }}
              >
                <div className="grid grid-cols-3 gap-1">{online.slice(0, 6).map(spokeCard)}</div>
                {online.length > 6 && (
                  <p className="mt-1 text-[10px] text-[#605e5c]">
                    +{online.length - 6} more installs
                  </p>
                )}
                <AddButton
                  label="Add a subscription"
                  onClick={() => setAdding({ kind: "subscription", parent: "online" })}
                />
              </Box>
            </div>

            {/* --------------------------------------------------------- right */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Box
                  anchor="onprem"
                  title="On-premises"
                  subtitle="Active Directory Domain Services"
                  tone="ext"
                  select={{ kind: "ext", id: "onprem" }}
                >
                  <p className="text-[9.5px] text-[#605e5c]">
                    {on(answers.expressRoute)
                      ? "Connected over ExpressRoute"
                      : on(answers.vpnGateway)
                        ? "Connected over site-to-site VPN"
                        : "Not connected"}
                  </p>
                </Box>
                <div className="space-y-2">
                  <Box
                    anchor="internet"
                    title="Internet"
                    tone="ext"
                    select={{ kind: "ext", id: "internet" }}
                  >
                    <Globe className="size-3.5 text-[#605e5c]" />
                  </Box>
                  <Box
                    anchor="users"
                    title="Your customers' users"
                    tone="ext"
                    select={{ kind: "ext", id: "users" }}
                  >
                    <Users className="size-3.5 text-[#605e5c]" />
                  </Box>
                </div>
              </div>
              <Box
                anchor="operator"
                title="Operators"
                subtitle="Microsoft Entra ID sign-in, Bastion"
                tone="ext"
                select={{ kind: "ext", id: "operator" }}
              >
                <UserCog className="size-3.5 text-[#605e5c]" />
              </Box>
              <Box anchor="devops" letter="I" title="DevOps · platform team" tone="plain">
                <div className="grid grid-cols-2 gap-2 text-[9.5px]">
                  <div className="rounded border border-[#c8c6c4] bg-white p-1.5">
                    <p className="flex items-center gap-1 font-semibold">
                      <GitBranch className="size-3" /> Git repository
                    </p>
                    <ul className="mt-0.5 text-[#605e5c]">
                      <li>· Policy and role definitions</li>
                      <li>· Policy assignments</li>
                      <li>· Terraform (this design)</li>
                    </ul>
                  </div>
                  <div className="rounded border border-[#c8c6c4] bg-white p-1.5">
                    <p className="font-semibold">Deployment pipelines</p>
                    <ul className="mt-0.5 text-[#605e5c]">
                      <li>· Subscription provisioning</li>
                      <li>· Policy deployment</li>
                      <li>· Platform deployment</li>
                    </ul>
                  </div>
                </div>
              </Box>
              <Box
                anchor="sub:sandbox"
                letter="H"
                title="Sandbox subscription"
                subtitle="Isolated experiments, not connected to the hub"
                isOn={has("sandbox")}
                toggle={set && (() => toggleLz("sandbox"))}
                select={{ kind: "mg", id: "sandbox" }}
              >
                <div className="flex flex-wrap gap-1 text-[9.5px]">
                  {["Applications", "Applications", "Applications"].map((x, i) => (
                    <span
                      key={i}
                      className="rounded-sm border border-[#c7e0f4] bg-white px-1.5 py-0.5"
                    >
                      <Building2 className="mr-0.5 inline size-3" />
                      {x}
                    </span>
                  ))}
                </div>
                <AddButton
                  label="Add a sandbox subscription"
                  onClick={() => setAdding({ kind: "subscription", parent: "sandbox" })}
                />
              </Box>
              <Box
                anchor="templates"
                letter="G"
                title="Workload landing zones and templates"
                tone="plain"
              >
                <div className="flex flex-wrap gap-1 text-[9.5px]">
                  {answers.workloads.length ? (
                    answers.workloads.map((w) => (
                      <span
                        key={`${w.group}-${w.id}`}
                        className="rounded-sm border border-[#c8c6c4] bg-white px-1.5 py-0.5"
                      >
                        <ShieldHalf className="mr-0.5 inline size-3" />
                        {w.id} · {w.group}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#605e5c]">
                      None yet — add AKS, App Service, AI and others to a landing zone group.
                    </span>
                  )}
                </div>
              </Box>
              <div className="flex items-center gap-2 rounded border border-[#d2d0ce] bg-[#faf9f8] px-2 py-1.5 text-[9.5px] text-[#605e5c]">
                <CreditCard className="size-3.5" />
                Legend: <span className="text-[#0078d4]">── peering</span>{" "}
                <span className="text-[#8661c5]">- - on-premises</span>{" "}
                <span className="text-[#ca5010]">── logs</span> <span>→ organization</span>
              </div>
            </div>
          </div>
        </div>
        {adding && set && (
          <AddDialog
            adding={adding}
            onClose={() => setAdding(null)}
            tree={tree}
            answers={answers}
            set={set}
          />
        )}
      </div>
    </div>
  );
}
