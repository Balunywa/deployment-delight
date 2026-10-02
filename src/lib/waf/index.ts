/*
 * Well-Architected review computed from the design: every recommendation for every service in it, plus the
 * workload-level ones, checked against the actual settings, topology and requirements. Scored per pillar, with
 * fixes that can be applied to the design in one click.
 */
import type { Architecture } from "../architecture";
import { SERVICE_BY_ID, type Selected, normalise } from "../catalog";

import { PILLAR_GUIDES } from "./pillars";
import { AI_GUIDES } from "./services/ai";
import { COMPUTE_GUIDES } from "./services/compute";
import { DATA_GUIDES } from "./services/data";
import { NETWORKING_GUIDES } from "./services/networking";
import { PLATFORM_GUIDES } from "./services/platform";
import {
  DEFAULT_WORKLOAD,
  type Pillar,
  PILLARS,
  type WafContext,
  type WafFix,
  type WafRec,
  type WafResult,
  type WafServiceGuide,
  type Workload,
} from "./types";
import { WORKLOAD_RECS } from "./workload";

export { PILLARS, PILLAR_GUIDES, DEFAULT_WORKLOAD };
export type { Pillar, WafRec, WafServiceGuide, Workload, WafFix };

/** A colour per pillar, used consistently in scorecards, tags and guides. */
export const PILLAR_TONE: Record<Pillar, string> = {
  reliability: "#3b82f6",
  security: "#ef4444",
  cost: "#22c55e",
  operations: "#a855f7",
  performance: "#f59e0b",
};

export const SERVICE_GUIDES: WafServiceGuide[] = [
  ...COMPUTE_GUIDES,
  ...NETWORKING_GUIDES,
  ...DATA_GUIDES,
  ...AI_GUIDES,
  ...PLATFORM_GUIDES,
];
export const GUIDE_BY_SERVICE = new Map(SERVICE_GUIDES.map((g) => [g.service, g]));

export type Finding = {
  rec: WafRec;
  /** The service it's about; absent for the workload as a whole. */
  service?: string | undefined;
  result: WafResult | "advice";
  detail: string;
  fix?: WafFix | undefined;
};

export type PillarScore = {
  pillar: Pillar;
  /** 0–100, or null when nothing in the design is checked for this pillar. */
  score: number | null;
  pass: number;
  warn: number;
  fail: number;
  advice: number;
};

export type Review = {
  workload: Workload;
  findings: Finding[];
  pillars: PillarScore[];
  /** Mean of the pillar scores that have one. */
  overall: number | null;
};

function context(arch: Architecture, workload: Workload, svc: Selected | undefined): WafContext {
  const byId = new Map(arch.selected.map((s) => [s.id, s]));
  return {
    svc,
    selected: arch.selected,
    topology: arch.topology,
    workload,
    has: (id) => byId.has(id),
    setting: (id, key) => byId.get(id)?.settings[key],
  };
}

function judge(rec: WafRec, ctx: WafContext, service?: string): Finding {
  if (!rec.check) return { rec, service, result: "advice", detail: rec.why };
  try {
    const r = rec.check(ctx);
    return { rec, service, result: r.result, detail: r.detail, fix: r.fix };
  } catch {
    // A check that can't evaluate this design is shown as advice rather than breaking the review.
    return { rec, service, result: "advice", detail: rec.why };
  }
}

/** The Well-Architected review of a design. */
export function review(arch: Architecture): Review {
  const workload = arch.workload ?? DEFAULT_WORKLOAD;
  const findings: Finding[] = [];
  for (const s of arch.selected) {
    const guide = GUIDE_BY_SERVICE.get(s.id);
    if (!guide) continue;
    const ctx = context(arch, workload, s);
    for (const rec of guide.recs) findings.push(judge(rec, ctx, s.id));
  }
  const wctx = context(arch, workload, undefined);
  for (const rec of WORKLOAD_RECS) findings.push(judge(rec, wctx));
  const pillars = PILLARS.map((p): PillarScore => {
    const mine = findings.filter((f) => f.rec.pillar === p.id);
    const count = (r: Finding["result"]) => mine.filter((f) => f.result === r).length;
    const pass = count("pass");
    const warn = count("warn");
    const fail = count("fail");
    const scored = pass + warn + fail;
    return {
      pillar: p.id,
      score: scored ? Math.round((100 * (pass + warn * 0.5)) / scored) : null,
      pass,
      warn,
      fail,
      advice: count("advice"),
    };
  });
  const scores = pillars.map((p) => p.score).filter((x): x is number => x !== null);
  return {
    workload,
    findings,
    pillars,
    overall: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  };
}

/** Apply a fix to the design: settings on a service, services to add, topology changes. */
export function applyFix(arch: Architecture, fix: WafFix, service?: string): Architecture {
  let selected = arch.selected.map((s) =>
    service && s.id === service && fix.settings
      ? { ...s, settings: { ...s.settings, ...fix.settings } }
      : s,
  );
  for (const id of fix.add ?? []) {
    const def = SERVICE_BY_ID.get(id);
    if (!def || selected.some((s) => s.id === id)) continue;
    selected.push({
      id,
      settings: Object.fromEntries(def.options.map((o) => [o.key, o.default])),
    });
  }
  const topology = { ...arch.topology, ...(fix.topology ?? {}) };
  selected = normalise(selected, topology);
  return { ...arch, selected, topology };
}

/** What a change does to the review: findings that newly fail or warn, and those it clears. */
export function reviewDelta(before: Architecture, after: Architecture) {
  const key = (f: Finding) => `${f.service ?? "workload"}:${f.rec.id}`;
  const a = new Map(review(before).findings.map((f) => [key(f), f]));
  const b = review(after).findings;
  const worse: Finding[] = [];
  const better: Finding[] = [];
  const rank = { pass: 0, na: 0, advice: 0, warn: 1, fail: 2 } as const;
  for (const f of b) {
    const prev = a.get(key(f));
    const now = rank[f.result];
    const was = prev ? rank[prev.result] : 0;
    if (now > was) worse.push(f);
    else if (now < was) better.push(f);
  }
  return { worse, better };
}
