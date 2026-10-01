/*
 * Engagements: listen and consult before solutioning. Pure: the six concepts a customer's situation is reasoned
 * about, the stages of a consulting conversation, and what an engagement records. The questions themselves, and
 * how answers route to the next one, live in conversation.ts.
 */

export type ConceptKey =
  "workflows" | "context" | "modernize" | "data" | "governance" | "ownership";
export type Readiness = "ready" | "partial" | "blocker" | "not-needed" | "unknown";
export type Audience = "executive" | "technical" | "internal";
export type Stage =
  "understand" | "explore" | "illustrate" | "validate" | "agree" | "prove" | "realize" | "decided";

export type Concept = {
  key: ConceptKey;
  title: string;
  /** One sentence an executive understands. */
  meaning: string;
  /** The barrier, in plain words, when it isn't ready. */
  gap: string;
  outcome: string;
  /** What to ask in the room. */
  questions: string[];
  /** Catalog solutions that address it, by name; matched against the live catalog. */
  accelerators: string[];
  /** Where the platform itself helps, when no accelerator does. */
  platform?: { label: string; to: string };
};

export const CONCEPTS: Concept[] = [
  {
    key: "workflows",
    gap: "no path for AI into the live workflow",
    title: "AI that changes workflows",
    meaning:
      "Agents and software that change how a business process runs in production, not more pilots.",
    outcome: "Shorter cycle times, more throughput and fewer errors in a named workflow.",
    questions: [
      "Which workflow should change first, and who does it today?",
      "How long does it take, and what does a delay cost?",
      "Which steps must stay with a person?",
    ],
    accelerators: ["Multi-Agent Custom Automation Engine", "Content Processing"],
  },
  {
    key: "context",
    gap: "business terms and knowledge that aren't shared",
    title: "Business context agents can trust",
    meaning:
      "Reusable knowledge of the business (terms, rules, relationships) so answers are right and consistent.",
    outcome: "Accurate, trusted answers; context built once and reused by every use case.",
    questions: [
      "Do the key terms mean the same thing across sites and systems?",
      "Where do people look things up today, and how often is it wrong?",
      "Which documents or records hold the knowledge?",
    ],
    accelerators: [
      "Chat with Your Data",
      "Conversation Knowledge Mining",
      "Agentic Apps on a Unified Data Foundation",
    ],
  },
  {
    key: "modernize",
    gap: "legacy systems that slow or block access",
    title: "Modernize what blocks AI",
    meaning:
      "Update the legacy apps, infrastructure and databases that make AI slow, costly or risky, in the order they block value.",
    outcome: "Lower run costs, less risk and faster delivery.",
    questions: [
      "Which systems does this workflow touch, and which are hard to change or integrate?",
      "What is expensive or risky to keep running?",
      "Is there an application repo we can import as a baseline?",
    ],
    accelerators: [],
    platform: { label: "Import the application's own repo", to: "/products?submit=true" },
  },
  {
    key: "data",
    gap: "data that's hard to reach and govern",
    title: "Data you can reach and govern",
    meaning:
      "Fragmented data connected so the right people and agents can reach it, under consistent rules.",
    outcome: "Faster access, one version of the truth, compliance.",
    questions: [
      "Where does the data this workflow needs live today?",
      "Who can access it, and how is that controlled?",
      "Is it streamed, batch, or only in documents?",
    ],
    accelerators: [
      "Unified Data Foundation with Fabric",
      "Real-Time Intelligence for Operations",
      "OSDU Developer Platform",
      "ADME Experience Lab",
    ],
  },
  {
    key: "governance",
    gap: "controls to run AI safely and affordably",
    title: "Operate AI safely and affordably",
    meaning:
      "Identity, access, monitoring, evaluation and cost management built into how AI runs, not bolted on.",
    outcome: "Controlled risk, auditability and predictable spend.",
    questions: [
      "Is there a landing zone, and who owns identity and policy?",
      "How would an AI answer or action be evaluated and audited?",
      "Who watches the cost, and what are the guardrails?",
    ],
    accelerators: [],
    platform: { label: "Assess or design the landing zone", to: "/foundations" },
  },
  {
    key: "ownership",
    gap: "no clear owner for the outcome",
    title: "Owners, delivery and adoption",
    meaning:
      "Every initiative has a business owner, a delivery path, the skills to run it, and adoption that's measured.",
    outcome: "Results that land and last.",
    questions: [
      "Who owns the outcome, by name?",
      "Who builds it, who runs it, and who supports it?",
      "How will we know people are using it?",
    ],
    accelerators: [],
    platform: { label: "Deliver it as a versioned offering", to: "/offerings" },
  },
];

export const CONCEPT_BY_KEY = new Map(CONCEPTS.map((c) => [c.key, c]));

export const READINESS: Record<Readiness, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "success" },
  partial: { label: "Partly there", tone: "warning" },
  blocker: { label: "Blocks value", tone: "danger" },
  "not-needed": { label: "Not needed", tone: "neutral" },
  unknown: { label: "Not yet known", tone: "neutral" },
};

export const STAGES: { key: Exclude<Stage, "decided">; title: string; sub: string }[] = [
  { key: "understand", title: "Understand", sub: "The outcome, the work, why now" },
  { key: "explore", title: "Explore", sub: "Symptoms to causes, one question at a time" },
  { key: "illustrate", title: "Illustrate", sub: "Something concrete to react to" },
  { key: "validate", title: "Validate", sub: "Test the hypotheses with the customer" },
  { key: "agree", title: "Agree", sub: "Owned next steps, with dates" },
  { key: "prove", title: "Prove", sub: "Deploy, measure, decide" },
  { key: "realize", title: "Realize", sub: "In production, measured, confirmed" },
];

export type Stakeholder = { name: string; role: string; audience: Audience };
export type Metric = { metric: string; value: string; unit: string };

export type Brief = {
  /** What the customer opened with, as entry paths (see conversation.ts PATHS). */
  signals?: string[];
  /** The customer's own words. */
  words?: string;
  problem?: string;
  workflow?: string;
  outcome?: string;
  whyNow?: string;
  owner?: string;
  success?: string;
  constraints?: string;
  stakeholders?: Stakeholder[];
  baseline?: Metric[];
  /** Internal only: never in the customer recap. */
  internal?: string;
};
export type ReadinessMap = Partial<Record<ConceptKey, { status: Readiness; note: string }>>;
export type MapItem = { concept: ConceptKey; products: string[]; note: string };
export type Result = {
  metric: string;
  baseline: string;
  target: string;
  measured: string;
  unit: string;
};
export type Decision = {
  choice: "scale" | "iterate" | "stop";
  note: string;
  by: string;
  at: string;
};

/** A meeting. Everything asked is recorded against the meeting it was asked in. */
export type Session = { id: string; title: string; at: string; attendees: string };
/** One question asked: the answers chosen and the customer's own words. Parked questions have no answers. */
export type Turn = {
  card: string;
  answers: string[];
  note: string;
  session: string;
  at: string;
  parked?: boolean;
};
export type FindingKind = "confirmed" | "hypothesis" | "unknown" | "ruled-out";
export type Finding = {
  id: string;
  text: string;
  kind: FindingKind;
  /** Who it came from: the customer said it, the presenter inferred it, or an AI suggested it. */
  source: "customer" | "presenter" | "ai";
  /** The customer's words, when they said it. */
  quote?: string;
  card?: string;
  /** Set when the presenter confirmed, ruled out or edited it: re-answering the card keeps it. */
  edited?: boolean;
  at: string;
};
export type Action = { id: string; text: string; owner: string; due: string; done: boolean };

/** A customer measure tracked from the baseline through the proof to 30, 60 and 90 days in production. */
export type ValueMeasure = {
  metric: string;
  unit: string;
  baseline: string;
  target: string;
  proof: string;
  d30: string;
  d60: string;
  d90: string;
};
export const CHECKPOINTS = [
  ["d30", "30 days"],
  ["d60", "60 days"],
  ["d90", "90 days"],
] as const;
export type Realization = {
  measures?: ValueMeasure[];
  /** Who uses it, in the customer's words. */
  adoption?: string;
  /** The business owner's confirmation, recorded by the presenter. */
  confirmed?: { by: string; note: string; at: string; recordedBy: string } | null;
  /** Internal only: where the work is tracked in MSX. Pasted links; never sent to the customer recap. */
  msx?: { opportunity?: string; milestones?: { title: string; url: string }[] };
};

/** The measures to track: what's been saved, else the proof's results. */
export function measuresOf(e: Pick<Engagement, "realization" | "results">): ValueMeasure[] {
  if (e.realization.measures?.length) return e.realization.measures;
  return e.results.map((r) => ({
    metric: r.metric,
    unit: r.unit,
    baseline: r.baseline,
    target: r.target,
    proof: r.measured,
    d30: "",
    d60: "",
    d90: "",
  }));
}

/** The most recent value a customer measure has, and when it was taken. */
export function latestOf(m: ValueMeasure): { value: string; when: string } | null {
  for (const [k, label] of [...CHECKPOINTS].reverse())
    if (m[k].trim()) return { value: m[k], when: label };
  return m.proof.trim() ? { value: m.proof, when: "the proof" } : null;
}

export type Engagement = {
  id: string;
  name: string;
  stage: Stage;
  owner_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  brief: Brief;
  readiness: ReadinessMap;
  solution_map: MapItem[];
  results: Result[];
  decision: Decision | null;
  sessions: Session[];
  trail: Turn[];
  findings: Finding[];
  actions: Action[];
  realization: Realization;
  created_at: string;
  updated_at: string;
};

export const stageIndex = (s: Stage) =>
  s === "decided" ? STAGES.length : STAGES.findIndex((x) => x.key === s);

/** Where an engagement is, and a one-line summary of what it has. */
export function progressOf(e: Engagement) {
  const current = stageIndex(e.stage);
  const count = (k: FindingKind) => e.findings.filter((f) => f.kind === k).length;
  const asked = e.trail.filter((t) => !t.parked && !t.card.startsWith("show:")).length;
  const checkpoints = measuresOf(e).length
    ? CHECKPOINTS.filter(([k]) => measuresOf(e).some((m) => m[k].trim())).length
    : 0;
  const next = e.realization.confirmed
    ? "Value realized"
    : e.stage === "decided"
      ? `Decided: ${e.decision?.choice ?? ""}`
      : e.stage === "realize"
        ? `Realizing value · ${checkpoints} of 3 checkpoints`
        : !asked
          ? "Not started"
          : [
              `${asked} asked`,
              `${count("confirmed")} confirmed`,
              count("hypothesis") ? `${count("hypothesis")} to test` : "",
              e.actions.length ? `${e.actions.filter((a) => !a.done).length} actions open` : "",
            ]
              .filter(Boolean)
              .join(" · ");
  return { current, next };
}
