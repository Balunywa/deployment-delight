/*
 * End-to-end traffic simulator: the network this design deploys, subnet by subnet, and a packet moving through
 * it hop by hop — forward, then the reply. At every hop: the packet header, the subnet's effective routes with
 * the one Azure picks (and why the others lose), and the NSG / firewall decisions. Where Azure would drop it,
 * the packet stops and says why.
 */
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Laptop,
  Network,
  Pause,
  Play,
  RotateCcw,
  Server,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Answers } from "@/lib/alz/engine";
import { type SimHop, type SimResult, type Topology, simulate, topology } from "@/lib/alz/routing";
import type { SceneExtra, Spoke } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

type Box = { x: number; y: number; w: number; h: number };
type El = Box & {
  id: string;
  title: string;
  detail?: string | undefined;
  tag?: string | undefined;
  publicIp?: string | undefined;
  kind: "ext" | "row" | "band";
  absent?: boolean | undefined;
};
type Frame = Box & { title: string; sub: string; kind: "hub" | "spoke" | "sidecar" };
type Link = {
  a: string;
  b: string;
  label: string;
  kind: "peering" | "tunnel" | "p2s" | "connection";
};

const W = 1000;

function layout(t: Topology) {
  const els = new Map<string, El>();
  const frames: Frame[] = [];
  const links: Link[] = [];
  const add = (e: El) => els.set(e.id, e);
  add({ id: "internet", x: 20, y: 14, w: W - 40, h: 38, title: "Internet", kind: "band" });

  // Hub (or Virtual WAN hub) in the middle.
  const hubX = 230;
  const hubW = 340;
  const rowH = 76;
  const gap = 14;
  let y = 96;
  let hubBottom = y;
  const sub = (id: string) => t.subnets.find((s) => s.id === id);
  if (t.mode === "hub") {
    const rows: [string, string, string, string][] = [
      [
        "hub-fw",
        "AzureFirewallSubnet",
        "10.0.0.64/26",
        t.firewall
          ? `Azure Firewall ${t.firewall.sku} · ${t.firewall.ip}`
          : "No firewall in this design",
      ],
      [
        "hub-bastion",
        "AzureBastionSubnet",
        "10.0.0.0/26",
        sub("hub-bastion") ? "Azure Bastion · 10.0.0.4" : "No Bastion",
      ],
      [
        "hub-gw",
        "GatewaySubnet",
        "10.0.0.192/27",
        t.gateway
          ? `${t.gateway.er ? "ExpressRoute" : ""}${t.gateway.er && t.gateway.vpn ? " + " : ""}${t.gateway.vpn ? "VPN" : ""} gateway`
          : "No gateway",
      ],
      [
        "hub-dns",
        "DNS resolver inbound",
        "10.0.0.224/28",
        sub("hub-dns") ? "DNS Private Resolver · 10.0.0.228" : "No DNS resolver",
      ],
    ];
    const frameY = y;
    y += 44;
    for (const [id, name, cidr, what] of rows) {
      const s = sub(id);
      add({
        id,
        x: hubX + 14,
        y,
        w: hubW - 28,
        h: rowH,
        title: `${name} · ${cidr}`,
        detail: what,
        tag:
          id === "hub-gw" && t.firewall && t.gateway
            ? "rt-hub-gateway: each added spoke → firewall"
            : s?.routeTable
              ? `${s.routeTable.name}: 0.0.0.0/0 → Internet`
              : undefined,
        publicIp: s?.publicIp,
        kind: "row",
        absent: !s,
      });
      y += rowH + gap;
    }
    frames.push({
      x: hubX,
      y: frameY,
      w: hubW,
      h: y - frameY,
      title: "Hub virtual network · 10.0.0.0/22",
      sub: "Peered with every Corp spoke",
      kind: "hub",
    });
    hubBottom = y;
  } else if (t.mode === "vwan") {
    const frameY = y;
    y += 44;
    const rows: [string, string, string, boolean][] = [
      [
        "vhub-fw",
        "Azure Firewall (secured hub)",
        t.firewall
          ? `${t.firewall.sku}${t.routingIntent ? " · routing intent: internet + private" : ""}`
          : "No firewall — no routing intent",
        !!t.firewall,
      ],
      [
        "hub-router",
        "Hub router · Default route table",
        t.routingIntent
          ? "Routing intent sends 0.0.0.0/0 and private ranges to the firewall"
          : "Every connection associates and propagates: any-to-any",
        true,
      ],
      [
        "vhub-gw",
        "Hub gateways",
        t.gateway
          ? `${t.gateway.er ? "ExpressRoute" : ""}${t.gateway.er && t.gateway.vpn ? " + " : ""}${t.gateway.vpn ? "VPN" : ""}`
          : "No gateway",
        !!t.gateway,
      ],
    ];
    for (const [id, title, detail, present] of rows) {
      add({
        id,
        x: hubX + 14,
        y,
        w: hubW - 28,
        h: rowH,
        title,
        detail,
        kind: "row",
        absent: !present,
        publicIp: id === "vhub-fw" && t.firewall ? t.firewall.publicIp : undefined,
      });
      y += rowH + gap;
    }
    frames.push({
      x: hubX,
      y: frameY,
      w: hubW,
      h: y - frameY,
      title: "Virtual WAN hub (Microsoft-managed)",
      sub: "Spokes connect with hub connections",
      kind: "hub",
    });
    y += 16;
    const sc = sub("sidecar-bastion");
    if (sc) {
      const fy = y;
      y += 44;
      add({
        id: sc.id,
        x: hubX + 14,
        y,
        w: hubW - 28,
        h: rowH,
        title: `AzureBastionSubnet · ${sc.cidr}`,
        detail: "Azure Bastion (Standard, IP-based connection)",
        publicIp: sc.publicIp,
        kind: "row",
      });
      y += rowH + gap;
      frames.push({
        x: hubX,
        y: fy,
        w: hubW,
        h: y - fy,
        title: "Sidecar network · 10.0.8.0/24",
        sub: "Connected to the hub",
        kind: "sidecar",
      });
    }
    hubBottom = y;
  }

  // Spokes on the right.
  const spX = 615;
  const spW = W - 20 - spX;
  let sy = 96;
  for (const id of [t.corpA, t.corpB, t.online].filter(Boolean) as string[]) {
    const v = t.vnets.find((x) => x.id === id)!;
    const fy = sy;
    sy += 44;
    for (const s of t.subnets.filter((x) => x.vnet === id)) {
      add({
        id: s.id,
        x: spX + 14,
        y: sy,
        w: spW - 28,
        h: 64,
        title: `${s.name} · ${s.cidr}`,
        detail: `${s.what} · ${s.ip}`,
        tag: s.routeTable
          ? `${s.routeTable.name}: 0.0.0.0/0 → firewall · propagation off`
          : s.private
            ? "Private subnet · no route table"
            : undefined,
        publicIp: s.publicIp,
        kind: "row",
      });
      sy += 64 + 10;
    }
    const online = id === t.online;
    frames.push({
      x: spX,
      y: fy,
      w: spW,
      h: sy - fy,
      title: `${v.name} · ${v.cidr}`,
      sub: online
        ? "Online · not connected to the hub"
        : t.mode === "hub"
          ? `Corp · peered to the hub${v.useRemoteGateways ? " · uses the hub's gateway" : ""}`
          : t.mode === "vwan"
            ? "Corp · hub connection"
            : "Corp · standalone network",
      kind: "spoke",
    });
    if (!online && t.mode === "hub")
      links.push({ a: `frame:hub`, b: `frame:${id}`, label: "Peering", kind: "peering" });
    if (!online && t.mode === "vwan")
      links.push({ a: "hub-router", b: `frame:${id}`, label: "Connection", kind: "connection" });
    sy += 18;
  }

  // Outside Azure on the left, level with the gateway.
  const gwEl = els.get("hub-gw") ?? els.get("vhub-gw");
  const oy = gwEl ? gwEl.y : 300;
  add({
    id: "onprem",
    x: 20,
    y: oy,
    w: 180,
    h: 70,
    title: "On-premises",
    detail: `${t.onPrem} (example)`,
    kind: "ext",
    absent: !t.gateway,
  });
  if (t.gateway)
    links.push({
      a: "onprem",
      b: gwEl!.id,
      label: t.gateway.er ? "ExpressRoute" : "IPsec S2S",
      kind: "tunnel",
    });
  if (t.gateway?.vpn) {
    add({
      id: "remote",
      x: 20,
      y: oy + 100,
      w: 180,
      h: 60,
      title: "Remote engineers",
      detail: "P2S · not configured",
      kind: "ext",
    });
    links.push({ a: "remote", b: gwEl!.id, label: "P2S", kind: "p2s" });
  }
  const h = Math.max(hubBottom, sy, oy + 200) + 20;
  add({
    id: "azure-dns",
    x: 20,
    y: h,
    w: W - 40,
    h: 38,
    title: "Azure platform",
    detail: "Azure DNS 168.63.129.16 · privatelink zones · Azure Monitor",
    kind: "band",
  });
  return { els, frames, links, h: h + 52 };
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** An orthogonal path from one element to the next. */
function segment(a: El, b: El): string | null {
  if (a.id === b.id) return null;
  if (b.kind === "band" || a.kind === "band") {
    const x = a.kind === "band" ? center(b).x : center(a).x;
    const ay = a.kind === "band" ? (a.y < b.y ? a.y + a.h : a.y) : a.y > b.y ? a.y : a.y + a.h;
    const by = b.kind === "band" ? (b.y < a.y ? b.y + b.h : b.y) : b.y > a.y ? b.y : b.y + b.h;
    return `M${x},${ay} V${by}`;
  }
  const ac = center(a);
  const bc = center(b);
  const apart = b.x >= a.x + a.w || a.x >= b.x + b.w;
  if (apart) {
    const sx = bc.x > ac.x ? a.x + a.w : a.x;
    const ex = bc.x > ac.x ? b.x : b.x + b.w;
    const mx = (sx + ex) / 2;
    return `M${sx},${ac.y} H${mx} V${bc.y} H${ex}`;
  }
  // Same column: go round the left side, between the boxes.
  const lane = Math.min(a.x, b.x) - 12;
  return `M${a.x},${ac.y} H${lane} V${bc.y} H${b.x}`;
}

const VERDICT: Record<SimResult["verdict"]["status"], { label: string; cls: string }> = {
  reaches: { label: "Reaches", cls: "bg-[#dff6dd] text-[#107c10]" },
  "needs-rules": { label: "Needs a firewall rule", cls: "bg-[#fff4ce] text-[#8a6100]" },
  isolated: { label: "Isolated", cls: "bg-[#e5f1fb] text-[#0f6cbd]" },
  uninspected: { label: "Uninspected", cls: "bg-[#fff4ce] text-[#8a6100]" },
  broken: { label: "Doesn't work", cls: "bg-[#fde7e9] text-[#a4262c]" },
};
const RESULT_CLS: Record<string, string> = {
  allow: "text-[#107c10]",
  inspect: "text-[#0f6cbd]",
  deny: "text-[#a4262c]",
  "needs-rule": "text-[#8a6100]",
};

export function TrafficSimulator({
  answers,
  spokes,
  extras,
  initial,
  set,
}: {
  answers: Answers;
  spokes: Spoke[];
  extras: SceneExtra[];
  initial?: string | undefined;
  set?: ((p: Partial<Answers>) => void) | undefined;
}) {
  const t = useMemo(() => topology(answers, { spokes, extras }), [answers, spokes, extras]);
  const [allowRules, setAllowRules] = useState(true);
  const sims = useMemo(() => simulate(t, answers, allowRules), [t, answers, allowRules]);
  const [id, setId] = useState(initial ?? "egress");
  const sim = sims.find((s) => s.id === id) ?? sims[0];
  const hops = useMemo(
    () => [
      ...(sim?.forward ?? []).map((h) => ({ ...h, dir: "fwd" as const })),
      ...(sim?.back ?? []).map((h) => ({ ...h, dir: "back" as const })),
    ],
    [sim],
  );
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [allRoutes, setAllRoutes] = useState(false);
  useEffect(() => {
    setStep(0);
    setPlaying(true);
  }, [sim?.id, allowRules, answers]);
  useEffect(() => {
    if (!playing || !hops.length) return;
    if (step >= hops.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), 1700);
    return () => clearTimeout(timer);
  }, [playing, step, hops.length]);

  const g = useMemo(() => layout(t), [t]);
  const el = (at: string) => g.els.get(at);
  const frameBox = (fid: string) => {
    if (!fid.startsWith("frame:")) return el(fid);
    const key = fid.slice(6);
    const f =
      key === "hub"
        ? g.frames.find((x) => x.kind === "hub")
        : g.frames.find((x) => x.title.startsWith(`${t.vnets.find((v) => v.id === key)?.name} `));
    return f ? ({ ...f, id: fid, kind: "row", title: f.title } as El) : undefined;
  };
  const segs = hops.map((h, i) => {
    if (!i || hops[i - 1]!.dir !== h.dir) return null;
    const a = el(hops[i - 1]!.at);
    const b = el(h.at);
    return a && b ? segment(a, b) : null;
  });
  const cur = hops[step];
  const curEl = cur ? el(cur.at) : undefined;
  const fwdColor = sim?.color ?? "#0078d4";
  const backColor = "#5c6bc0";
  const drop = hops.find((h) => h.drop);

  if (!sim)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Add a Corp landing zone or customer installs to simulate traffic.
      </p>
    );

  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
      {/* Scenarios */}
      <aside className="space-y-1.5" aria-label="Traffic scenarios">
        <p className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Scenarios
        </p>
        {sims.map((s) => (
          <button
            key={s.id}
            onClick={() => setId(s.id)}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-left transition-colors",
              s.id === sim.id
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/50",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="text-[12.5px] font-medium">{s.title}</span>
            </span>
            <span className="mt-1 flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded px-1.5 text-[10px] font-semibold",
                  VERDICT[s.verdict.status].cls,
                )}
              >
                {s.available ? VERDICT[s.verdict.status].label : "Not in this design"}
              </span>
            </span>
          </button>
        ))}
        {t.firewall && (
          <div className="mt-3 rounded-md border border-border bg-card p-2.5">
            <p className="mb-1.5 text-[11.5px] font-medium">Firewall rules</p>
            <div
              className="flex rounded-md border border-border bg-muted/40 p-0.5 text-[11.5px]"
              role="radiogroup"
            >
              {(
                [
                  [true, "Assume allowed"],
                  [false, "As deployed"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={label}
                  role="radio"
                  aria-checked={allowRules === v}
                  onClick={() => setAllowRules(v)}
                  className={cn(
                    "flex-1 rounded px-2 py-1",
                    allowRules === v ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              The policy this design deploys starts empty — Azure Firewall denies whatever no rule
              allows.
            </p>
          </div>
        )}
      </aside>

      {/* Topology + packet */}
      <section className="min-w-0 rounded-md border border-border bg-card">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">{sim.title}</p>
            <p className="font-mono text-[11.5px] text-muted-foreground">{sim.question}</p>
          </div>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-[11.5px] font-semibold",
              VERDICT[sim.verdict.status].cls,
            )}
            data-verdict={sim.verdict.status}
          >
            {sim.available ? VERDICT[sim.verdict.status].label : "Not in this design"}
          </span>
        </header>
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-1.5 text-[11.5px]">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            aria-label="Previous hop"
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.max(0, s - 1));
            }}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => {
              if (step >= hops.length - 1) setStep(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            aria-label="Next hop"
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.min(hops.length - 1, s + 1));
            }}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            aria-label="Restart"
            onClick={() => {
              setStep(0);
              setPlaying(true);
            }}
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <span className="ml-1 text-muted-foreground">
            Hop {Math.min(step + 1, hops.length)} of {hops.length}
            {cur?.dir === "back" ? " · reply" : sim.back.length ? " · request" : ""}
          </span>
          <span className="ml-auto flex items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-4" style={{ background: fwdColor }} /> Request
            </span>
            {sim.back.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-4 border-t-2 border-dashed" style={{ borderColor: backColor }} />{" "}
                Reply
              </span>
            )}
          </span>
        </div>
        <div className="overflow-x-auto p-2">
          <svg
            viewBox={`0 0 ${W} ${g.h}`}
            className="h-auto w-full min-w-[760px]"
            role="img"
            aria-label="Network topology with the packet's path"
          >
            <defs>
              <marker
                id="ts-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
              </marker>
            </defs>
            {/* Frames: VNets */}
            {g.frames.map((f) => (
              <g key={f.title}>
                <rect
                  x={f.x}
                  y={f.y}
                  width={f.w}
                  height={f.h}
                  rx={10}
                  fill={f.kind === "hub" ? "#eef6fc" : f.kind === "sidecar" ? "#f4f0fb" : "#f3faf5"}
                  stroke={
                    f.kind === "hub" ? "#8ac7ea" : f.kind === "sidecar" ? "#c5b3e6" : "#b7dcc2"
                  }
                  strokeWidth={1.5}
                />
                <text x={f.x + 14} y={f.y + 21} fontSize={14} fontWeight={600} fill="#1b1b1b">
                  {f.title}
                </text>
                <text x={f.x + 14} y={f.y + 36} fontSize={11} fill="#605e5c">
                  {f.sub}
                </text>
              </g>
            ))}
            {/* Static connections */}
            {g.links.map((l) => {
              const a = frameBox(l.a);
              const b = frameBox(l.b);
              if (!a || !b) return null;
              const ay = l.kind === "peering" ? center(b).y : center(a).y;
              const d = l.kind === "peering" ? `M${a.x + a.w},${ay} H${b.x}` : segment(a, b);
              if (!d) return null;
              const color =
                l.kind === "tunnel" ? "#8661c5" : l.kind === "p2s" ? "#a19f9d" : "#0078d4";
              return (
                <g key={`${l.a}-${l.b}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={l.kind === "peering" || l.kind === "connection" ? 2 : 1.6}
                    strokeDasharray={l.kind === "tunnel" || l.kind === "p2s" ? "6 4" : undefined}
                    opacity={0.55}
                  />
                  <text
                    x={
                      l.kind === "peering" ? (a.x + a.w + b.x) / 2 : (center(a).x + center(b).x) / 2
                    }
                    y={(l.kind === "peering" ? ay : (center(a).y + center(b).y) / 2) - 6}
                    fontSize={10.5}
                    textAnchor="middle"
                    fill={color}
                  >
                    {l.label}
                  </text>
                </g>
              );
            })}
            {/* Elements */}
            {[...g.els.values()].map((e) => {
              const active = curEl?.id === e.id;
              const onPath = hops.some((h) => h.at === e.id);
              const Icon =
                e.id === "internet"
                  ? Globe
                  : e.id === "onprem"
                    ? Server
                    : e.id === "remote"
                      ? Laptop
                      : Network;
              return (
                <g key={e.id} opacity={e.absent ? 0.55 : !onPath && hops.length ? 0.7 : 1}>
                  <rect
                    x={e.x}
                    y={e.y}
                    width={e.w}
                    height={e.h}
                    rx={e.kind === "band" ? 8 : 6}
                    fill={e.kind === "band" ? "#f3f2f1" : e.kind === "ext" ? "#f3f2f1" : "#ffffff"}
                    stroke={
                      active
                        ? cur?.dir === "back"
                          ? backColor
                          : fwdColor
                        : e.absent
                          ? "#a19f9d"
                          : "#c8c6c4"
                    }
                    strokeWidth={active ? 3 : 1}
                    strokeDasharray={e.absent ? "5 4" : undefined}
                  />
                  <foreignObject x={e.x} y={e.y} width={e.w} height={e.h} pointerEvents="none">
                    <div className="flex h-full items-start gap-2 overflow-hidden px-2.5 py-2 text-[#1b1b1b]">
                      {e.kind !== "row" && (
                        <Icon className="mt-0.5 size-4 shrink-0 text-[#605e5c]" />
                      )}
                      <div className="min-w-0 leading-tight">
                        <p
                          className={cn(
                            "truncate text-[13px] font-semibold",
                            e.absent && "text-[#8a8886] line-through",
                          )}
                        >
                          {e.title}
                        </p>
                        {e.detail && (
                          <p className="truncate text-[12px] text-[#605e5c]">{e.detail}</p>
                        )}
                        {e.tag && !e.absent && (
                          <p className="mt-0.5 truncate font-mono text-[10.5px] text-[#0f6cbd]">
                            {e.tag}
                          </p>
                        )}
                        {e.publicIp && !e.absent && (
                          <p className="truncate font-mono text-[10px] text-[#605e5c]">
                            public IP {e.publicIp}
                          </p>
                        )}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
            {/* The packet's path so far */}
            {segs.map((d, i) =>
              d && i <= step ? (
                <path
                  key={`s${i}`}
                  d={d}
                  fill="none"
                  stroke={hops[i]!.dir === "back" ? backColor : fwdColor}
                  strokeWidth={i === step ? 3.5 : 2.5}
                  strokeDasharray={hops[i]!.dir === "back" ? "7 5" : undefined}
                  markerEnd="url(#ts-arrow)"
                  style={{ color: hops[i]!.dir === "back" ? backColor : fwdColor }}
                />
              ) : d ? (
                <path
                  key={`s${i}`}
                  d={d}
                  fill="none"
                  stroke="#c8c6c4"
                  strokeWidth={1.5}
                  strokeDasharray="3 5"
                />
              ) : null,
            )}
            {/* Where it stops */}
            {hops.map((h, i) => {
              const e = el(h.at);
              if (!h.drop || !e || i > step) return null;
              return (
                <g key={`x${i}`} transform={`translate(${e.x + e.w - 14},${e.y + 14})`}>
                  <circle r={11} fill="#a4262c" stroke="white" strokeWidth={2} />
                  <text textAnchor="middle" dy={4.5} fontSize={13} fontWeight={700} fill="white">
                    ✕
                  </text>
                  <title>{h.drop}</title>
                </g>
              );
            })}
            {/* The packet */}
            {segs[step] && (
              <g key={`p-${sim.id}-${step}`}>
                <circle
                  r={8}
                  fill={cur?.dir === "back" ? backColor : fwdColor}
                  stroke="white"
                  strokeWidth={2.5}
                >
                  <animateMotion dur="1.1s" fill="freeze" path={segs[step]!} />
                </circle>
              </g>
            )}
            {!segs[step] && curEl && (
              <circle
                cx={curEl.x + 14}
                cy={curEl.y + curEl.h / 2}
                r={8}
                fill={cur?.dir === "back" ? backColor : fwdColor}
                stroke="white"
                strokeWidth={2.5}
              />
            )}
          </svg>
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Addresses: hub subnets as Microsoft's hub-and-spoke module allocates them (first /22 of
          10.0.0.0/16); spokes from this design, or the offering's range (10.60.0.0/19, a /22 per
          install) for customer installs. On-premises and internet addresses are examples.
        </p>
      </section>

      {/* This hop */}
      <aside className="space-y-3" aria-label="This hop">
        <div className={cn("rounded-md px-3 py-2 text-[12px]", VERDICT[sim.verdict.status].cls)}>
          <b>{sim.available ? VERDICT[sim.verdict.status].label : "Not in this design"}.</b>{" "}
          {sim.available ? sim.verdict.text : sim.reason}
        </div>
        {cur && (
          <HopCard
            hop={cur}
            dir={cur.dir}
            color={cur.dir === "back" ? backColor : fwdColor}
            allRoutes={allRoutes}
            setAllRoutes={setAllRoutes}
            set={set}
          />
        )}
        {drop && step < hops.indexOf(drop) && (
          <p className="text-[11px] text-muted-foreground">
            Keep stepping: the packet is dropped at hop {hops.indexOf(drop) + 1}.
          </p>
        )}
        {sim.notes.map((n) => (
          <p
            key={n}
            className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
          >
            {n}
          </p>
        ))}
        <details className="rounded-md border border-border bg-card px-3 py-2 text-[11.5px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            How Azure picks a route
          </summary>
          <p className="mt-1.5">
            Longest prefix wins. For the same prefix, a route table entry (UDR) beats a BGP route,
            which beats Azure's system routes. A 0.0.0.0/0 UDR also removes the system routes that
            drop private ranges (10/8, 172.16/12, 192.168/16) — that's why spoke-to-spoke follows it
            to the firewall.
          </p>
          <p className="mt-1.5">
            Azure Route Server isn't needed here: Azure Firewall is steered by route tables or
            Virtual WAN routing intent. Route Server is for third-party appliances that speak BGP.
          </p>
          <a
            className="mt-1.5 inline-block text-primary hover:underline"
            href="https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview"
            target="_blank"
            rel="noreferrer"
          >
            Virtual network traffic routing (Microsoft Learn)
          </a>
        </details>
      </aside>
    </div>
  );
}

function HopCard({
  hop,
  dir,
  color,
  allRoutes,
  setAllRoutes,
  set,
}: {
  hop: SimHop;
  dir: "fwd" | "back";
  color: string;
  allRoutes: boolean;
  setAllRoutes: (v: boolean) => void;
  set?: ((p: Partial<Answers>) => void) | undefined;
}) {
  const rows =
    hop.routes?.filter((r) => allRoutes || r.active || r.reason !== "doesn't match") ?? [];
  return (
    <section
      className="rounded-md border bg-card"
      style={{ borderColor: color }}
      aria-label="Current hop"
    >
      <header className="border-b border-border px-3 py-2">
        <p className="text-[10.5px] font-semibold tracking-wide uppercase" style={{ color }}>
          {dir === "back" ? "Reply" : "Request"}
        </p>
        <p className="text-[13px] font-semibold">{hop.title}</p>
        {hop.body && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hop.body}</p>}
      </header>
      <div className="space-y-2 px-3 py-2">
        <p className="rounded bg-muted/60 px-2 py-1 font-mono text-[11px]" data-testid="packet">
          {hop.packet.src} → {hop.packet.dst}:{hop.packet.port}
        </p>
        {hop.nat && <p className="font-mono text-[11px] text-[#0f6cbd]">{hop.nat}</p>}
        {hop.routes && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold">Effective routes · {hop.table}</p>
              <button
                className="text-[10.5px] text-primary hover:underline"
                onClick={() => setAllRoutes(!allRoutes)}
              >
                {allRoutes ? "Only matching" : `All ${hop.routes.length}`}
              </button>
            </div>
            <table className="w-full font-mono text-[10.5px]" aria-label="Effective routes">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="font-normal">Prefix</th>
                  <th className="font-normal">Next hop</th>
                  <th className="font-normal">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={cn(
                      r.active
                        ? "bg-[#dff6dd] font-semibold text-[#0b5a08]"
                        : r.reason === "doesn't match"
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground line-through",
                    )}
                    title={r.active ? "Azure uses this route" : r.reason}
                    data-active={r.active || undefined}
                  >
                    <td className="py-0.5 pr-1">{r.prefix}</td>
                    <td className="pr-1">
                      {r.nextHop}
                      {r.nextHopIp ? ` ${r.nextHopIp}` : ""}
                    </td>
                    <td>{r.source === "Virtual network gateway" ? "BGP" : r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.filter((r) => !r.active && r.reason && r.reason !== "doesn't match").length >
              0 && (
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                Struck through: matched but lost (
                {[
                  ...new Set(
                    rows
                      .filter((r) => !r.active && r.reason && r.reason !== "doesn't match")
                      .map((r) => r.reason),
                  ),
                ].join("; ")}
                ).
              </p>
            )}
          </div>
        )}
        {hop.decisions?.map((d) => (
          <p key={d.text} className="flex gap-1 text-[11px]">
            <span className={cn("shrink-0 font-semibold", RESULT_CLS[d.result])}>{d.kind}:</span>
            <span>{d.text}</span>
          </p>
        ))}
        {hop.via && <p className="text-[11px] text-muted-foreground">Next: {hop.via}</p>}
        {hop.drop && (
          <p
            className="rounded bg-[#fde7e9] px-2 py-1.5 text-[11.5px] text-[#a4262c]"
            data-testid="drop"
          >
            <b>Dropped.</b> {hop.drop}
          </p>
        )}
        {hop.gap && (
          <p
            className={cn(
              "rounded px-2 py-1.5 text-[11.5px]",
              hop.gap.severity === "fail"
                ? "bg-[#fde7e9] text-[#a4262c]"
                : "bg-[#fff4ce] text-[#5c4400]",
            )}
          >
            <b>{hop.gap.severity === "fail" ? "Gap: " : "Note: "}</b>
            {hop.gap.text}
            {hop.gap.fix && set && (
              <button
                className="ml-1 font-semibold underline"
                onClick={() => set(hop.gap!.fix!.patch)}
              >
                {hop.gap.fix.label}
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
