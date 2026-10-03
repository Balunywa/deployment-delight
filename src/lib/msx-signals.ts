/*
 * What an MSX snapshot says about the account, worked out with fixed rules (no AI): which workloads the account team
 * is driving and how they're going, what's already in production, what needs attention, who the customer contacts
 * are, and which partners are involved. Every item points back to the MSX record it came from.
 *
 * Rules follow how Microsoft field teams read MSX (and the CAIP SSP dashboard): fiscal years run July–June (FY27 =
 * July 2026–June 2027); milestones that are Cancelled, Lost or Hygiene/Duplicate are already left out by the
 * connector; a milestone not updated in 75 days is stale; a committed milestone in the current quarter should be
 * updated weekly.
 */
import type { MsxContact, MsxMilestone, MsxSnapshot } from "./msx-connector";

const DAY = 864e5;
export const STALE_MILESTONE_DAYS = 75;
export const COMMITTED_UPDATE_DAYS = 7;
const SOON_DAYS = 30;
const LIVE_LOOKBACK_DAYS = 730;

/** Microsoft fiscal year and quarter for a date: July 2026 is FY27 Q1. */
export function fiscal(date: string | Date) {
  const d = typeof date === "string" ? new Date(date) : date;
  const m = d.getUTCMonth() + 1;
  const fy = (m >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()) % 100;
  const q = m >= 7 ? (m <= 9 ? 1 : 2) : m <= 3 ? 3 : 4;
  return { fy, q, label: `FY${String(fy).padStart(2, "0")} Q${q}` };
}

export type MilestoneFlag =
  "blocked" | "at-risk" | "overdue" | "stale" | "committed-not-updated" | "due-soon";

const done = (m: MsxMilestone) => m.status === "Completed";
const days = (from: string | null, now: Date) =>
  from ? Math.floor((now.getTime() - new Date(from).getTime()) / DAY) : null;

/** What stands out about one milestone today, most serious first. */
export function milestoneFlags(m: MsxMilestone, now = new Date()): MilestoneFlag[] {
  if (done(m)) return [];
  const flags: MilestoneFlag[] = [];
  if (m.status === "Blocked") flags.push("blocked");
  if (m.status === "At Risk") flags.push("at-risk");
  const until = m.date ? Math.floor((new Date(m.date).getTime() - now.getTime()) / DAY) : null;
  if (until != null && until < 0) flags.push("overdue");
  const age = days(m.modifiedOn, now);
  const thisQuarter = m.date != null && fiscal(m.date).label === fiscal(now).label;
  if (m.commitment === "Committed" && thisQuarter && age != null && age > COMMITTED_UPDATE_DAYS)
    flags.push("committed-not-updated");
  else if (age != null && age > STALE_MILESTONE_DAYS) flags.push("stale");
  if (until != null && until >= 0 && until <= SOON_DAYS) flags.push("due-soon");
  return flags;
}

export const FLAG_LABEL: Record<MilestoneFlag, string> = {
  blocked: "Blocked",
  "at-risk": "At risk",
  overdue: "Past its date",
  stale: "Not updated recently",
  "committed-not-updated": "Committed this quarter, not updated this week",
  "due-soon": "Due within 30 days",
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "no date");
const workloadOf = (m: MsxMilestone) => m.workload?.trim() || "Workload not set";

/** One line about a flagged milestone, in plain words, with the facts it rests on. */
export function flagText(m: MsxMilestone, flags: MilestoneFlag[], now = new Date()) {
  const what = `“${m.name}” (${workloadOf(m)})`;
  const age = days(m.modifiedOn, now);
  const parts: string[] = [];
  if (flags.includes("blocked")) parts.push("is marked Blocked");
  else if (flags.includes("at-risk")) parts.push("is marked At Risk");
  if (flags.includes("overdue")) parts.push(`is past its date (${day(m.date)}) and not completed`);
  if (flags.includes("committed-not-updated"))
    parts.push(`is committed for ${fiscal(m.date!).label} but was last updated ${age} days ago`);
  else if (flags.includes("stale")) parts.push(`hasn't been updated in ${age} days`);
  return `${what} ${parts.join(", and ")}.`;
}

export type WorkloadInMotion = {
  workload: string;
  milestones: MsxMilestone[];
  next: MsxMilestone;
  committed: number;
  flagged: number;
};

export type MsxSignals = {
  industry: string | null;
  country: string | null;
  segment: string | null;
  /** Open milestones by workload, soonest first. */
  inMotion: WorkloadInMotion[];
  /** Workloads with a Production milestone completed in the last two years. */
  live: { workload: string; milestone: MsxMilestone }[];
  attention: { milestone: MsxMilestone; flags: MilestoneFlag[]; text: string }[];
  /** Open milestones dated in the current fiscal quarter. */
  thisQuarter: MsxMilestone[];
  contacts: MsxContact[];
  partners: { partner: string; opportunities: string[] }[];
  /** Open opportunities by the Microsoft team that owns them. */
  ownerTeams: { team: string; count: number }[];
  /** What couldn't be read (null in the snapshot) or isn't in older snapshots. */
  missing: ("milestones" | "contacts" | "partners")[];
};

const SENIORITY: [RegExp, number][] = [
  [/\b(chief|c[eitfdis]o|ciso|cdo|president|founder|owner)\b/i, 6],
  [/\b(evp|svp|vp|vice president)\b/i, 5],
  [/\b(director|head of|general manager|gm)\b/i, 4],
  [/\b(architect|principal|fellow)\b/i, 3],
  [/\b(manager|lead|owner)\b/i, 2],
];
/** Rank a job title so the people most likely to own or decide come first. */
export function seniority(title: string | null) {
  if (!title) return 0;
  for (const [re, score] of SENIORITY) if (re.test(title)) return score;
  return 1;
}

export function msxSignals(s: MsxSnapshot, now = new Date()): MsxSignals {
  const ms = s.milestones ?? [];
  const open = ms.filter((m) => !done(m));
  const byWorkload = new Map<string, MsxMilestone[]>();
  for (const m of open)
    byWorkload.set(workloadOf(m), [...(byWorkload.get(workloadOf(m)) ?? []), m]);
  const time = (m: MsxMilestone) => (m.date ? new Date(m.date).getTime() : Number.MAX_SAFE_INTEGER);
  const inMotion = [...byWorkload.entries()]
    .map(([workload, list]) => {
      const sorted = [...list].sort((a, b) => time(a) - time(b));
      const upcoming = sorted.find((m) => !m.date || new Date(m.date) >= now) ?? sorted.at(-1)!;
      return {
        workload,
        milestones: sorted,
        next: upcoming,
        committed: list.filter((m) => m.commitment === "Committed").length,
        flagged: list.filter((m) => milestoneFlags(m, now).some((f) => f !== "due-soon")).length,
      };
    })
    .sort((a, b) => b.flagged - a.flagged || time(a.next) - time(b.next));

  const liveMap = new Map<string, MsxMilestone>();
  for (const m of ms)
    if (
      done(m) &&
      m.category === "Production" &&
      m.date &&
      now.getTime() - new Date(m.date).getTime() <= LIVE_LOOKBACK_DAYS * DAY
    ) {
      const prev = liveMap.get(workloadOf(m));
      if (!prev || time(m) > time(prev)) liveMap.set(workloadOf(m), m);
    }
  const live = [...liveMap.entries()]
    .map(([workload, milestone]) => ({ workload, milestone }))
    .sort((a, b) => time(b.milestone) - time(a.milestone));

  const rank: Record<MilestoneFlag, number> = {
    blocked: 0,
    "at-risk": 1,
    overdue: 2,
    "committed-not-updated": 3,
    stale: 4,
    "due-soon": 5,
  };
  const attention = open
    .map((m) => ({ milestone: m, flags: milestoneFlags(m, now).filter((f) => f !== "due-soon") }))
    .filter((a) => a.flags.length)
    .sort((a, b) => rank[a.flags[0]!] - rank[b.flags[0]!] || time(a.milestone) - time(b.milestone))
    .map((a) => ({ ...a, text: flagText(a.milestone, a.flags, now) }));

  const quarter = fiscal(now).label;
  const thisQuarter = open
    .filter((m) => m.date && fiscal(m.date).label === quarter)
    .sort((a, b) => time(a) - time(b));

  const contacts = [...(s.contacts ?? [])].sort(
    (a, b) => seniority(b.title) - seniority(a.title) || a.name.localeCompare(b.name),
  );

  const oppName = new Map(s.opportunities.map((o) => [o.id, o.name]));
  const byPartner = new Map<string, Set<string>>();
  for (const p of s.partners ?? []) {
    if (!p.partner) continue;
    const set = byPartner.get(p.partner) ?? new Set<string>();
    const name = p.opportunityId ? oppName.get(p.opportunityId) : null;
    if (name) set.add(name);
    byPartner.set(p.partner, set);
  }
  const partners = [...byPartner.entries()].map(([partner, opps]) => ({
    partner,
    opportunities: [...opps],
  }));

  const teams = new Map<string, number>();
  for (const o of s.opportunities)
    if (o.ownerTeam) teams.set(o.ownerTeam, (teams.get(o.ownerTeam) ?? 0) + 1);

  return {
    industry: s.account?.industry ?? null,
    country: s.account?.country ?? null,
    segment: s.account?.segment ?? null,
    inMotion,
    live,
    attention,
    thisQuarter,
    contacts,
    partners,
    ownerTeams: [...teams.entries()]
      .map(([team, count]) => ({ team, count }))
      .sort((a, b) => b.count - a.count),
    missing: (["milestones", "contacts", "partners"] as const).filter((k) => s[k] == null),
  };
}

export const TEAM_LABEL: Record<string, string> = {
  ATU: "account team (ATU)",
  STU: "specialists (STU)",
  CSU: "customer success (CSU)",
  Other: "other teams",
};

/** A milestone's facts in one short line: status, category, commitment, quarter and date, owner. */
export function milestoneFacts(m: MsxMilestone) {
  return [
    m.status,
    m.category,
    m.commitment,
    m.date && `${fiscal(m.date).label} (${day(m.date)})`,
    m.owner && `owner ${m.owner}${m.ownerTeam ? `, ${m.ownerTeam}` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
