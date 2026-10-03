/*
 * The engagement workspace, pure: what an SE/CSA works on from the first look at a customer to production. One record
 * carries it all: the evidence brief (facts, interpretations and unknowns, each with its source and whether the
 * customer confirmed it), the point of view, call plans, what each meeting confirmed, the engagement charter, the
 * validation plan, the Technical Close Plan and the handoff. Rules here only arrange and quote what's stored; they
 * never invent customer facts, numbers or intent.
 */
import type { Action, Engagement, Finding } from "./engagements";
import type { MsxSnapshot } from "./msx-connector";
import {
  ENGAGEMENT_TYPES,
  type EngagementType,
  HANDOFF_CRITERIA,
  PURPOSES,
  type Purpose,
  RESOURCES,
  type Resource,
} from "./playbook";
import type { MatchedArea, Prep, Quote } from "./prep";

/* ----------------------------------------------------------------------------------------- evidence */

export type EvidenceStatus = "confirmed" | "needs-validation" | "contradicted" | "unknown";
export type ClaimKind = "fact" | "interpretation" | "hypothesis";
export type BriefSection = "priorities" | "relationship" | "technical" | "stakeholders" | "risks";

export const BRIEF_SECTIONS: { key: BriefSection; title: string; hint: string }[] = [
  {
    key: "priorities",
    title: "Business priorities and why now",
    hint: "What they want to achieve, and what makes it urgent.",
  },
  {
    key: "relationship",
    title: "Microsoft relationship and opportunities",
    hint: "Where the request came from, open opportunities, earlier work.",
  },
  {
    key: "technical",
    title: "Technical environment",
    hint: "What runs today, what's mentioned, modernization maturity.",
  },
  {
    key: "stakeholders",
    title: "Stakeholders and decision process",
    hint: "Who owns it, who decides, competing priorities.",
  },
  {
    key: "risks",
    title: "Risks, blockers and open questions",
    hint: "What we don't know, and what conflicts.",
  },
];

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  confirmed: "Customer confirmed",
  "needs-validation": "Needs validation",
  contradicted: "Contradicted",
  unknown: "Unknown",
};
export const KIND_LABEL: Record<ClaimKind, string> = {
  fact: "Documented",
  interpretation: "Our interpretation",
  hypothesis: "Hypothesis",
};

export type BriefItem = {
  id: string;
  section: BriefSection;
  text: string;
  kind: ClaimKind;
  status: EvidenceStatus;
  source: {
    label: string;
    date: string | null;
    retrieved: string | null;
    url?: string | undefined;
  };
  origin: "msx" | "context" | "engineer" | "derived";
  note?: string | undefined;
  /** When the SE last set its status. */
  marked?: { by: string; at: string } | undefined;
};

export type EvidenceMark = {
  status: EvidenceStatus;
  note?: string | undefined;
  by: string;
  at: string;
  history?: { status: EvidenceStatus; note?: string | undefined; by: string; at: string }[];
};
export type ManualItem = {
  id: string;
  section: BriefSection;
  text: string;
  kind: ClaimKind;
  status: EvidenceStatus;
  source: string;
  by: string;
  at: string;
};
/** Stored on the customer: the SE's marks on derived items, and items the SE added. */
export type EvidenceStore = { marks?: Record<string, EvidenceMark>; items?: ManualItem[] };

/** A short, stable ID for a derived item, so a mark survives a refresh when the text is unchanged. */
export function itemId(section: string, text: string) {
  let h = 5381;
  for (const c of `${section}|${text.trim().toLowerCase()}`)
    h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return `${section.slice(0, 3)}-${(h >>> 0).toString(36)}`;
}

const fromQuote = (
  section: BriefSection,
  q: Quote,
  kind: ClaimKind = q.origin === "brief" ? "interpretation" : "fact",
): Omit<BriefItem, "status"> => ({
  id: itemId(section, q.text),
  section,
  text: q.text,
  kind,
  source: { label: q.from, date: q.at ?? null, retrieved: q.retrieved ?? null },
  origin: q.origin === "msx" ? "msx" : "context",
});

/** The customer brief: derived from MSX and added context, with the SE's marks and own items applied. */
export function briefItems(input: {
  prep: Prep;
  evidence: EvidenceStore;
  engagements: { id: string; name: string; stage: string; status?: string }[];
  installs?: { name: string; environment_type: string; offering_name: string }[];
  foundation?: { name: string; status: string } | null;
}): BriefItem[] {
  const { prep: p } = input;
  const derived: Omit<BriefItem, "status">[] = [];
  const seen = new Set<string>();
  const add = (i: Omit<BriefItem, "status">) => {
    if (seen.has(i.id)) return;
    seen.add(i.id);
    derived.push(i);
  };

  for (const q of p.goals) add(fromQuote("priorities", q));
  for (const q of p.whyNow) add(fromQuote("priorities", q));

  for (const q of p.origin) add(fromQuote("relationship", q));
  if (p.account.accounts != null)
    add({
      id: itemId("relationship", `accounts:${p.account.name}`),
      section: "relationship",
      text: `${p.account.name ?? "The account"} has ${p.account.accounts} active MSX account${p.account.accounts === 1 ? "" : "s"} under the TPID.`,
      kind: "fact",
      source: { label: "MSX", date: null, retrieved: p.account.fetchedAt },
      origin: "msx",
    });
  for (const e of input.engagements)
    add({
      id: itemId("relationship", `engagement:${e.id}`),
      section: "relationship",
      text: `Earlier or parallel engagement: ${e.name} (${e.status === "draft" ? "preparing" : e.stage}).`,
      kind: "fact",
      source: { label: "Cloud Delivery", date: null, retrieved: null },
      origin: "derived",
    });

  for (const a of p.areas)
    add({
      id: itemId("technical", `area:${a.id}`),
      section: "technical",
      text: `${a.label}: the context mentions ${a.matched.join(", ")}.`,
      kind: "interpretation",
      source: { label: "Read from MSX and notes", date: null, retrieved: null },
      origin: "derived",
    });
  for (const i of input.installs ?? [])
    add({
      id: itemId("technical", `install:${i.name}:${i.offering_name}`),
      section: "technical",
      text: `Runs ${i.offering_name} (${i.environment_type}) through Cloud Delivery: ${i.name}.`,
      kind: "fact",
      source: { label: "Cloud Delivery", date: null, retrieved: null },
      origin: "derived",
    });
  if (input.foundation)
    add({
      id: itemId("technical", `foundation:${input.foundation.name}`),
      section: "technical",
      text: `Has an Azure landing zone in Cloud Delivery: ${input.foundation.name} (${input.foundation.status}).`,
      kind: "fact",
      source: { label: "Cloud Delivery", date: null, retrieved: null },
      origin: "derived",
    });

  for (const q of p.people) add(fromQuote("stakeholders", q));

  for (const g of p.gaps)
    add({
      id: itemId("risks", g),
      section: "risks",
      text: g,
      kind: "interpretation",
      source: { label: "Gap in what we hold", date: null, retrieved: null },
      origin: "derived",
    });

  const marks = input.evidence.marks ?? {};
  const out: BriefItem[] = derived.map((d) => {
    const m = marks[d.id];
    const fallback: EvidenceStatus = d.section === "risks" ? "unknown" : "needs-validation";
    return {
      ...d,
      status: m?.status ?? fallback,
      note: m?.note,
      marked: m ? { by: m.by, at: m.at } : undefined,
    };
  });
  for (const m of input.evidence.items ?? [])
    out.push({
      id: m.id,
      section: m.section,
      text: m.text,
      kind: m.kind,
      status: marks[m.id]?.status ?? m.status,
      note: marks[m.id]?.note,
      source: { label: m.source || `Added by ${m.by}`, date: m.at, retrieved: null },
      origin: "engineer",
      marked: marks[m.id] ? { by: marks[m.id]!.by, at: marks[m.id]!.at } : undefined,
    });
  return out;
}

/** Days since the MSX snapshot, or null when there isn't one. */
export const snapshotAge = (fetchedAt: string | null) =>
  fetchedAt ? Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 864e5) : null;
export const STALE_DAYS = 14;

/** What changed in MSX between two snapshots, in plain words. */
export function snapshotChanges(prev: MsxSnapshot | null | undefined, next: MsxSnapshot): string[] {
  if (!prev) return [];
  const out: string[] = [];
  if (prev.account?.name !== next.account?.name && next.account)
    out.push(`Account name is now ${next.account.name}.`);
  const before = new Map(prev.opportunities.map((o) => [o.id, o]));
  const after = new Map(next.opportunities.map((o) => [o.id, o]));
  for (const o of next.opportunities) {
    const b = before.get(o.id);
    if (!b) out.push(`New open opportunity: ${o.name}.`);
    else {
      if ((b.stage ?? "") !== (o.stage ?? ""))
        out.push(`${o.name}: stage ${b.stage ?? "none"} → ${o.stage ?? "none"}.`);
      if ((b.closeDate ?? "").slice(0, 10) !== (o.closeDate ?? "").slice(0, 10))
        out.push(
          `${o.name}: estimated close ${(b.closeDate ?? "none").slice(0, 10)} → ${(o.closeDate ?? "none").slice(0, 10)}.`,
        );
      if ((b.description ?? "") !== (o.description ?? ""))
        out.push(`${o.name}: the description changed.`);
      if ((b.owner ?? "") !== (o.owner ?? ""))
        out.push(`${o.name}: owner is now ${o.owner ?? "nobody"}.`);
    }
  }
  for (const o of prev.opportunities) if (!after.has(o.id)) out.push(`No longer open: ${o.name}.`);
  return out;
}

/* ------------------------------------------------------------------------------------ point of view */

export type AssumptionStatus = "open" | "confirmed" | "revised" | "rejected";
export type Assumption = {
  id: string;
  text: string;
  status: AssumptionStatus;
  /** What the customer said, when it was tested. */
  quote?: string | undefined;
  /** The corrected version, when revised. */
  revisedTo?: string | undefined;
  /** The call plan (meeting) it was tested in. */
  meeting?: string | undefined;
};
export type PathOption = {
  id: string;
  title: string;
  outcome: string;
  prerequisites: string;
  implications: string;
  risks: string;
  evidenceNeeded: string;
  /** Keeping today's approach. */
  current?: boolean | undefined;
};
export type Pov = {
  pressure: string;
  stakeholders: string;
  consequence: string;
  technical: string;
  /** Brief item IDs that support it. */
  evidence: string[];
  assumptions: Assumption[];
  disprove: string;
  invite: string;
  opening: string;
  paths: PathOption[];
};
export type PovRevision = { at: string; by: string; reason: string; pov: Pov };

export const emptyPov = (): Pov => ({
  pressure: "",
  stakeholders: "",
  consequence: "",
  technical: "",
  evidence: [],
  assumptions: [],
  disprove: "",
  invite: "",
  opening: "",
  paths: [],
});

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => {
  const t = s.trim();
  return t && !/[.!?]$/.test(t) ? `${t}.` : t;
};

/** The opening line, from what the SE wrote. Labelled a working hypothesis; adds nothing that isn't there. */
export function composeOpening(p: Pov) {
  // Spoken to the customer: "Customer wants…" becomes "you want…".
  const pressure = p.pressure
    .trim()
    .replace(/^(?:the )?customer (want|need)s?\b/i, "you $1")
    .replace(/[.!?]$/, "");
  const parts = [
    pressure && sentence(`From what we've seen, ${lowerFirst(pressure)}`),
    p.consequence &&
      sentence(`If that's right, ${lowerFirst(p.consequence.replace(/[.!?]$/, ""))}`),
    p.technical &&
      sentence(`On the technical side, ${lowerFirst(p.technical.replace(/[.!?]$/, ""))}`),
  ].filter(Boolean);
  if (!parts.length) return "";
  return `${parts.join(" ")} ${p.invite.trim() || "What are we missing?"}`;
}

/** "We understand Azure Local, Oracle and AKS are in the picture." Something you can say to a customer. */
function inThePicture(areas: MatchedArea[]) {
  const terms = [...new Set(areas.slice(0, 3).map((a) => a.matched[0]!))];
  if (!terms.length) return "";
  const list =
    terms.length === 1 ? terms[0]! : `${terms.slice(0, -1).join(", ")} and ${terms.at(-1)!}`;
  return `We understand ${list} ${terms.length === 1 ? "is" : "are"} in the picture.`;
}

/** A first draft from the evidence: quotes, not conclusions. Every field stays editable. */
export function draftPov(prep: Prep, items: BriefItem[]): Pov {
  const byText = (t: string | undefined) => (t ? items.find((i) => i.text === t)?.id : undefined);
  const goalQ = prep.goals[0];
  const whyQ = prep.whyNow.find((q) => q.text !== goalQ?.text);
  const pressure = [goalQ?.text, whyQ?.text].filter(Boolean).join(" ");
  const top: MatchedArea | undefined = prep.areas[0];
  const assumptions: Assumption[] = [];
  const goal = prep.goals[0];
  if (goal)
    assumptions.push({
      id: uid("as"),
      text: `The goal as written still holds: "${goal.text.replace(/[.!?]$/, "")}"`,
      status: "open",
    });
  if (prep.origin.length)
    assumptions.push({
      id: uid("as"),
      text: "The MSX opportunity reflects what they want now, not only what was sold before.",
      status: "open",
    });
  if (top)
    assumptions.push({
      id: uid("as"),
      text: `The decision includes ${top.label.replace(/ \(.*\)$/, "")}, not as a side topic.`,
      status: "open",
    });
  if (!prep.people.length)
    assumptions.push({
      id: uid("as"),
      text: "The owner of the outcome and the decision maker are known.",
      status: "open",
    });

  const paths: PathOption[] = [
    {
      id: uid("pa"),
      title: "Keep today's approach and fix the biggest pain",
      outcome: "Least change; shows whether the problem is process or platform.",
      prerequisites: "Know what fails today, how often, and why.",
      implications: "No migration; existing skills and support stay.",
      risks: "May not meet the outcome if the platform is the constraint.",
      evidenceNeeded: "Where today's approach breaks, and what that costs them.",
      current: true,
    },
  ];
  if (!prep.goals.length || !prep.whyNow.length || !top)
    paths.push({
      id: uid("pa"),
      title: "Focused discovery or assessment first",
      outcome: "Enough evidence to choose a direction with the customer.",
      prerequisites: "Time with the owner and the people who run it today.",
      implications: "Delays design by days, not months.",
      risks: "Feels slow if they expected a proposal.",
      evidenceNeeded: "The outcome, why now, and the hard constraints.",
    });
  if (top)
    paths.push({
      id: uid("pa"),
      title: `Explore ${top.label.replace(/ \(.*\)$/, "")}`,
      outcome: "",
      prerequisites: "",
      implications:
        "Integration, security, operations and adoption to be worked through with them.",
      risks: "",
      evidenceNeeded: top.ask[0] ?? "",
    });

  const pov: Pov = {
    pressure,
    stakeholders: prep.people.map((q) => q.text).join(" "),
    consequence: "",
    technical: inThePicture(prep.areas),
    evidence: [
      byText(goalQ?.text),
      byText(whyQ?.text),
      ...prep.people.map((q) => byText(q.text)),
    ].filter((x): x is string => !!x),
    assumptions,
    disprove: "",
    invite: "Here's how we see it. What are we missing?",
    opening: "",
    paths: paths.slice(0, 3),
  };
  return { ...pov, opening: composeOpening(pov) };
}

/** Material claims in the POV that have no evidence linked: shown as hypotheses. */
export function unsupported(p: Pov) {
  const out: string[] = [];
  if (p.pressure && !p.evidence.length) out.push("The pressure has no evidence linked.");
  if (p.consequence) out.push("The consequence is our interpretation until the customer says it.");
  return out;
}

/* ---------------------------------------------------------------------------------------- call plans */

export type PlanQuestion = {
  id: string;
  text: string;
  why: string;
  source: "pov" | "assumption" | "playbook" | "area" | "own";
  /** The assumption it tests, when it tests one. */
  assumption?: string | undefined;
};
export type Attendee = {
  id: string;
  name: string;
  role: string;
  priorities: string;
  /** Priorities we inferred rather than heard. */
  inferred: boolean;
};
export type CallPlan = {
  id: string;
  title: string;
  purpose: Purpose;
  duration: number;
  date: string;
  outcome: string;
  audience: Attendee[];
  opening: string;
  questions: PlanQuestion[];
  followUps: { text: string; because: string }[];
  listenFor: string[];
  objections: { text: string; explore: string }[];
  constraints: string[];
  nextStep: string;
  participants: string;
  agenda: { minutes: number; item: string }[];
  /** During the meeting. */
  notes: string;
  answers: Record<string, string>;
  agreedNext: string;
  held: { at: string } | null;
  /** After the meeting. */
  review: MeetingReview | null;
};
export type MeetingReview = {
  need: string;
  options: { id: string; text: string; tradeoff: string }[];
  decisions: { id: string; text: string; status: "decided" | "open" }[];
  missing: string;
  at: string;
  by: string;
};

export function agendaFor(purpose: Purpose, duration: number) {
  const rows = PURPOSES[purpose].agenda.map(([share, item]) => ({
    item,
    minutes: Math.max(5, Math.round((share * duration) / 5) * 5),
  }));
  const diff = duration - rows.reduce((s, r) => s + r.minutes, 0);
  const biggest = rows.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  biggest.minutes = Math.max(5, biggest.minutes + diff);
  return rows;
}

/** A call plan for this customer and purpose, from the POV, the playbook and what the context mentions. */
export function buildPlan(input: {
  purpose: Purpose;
  duration: number;
  pov: Pov;
  prep: Prep;
  customer: string;
  audience?: Attendee[];
}): CallPlan {
  const g = PURPOSES[input.purpose];
  const { pov, prep } = input;
  const questions: PlanQuestion[] = [];
  const seen = new Set<string>();
  const push = (q: Omit<PlanQuestion, "id">) => {
    const k = q.text.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    questions.push({ ...q, id: uid("q") });
  };
  if (pov.invite.trim())
    push({
      text: pov.invite.trim(),
      why: "Invites them to correct our point of view.",
      source: "pov",
    });
  for (const a of pov.assumptions.filter((x) => x.status === "open").slice(0, 3))
    push({
      text: `We understand that ${lowerFirst(a.text.replace(/[.!?]$/, ""))}. Is that right?`,
      why: "Tests an assumption in our point of view.",
      source: "assumption",
      assumption: a.id,
    });
  for (const q of g.questions.slice(0, 3)) push({ ...q, source: "playbook" });
  for (const a of prep.areas.slice(0, 2))
    if (a.ask[0])
      push({
        text: a.ask[0],
        why: `The context mentions ${a.matched.join(", ")}.`,
        source: "area",
      });
  for (const q of g.questions.slice(3)) push({ ...q, source: "playbook" });

  const followUps: CallPlan["followUps"] = [];
  if (pov.disprove.trim())
    followUps.push({
      text: `Listen for anything that suggests: ${pov.disprove.trim()}`,
      because: "What would disprove our point of view.",
    });
  for (const gap of prep.gaps) {
    if (/why now/i.test(gap))
      followUps.push({ text: "If this waited a year, what would it cost?", because: gap });
    else if (/wants to achieve/i.test(gap))
      followUps.push({ text: "How would you measure success?", because: gap });
    else if (/sponsor|decision maker/i.test(gap))
      followUps.push({
        text: "Who else needs to agree, and what do they care about?",
        because: gap,
      });
    else if (/no description/i.test(gap))
      followUps.push({ text: "How did this request start, and who raised it?", because: gap });
  }

  return {
    id: uid("plan"),
    title: `${g.label} with ${input.customer}`,
    purpose: input.purpose,
    duration: input.duration,
    date: "",
    outcome: g.aim,
    audience: input.audience ?? [],
    opening: pov.opening || composeOpening(pov),
    questions: questions.slice(0, 9),
    followUps,
    listenFor: [...g.listenFor],
    objections: [...g.objections],
    constraints: prep.areas.slice(0, 3).map((a) => `${a.label}: ${a.ask[a.ask.length - 1]}`),
    nextStep: g.nextStep,
    participants: g.participants,
    agenda: agendaFor(input.purpose, input.duration),
    notes: "",
    answers: {},
    agreedNext: "",
    held: null,
    review: null,
  };
}

export type RankedResource = Resource & { essential: boolean };

/** Preparation resources for this meeting: essential first, each with why it helps. */
export function resourcesFor(purpose: Purpose, areas: MatchedArea[]): RankedResource[] {
  const technical: RankedResource[] = areas.slice(0, 3).flatMap((a) =>
    a.review.map((r) => ({
      title: r.title,
      url: r.url,
      kind: "technical" as const,
      why: `Technical depth on ${a.label}, which the context mentions.`,
      essentialFor: [],
      essential: ["architecture", "workshop", "poc"].includes(purpose),
    })),
  );
  const listed = RESOURCES.map((r) => ({ ...r, essential: r.essentialFor.includes(purpose) }));
  return [...listed, ...technical].sort((a, b) => Number(b.essential) - Number(a.essential));
}

/* ------------------------------------------------------------------- charter, validation, handoff */

export type Charter = {
  outcome: string;
  objective: string;
  scope: string;
  exclusions: string;
  type: EngagementType;
  owner: string;
  roles: { se: string; csa: string; ssp: string; other: string };
  sponsor: string;
  technicalContact: string;
  success: { id: string; criterion: string; evidence: string }[];
  targetDate: string;
  dependencies: string;
  risks: string;
  resources: string;
  firstActivity: string;
  nextDecision: { what: string; when: string };
  /** The MSX milestone it's tracked under (reference only; MSX is never changed from here). */
  milestone: string;
};

export const emptyCharter = (): Charter => ({
  outcome: "",
  objective: "",
  scope: "",
  exclusions: "",
  type: "discovery",
  owner: "",
  roles: { se: "", csa: "", ssp: "", other: "" },
  sponsor: "",
  technicalContact: "",
  success: [],
  targetDate: "",
  dependencies: "",
  risks: "",
  resources: "",
  firstActivity: "",
  nextDecision: { what: "", when: "" },
  milestone: "",
});

export type Poc = {
  decision: string;
  hypotheses: string[];
  passFail: { id: string; criterion: string; threshold: string }[];
  environment: string;
  data: string;
  duration: string;
  resources: string;
  production: string;
  exitDecision: string;
  nextOwner: string;
};
export const emptyPoc = (): Poc => ({
  decision: "",
  hypotheses: [],
  passFail: [],
  environment: "",
  data: "",
  duration: "",
  resources: "",
  production: "",
  exitDecision: "",
  nextOwner: "",
});

export type Handoff = {
  routing: "" | "unified" | "non-unified";
  discussed: { at: string; note: string } | null;
  criteria: Partial<Record<(typeof HANDOFF_CRITERIA)[number]["id"], boolean>>;
  receivingOwner: string;
  receivingTeam: string;
  transferred: { architecture: boolean; risks: boolean };
  notes: string;
  accepted: { by: string; recordedBy: string; at: string; note: string } | null;
};
export const emptyHandoff = (): Handoff => ({
  routing: "",
  discussed: null,
  criteria: {},
  receivingOwner: "",
  receivingTeam: "",
  transferred: { architecture: false, risks: false },
  notes: "",
  accepted: null,
});

export type Tcp = {
  on: boolean;
  milestone: string;
  productionDate: string;
  workload: string;
  architecture: string;
  deploymentPath: string;
  supportModel: string;
  acceptance: string;
  risks: { id: string; text: string; owner: string; mitigation: string }[];
  updatedAt: string;
};
export const emptyTcp = (): Tcp => ({
  on: false,
  milestone: "",
  productionDate: "",
  workload: "",
  architecture: "",
  deploymentPath: "",
  supportModel: "",
  acceptance: "",
  risks: [],
  updatedAt: "",
});

export type Workspace = {
  pov?: Pov;
  povHistory?: PovRevision[];
  plans?: CallPlan[];
  charter?: Charter;
  poc?: Poc;
  handoff?: Handoff;
  tcp?: Tcp;
  playbook?: string;
};

export type WorkspaceEngagement = Engagement & {
  status: "draft" | "active";
  workspace: Workspace;
};

/* ------------------------------------------------------------------------------- phase and readiness */

export type Phase = "preparing" | "discovery" | "validation" | "handoff" | "delivery" | "closed";
export const PHASES: { key: Phase; title: string; sub: string }[] = [
  { key: "preparing", title: "Preparing", sub: "Not started with the customer" },
  { key: "discovery", title: "Discovery", sub: "Testing the point of view" },
  { key: "validation", title: "Validation", sub: "Proving it against agreed criteria" },
  { key: "handoff", title: "Handoff", sub: "Receiving team reviews and accepts" },
  { key: "delivery", title: "Delivery and value", sub: "In production, measured" },
  { key: "closed", title: "Closed", sub: "Decided or realized" },
];

export function phaseOf(e: WorkspaceEngagement): Phase {
  if (e.status === "draft") return "preparing";
  if (e.realization?.confirmed || (e.stage === "decided" && e.decision?.choice !== "scale"))
    return "closed";
  if (e.stage === "realize") return "delivery";
  const h = e.workspace.handoff;
  if (h && (h.discussed || h.receivingOwner) && !h.accepted) return "handoff";
  if (e.stage === "prove") return "validation";
  return "discovery";
}

export type Tab =
  | "overview"
  | "context"
  | "pov"
  | "plan"
  | "meeting"
  | "findings"
  | "charter"
  | "prove"
  | "handoff"
  | "realize"
  | "recap"
  | "conversation"
  | "fit";

export type Check = { id: string; label: string; ok: boolean; fix: Tab; hint: string };

export const TAB_TITLE: Record<Tab, string> = {
  overview: "Overview",
  context: "Context",
  pov: "Point of view",
  plan: "Call plan",
  meeting: "Meeting",
  findings: "Findings",
  charter: "Engagement plan",
  prove: "Validate",
  handoff: "Handoff",
  realize: "Realize value",
  recap: "Customer recap",
  conversation: "Question bank",
  fit: "Fit & gap",
};
export type Readiness = { discovery: Check[]; validation: Check[]; handoff: Check[] };

export function readinessOf(e: WorkspaceEngagement): Readiness {
  const w = e.workspace;
  const pov = w.pov;
  const plan = (w.plans ?? []).find((p) => !p.held) ?? (w.plans ?? []).at(-1);
  const c = w.charter;
  const h = w.handoff;
  const confirmedFinding =
    e.findings.some((f) => f.kind === "confirmed") ||
    !!pov?.assumptions.some((a) => a.status === "confirmed" || a.status === "revised");
  return {
    discovery: [
      {
        id: "customer",
        label: "Confirmed customer",
        ok: !!e.customer_id,
        fix: "context",
        hint: "Resolve the customer by TPID.",
      },
      {
        id: "purpose",
        label: "Conversation purpose",
        ok: !!plan,
        fix: "plan",
        hint: "Choose what the next meeting is for.",
      },
      {
        id: "pov",
        label: "Initial point of view",
        ok: !!(pov && (pov.pressure.trim() || pov.opening.trim())),
        fix: "pov",
        hint: "Write the working hypothesis.",
      },
      {
        id: "questions",
        label: "Explicit questions",
        ok: (plan?.questions.length ?? 0) >= 2,
        fix: "plan",
        hint: "At least two questions to ask.",
      },
    ],
    validation: [
      {
        id: "problem",
        label: "Agreed problem",
        ok: confirmedFinding,
        fix: "findings",
        hint: "The customer confirmed at least part of the point of view.",
      },
      {
        id: "scope",
        label: "Bounded scope",
        ok: !!(c?.scope.trim() && c.exclusions.trim()),
        fix: "charter",
        hint: "Scope and explicit exclusions.",
      },
      {
        id: "criteria",
        label: "Decision criteria",
        ok: !!c?.success.some((s) => s.criterion.trim() && s.evidence.trim()),
        fix: "charter",
        hint: "Success criteria with how the evidence is collected.",
      },
      {
        id: "resources",
        label: "Required resources",
        ok: !!c?.resources.trim(),
        fix: "charter",
        hint: "People, environment and time it needs.",
      },
    ],
    handoff: [
      {
        id: "outcome",
        label: "Confirmed outcome",
        ok: !!(c?.outcome.trim() && h?.criteria.outcome),
        fix: "handoff",
        hint: "The customer confirmed the outcome.",
      },
      {
        id: "milestone",
        label: "Milestone details",
        ok: !!(c?.milestone.trim() || e.msx_opportunity_id) && !!h?.criteria.milestone,
        fix: "handoff",
        hint: "The MSX opportunity and milestone, complete in MSX.",
      },
      {
        id: "budget",
        label: "Resources and budget",
        ok: !!h?.criteria.resources,
        fix: "handoff",
        hint: "Confirmed with the customer and our side.",
      },
      {
        id: "contact",
        label: "Customer contact",
        ok: !!c?.technicalContact.trim(),
        fix: "charter",
        hint: "A named technical contact.",
      },
      {
        id: "accepted",
        label: "Receiving team accepted",
        ok: !!h?.accepted,
        fix: "handoff",
        hint: "The receiving owner reviewed and accepted ownership.",
      },
    ],
  };
}

export const allOk = (checks: Check[]) => checks.every((c) => c.ok);

/** The one thing to do next, and where. */
export function nextAction(e: WorkspaceEngagement): { label: string; tab: Tab; why: string } {
  const w = e.workspace;
  const plans = w.plans ?? [];
  const upcoming = plans.find((p) => !p.held);
  const unreviewed = plans.find((p) => p.held && !p.review);
  const phase = phaseOf(e);
  if (phase === "preparing") {
    if (!w.pov?.pressure.trim() && !w.pov?.opening.trim())
      return {
        label: "Shape your point of view",
        tab: "pov",
        why: "A hypothesis to test, not a pitch.",
      };
    if (!plans.length)
      return {
        label: "Prepare the conversation",
        tab: "plan",
        why: "Purpose, opening and questions.",
      };
    if (upcoming) return { label: "Run the meeting", tab: "meeting", why: upcoming.title };
    if (unreviewed)
      return { label: "Confirm what you heard", tab: "findings", why: "Before memory fades." };
    return { label: "Review the engagement", tab: "charter", why: "Then create it." };
  }
  if (unreviewed)
    return { label: "Confirm what you heard", tab: "findings", why: unreviewed.title };
  if (phase === "handoff")
    return {
      label: "Get the handoff accepted",
      tab: "handoff",
      why: "The receiving owner must accept.",
    };
  if (phase === "delivery")
    return { label: "Track the value", tab: "realize", why: "30, 60 and 90-day measures." };
  if (phase === "validation")
    return { label: "Run and measure the proof", tab: "prove", why: "Then decide." };
  if (phase === "closed")
    return { label: "Share the recap", tab: "recap", why: "What was agreed." };
  if (upcoming) return { label: "Run the next meeting", tab: "meeting", why: upcoming.title };
  if (!w.pov?.pressure.trim() && !w.pov?.opening.trim())
    return {
      label: "Shape your point of view",
      tab: "pov",
      why: "A hypothesis to test, not a pitch.",
    };
  if (!plans.length)
    return {
      label: "Prepare the next conversation",
      tab: "plan",
      why: "Purpose, opening and questions.",
    };
  const r = readinessOf(e);
  if (!allOk(r.validation)) {
    const miss = r.validation.find((c) => !c.ok)!;
    return {
      label: `Ready for validation: ${lowerFirst(miss.label)}`,
      tab: miss.fix,
      why: miss.hint,
    };
  }
  if (ENGAGEMENT_TYPES[w.charter?.type ?? "discovery"].production || w.charter?.type === "poc")
    return {
      label: "Plan the validation",
      tab: "prove",
      why: "Decision, pass/fail criteria, limits.",
    };
  return {
    label: "Prepare the next conversation",
    tab: "plan",
    why: "Keep the momentum with a purpose.",
  };
}

/* -------------------------------------------------------------------------- what matters right now */

export function whatMatters(e: WorkspaceEngagement, items: BriefItem[], changes: string[]) {
  const plan = (e.workspace.plans ?? []).find((p) => !p.held);
  const pov = e.workspace.pov;
  return {
    why:
      plan?.outcome ||
      (e.msx_opportunity_name ? `The opportunity: ${e.msx_opportunity_name}.` : "") ||
      "Not set: choose the meeting's purpose in the call plan.",
    changed: changes,
    know: items.filter((i) => i.status === "confirmed").slice(0, 4),
    dontAssume: [
      ...items
        .filter((i) => i.status === "needs-validation" && i.section !== "relationship")
        .slice(0, 3),
      ...items.filter((i) => i.status === "contradicted"),
    ],
    assumptions: (pov?.assumptions ?? []).filter((a) => a.status === "open").slice(0, 3),
    decision: plan?.nextStep || e.workspace.charter?.nextDecision.what || "",
  };
}

/* ----------------------------------------------------------- meeting results into the engagement */

/** Applies a meeting's assumption results to the POV and the engagement's findings, keeping both histories. */
export function applyAssumptionResults(
  pov: Pov,
  findings: Finding[],
  results: { id: string; status: AssumptionStatus; quote: string; revisedTo: string }[],
  meeting: string,
) {
  const at = new Date().toISOString();
  const next: Pov = {
    ...pov,
    assumptions: pov.assumptions.map((a) => {
      const r = results.find((x) => x.id === a.id);
      return r && r.status !== "open"
        ? {
            ...a,
            status: r.status,
            quote: r.quote || undefined,
            revisedTo: r.revisedTo || undefined,
            meeting,
          }
        : a;
    }),
  };
  const added: Finding[] = [];
  for (const r of results) {
    const a = pov.assumptions.find((x) => x.id === r.id);
    if (!a || r.status === "open") continue;
    const id = `pov-${a.id}`;
    if (findings.some((f) => f.id === id)) continue;
    added.push({
      id,
      // The customer-facing statement: the goal itself, not our wording about it.
      text:
        r.status === "revised"
          ? r.revisedTo || a.text
          : a.text.replace(/^The goal as written still holds: "(.*)"$/, "$1"),
      kind: r.status === "rejected" ? "ruled-out" : "confirmed",
      source: "customer",
      ...(r.quote ? { quote: r.quote } : {}),
      edited: true,
      at,
    });
  }
  return { pov: next, findings: [...findings, ...added] };
}

export const newAction = (text: string, owner: string, due: string): Action => ({
  id: uid("a"),
  text,
  owner,
  due,
  done: false,
});

/** Where a meeting stores an assumption's result and the customer's words, in the call plan's answers. */
export const assumptionKey = (id: string) => ({
  status: `assume:${id}:status`,
  quote: `assume:${id}:quote`,
  revised: `assume:${id}:revised`,
});

export { uid };
