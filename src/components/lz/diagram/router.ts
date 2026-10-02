/*
 * Orthogonal routing around cards, so connectors in every React Flow diagram follow lanes like the traffic overview:
 * try the plain step route first, then move the vertical run into the nearest gutter and the horizontal run into
 * the nearest free channel, until no segment crosses a card. Endpoints' own cards don't count.
 */
import { Position } from "@xyflow/react";

export type Rect = { id: string; x: number; y: number; w: number; h: number };
type P = { x: number; y: number };

const LEAD = 14;
const STEP = 12;

const out = (p: P, pos: Position, d = LEAD): P =>
  pos === Position.Top
    ? { x: p.x, y: p.y - d }
    : pos === Position.Bottom
      ? { x: p.x, y: p.y + d }
      : pos === Position.Left
        ? { x: p.x - d, y: p.y }
        : { x: p.x + d, y: p.y };

function hits(a: P, b: P, rects: Rect[]) {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return rects.some(
    (r) => x2 > r.x - 3 && x1 < r.x + r.w + 3 && y2 > r.y - 3 && y1 < r.y + r.h + 3,
  );
}

const clear = (pts: P[], rects: Rect[]) => pts.slice(1).every((b, i) => !hits(pts[i]!, b, rects));

const spread = (centre: number, n: number) =>
  Array.from({ length: n * 2 + 1 }, (_, k) => centre + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * STEP);

/** Route from source to target; returns the points of the path. */
export function routeAround(
  s: P,
  sp: Position,
  t: P,
  tp: Position,
  rects: Rect[],
  /** Parallel connectors between the same cards take neighbouring channels. */
  lane = 0,
): P[] {
  const s1 = out(s, sp);
  const t1 = out(t, tp);
  const vertical = sp === Position.Top || sp === Position.Bottom;
  const tv = tp === Position.Top || tp === Position.Bottom;
  const tries: P[][] = [];
  if (vertical && tv) {
    // The shared channel sits nearer the source, like a bus under a parent, so it stays clear of the target's
    // boundary and its label.
    const mid = s1.y + (t1.y - s1.y) * 0.4 + lane * 8;
    for (const my of spread(mid, 24))
      tries.push([s, s1, { x: s1.x, y: my }, { x: t1.x, y: my }, t1, t]);
    for (const a of spread(s1.x, 30))
      for (const my of spread(mid, 12))
        tries.push([s, s1, { x: a, y: s1.y }, { x: a, y: my }, { x: t1.x, y: my }, t1, t]);
    for (const a of spread(s1.x, 20))
      for (const b of spread(t1.x, 20))
        for (const my of spread(mid, 6))
          tries.push([
            s,
            s1,
            { x: a, y: s1.y },
            { x: a, y: my },
            { x: b, y: my },
            { x: b, y: t1.y },
            t1,
            t,
          ]);
  } else if (!vertical && !tv) {
    const mid = (s1.x + t1.x) / 2 + lane * 8;
    for (const mx of spread(mid, 24))
      tries.push([s, s1, { x: mx, y: s1.y }, { x: mx, y: t1.y }, t1, t]);
    for (const a of spread(s1.y, 30))
      for (const mx of spread(mid, 12))
        tries.push([s, s1, { x: s1.x, y: a }, { x: mx, y: a }, { x: mx, y: t1.y }, t1, t]);
  } else {
    const corner = vertical ? { x: s1.x, y: t1.y } : { x: t1.x, y: s1.y };
    tries.push([s, s1, corner, t1, t]);
    for (const a of spread(vertical ? s1.x : s1.y, 30))
      tries.push(
        vertical
          ? [s, s1, { x: a, y: s1.y }, { x: a, y: t1.y }, t1, t]
          : [s, s1, { x: s1.x, y: a }, { x: t1.x, y: a }, t1, t],
      );
  }
  return tries.find((p) => clear(p.slice(1, -1), rects)) ?? tries[0]!;
}

export const toPath = (pts: P[]) =>
  pts
    .filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y)
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

/** Where a label reads best: the middle of the longest segment. */
export function midOfLongest(pts: P[]) {
  let best = { x: pts[0]!.x, y: pts[0]!.y, len: -1 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (len > best.len) best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, len };
  }
  return best;
}
