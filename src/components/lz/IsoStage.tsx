/*
 * Isometric renderer for a landing zone scene. Geometry scales with zoom; labels are counter-scaled so they
 * stay readable at any zoom level. Traffic paths arc between hops and animate packets along them.
 */
import {
  AppWindow,
  BrickWall,
  Building2,
  Cable,
  Filter,
  Fingerprint,
  Globe,
  KeyRound,
  Layers,
  Network,
  Radar,
  ScrollText,
  ShieldAlert,
  Signpost,
  SquareTerminal,
  UserCog,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import type { Flow, IconKey, Prism, Scene, Sel } from "@/lib/alz/scene";

const C = 0.8660254;
const S = 0.5;
const P = (x: number, y: number, z: number): [number, number] => [(x - y) * C, (x + y) * S - z];
const pts = (list: [number, number][]) =>
  list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const FONT = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';

const ICONS: Record<IconKey, LucideIcon> = {
  firewall: BrickWall,
  vpn: KeyRound,
  er: Cable,
  bastion: SquareTerminal,
  dnsresolver: Signpost,
  dnszones: Network,
  ddos: ShieldAlert,
  law: ScrollText,
  dcr: Filter,
  ama: Fingerprint,
  sentinel: Radar,
  vwan: Waypoints,
  app: AppWindow,
  appPublic: Globe,
  internet: Globe,
  onprem: Building2,
  operator: UserCog,
  users: Users,
  more: Layers,
};

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const selKey = (s: Sel | null) => (s ? `${s.kind}:${s.id}` : "");

export type PolicyBadge = { mg: string; here: number };

export function IsoStage({
  scene,
  lens,
  selected,
  onSelect,
  flow,
  activeStep,
  onStep,
  policyBadges,
  policyChain,
  height,
  children,
}: {
  scene: Scene;
  lens: "build" | "traffic" | "policy";
  selected: Sel | null;
  onSelect: (s: Sel | null) => void;
  flow: Flow | null;
  activeStep: number;
  onStep: (i: number) => void;
  policyBadges: PolicyBadge[];
  policyChain: string[];
  height: number | string;
  children?: React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<{ p: Prism; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(
    null,
  );
  const moved = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of scene.prisms)
      for (const [x, y, z] of [
        [p.x, p.y, p.z + p.h + 30],
        [p.x + p.w, p.y, p.z],
        [p.x, p.y + p.d, p.z],
        [p.x + p.w, p.y + p.d, p.z],
      ] as [number, number, number][]) {
        const [sx, sy] = P(x, y, z);
        x0 = Math.min(x0, sx);
        y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx);
        y1 = Math.max(y1, sy);
      }
    const m = 30;
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + m * 2, h: y1 - y0 + m * 2 + 20 };
  }, [scene]);

  const base = Math.min(size.w / bounds.w, size.h / bounds.h);
  const ppu = base * view.k;
  const inv = 1 / ppu;
  const detail = ppu >= 0.62;

  const toVb = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const ox = (size.w - bounds.w * base) / 2;
    const oy = (size.h - bounds.h * base) / 2;
    return [
      bounds.x + (clientX - r.left - ox) / base,
      bounds.y + (clientY - r.top - oy) / base,
    ] as const;
  };
  const zoomAt = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const k = Math.min(4, Math.max(0.6, v.k * factor));
      const r = wrap.current!.getBoundingClientRect();
      const [vx, vy] = toVb(cx ?? r.left + r.width / 2, cy ?? r.top + r.height / 2);
      const wx = (vx - v.tx) / v.k;
      const wy = (vy - v.ty) / v.k;
      return { k, tx: vx - wx * k, ty: vy - wy * k };
    });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.004), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    moved.current = false;
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      moved.current = true;
    }
    if (d.moved) setView((v) => ({ ...v, tx: d.tx + dx / base, ty: d.ty + dy / base }));
  };
  const onUp = () => {
    drag.current = null;
  };

  /* ---- emphasis per lens */
  const flowKeys = useMemo(() => {
    if (lens !== "traffic" || !flow?.available) return null;
    const keys = new Set<string>();
    for (const s of flow.steps) {
      keys.add(`res:${s.at}`);
      keys.add(`ext:${s.at}`);
      keys.add(s.at);
      if (s.at.startsWith("spoke:")) keys.add(`app:${s.at.slice(6)}`);
    }
    if (
      flow.steps.some((s) => ["firewall", "vpngw", "ergw", "bastion", "dnsresolver"].includes(s.at))
    ) {
      keys.add("res:hubvnet");
      keys.add("res:vhub");
      keys.add("res:sidecar");
    }
    return keys;
  }, [lens, flow]);
  const selectedKey = selKey(selected);
  const emphasis = (p: Prism) => {
    if (flowKeys) {
      if (p.shape === "plate" && p.sel?.kind === "mg") return 1;
      if (p.sel?.kind === "sub") return 0.75;
      return flowKeys.has(p.key) ? 1 : 0.3;
    }
    if (lens === "policy" && policyChain.length) {
      if (p.sel?.kind === "mg") return policyChain.includes(p.sel.id) ? 1 : 0.4;
      return p.mg && policyChain.includes(p.mg) ? 1 : 0.4;
    }
    return 1;
  };

  const sorted = useMemo(
    () => [...scene.prisms].sort((a, b) => a.z - b.z || a.x + a.y - (b.x + b.y)),
    [scene],
  );

  const pathFor = (steps: string[]) => {
    const points = steps.map((a) => scene.anchors[a]).filter(Boolean) as [number, number, number][];
    let d = "";
    const hops: [number, number][] = [];
    points.forEach((p, i) => {
      const [x, y] = P(p[0], p[1], p[2] + 6);
      hops.push([x, y]);
      if (i === 0) {
        d += `M${x.toFixed(1)},${y.toFixed(1)}`;
        return;
      }
      const [px, py] = hops[i - 1]!;
      const dist = Math.hypot(x - px, y - py);
      const lift = dist < 1 ? 60 : Math.min(150, 30 + dist * 0.28);
      const cx = (x + px) / 2 + (dist < 1 ? 50 : 0);
      const cy = Math.min(y, py) - lift;
      d += ` Q${cx.toFixed(1)},${cy.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { d, hops };
  };

  const renderPrism = (p: Prism) => {
    const { x, y, z, w, d, h } = p;
    const isSel = !!selectedKey && !!p.sel && selKey(p.sel) === selectedKey;
    const hot = hover?.p.key === p.key;
    const op = emphasis(p);
    const top: [number, number][] = [
      P(x, y, z + h),
      P(x + w, y, z + h),
      P(x + w, y + d, z + h),
      P(x, y + d, z + h),
    ];
    const left: [number, number][] = [
      P(x, y + d, z + h),
      P(x + w, y + d, z + h),
      P(x + w, y + d, z),
      P(x, y + d, z),
    ];
    const right: [number, number][] = [
      P(x + w, y, z + h),
      P(x + w, y + d, z + h),
      P(x + w, y + d, z),
      P(x + w, y, z),
    ];
    const events = p.sel
      ? {
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            if (!moved.current) onSelect(p.sel!);
          },
          onMouseMove: (e: React.MouseEvent) => {
            const r = wrap.current!.getBoundingClientRect();
            setHover({ p, x: e.clientX - r.left, y: e.clientY - r.top });
          },
          onMouseLeave: () => setHover((cur) => (cur?.p.key === p.key ? null : cur)),
          style: { cursor: "pointer" },
        }
      : {};
    const stroke = isSel
      ? "#ffffff"
      : hot
        ? shade(p.color, 0.6)
        : shade(p.color, p.shape === "plate" ? 0.16 : 0.32);
    const strokeWidth = isSel ? 2.4 : hot ? 1.6 : 0.8;

    if (p.shape === "disc") {
      const [cx, cy] = P(x + w / 2, y + d / 2, z + h);
      const [, by] = P(x + w / 2, y + d / 2, z);
      const rx = w * 0.62;
      const ry = w * 0.36;
      return (
        <g key={p.key} {...events} opacity={op}>
          <g className="lz-fade">
            <ellipse cx={cx} cy={by} rx={rx} ry={ry} fill={shade(p.color, -0.5)} />
            <rect x={cx - rx} y={cy} width={rx * 2} height={by - cy} fill={shade(p.color, -0.32)} />
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              fill={p.color}
              stroke={stroke}
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
            />
            {p.icon && (
              <IconAt icon={p.icon} x={cx} y={cy} size={Math.min(26, w * 0.42)} color="#0b1324" />
            )}
          </g>
        </g>
      );
    }

    if (p.ghost)
      return (
        <g key={p.key} {...events} opacity={op}>
          <polygon
            points={pts(top)}
            fill={hot ? `${p.color}30` : `${p.color}12`}
            stroke={isSel ? "#fff" : `${p.color}99`}
            strokeDasharray={isSel ? undefined : "5 4"}
            strokeWidth={isSel ? 2 : 1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );

    const drop = p.shape === "block" || p.key.startsWith("spoke:") || p.key.startsWith("res:");
    return (
      <g key={p.key} {...events} opacity={op}>
        <g className={drop ? "lz-drop" : "lz-fade"}>
          <polygon points={pts(left)} fill={shade(p.color, -0.24)} />
          <polygon points={pts(right)} fill={shade(p.color, -0.4)} />
          <polygon
            points={pts(top)}
            fill={hot && p.shape !== "plate" ? shade(p.color, 0.14) : p.color}
            stroke={stroke}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          {p.icon &&
            (() => {
              const [cx, cy] = P(x + w / 2, y + d / 2, z + h);
              return (
                <IconAt icon={p.icon} x={cx} y={cy} size={Math.min(22, w * 0.46)} color="#ffffff" />
              );
            })()}
        </g>
      </g>
    );
  };

  /* ---- labels: sized in screen pixels, laid out so they never overlap */
  type Tone = "mg" | "res" | "spoke" | "ext" | "ghost";
  type LabelItem = {
    key: string;
    x: number;
    y: number;
    text: string;
    sub?: string | undefined;
    tone: Tone;
    anchor: "start" | "middle";
    opacity: number;
    priority: number;
    /** Screen direction to slide along when the spot is taken (e.g. along a plate's front edge). */
    slide?: [number, number];
    badge?: string | undefined;
  };
  const measure = (l: LabelItem) => {
    const fs = l.tone === "mg" ? 11.5 : 10.5;
    const textW = textWidth(l.text, fs, l.tone === "mg" ? 650 : 520) + 12;
    const badgeW = l.badge ? textWidth(l.badge, 10, 700) + 14 : 0;
    const w = Math.max(textW + badgeW, l.sub ? textWidth(l.sub, 9.5, 400) + 12 : 0);
    return { w, h: l.sub ? 30 : 18, fs, textW, badgeW };
  };
  const items: LabelItem[] = [];
  const mgDepth = (id: string) =>
    id === "alz"
      ? 0
      : ["platform", "landingzones", "sandbox", "decommissioned"].includes(id)
        ? 1
        : 2;
  for (const p of sorted) {
    if (!p.label) continue;
    const opacity = Math.max(emphasis(p), 0.5);
    const base = { key: `l:${p.key}`, text: p.label, opacity };
    if (p.labelLevel === "mg") {
      const [x, y] = P(p.x + 12, p.y + p.d - 11, p.z + p.h);
      items.push({
        ...base,
        x,
        y,
        tone: "mg",
        anchor: "start",
        priority: 28 + mgDepth(p.mg ?? ""),
        badge:
          lens === "policy" ? `${policyBadges.find((b) => b.mg === p.mg)?.here ?? 0}` : undefined,
        slide: [C, S],
      });
    } else if (p.labelLevel === "sub") {
      if (!p.ghost) continue;
      const [x, y] = P(p.x + p.w / 2, p.y + p.d / 2, p.z + p.h);
      items.push({ ...base, x, y, sub: p.sublabel, tone: "ghost", anchor: "middle", priority: 18 });
    } else if (p.labelLevel === "res") {
      if (!detail) continue;
      if (p.shape === "plate") {
        const [x, y] = P(p.x + 4, p.y + 4, p.z + p.h);
        items.push({ ...base, x, y: y - 10 * inv, tone: "res", anchor: "start", priority: 12 });
      } else {
        const [x, y] = P(p.x + p.w, p.y + p.d, p.z);
        items.push({ ...base, x, y: y + 10 * inv, tone: "res", anchor: "middle", priority: 14 });
      }
    } else if (p.labelLevel === "spoke") {
      if (!p.ghost && !detail) continue;
      const [x, y] = P(p.x + p.w / 2, p.y + p.d, p.z);
      items.push({
        ...base,
        x,
        y: y + 12 * inv,
        sub: detail ? p.sublabel : undefined,
        tone: p.ghost ? "ghost" : "spoke",
        anchor: "middle",
        priority: p.ghost ? 10 : 16,
      });
    } else if (p.labelLevel === "ext") {
      const [x, y] = P(p.x + p.w, p.y + p.d, p.z);
      items.push({ ...base, x, y: y + 12 * inv, tone: "ext", anchor: "middle", priority: 20 });
    }
  }
  const placedRects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const laidOut: (LabelItem & ReturnType<typeof measure>)[] = [];
  for (const l of [...items].sort((a, b) => b.priority - a.priority)) {
    const m = measure(l);
    const tries: [number, number][] = [[0, 0]];
    if (l.slide)
      for (let k = 1; k <= 6; k++) tries.push([l.slide[0] * 34 * k, l.slide[1] * 34 * k]);
    else tries.push([0, m.h + 2], [0, -(m.h + 2)], [m.w * 0.6, 0], [-m.w * 0.6, 0]);
    let spot: [number, number] | null = null;
    for (const [dx, dy] of tries) {
      const x = l.x + dx * inv;
      const y = l.y + dy * inv;
      const x0 = x + (l.anchor === "start" ? 0 : -m.w / 2) * inv;
      const r = {
        x0: x0 - 2 * inv,
        y0: y - (m.h / 2 + 2) * inv,
        x1: x0 + (m.w + 2) * inv,
        y1: y + (m.h / 2 + 2) * inv,
      };
      if (!placedRects.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) {
        spot = [x, y];
        placedRects.push(r);
        break;
      }
    }
    if (!spot && l.tone !== "mg") continue;
    laidOut.push({ ...l, ...m, x: spot?.[0] ?? l.x, y: spot?.[1] ?? l.y });
  }
  const labels: React.ReactNode[] = laidOut.map((l) => {
    const x0 = l.anchor === "start" ? 0 : -l.w / 2;
    return (
      <g
        key={l.key}
        transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) scale(${inv})`}
        opacity={l.opacity}
        style={{ pointerEvents: "none" }}
      >
        <rect
          x={x0}
          y={-l.h / 2}
          width={l.w}
          height={l.h}
          rx={4}
          fill={l.tone === "mg" ? "rgba(8,13,26,0.88)" : "rgba(8,13,26,0.74)"}
          stroke={l.tone === "mg" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}
        />
        <text
          x={x0 + 6}
          y={l.sub ? -2 : 3.8}
          fontSize={l.fs}
          fontWeight={l.tone === "mg" ? 650 : 520}
          fill={l.tone === "ghost" ? "#aab4c8" : "#eef2fa"}
          fontFamily={FONT}
        >
          {l.text}
        </text>
        {l.sub && (
          <text x={x0 + 6} y={10.5} fontSize={9.5} fill="#9fb0cc" fontFamily={FONT}>
            {l.sub}
          </text>
        )}
        {l.badge && (
          <>
            <rect
              x={x0 + l.textW - 2}
              y={-7.5}
              width={l.badgeW - 4}
              height={15}
              rx={7.5}
              fill={l.badge === "0" ? "#3a4868" : "#f3c24f"}
            />
            <text
              x={x0 + l.textW - 2 + (l.badgeW - 4) / 2}
              y={3.6}
              textAnchor="middle"
              fontSize={10}
              fontWeight={700}
              fill={l.badge === "0" ? "#c9d3e6" : "#1b1405"}
              fontFamily={FONT}
            >
              {l.badge}
            </text>
          </>
        )}
      </g>
    );
  });

  const links =
    lens === "build"
      ? scene.links.map((l) => (
          <path
            key={`${l.from}-${l.to}`}
            d={pathFor([l.from, l.to]).d}
            fill="none"
            stroke="#8fbaff"
            strokeOpacity={0.8}
            strokeWidth={1.6}
            strokeDasharray="4 5"
            vectorEffect="non-scaling-stroke"
            className="lz-dash-slow"
            style={{ pointerEvents: "none" }}
          />
        ))
      : null;

  let overlay: React.ReactNode = null;
  if (lens === "traffic" && flow?.available) {
    const { d, hops } = pathFor(flow.steps.map((s) => s.at));
    overlay = (
      <g style={{ pointerEvents: "none" }}>
        <path
          d={d}
          fill="none"
          stroke={flow.color}
          strokeOpacity={0.22}
          strokeWidth={11}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={d}
          fill="none"
          stroke={flow.color}
          strokeWidth={2.4}
          strokeDasharray="7 7"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="lz-dash"
        />
        {[0, 1, 2].map((i) => (
          <circle
            key={`${flow.id}-${d.length}-${i}`}
            r={5 * inv}
            fill="#fff"
            stroke={flow.color}
            strokeWidth={2 * inv}
          >
            <animateMotion
              dur={`${Math.max(2.4, flow.steps.length * 1.15)}s`}
              begin={`${i * 0.75}s`}
              repeatCount="indefinite"
              path={d}
            />
          </circle>
        ))}
      </g>
    );
    hops.forEach(([hx, hy], i) =>
      labels.push(
        <g
          key={`hop-${i}`}
          transform={`translate(${hx} ${hy - 16 * inv}) scale(${inv})`}
          style={{ cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            onStep(i);
          }}
        >
          {i === activeStep && (
            <circle r={16} fill={flow.color} opacity={0.35} className="lz-pulse" />
          )}
          <circle
            r={10.5}
            fill={i === activeStep ? flow.color : "#0b1324"}
            stroke={flow.color}
            strokeWidth={2}
          />
          <text
            y={4}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="#fff"
            fontFamily={FONT}
          >
            {i + 1}
          </text>
        </g>,
      ),
    );
  }

  /* ---- policy: tint and outline the chain of management groups the selection inherits from */
  if (lens === "policy" && policyChain.length) {
    overlay = (
      <g style={{ pointerEvents: "none" }}>
        {policyChain.map((id) => {
          const p = scene.plates[id];
          if (!p) return null;
          const top = pts([
            P(p.x, p.y, p.z + p.h),
            P(p.x + p.w, p.y, p.z + p.h),
            P(p.x + p.w, p.y + p.d, p.z + p.h),
            P(p.x, p.y + p.d, p.z + p.h),
          ]);
          const last = id === policyChain[policyChain.length - 1];
          return (
            <g key={`chain-${id}`}>
              <polygon points={top} fill="#f3c24f" fillOpacity={last ? 0.16 : 0.06} />
              <polygon
                points={top}
                fill="none"
                stroke="#f3c24f"
                strokeWidth={last ? 2.4 : 1.4}
                strokeDasharray={last ? undefined : "7 6"}
                vectorEffect="non-scaling-stroke"
                className={last ? undefined : "lz-dash-slow"}
              />
            </g>
          );
        })}
      </g>
    );
  }

  return (
    <div
      ref={wrap}
      className="relative w-full touch-none overflow-hidden select-none"
      style={{
        height,
        background: "radial-gradient(ellipse at 50% 30%, #182745 0%, #0b1324 72%)",
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => {
        drag.current = null;
        setHover(null);
      }}
      onClick={() => {
        if (!moved.current) onSelect(null);
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        className="block"
        role="img"
        aria-label="Landing zone architecture"
      >
        <defs>
          <pattern id="lz-grid" width="46" height="26.56" patternUnits="userSpaceOnUse">
            <path
              d="M0 13.28 L23 0 L46 13.28 L23 26.56 Z"
              fill="none"
              stroke="rgba(140,170,230,0.06)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect
          x={bounds.x - 3000}
          y={bounds.y - 3000}
          width={bounds.w + 6000}
          height={bounds.h + 6000}
          fill="url(#lz-grid)"
        />
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          {sorted.map(renderPrism)}
          {links}
          {overlay}
          {labels}
        </g>
      </svg>

      <div
        className="absolute right-3 bottom-3 flex overflow-hidden rounded-md border border-white/10 bg-[#0b1324]/85 text-[#cfd8ea] shadow"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="px-2.5 py-1 text-sm hover:bg-white/10"
          onClick={() => zoomAt(1.25)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="border-x border-white/10 px-2.5 py-1 text-sm hover:bg-white/10"
          onClick={() => zoomAt(0.8)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="px-2.5 py-1 text-[11px] hover:bg-white/10"
          onClick={() => setView({ k: 1, tx: 0, ty: 0 })}
        >
          Fit
        </button>
      </div>
      {children}
      <p className="pointer-events-none absolute bottom-3 left-3 text-[10.5px] text-[#7d8aa6]">
        Drag to pan · pinch or ⌘/Ctrl + scroll to zoom · click anything to inspect
      </p>

      {hover?.p.label && (
        <div
          className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-white/10 bg-[#0b1324]/95 px-2.5 py-1.5 text-[11.5px] text-[#eef2fa] shadow-lg"
          style={{ left: Math.min(hover.x + 14, size.w - 250), top: hover.y + 16 }}
        >
          <p className="font-semibold">{hover.p.label}</p>
          {hover.p.sublabel && <p className="text-[#9fb0cc]">{hover.p.sublabel}</p>}
        </div>
      )}
    </div>
  );
}

const widths = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;
/** Real text width in pixels (canvas measureText), with an estimate during server rendering. */
function textWidth(text: string, size: number, weight: number) {
  const key = `${weight}|${size}|${text}`;
  const cached = widths.get(key);
  if (cached !== undefined) return cached;
  if (ctx === undefined && typeof document !== "undefined")
    ctx = document.createElement("canvas").getContext("2d");
  let w = text.length * size * 0.58;
  if (ctx) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    w = ctx.measureText(text).width;
  }
  widths.set(key, w);
  return w;
}

function IconAt({
  icon,
  x,
  y,
  size,
  color,
}: {
  icon: IconKey;
  x: number;
  y: number;
  size: number;
  color: string;
}) {
  const Icon = ICONS[icon];
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2})`} style={{ pointerEvents: "none" }}>
      <Icon width={size} height={size} color={color} strokeWidth={2.1} />
    </g>
  );
}
