/*
 * The field guidance the workspace uses, in one versioned place rather than in screen text: meeting purposes (agenda,
 * questions, signals, objections worth exploring, the next step to aim for), preparation resources, engagement types,
 * readiness checks and the handoff criteria. Grounded in the FY27 Cloud + AI SE Playbook, the Technical Seller Field
 * Guide and the FY27 CSA IC Handbook. Change it here; bump PLAYBOOK_VERSION when the guidance changes.
 */
export const PLAYBOOK_VERSION = "FY27.1";

export type Purpose = "discovery" | "architecture" | "workshop" | "demo" | "poc" | "kickoff";

type PurposeGuide = {
  label: string;
  /** What a good meeting of this kind leaves behind. */
  aim: string;
  /** Agenda as shares of the meeting. */
  agenda: [share: number, item: string][];
  /** Questions about causes, consequences, decision criteria and ownership, in priority order. */
  questions: { text: string; why: string }[];
  listenFor: string[];
  /** Framed as worth exploring, never as what this customer thinks. */
  objections: { text: string; explore: string }[];
  nextStep: string;
  participants: string;
};

export const PURPOSES: Record<Purpose, PurposeGuide> = {
  discovery: {
    label: "Initial discovery",
    aim: "Understand the business pressure, test our working hypothesis, and agree one owned next step.",
    agenda: [
      [0.1, "Introductions and why we're here"],
      [0.1, "Our working hypothesis, briefly: invite them to correct it"],
      [0.35, "Their priorities, what changed, and why now"],
      [0.25, "How it works today, and what gets in the way"],
      [0.2, "How they'll decide, who decides, and the next step"],
    ],
    questions: [
      {
        text: "What prompted this now? What changed?",
        why: "The trigger tells you the urgency and who cares.",
      },
      {
        text: "What happens if nothing changes in the next twelve months?",
        why: "The consequence, in their words, not ours.",
      },
      {
        text: "Who feels this most, and who owns fixing it?",
        why: "Finds the owner and the people the outcome must serve.",
      },
      {
        text: "What have you tried already, and what got in the way?",
        why: "Past attempts expose the real constraints.",
      },
      {
        text: "How will you choose between options, and who signs off?",
        why: "Decision criteria and the decision maker.",
      },
    ],
    listenFor: [
      "A named owner and a date",
      "The cost of delay, in their words",
      "Earlier attempts and why they stalled",
      "Who else has to agree",
      "Constraints they treat as non-negotiable",
    ],
    objections: [
      {
        text: "We already tried something like this.",
        explore: "Ask what happened and what they'd do differently.",
      },
      {
        text: "This isn't a priority this year.",
        explore: "Ask what is, and whether this blocks it.",
      },
      {
        text: "Security won't allow this data in the cloud.",
        explore: "Ask which rule, who owns it, and what evidence would satisfy them.",
      },
    ],
    nextStep:
      "A focused follow-up (architecture session, assessment or workshop) with the decision maker in the room.",
    participants:
      "Business owner, technical lead; account executive or specialist if the opportunity is theirs.",
  },
  architecture: {
    label: "Architecture discussion",
    aim: "Agree the requirements that can't be traded away and narrow the options with their trade-offs.",
    agenda: [
      [0.1, "Recap: the outcome and what we heard"],
      [0.2, "Requirements: criticality, availability, RTO/RPO, data, users, downtime"],
      [0.4, "Options and trade-offs, including keeping today's approach"],
      [0.15, "Risks, dependencies and open questions"],
      [0.15, "What we'll decide, by when, and the next step"],
    ],
    questions: [
      {
        text: "Which requirement can't be traded away: availability, data residency, cost or speed?",
        why: "Ranks the constraints that shape every option.",
      },
      {
        text: "How much downtime and data loss can the business accept?",
        why: "RTO and RPO drive the design and the cost.",
      },
      {
        text: "Which standards must it follow: identity, network, landing zone, tooling?",
        why: "Existing standards rule options in or out.",
      },
      {
        text: "Who runs this day to day after go-live?",
        why: "Operability decides between otherwise equal options.",
      },
      {
        text: "Who approves the architecture, and what do they need to see?",
        why: "The decision path for the design.",
      },
    ],
    listenFor: [
      "Hard constraints versus preferences",
      "Standards and approvals they must pass",
      "Who will operate it",
      "Integration points nobody owns",
    ],
    objections: [
      {
        text: "Why not just lift and shift?",
        explore:
          "Compare effort, risk and run cost for their workload; it may be the right first step.",
      },
      {
        text: "We're standardized on another platform.",
        explore: "Ask what the standard protects, and where it doesn't fit this workload.",
      },
    ],
    nextStep:
      "A reviewed design option with decision criteria, or a bounded validation (POC or pilot).",
    participants: "Lead architect, security, operations owner.",
  },
  workshop: {
    label: "Technical workshop",
    aim: "Work through the current state together and leave with shared findings and owners.",
    agenda: [
      [0.1, "Objectives and how we'll work"],
      [0.25, "Current state walk-through"],
      [0.4, "Whiteboard or hands-on on the hardest part"],
      [0.15, "Read back the findings"],
      [0.1, "Owners, dates and the next step"],
    ],
    questions: [
      {
        text: "Where does the current approach break, and how often?",
        why: "Grounds the work in real failures, not features.",
      },
      {
        text: "What would you have to see to trust a change here?",
        why: "Their evidence bar for the next step.",
      },
      {
        text: "Who needs to be in the next session that isn't here?",
        why: "Missing stakeholders stall delivery later.",
      },
    ],
    listenFor: [
      "Disagreement inside their team",
      "Skills they lack today",
      "Undocumented dependencies",
    ],
    objections: [
      {
        text: "We don't have time for this.",
        explore: "Offer a shorter, sharper format focused on the one decision they need.",
      },
    ],
    nextStep: "Findings read back and agreed, with owners for each open item.",
    participants: "Engineers who do the work today, their lead, the operations owner.",
  },
  demo: {
    label: "Demo",
    aim: "Show something concrete in their terms and learn what they'd need to believe it works for them.",
    agenda: [
      [0.1, "What they care about, in their words"],
      [0.15, "The scenario, framed on their workflow"],
      [0.45, "The demo"],
      [0.2, "Reactions, gaps and questions"],
      [0.1, "Next step"],
    ],
    questions: [
      {
        text: "What would you need to see to believe this works for you?",
        why: "Their success bar, before you show anything.",
      },
      {
        text: "Which part of your workflow should this mirror?",
        why: "Keeps the demo about them, not the product.",
      },
      {
        text: "Who else needs to see this before anything moves?",
        why: "Finds the next audience and decision maker.",
      },
    ],
    listenFor: [
      "Questions about their own data",
      "Who they want to show it to",
      "Where it doesn't fit",
    ],
    objections: [
      {
        text: "This works in a demo; ours is messier.",
        explore: "Ask for one real example to try; propose a bounded validation if it matters.",
      },
    ],
    nextStep: "An agreed scenario to validate with their data, or a decision not to.",
    participants: "Business owner, the people who'd use it, technical lead.",
  },
  poc: {
    label: "POC or pilot planning",
    aim: "Agree the decision the validation informs, its pass/fail criteria, limits and the production path.",
    agenda: [
      [0.15, "The decision this validation informs, and who makes it"],
      [0.25, "Hypotheses and pass/fail criteria"],
      [0.25, "Scope, environment and data restrictions"],
      [0.2, "Roles, timeline and resources"],
      [0.15, "Exit decision and the path to production"],
    ],
    questions: [
      {
        text: "Which decision will this inform, and who makes it?",
        why: "A POC without a decision is a demo that costs more.",
      },
      {
        text: "What result means go, and what means stop?",
        why: "Pass/fail criteria agreed up front.",
      },
      {
        text: "What data and environment can we use, under which restrictions?",
        why: "Data access is the usual blocker.",
      },
      {
        text: "If it passes, who runs it in production, and when?",
        why: "The production owner and timeline, before you start.",
      },
    ],
    listenFor: [
      "Measurable pass/fail criteria",
      "Data access approvals and who grants them",
      "A production owner",
      "Signs a demo or assessment would answer the question faster",
    ],
    objections: [
      {
        text: "Can we just try it and see?",
        explore:
          "Ask which decision depends on the result; without one, propose a demo or workshop instead.",
      },
    ],
    nextStep: "A signed-off validation plan with dates, owners and the exit decision.",
    participants: "Decision maker, technical lead, data owner, security.",
  },
  kickoff: {
    label: "Delivery kickoff",
    aim: "Confirm the outcome, scope, owners and support model so delivery can start without surprises.",
    agenda: [
      [0.15, "Outcome and success criteria"],
      [0.15, "Scope and explicit exclusions"],
      [0.25, "Architecture, risks and dependencies"],
      [0.2, "Roles, responsibilities and cadence"],
      [0.15, "Support model and handoff"],
      [0.1, "First milestone"],
    ],
    questions: [
      {
        text: "What does done look like for your sponsor?",
        why: "The outcome the delivery team is accountable for.",
      },
      {
        text: "Who are the accountable owners on each side?",
        why: "Names, not teams.",
      },
      {
        text: "Which risks could stop production, and who owns each?",
        why: "Risk ownership before the first sprint.",
      },
      {
        text: "How will support work after go-live?",
        why: "The support model is part of the outcome.",
      },
    ],
    listenFor: ["Sponsor commitment", "Unowned risks", "A support model nobody has agreed"],
    objections: [
      {
        text: "We'll sort out support later.",
        explore: "Ask who takes the first incident call after go-live.",
      },
    ],
    nextStep: "First milestone dated and owned; handoff accepted by the receiving team.",
    participants: "Sponsor, delivery leads on both sides, the receiving CSA/CSU owner.",
  },
};

export const PURPOSE_ORDER: Purpose[] = [
  "discovery",
  "architecture",
  "workshop",
  "demo",
  "poc",
  "kickoff",
];
export const DURATIONS = [30, 45, 60, 90, 120] as const;

export type EngagementType =
  "discovery" | "architecture" | "workshop" | "demo" | "assessment" | "poc" | "pilot" | "delivery";

export const ENGAGEMENT_TYPES: Record<EngagementType, { label: string; production: boolean }> = {
  discovery: { label: "Discovery", production: false },
  architecture: { label: "Architecture design", production: false },
  workshop: { label: "Technical workshop", production: false },
  demo: { label: "Demo", production: false },
  assessment: { label: "Assessment", production: false },
  poc: { label: "POC", production: false },
  pilot: { label: "Pilot", production: true },
  delivery: { label: "Delivery to production", production: true },
};

export type Resource = {
  title: string;
  /** Only links we know exist; internal documents without a link say so. */
  url?: string;
  kind:
    "discovery" | "technical" | "architecture" | "demo" | "competitive" | "validation" | "handoff";
  /** Why it helps, in one line. */
  why: string;
  essentialFor: Purpose[];
};

export const RESOURCES: Resource[] = [
  {
    title: "Technical Seller Field Guide",
    kind: "discovery",
    why: "Testable points of view, deeper discovery, realistic alternatives and customer-owned next steps.",
    essentialFor: ["discovery"],
  },
  {
    title: "FY27 Cloud + AI Solution Engineers Playbook",
    kind: "discovery",
    why: "Outcome-driven technical conversations, customer-specific preparation, technical validation and handoff.",
    essentialFor: ["discovery", "architecture"],
  },
  {
    title: "Consultative Mindset in Action: Seller Participant Workbook",
    kind: "discovery",
    why: "Question technique for causes, consequences and decision criteria.",
    essentialFor: [],
  },
  {
    title: "Azure Architecture Center",
    url: "https://learn.microsoft.com/azure/architecture/",
    kind: "architecture",
    why: "Reference architectures to whiteboard from.",
    essentialFor: ["architecture", "workshop"],
  },
  {
    title: "Azure Well-Architected Framework",
    url: "https://learn.microsoft.com/azure/well-architected/",
    kind: "architecture",
    why: "Reliability, security, cost, operations and performance trade-offs to discuss.",
    essentialFor: ["architecture"],
  },
  {
    title: "Well-Architected guide in Cloud Delivery",
    url: "/well-architected",
    kind: "architecture",
    why: "Pillars and per-service checks, ready to show.",
    essentialFor: [],
  },
  {
    title: "Solution design in Cloud Delivery",
    url: "/offerings",
    kind: "architecture",
    why: "Sketch the design live with flows and a Well-Architected score.",
    essentialFor: ["workshop"],
  },
  {
    title: "Solution catalog in Cloud Delivery",
    url: "/products",
    kind: "demo",
    why: "Concrete examples to show and react to.",
    essentialFor: ["demo"],
  },
  {
    title: "Competitive considerations",
    kind: "competitive",
    why: "Ask what else they're evaluating and why; use your competitive team's current guidance. No link is stored here.",
    essentialFor: [],
  },
  {
    title: "Technical Close Plan",
    url: "https://aka.ms/CAIPTechnicalClosePlan",
    kind: "validation",
    why: "The production-milestone plan that evolves with the engagement.",
    essentialFor: ["poc", "kickoff"],
  },
  {
    title: "STU-to-CSU handoff conversation",
    url: "https://aka.ms/CAIPCSUHandoff",
    kind: "handoff",
    why: "How the handoff discussion, commitment validation and ownership transfer work.",
    essentialFor: ["kickoff"],
  },
  {
    title: "FY27 Cloud & AI Platforms CSA IC Handbook",
    kind: "handoff",
    why: "Human handoff, commitment validation, ownership transition and Technical Close Plans.",
    essentialFor: ["kickoff"],
  },
];

/** What the receiving team must see before it accepts ownership (CSA IC Handbook). */
export const HANDOFF_CRITERIA = [
  { id: "outcome", label: "The customer outcome is confirmed by the customer" },
  {
    id: "milestone",
    label: "Milestone details are complete in MSX (we don't change MSX from here)",
  },
  { id: "resources", label: "Resources and budget are confirmed" },
  { id: "contact", label: "A customer technical contact is named" },
  { id: "architecture", label: "Architecture decisions and their reasons are written down" },
  { id: "risks", label: "Open risks have owners" },
] as const;

/**
 * Unified versus non-Unified routing differs by area and changes over time, so it's guidance to confirm, not a rule
 * this app enforces.
 */
export const ROUTING = {
  unified:
    "Unified customer: confirm the receiving CSU team and the support path with the account's CSAM.",
  "non-unified":
    "Non-Unified customer: confirm who receives ownership and the support path with your manager.",
} as const;
