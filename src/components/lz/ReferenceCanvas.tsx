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
  GripVertical,
  Trash2,
  CreditCard,
  GitBranch,
  Globe,
  KeyRound,
  Minus,
  Plus,
  ShieldHalf,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  type AlzLibrary,
  type Answers,
  type MgNode,
  type OptionalGroup,
  hasFirewall,
  hasHub,
  on,
  platformResources,
  spokeOf,
} from "@/lib/alz/engine";
import type { Flow, Sel, Spoke } from "@/lib/alz/scene";
import { AZURE_REGIONS } from "@/lib/regions";
import { cn } from "@/lib/utils";

import { ICON, ManagementTree, TONE, TOOLS, toggleTool, toolOn } from "./ArchitectureDiagram";
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
  baseline,
}: {
  /** The saved design; anything that differs glows until it's saved. */
  baseline?: Answers | undefined;
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
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // "auto" = fit the width but never smaller than readable; "fit" = the whole width; a number = fixed zoom.
  // The canvas scrolls and pans (drag empty space or hold Space), and Ctrl/⌘ + wheel zooms.
  const [zoom, setZoom] = useState<"auto" | "fit" | number>("auto");
  const zoomAt = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  const pan = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const [space, setSpace] = useState(false);
  const [height, setHeight] = useState(900);
  const [hover, setHover] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);
  // Boxes can be dragged anywhere; offsets are kept per landing zone prefix in this browser.
  const layoutKey = `cd-canvas-layout:${answers.intermediateRootId || "alz"}`;
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  // Read after mount: the server render has no localStorage.
  useEffect(() => {
    try {
      setOffsets(JSON.parse(localStorage.getItem(layoutKey) ?? "{}"));
    } catch {
      setOffsets({});
    }
  }, [layoutKey]);
  const [dragging, setDragging] = useState<string | null>(null);
  const startDrag = (anchor: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const from = offsets[anchor] ?? { x: 0, y: 0 };
    setDragging(anchor);
    const move = (ev: PointerEvent) =>
      setOffsets((o) => ({
        ...o,
        [anchor]: {
          x: Math.round((from.x + (ev.clientX - start.x) / scale) / 8) * 8,
          y: Math.round((from.y + (ev.clientY - start.y) / scale) / 8) * 8,
        },
      }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(null);
      setOffsets((o) => {
        globalThis.localStorage?.setItem(layoutKey, JSON.stringify(o));
        return o;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
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
  const extras = answers.extraSubscriptions.map((x, i) => ({ x, ...spokeOf(answers, lib, x, i) }));
  const edit = !!set;

  const changed = new Set<string>();
  if (baseline) {
    const b = baseline;
    const mark = (cond: boolean, ...ids: string[]) => cond && ids.forEach((i) => changed.add(i));
    mark(b.firewall !== answers.firewall, "firewall", "firewall2");
    mark(b.vpnGateway !== answers.vpnGateway, "vpngw", "vpngw2");
    mark(b.expressRoute !== answers.expressRoute, "ergw", "ergw2");
    mark(b.bastion !== answers.bastion, "bastion", "bastion2");
    mark(b.privateDns !== answers.privateDns, "dnsresolver", "dnsresolver2", "dnszones");
    mark(b.ddosPlan !== answers.ddosPlan, "ddos");
    mark(b.secondaryRegion !== answers.secondaryRegion, "hub2", "sub:connectivity");
    mark(b.connectivity !== answers.connectivity, "sub:connectivity", "chip:connectivity");
    mark(b.primaryRegion !== answers.primaryRegion, "hub1");
    mark(b.identity !== answers.identity, "sub:identity", "chip:identity");
    mark(b.securitySubscription !== answers.securitySubscription, "sub:security", "chip:security");
    mark(b.siem !== answers.siem, "sentinel", "seclaw");
    mark(b.monitoring !== answers.monitoring, "ama");
    mark(b.logRetentionDays !== answers.logRetentionDays, "law");
    mark(JSON.stringify(b.rbac) !== JSON.stringify(answers.rbac), "iam");
    mark(JSON.stringify(b.workloads) !== JSON.stringify(answers.workloads), "templates");
    mark(
      b.intermediateRootName !== answers.intermediateRootName ||
        b.intermediateRootId !== answers.intermediateRootId,
      "mg-root",
    );
    for (const g of ["corp", "online", "sandbox", "local"] as const)
      mark(
        b.landingZones.includes(g) !== answers.landingZones.includes(g),
        `sub:${g}`,
        `chip:${g}`,
        `mg:${g}`,
      );
    for (const g of answers.customGroups)
      mark(
        !b.customGroups.some((x) => JSON.stringify(x) === JSON.stringify(g)),
        `mg:${g.id}`,
        `sub:${g.id}`,
      );
    for (const [k, v] of Object.entries(answers.groupNames)) mark(b.groupNames[k] !== v, `mg:${k}`);
    for (const x of answers.extraSubscriptions)
      mark(
        !b.extraSubscriptions.some((y) => JSON.stringify(y) === JSON.stringify(x)),
        `extra:${x.id}`,
        `chip:extra-${x.id}`,
      );
    for (const t of TOOLS) if (t.answer) mark(b[t.answer] !== answers[t.answer], `tool:${t.id}`);
    mark(JSON.stringify(b.policyOverrides) !== JSON.stringify(answers.policyOverrides), "mg-box");
  }
  const glow = (id: string) => changed.has(id) && "cd-glow";

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
    ...answers.customGroups.map((g) => ({
      from: `chip:${g.id}`,
      to: `sub:${g.id}`,
      kind: "org" as const,
    })),
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
          ...extras
            .filter((e) => e.peered)
            .map((e) => ({
              from: "hub1",
              to: `extra:${e.x.id}`,
              kind: "peering" as const,
              label: wan ? "Hub connection" : "Peering",
            })),
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

  const key = JSON.stringify([answers, spokes.length, flow?.id, flow?.available, offsets]);
  useLayoutEffect(() => {
    const o = outer.current;
    const el = inner.current;
    if (!o || !el) return;
    const measure = () => {
      const fit = (o.clientWidth - 4) / W;
      const s =
        zoom === "fit"
          ? Math.min(1, fit)
          : zoom === "auto"
            ? Math.min(1, Math.max(0.9, fit))
            : zoom;
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

  // Keep the point under the cursor still while zooming.
  useLayoutEffect(() => {
    const o = outer.current;
    const a = zoomAt.current;
    if (!o || !a) return;
    o.scrollLeft = a.cx * scale - a.px;
    o.scrollTop = a.cy * scale - a.py;
    zoomAt.current = null;
  }, [scale]);

  const zoomBy = (factor: number, px?: number, py?: number) => {
    const o = outer.current;
    if (!o) return;
    const x = px ?? o.clientWidth / 2;
    const y = py ?? o.clientHeight / 2;
    zoomAt.current = {
      px: x,
      py: y,
      cx: (o.scrollLeft + x) / scale,
      cy: (o.scrollTop + y) / scale,
    };
    setZoom(Math.min(1.5, Math.max(0.4, Math.round(scale * factor * 20) / 20)));
  };
  useEffect(() => {
    const o = outer.current;
    if (!o) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = o.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    };
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (down) e.preventDefault();
      setSpace(down);
    };
    const kd = key(true);
    const ku = key(false);
    o.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      o.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  });

  const startPan = (e: React.PointerEvent) => {
    const o = outer.current;
    if (!o || e.button > 1) return;
    const t = e.target as HTMLElement;
    if (
      !space &&
      e.button === 0 &&
      t.closest("button, input, select, a, [role=button], [data-anchor]")
    )
      return;
    pan.current = { x: e.clientX, y: e.clientY, l: o.scrollLeft, t: o.scrollTop, moved: false };
    const move = (ev: PointerEvent) => {
      const p = pan.current;
      if (!p) return;
      const dx = ev.clientX - p.x;
      const dy = ev.clientY - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) p.moved = true;
      o.scrollLeft = p.l - dx;
      o.scrollTop = p.t - dy;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // A pan shouldn't count as a click on the background (which clears the selection).
      if (pan.current?.moved)
        window.addEventListener("click", (ev) => ev.stopPropagation(), {
          capture: true,
          once: true,
        });
      pan.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
          glow(id),
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
              glow(`tool:${t.id}`),
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
      style={
        offsets[anchor]
          ? { transform: `translate(${offsets[anchor]!.x}px, ${offsets[anchor]!.y}px)` }
          : undefined
      }
      className={cn(
        "group/box relative rounded-md border p-2.5",
        dragging === anchor ? "z-40 shadow-xl" : "transition-[box-shadow,border-color]",
        offsets[anchor] && "z-20 shadow-md",
        glow(anchor),
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
        <span
          onPointerDown={startDrag(anchor)}
          onClick={(e) => e.stopPropagation()}
          title="Drag to move"
          className="-ml-1 hidden cursor-grab touch-none text-[#a19f9d] group-hover/box:block active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </span>
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
        glow(anchor),
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

  // Subscriptions the design adds by hand: each is vended with its own spoke network, and peered to the hub
  // (or connected to the Virtual WAN hub) when chosen — exactly what the generated Terraform deploys.
  const extraCards = (group: string) =>
    extras
      .filter((e) => e.x.group === group)
      .map((e) => (
        <div
          key={e.x.id}
          data-anchor={`extra:${e.x.id}`}
          onClick={pick({ kind: "mg", id: e.x.group })}
          className={cn(
            "group/extra relative cursor-pointer rounded border border-[#0078d4]/50 bg-white p-1.5",
            glow(`extra:${e.x.id}`),
          )}
        >
          <p className="flex items-center gap-1 truncate text-[10.5px] font-semibold">
            <KeyRound className="size-3 shrink-0 text-[#e8a900]" />
            {e.x.name}
            <span className="rounded-sm bg-[#fff4ce] px-1 text-[9px] font-normal">
              {e.x.environment}
            </span>
          </p>
          {e.vnet ? (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
              <span className="rounded-sm border border-[#8ac7ea] bg-[#e5f4fc] px-1 font-mono">
                vnet {e.cidr}
              </span>
              <span className="rounded-sm border border-[#c7e0f4] px-1">
                workload + private endpoint subnets
              </span>
              {hub && (
                <button
                  disabled={!edit}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    set?.({
                      extraSubscriptions: answers.extraSubscriptions.map((y) =>
                        y.id === e.x.id ? { ...y, peer: !e.peered } : y,
                      ),
                    });
                  }}
                  title={e.peered ? "Disconnect from the hub" : "Connect to the hub"}
                  className={cn(
                    "rounded-sm border px-1",
                    e.peered
                      ? "border-[#0078d4] bg-[#0078d4] text-white"
                      : "border-dashed border-[#8a8886] text-[#605e5c]",
                  )}
                >
                  {e.peered
                    ? wan
                      ? "✓ connected to vWAN hub"
                      : "✓ peered to hub"
                    : "+ peer to hub"}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-1 text-[9px] text-[#605e5c]">No virtual network</p>
          )}
          {edit && (
            <button
              onClick={(ev) => {
                ev.stopPropagation();
                set?.({
                  extraSubscriptions: answers.extraSubscriptions.filter((y) => y.id !== e.x.id),
                });
              }}
              title="Remove this subscription"
              className="absolute top-1 right-1 hidden text-[#a4262c] group-hover/extra:block"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      ));

  return (
    <div className="relative w-full bg-white">
      <div className="flex items-center justify-end gap-1 border-b border-[#edebe9] bg-white px-3 py-1 text-[11px]">
        <span className="mr-auto text-[#605e5c]">
          Click anything to see and change it · drag empty space to move around · Ctrl/⌘ + scroll to
          zoom · drag a box by its grip · <span className="cd-glow-key rounded-sm px-1">amber</span>{" "}
          = not saved yet
        </span>
        {Object.keys(offsets).length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOffsets({});
              globalThis.localStorage?.removeItem(layoutKey);
            }}
            className="rounded-sm border border-[#c8c6c4] px-1.5 py-0.5 text-[#605e5c] hover:border-[#0078d4] hover:text-[#0078d4]"
          >
            Reset layout
          </button>
        )}
      </div>
      <div className="relative">
        <div
          ref={outer}
          onPointerDown={startPan}
          className={cn(
            "relative w-full overflow-auto overscroll-contain bg-white",
            space ? "cursor-grab" : "cursor-default",
          )}
          style={{
            height: height * scale + 8,
            maxHeight: "max(560px, calc(100vh - 170px))",
            backgroundImage: "radial-gradient(#e1dfdd 1px, transparent 1px)",
            backgroundSize: `${16 * scale}px ${16 * scale}px`,
          }}
        >
          <div style={{ width: W * scale, height: height * scale }} />
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
                      strokeDasharray={
                        l.kind === "onprem" || l.kind === "deploy" ? "5 4" : undefined
                      }
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
                      set({
                        securitySubscription: on(answers.securitySubscription) ? "no" : "yes",
                      }))
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
                        {answers.rbac.length} role assignment{answers.rbac.length === 1 ? "" : "s"}{" "}
                        in the design
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
                  <div data-anchor="subs-row">
                    <ManagementTree
                      lib={lib}
                      tree={tree}
                      answers={answers}
                      set={set}
                      sel={sel}
                      onSelect={onSelect}
                      spokes={spokes}
                      onAdd={setAdding}
                      changed={changed}
                      onHover={setHover}
                    />
                  </div>
                  {edit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAdding({ kind: "group", parent: "landingzones" });
                      }}
                      className="mt-1.5 flex items-center gap-1 text-[10.5px] text-[#0078d4] hover:underline"
                    >
                      <Plus className="size-3" /> Add a management group
                    </button>
                  )}
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
                    {edit && (
                      <div className="mb-1.5 flex rounded-sm border border-[#c8c6c4] bg-white p-0.5 text-[10px]">
                        {(
                          [
                            ["hub_and_spoke", "Hub and spoke"],
                            ["virtual_wan", "Virtual WAN"],
                          ] as const
                        ).map(([v, label]) => (
                          <button
                            key={v}
                            onClick={(e) => {
                              e.stopPropagation();
                              set?.({ connectivity: v });
                            }}
                            className={cn(
                              "flex-1 rounded-sm px-1.5 py-0.5",
                              answers.connectivity === v
                                ? "bg-[#0078d4] font-medium text-white"
                                : "text-[#605e5c] hover:text-[#0078d4]",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mb-1.5 grid grid-cols-2 gap-1">
                      <Item
                        id="ddos"
                        label="DDoS Network Protection"
                        icon={ICON["ddos"]!}
                        tone={TONE["ddos"]!}
                        isOn={on(answers.ddosPlan)}
                        toggle={
                          set && (() => set({ ddosPlan: on(answers.ddosPlan) ? "no" : "yes" }))
                        }
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
                      {extraCards("corp")}
                      {corp.length > 4 && (
                        <p className="text-[10px] text-[#605e5c]">
                          +{corp.length - 4} more installs
                        </p>
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
                  <div className="grid grid-cols-3 gap-1">
                    {online.slice(0, 6).map(spokeCard)}
                    {extraCards("online")}
                  </div>
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

                {(answers.customGroups.length > 0 || edit) && (
                  <div className="grid grid-cols-2 gap-3">
                    {answers.customGroups.map((g) => (
                      <Box
                        key={g.id}
                        anchor={`sub:${g.id}`}
                        title={`${answers.groupNames[g.id] || g.name} landing zones`}
                        subtitle={`Your management group · ${g.archetype} policies`}
                        select={{ kind: "mg", id: g.id }}
                      >
                        <div className="space-y-1">{extraCards(g.id)}</div>
                        <AddButton
                          label="Add a subscription"
                          onClick={() => setAdding({ kind: "subscription", parent: g.id })}
                        />
                      </Box>
                    ))}
                    {edit && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAdding({ kind: "group", parent: "landingzones" });
                        }}
                        className="flex min-h-20 flex-col items-center justify-center rounded-md border border-dashed border-[#8a8886] p-2 text-[11px] text-[#605e5c] hover:border-[#0078d4] hover:text-[#0078d4]"
                      >
                        <span className="flex items-center gap-1 font-medium">
                          <Plus className="size-3.5" /> Add a landing zone group
                        </span>
                        <span className="text-[10px]">
                          e.g. Confidential, AKS platform, Regulated
                        </span>
                      </button>
                    )}
                  </div>
                )}
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
                  <div className="mt-1 space-y-1">{extraCards("sandbox")}</div>
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
        <div
          className="absolute right-3 bottom-3 z-30 flex items-center gap-0.5 rounded-md border border-[#c8c6c4] bg-white p-0.5 text-[11px] shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.15)}
            className="grid size-6 place-items-center rounded-sm hover:bg-[#f3f2f1]"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-10 text-center tabular-nums text-[#605e5c]">
            {Math.round(scale * 100)}%
          </span>
          <button
            aria-label="Zoom in"
            onClick={() => zoomBy(1.15)}
            className="grid size-6 place-items-center rounded-sm hover:bg-[#f3f2f1]"
          >
            <Plus className="size-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-[#e1dfdd]" />
          {(
            [
              ["fit", "Whole picture"],
              ["auto", "Readable"],
            ] as const
          ).map(([z, label]) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={cn(
                "rounded-sm px-1.5 py-0.5",
                zoom === z ? "bg-[#eff6fc] text-[#0078d4]" : "text-[#605e5c] hover:bg-[#f3f2f1]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
