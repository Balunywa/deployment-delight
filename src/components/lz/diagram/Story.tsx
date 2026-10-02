/*
 * The story engine behind every traffic diagram: any architecture drawn in Microsoft's style (nested boundaries,
 * icon cards in rows, one lane per flow with the reason written on it), animated like a live packet, stepped one
 * flow at a time, compared side by side with an alternative, and downloadable. A layout says where things sit;
 * flows say what talks to what and whether it works. The landing zone overview and the workload diagrams both use it.
 */
import { Download, Moon, Pause, Play, Sun } from "lucide-react";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { Flow } from "@/lib/alz/scene";
import { cn } from "@/lib/utils";

import { OUTCOME, PALETTE, useDiagramTheme } from "./theme";

type Theme = "dark" | "light";
const STATUS = OUTCOME;

export type StoryBox = { x: number; y: number; w: number; h: number };
export type StoryNode = StoryBox & {
  id: string;
  title: string;
  sub: string;
  /** Azure icon file name in public/azure-icons, without .svg. */
  icon?: string;
  /** A shorter title for crowded rows. */
  short?: string;
  /** Drawn tighter, with the short title, when its row is crowded. */
  tight?: boolean;
  /** Index into layout.rows. */
  row: number;
  /** Drawn only when a shown flow touches it. */
  optional?: boolean;
  /** Highlight: just added by a change, or about to be removed. */
  mark?: "added" | "removed" | undefined;
};
export type StoryZone = StoryBox & { label: string; dashed?: boolean };
export type StoryLayout = {
  width: number;
  height: number;
  rows: { y: number; h: number }[];
  /** Free band between row r and r+1 where horizontal channels run. */
  gaps: { top: number; bottom: number }[];
  nodes: StoryNode[];
  zones: StoryZone[];
  /** The outer boundary (Azure, or a subscription) with its title at the bottom right. */
  outer?: (StoryBox & { title: string; sub: string }) | undefined;
  /** A connection band (hybrid, landing zone platform). */
  band?: (StoryBox & { label: string; on: boolean; icon?: string }) | undefined;
  /** A lower boundary (on-premises, or the landing zone). */
  /** A panel below the design; its label sits at the bottom when flows enter it from above. */
  lower?: (StoryBox & { label: string; labelAt?: "top" | "bottom" }) | undefined;
};
export type StoryData = { layout: StoryLayout; flows: Flow[]; alias?: Record<string, string> };

type Pt = { x: number; y: number };
const center = (b: StoryBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** A flow's own port on a box side, so flows touching the same box never share a point. */
const portX = (b: StoryBox, lane: number, lanes: number) =>
  b.x + b.w * (0.16 + (0.68 * (lane + 0.5)) / lanes);
const portY = (b: StoryBox, lane: number, lanes: number) =>
  b.y + b.h * (0.2 + (0.6 * (lane + 0.5)) / lanes);
const channel = (L: StoryLayout, gap: number, lane: number, lanes: number) => {
  const g = L.gaps[Math.max(0, Math.min(gap, L.gaps.length - 1))]!;
  return g.top + ((g.bottom - g.top) * (lane + 0.5)) / lanes;
};

/** A vertical run at x would cross a box in one of these rows; find the nearest gap between boxes instead. */
function gutter(x: number, rows: number[], nodes: StoryNode[], lane: number) {
  const blockers = nodes.filter((n) => rows.includes(n.row));
  const free = (v: number) => blockers.every((n) => v < n.x - 5 || v > n.x + n.w + 5);
  if (free(x)) return x;
  for (let d = 4; d < 900; d += 4) {
    if (free(x - d - lane)) return x - d - lane;
    if (free(x + d + lane)) return x + d + lane;
  }
  return x;
}

function route(L: StoryLayout, a: StoryNode, b: StoryNode, lane: number, lanes: number): Pt[] {
  const nodes = L.nodes;
  if (a.row === b.row) {
    const between = nodes.filter(
      (n) =>
        n.row === a.row &&
        n !== a &&
        n !== b &&
        n.x > Math.min(a.x, b.x) &&
        n.x < Math.max(a.x, b.x),
    );
    if (!between.length) {
      const y = portY(a, lane, lanes);
      return a.x < b.x
        ? [
            { x: a.x + a.w, y },
            { x: b.x, y },
          ]
        : [
            { x: a.x, y },
            { x: b.x + b.w, y },
          ];
    }
    const y = channel(L, a.row, lane, lanes);
    const ax = portX(a, lane, lanes);
    const bx = portX(b, lane, lanes);
    const yb = L.rows[a.row]!.y + L.rows[a.row]!.h;
    return [
      { x: ax, y: yb },
      { x: ax, y },
      { x: bx, y },
      { x: bx, y: yb },
    ];
  }
  const down = b.row > a.row;
  const ax = portX(a, lane, lanes);
  const bx = portX(b, lane, lanes);
  const ay = down ? a.y + a.h : a.y;
  const by = down ? b.y : b.y + b.h;
  const gapA = down ? a.row : a.row - 1;
  const gapB = down ? b.row - 1 : b.row;
  const yB = channel(L, gapB, lane, lanes);
  const inner = Array.from({ length: Math.abs(b.row - a.row) - 1 }, (_, i) =>
    down ? a.row + 1 + i : a.row - 1 - i,
  );
  const gx = inner.length ? gutter(ax, inner, nodes, lane) : ax;
  if (gx === ax)
    return [
      { x: ax, y: ay },
      { x: ax, y: yB },
      { x: bx, y: yB },
      { x: bx, y: by },
    ];
  const yA = channel(L, gapA, lane, lanes);
  return [
    { x: ax, y: ay },
    { x: ax, y: yA },
    { x: gx, y: yA },
    { x: gx, y: yB },
    { x: bx, y: yB },
    { x: bx, y: by },
  ];
}

const toD = (pts: Pt[]) =>
  pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export function StoryView({
  mine,
  other,
  only,
  compact,
  onTrace,
  baseLabel = "Your design",
  stacked,
  fileName,
  label,
  categories = "Traffic categories",
  intro = "The pieces of this design. Press Next to add one kind of traffic at a time.",
  allLabel = "All traffic",
}: {
  mine: StoryData;
  other?: (StoryData & { label: string }) | undefined;
  /** Show only these flows. */
  only?: string[] | undefined;
  compact?: boolean;
  onTrace?: ((flowId: string) => void) | undefined;
  /** What to call this design when it's drawn beside an alternative. */
  baseLabel?: string;
  /** Draw the comparison underneath rather than beside (for narrow columns). */
  stacked?: boolean;
  fileName: string;
  /** Accessible name of the drawing. */
  label: string;
  categories?: string;
  intro?: string;
  /** The "show everything" button, e.g. "All identity flows". */
  allLabel?: string;
}) {
  const [theme, setTheme] = useDiagramTheme();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const flows = mine.flows.filter((f) => !only || only.includes(f.id));
  const numbered = flows.filter((f) => f.available);
  // Numbers follow this design's flows, so ① is the same traffic in both pictures when comparing.
  const num = new Map(numbered.map((f, i) => [f.id, i + 1]));
  for (const f of other?.flows ?? [])
    if (f.available && (!only || only.includes(f.id)) && !num.has(f.id))
      num.set(f.id, num.size + 1);
  const shown = (f: Flow) =>
    f.available && !hidden.has(f.id) && (step === null || (num.get(f.id) ?? 99) <= step);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const current =
    step !== null && step > 0
      ? numbered[step - 1]
      : focus
        ? numbered.find((f) => f.id === focus)
        : undefined;

  const download = async (kind: "svg" | "png") => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Inline the icons so the file stands on its own.
    await Promise.all(
      [...clone.querySelectorAll("image")].map(async (img) => {
        const href = img.getAttribute("href");
        if (!href || href.startsWith("data:")) return;
        const text = await fetch(href).then((r) => r.text());
        img.setAttribute(
          "href",
          `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`,
        );
      }),
    );
    clone.querySelectorAll("[data-anim]").forEach((n) => n.remove());
    const data = new XMLSerializer().serializeToString(clone);
    const name = fileName;
    const save = (blob: Blob, ext: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    };
    if (kind === "svg") return save(new Blob([data], { type: "image/svg+xml" }), "svg");
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data)))}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    const W = mine.layout.width;
    const H = mine.layout.height;
    canvas.width = W * 2;
    canvas.height = H * 2;
    canvas.getContext("2d")!.drawImage(img, 0, 0, W * 2, H * 2);
    canvas.toBlob((b) => b && save(b, "png"), "image/png");
  };

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={step === null ? "default" : "outline"}
              className="h-8"
              onClick={() => setStep(null)}
            >
              {allLabel}
            </Button>
            <Button
              size="sm"
              variant={step !== null ? "default" : "outline"}
              className="h-8"
              onClick={() => setStep(step === null ? 0 : step)}
            >
              Step through
            </Button>
            {step !== null && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={step === 0}
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </Button>
                <span className="text-[12px] text-muted-foreground">
                  {step === 0 ? "The pieces" : `${step} of ${numbered.length}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={step >= numbered.length}
                  onClick={() => setStep(step + 1)}
                >
                  Next
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? "Pause animation" : "Play animation"}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Switch diagram theme"
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void download("svg")}
            >
              <Download className="size-3.5" /> SVG
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void download("png")}
            >
              <Download className="size-3.5" /> PNG
            </Button>
          </div>
        </div>
      )}

      <div className={cn("grid gap-3", other && !stacked && "2xl:grid-cols-2")}>
        <StoryCanvas
          title={other ? baseLabel : undefined}
          theme={theme}
          label={label}
          story={mine}
          only={only}
          num={num}
          shown={shown}
          focus={current?.id ?? null}
          playing={playing}
          onFocus={(id) => setFocus(focus === id ? null : id)}
          svgRef={svgRef}
        />
        {other && (
          <StoryCanvas
            title={other.label}
            theme={theme}
            label={label}
            story={other}
            only={only}
            num={num}
            shown={shown}
            focus={current?.id ?? null}
            playing={playing}
            onFocus={(id) => setFocus(focus === id ? null : id)}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={categories}>
        {flows.map((f) => {
          const n = num.get(f.id) ?? 0;
          const s = STATUS[f.outcome?.status ?? ""];
          const off = hidden.has(f.id);
          return (
            <button
              key={f.id}
              disabled={!f.available}
              aria-pressed={f.available && !off}
              title={
                f.available ? (f.outcome?.text ?? f.summary) : (f.reason ?? "Not in this design")
              }
              onClick={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(f.id)) next.delete(f.id);
                  else next.add(f.id);
                  return next;
                })
              }
              onMouseEnter={() => setFocus(f.id)}
              onMouseLeave={() => setFocus(null)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors",
                !f.available
                  ? "border-dashed border-border text-muted-foreground"
                  : off
                    ? "border-border text-muted-foreground line-through"
                    : "border-border bg-card hover:bg-muted/50",
              )}
            >
              {f.available ? (
                <span
                  className="grid size-5 place-items-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: f.color }}
                >
                  {n}
                </span>
              ) : null}
              {f.title}
              {f.available && s && (
                <span className="font-semibold" style={{ color: s.color }}>
                  {s.mark}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <span
                  className="grid size-6 place-items-center rounded-full text-[12px] font-bold text-white"
                  style={{ background: current.color }}
                >
                  {num.get(current.id)}
                </span>
                {current.title}
              </p>
              {current.outcome && (
                <p
                  className="mt-1 text-[12.5px]"
                  style={{ color: STATUS[current.outcome.status]?.color }}
                >
                  {STATUS[current.outcome.status]?.label}: {current.outcome.text}
                </p>
              )}
            </div>
            {onTrace && (
              <Button size="sm" variant="outline" onClick={() => onTrace(current.id)}>
                Trace it hop by hop
              </Button>
            )}
          </div>
          <ol className="mt-3 space-y-1.5 text-[12.5px]">
            {current.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-5 shrink-0 text-right font-mono text-muted-foreground">
                  {i + 1}
                </span>
                <span>
                  <span className="font-medium">{s.title}</span>
                  {s.route && (
                    <span className="block text-[11.5px] text-muted-foreground">
                      {s.route.text}
                    </span>
                  )}
                  {s.gap && (
                    <span
                      className={cn(
                        "block text-[11.5px]",
                        s.gap.severity === "fail" ? "text-danger" : "text-[oklch(0.5_0.12_70)]",
                      )}
                    >
                      {s.gap.text}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {step === 0 && (
        <p className="rounded-lg bg-muted/50 px-4 py-2.5 text-[12.5px] text-muted-foreground">
          {intro}
        </p>
      )}
    </div>
  );
}

export function StoryCanvas({
  title,
  theme,
  label,
  story,
  only,
  num,
  shown,
  focus,
  playing,
  onFocus,
  svgRef,
}: {
  title?: string | undefined;
  theme: Theme;
  label: string;
  story: StoryData;
  only?: string[] | undefined;
  num: Map<string, number>;
  shown: (f: Flow) => boolean;
  focus: string | null;
  playing: boolean;
  onFocus: (id: string) => void;
  svgRef?: RefObject<SVGSVGElement | null> | undefined;
}) {
  const uid = useId().replace(/:/g, "");
  const c = PALETTE[theme];
  const L = story.layout;
  const W = L.width;
  const H = L.height;
  const alias = story.alias ?? {};
  const byId = new Map(L.nodes.map((n) => [n.id, n]));
  const flows = story.flows.filter((f) => (!only || only.includes(f.id)) && f.available);
  // Lanes are per flow across what this view can show, so a flow keeps its lane while stepping through or focusing,
  // and a lens with few flows spreads them out instead of crowding them into a few pixels.
  const laneOf = new Map(flows.map((f, i) => [f.id, i]));
  const lanes = Math.max(laneOf.size, 1);
  const touched = new Set(flows.flatMap((f) => f.steps.map((s) => alias[s.at] ?? s.at)));
  const drawn = L.nodes.filter((n) => !n.optional || touched.has(n.id));

  const paths = flows.map((f, i) => {
    const lane = laneOf.get(f.id) ?? i;
    const seq = f.steps
      .map((s) => byId.get(s.at) ?? byId.get(alias[s.at] ?? ""))
      .filter((n): n is StoryNode => !!n);
    const legs: { d: string; pts: Pt[]; via?: string | undefined }[] = [];
    for (let k = 1; k < seq.length; k++) {
      if (seq[k] === seq[k - 1]) continue;
      const pts = route(L, seq[k - 1]!, seq[k]!, lane, lanes);
      legs.push({ d: toD(pts), pts, via: f.steps[k - 1]?.via });
    }
    return { f, i, legs, start: seq[0], end: seq.at(-1) };
  });

  // Hop labels go where they overlap neither a box nor another label: each tries every segment of its own path,
  // beside a vertical run or above/below a horizontal one. A label with no room is left for the focused view.
  const placed: StoryBox[] = drawn.map((n) => ({ x: n.x - 2, y: n.y - 2, w: n.w + 4, h: n.h + 4 }));
  const hit = (b: StoryBox) =>
    b.x < 4 ||
    b.x + b.w > W - 4 ||
    placed.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  const labels = new Map<string, { x: number; y: number; w: number; text: string }[]>();
  const order = [...paths].sort((p, q) => (p.f.id === focus ? -1 : q.f.id === focus ? 1 : 0));
  for (const { f, legs } of order) {
    if (!shown(f)) continue;
    const out: { x: number; y: number; w: number; text: string }[] = [];
    legs.forEach((leg, k) => {
      if (!leg.via || (focus !== f.id && k > 0)) return;
      const text = leg.via.length > 34 ? `${leg.via.slice(0, 33)}…` : leg.via;
      const w = Math.min(text.length * 6.2 + 14, 230);
      const spots: StoryBox[] = [];
      const segs = leg.pts
        .slice(1)
        .map((b, i) => ({ a: leg.pts[i]!, b }))
        .sort(
          (p, q) =>
            Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y),
        );
      for (const { a, b } of segs) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (a.x === b.x)
          for (const dy of [0, -24, 24])
            spots.push(
              { x: mx + 8, y: my - 10 + dy, w, h: 20 },
              { x: mx - 8 - w, y: my - 10 + dy, w, h: 20 },
            );
        else
          for (const dx of [0, -w / 2, w / 2])
            spots.push(
              { x: mx - w / 2 + dx, y: my - 24, w, h: 20 },
              { x: mx - w / 2 + dx, y: my + 4, w, h: 20 },
            );
      }
      const spot = spots.find((b) => !hit(b));
      if (!spot) return;
      placed.push(spot);
      out.push({ x: spot.x, y: spot.y, w, text });
    });
    labels.set(f.id, out);
  }

  return (
    <figure
      className="overflow-hidden rounded-xl border border-border"
      style={{ background: c.bg }}
    >
      {title && (
        <figcaption className="px-4 pt-3 text-[12px] font-semibold" style={{ color: c.sub }}>
          {title}
        </figcaption>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}${title ? `: ${title}` : ""}`}
        className="block h-auto w-full"
        style={{ background: c.bg }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <style>{`
            @keyframes march-${uid} { to { stroke-dashoffset: -22; } }
            .march-${uid} { animation: march-${uid} 0.9s linear infinite; }
            @media (prefers-reduced-motion: reduce) { .march-${uid} { animation: none; } }
          `}</style>
        </defs>
        <rect width={W} height={H} fill={c.bg} />

        {L.outer && (
          <>
            <rect
              x={L.outer.x}
              y={L.outer.y}
              width={L.outer.w}
              height={L.outer.h}
              rx={22}
              fill={c.azure}
              stroke={c.azureLine}
              strokeWidth={1.5}
            />
          </>
        )}
        {L.zones.map((z) => (
          <g key={z.label}>
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx={14}
              fill={c.zone}
              stroke={c.zoneLine}
              strokeWidth={1.2}
              strokeDasharray={z.dashed ? "7 5" : undefined}
            />
          </g>
        ))}

        {L.band && (
          <>
            <rect
              x={L.band.x}
              y={L.band.y}
              width={L.band.w}
              height={L.band.h}
              rx={10}
              fill={L.band.on ? c.band : "none"}
              stroke={L.band.on ? c.zoneLine : c.muted}
              strokeDasharray={L.band.on ? undefined : "6 5"}
            />
            <image
              href={`/azure-icons/${L.band.icon ?? "expressroute"}.svg`}
              x={L.band.x + 14}
              y={L.band.y + 11}
              width={22}
              height={22}
              opacity={L.band.on ? 1 : 0.4}
            />
            <text
              x={L.band.x + 46}
              y={L.band.y + 27}
              fill={L.band.on ? c.text : c.muted}
              fontSize={13}
              fontWeight={600}
            >
              {L.band.label}
            </text>
          </>
        )}
        {L.lower && (
          <>
            <rect
              x={L.lower.x}
              y={L.lower.y}
              width={L.lower.w}
              height={L.lower.h}
              rx={18}
              fill="none"
              stroke="#3b82f6"
              strokeOpacity={0.6}
              strokeWidth={1.4}
            />
          </>
        )}

        {/* Flows under the boxes, so lines tuck into them */}
        {paths.map(({ f, i, legs }) => {
          if (!shown(f)) return null;
          const dim = focus && focus !== f.id;
          return (
            <g
              key={f.id}
              opacity={dim ? 0.14 : 1}
              onClick={() => onFocus(f.id)}
              style={{ cursor: "pointer" }}
            >
              {legs.map((leg, k) => (
                <g key={k}>
                  <path
                    d={leg.d}
                    fill="none"
                    stroke={f.color}
                    strokeOpacity={0.22}
                    strokeWidth={7}
                    strokeLinejoin="round"
                    filter={`url(#glow-${uid})`}
                  />
                  <path
                    d={leg.d}
                    fill="none"
                    stroke={f.color}
                    strokeWidth={2.2}
                    strokeDasharray="7 4"
                    strokeLinejoin="round"
                    className={playing ? `march-${uid}` : undefined}
                  />
                  {playing &&
                    [0, 0.5].map((phase) => (
                      <circle
                        key={phase}
                        data-anim
                        r={4.2}
                        fill={f.color}
                        filter={`url(#glow-${uid})`}
                      >
                        <animateMotion
                          dur={`${2.2 + (i % 3) * 0.4}s`}
                          begin={`${phase * 2}s`}
                          repeatCount="indefinite"
                          path={leg.d}
                        />
                      </circle>
                    ))}
                </g>
              ))}
            </g>
          );
        })}

        {/* Boundary labels above the lines, haloed so a line passing under stays readable */}
        {L.outer && (
          <text
            x={L.outer.x + L.outer.w - 18}
            y={L.outer.y + L.outer.h - 6}
            textAnchor="end"
            fill={c.sub}
            fontSize={12}
            stroke={c.bg}
            strokeWidth={4}
            paintOrder="stroke"
          >
            <tspan fill={c.text} fontWeight={700} fontSize={14}>
              {L.outer.title}
            </tspan>
            {L.outer.sub ? `  ·  ${L.outer.sub}` : ""}
          </text>
        )}
        {L.zones.map((z) => (
          <g key={z.label}>
            <text
              x={z.x + z.w - 14}
              y={z.y + 16}
              textAnchor="end"
              fill={c.sub}
              fontSize={11.5}
              fontWeight={600}
              stroke={c.bg}
              strokeWidth={4}
              paintOrder="stroke"
            >
              {z.label}
            </text>
          </g>
        ))}
        {L.lower && (
          <text
            x={L.lower.x + 16}
            y={L.lower.labelAt === "bottom" ? L.lower.y + L.lower.h - 12 : L.lower.y + 20}
            fill="#60a5fa"
            fontSize={12}
            fontWeight={600}
            stroke={c.bg}
            strokeWidth={4}
            paintOrder="stroke"
          >
            {L.lower.label}
          </text>
        )}
        {drawn.map((n) => {
          const big = n.h > 80;
          const tx = n.x + (n.tight ? 36 : 48);
          const tw = n.w - (n.tight ? 42 : 58);
          const icon = n.tight ? 20 : 26;
          const titleLines = wrap(n.title, tw, 13);
          const subLines = wrap(n.sub, tw, 11);
          // A subtitle that doesn't fit a crowded box is left out rather than cut mid-word.
          const subLine =
            subLines.length === 1 ? subLines[0]! : n.tight ? "" : `${subLines[0] ?? ""}…`;
          const ty = big ? n.y + 30 : n.y + n.h / 2 - (titleLines.length > 1 ? 12 : 4);
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={10}
                fill={c.node}
                stroke={
                  n.mark === "added" ? "#22c55e" : n.mark === "removed" ? "#ef4444" : c.nodeLine
                }
                strokeWidth={n.mark ? 2.2 : 1.2}
                strokeDasharray={n.mark === "removed" ? "5 4" : undefined}
              />
              {n.icon && (
                <image
                  href={`/azure-icons/${n.icon}.svg`}
                  x={n.x + (n.tight ? 10 : 12)}
                  y={big ? n.y + 16 : n.y + n.h / 2 - icon / 2}
                  width={icon}
                  height={icon}
                />
              )}
              <text x={tx} y={ty} fill={c.text} fontSize={13} fontWeight={600}>
                {titleLines.map((l, i) => (
                  <tspan key={i} x={tx} dy={i ? 15 : 0}>
                    {l}
                  </tspan>
                ))}
              </text>
              <text x={tx} y={ty + titleLines.length * 15 + 1} fill={c.sub} fontSize={11}>
                {subLine}
              </text>
            </g>
          );
        })}

        {/* Labels, numbers and outcomes on top */}
        {paths.map(({ f, legs, start, end }) => {
          const n = num.get(f.id) ?? 0;
          if (!shown(f) || !start) return null;
          const dim = focus && focus !== f.id;
          const s = STATUS[f.outcome?.status ?? ""];
          // A flow whose hops all land in one box (e.g. a lookup inside the landing zone) is marked on its corner.
          const first = legs[0]?.pts[0] ?? { x: start.x + start.w - 18, y: start.y };
          const end0 = legs.at(-1)?.pts.at(-1) ?? first;
          // A flow that ends where it started (e.g. a lookup, then the connection) shows its outcome beside its number.
          const last =
            Math.hypot(end0.x - first.x, end0.y - first.y) < 24
              ? { x: first.x + 24, y: first.y }
              : end0;
          return (
            <g key={f.id} opacity={dim ? 0.14 : 1}>
              {(labels.get(f.id) ?? []).map((l, k) => (
                <g key={k}>
                  <rect
                    x={l.x}
                    y={l.y}
                    width={l.w}
                    height={20}
                    rx={6}
                    fill={c.bg}
                    stroke={f.color}
                    strokeOpacity={0.7}
                  />
                  <text
                    x={l.x + l.w / 2}
                    y={l.y + 14}
                    textAnchor="middle"
                    fill={f.color}
                    fontSize={11}
                    fontWeight={600}
                  >
                    {l.text}
                  </text>
                </g>
              ))}
              <circle
                cx={first.x}
                cy={first.y}
                r={11}
                fill={f.color}
                stroke={c.bg}
                strokeWidth={2}
              />
              <text
                x={first.x}
                y={first.y + 4.5}
                textAnchor="middle"
                fill="#fff"
                fontSize={12}
                fontWeight={800}
              >
                {n}
              </text>
              {s && (
                <g>
                  <circle
                    cx={last.x}
                    cy={last.y}
                    r={10}
                    fill={c.bg}
                    stroke={s.color}
                    strokeWidth={2}
                  />
                  <text
                    x={last.x}
                    y={last.y + 4.5}
                    textAnchor="middle"
                    fill={s.color}
                    fontSize={12}
                    fontWeight={800}
                  >
                    {s.mark}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Word wrap for SVG text by an approximate character width; at most two lines. */
function wrap(text: string, width: number, size: number) {
  const per = Math.max(8, Math.floor(width / (size * 0.56)));
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if ((cur + " " + word).trim().length > per && cur) {
      lines.push(cur.trim());
      cur = word;
    } else cur = `${cur} ${word}`;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.length > 2 ? [lines[0]!, `${lines[1]!}…`] : lines;
}
