/*
 * The conversation navigator's knowledge: how customers describe their problem (entry paths), the questions a
 * good SE or CSA asks (cards), what each answer indicates, and where it leads. Routing is transparent rules:
 * every suggestion carries the reason it was made, and the presenter can always ask something else.
 *
 * The cards organize the knowledge behind the interface; they don't dictate how the customer must speak. Nothing
 * here is a fact about a customer until the customer confirms it.
 */
import {
  CONCEPT_BY_KEY,
  type ConceptKey,
  type Engagement,
  type Finding,
  type FindingKind,
  type Readiness,
  type ReadinessMap,
  type Stage,
  stageIndex,
} from "./engagements";

export type PathKey = "pilots" | "answers" | "legacy" | "data" | "explore";

export const PATHS: { key: PathKey; says: string; concept?: ConceptKey; start: string }[] = [
  {
    key: "pilots",
    says: "We have AI pilots, but they don't make it into production.",
    concept: "workflows",
    start: "x-last-pilot",
  },
  {
    key: "answers",
    says: "Our AI answers aren't reliable, or don't understand our business.",
    concept: "context",
    start: "x-wrong-answer",
  },
  {
    key: "legacy",
    says: "Our existing systems are expensive or holding us back.",
    concept: "modernize",
    start: "x-hardest-system",
  },
  {
    key: "data",
    says: "Our data is fragmented and hard to access safely.",
    concept: "data",
    start: "x-data-where",
  },
  { key: "explore", says: "Something else. Let's explore.", start: "x-where-time-goes" },
];

export type Answer = {
  id: string;
  label: string;
  /** Presenter only: what this answer usually indicates. */
  means: string;
  finding?: { kind: FindingKind; text: string };
  /** Cards this answer opens up. */
  next?: string[];
  /** Catalog accelerators this answer points to, by catalog number. */
  accelerators?: number[];
  sets?: { concept: ConceptKey; status: Readiness };
  /** A next step to propose in Agree. Never agreed automatically. */
  action?: string;
};

export type CardStage = Extract<Stage, "understand" | "explore" | "validate" | "agree">;

export type Card = {
  id: string;
  stage: CardStage;
  concept?: ConceptKey;
  question: string;
  /** Presenter only: why this question, and what to listen for. */
  why: string;
  /** Free-text answers are saved to this part of the brief. Baseline appends a metric. */
  capture?: "outcome" | "workflow" | "whyNow" | "owner" | "baseline" | "success" | "constraints";
  multi?: boolean;
  answers: Answer[];
};

export const CARDS: Card[] = [
  /* ------------------------------------------------------------------------------------- understand */
  {
    id: "u-outcome",
    stage: "understand",
    question: "If this goes well, what's different a year from now, and for whom?",
    why: "Anchors the conversation on a business result before any technology. Listen for a group of people, a change you could measure, and a date.",
    capture: "outcome",
    answers: [],
  },
  {
    id: "u-workflow",
    stage: "understand",
    concept: "workflows",
    question: "Which piece of work would you change first? Who does it today?",
    why: "Value comes from one named workflow, not from AI in general. A team and a task you could sit with next week.",
    capture: "workflow",
    answers: [],
  },
  {
    id: "u-why-now",
    stage: "understand",
    question: "What makes this matter now, rather than next year?",
    why: "Separates real urgency from interest. Without a trigger, a good pilot still stalls.",
    capture: "whyNow",
    answers: [
      {
        id: "date",
        label: "A date we can't move",
        means:
          "An outage, turnaround, regulation or contract sets the clock. Plan backwards from it.",
        finding: { kind: "confirmed", text: "A fixed date drives the timing." },
      },
      {
        id: "cost",
        label: "Cost or margin pressure",
        means: "The case will be judged on run cost. Make sure a baseline is captured.",
        finding: { kind: "confirmed", text: "Cost pressure drives the timing." },
        next: ["u-cost-of-delay"],
      },
      {
        id: "people",
        label: "People leaving, or not enough of them",
        means:
          "Capacity and lost expertise. Often the strongest case for agents that draft and people that decide.",
        finding: {
          kind: "confirmed",
          text: "Not enough people to do this work the way it's done today.",
        },
      },
      {
        id: "none",
        label: "Nothing specific",
        means: "Interest without urgency. Find the cost of delay before proposing anything.",
        finding: { kind: "hypothesis", text: "No trigger to act now; this risks staying a pilot." },
        next: ["u-cost-of-delay"],
      },
    ],
  },
  {
    id: "u-cost-of-delay",
    stage: "understand",
    question: "What does it cost when this work is late or wrong? Think of one recent example.",
    why: "One real incident is worth more than a market statistic, and it's the customer's number, not ours.",
    answers: [
      {
        id: "known",
        label: "We could put a number on it",
        means: "Ask them to bring it. Don't estimate it for them.",
        action: "Quantify the cost of one recent delay or error.",
      },
      {
        id: "unknown",
        label: "Hard to say",
        means: "The case will rest on time and capacity rather than cost. That's fine, but say so.",
        finding: { kind: "unknown", text: "The cost of the problem hasn't been quantified." },
      },
    ],
  },
  {
    id: "u-baseline",
    stage: "understand",
    question: "How do you measure this work today?",
    why: "Every later claim is measured against this. If there's no baseline, measuring one is the first next step.",
    capture: "baseline",
    answers: [
      {
        id: "measured",
        label: "We measure it",
        means: "Use their measure, in their units.",
        finding: { kind: "confirmed", text: "A baseline is measured today." },
      },
      {
        id: "rough",
        label: "We have a rough idea",
        means: "An estimate. Measure it properly before the proof starts.",
        finding: { kind: "hypothesis", text: "The baseline is an estimate." },
        action: "Measure the baseline for two weeks before the proof starts.",
      },
      {
        id: "none",
        label: "We don't measure it",
        means: "Nothing to prove against yet.",
        finding: { kind: "unknown", text: "No baseline for this work." },
        action: "Agree how to measure the baseline, and start measuring.",
      },
    ],
  },
  {
    id: "u-owner",
    stage: "understand",
    concept: "ownership",
    question: "Who would own the result, and could they fund the next step?",
    why: "A business owner with budget turns a pilot into a decision. IT-only sponsorship is the commonest reason pilots stall.",
    capture: "owner",
    answers: [
      {
        id: "funded",
        label: "A business leader, with budget",
        means: "Engage them directly; they make the decision at the end.",
        finding: { kind: "confirmed", text: "A business owner can fund the next step." },
        sets: { concept: "ownership", status: "ready" },
      },
      {
        id: "unfunded",
        label: "A business leader, budget not agreed",
        means: "Keep the next step small enough to fund from what exists.",
        finding: { kind: "hypothesis", text: "The sponsor exists, but funding isn't agreed." },
        sets: { concept: "ownership", status: "partial" },
      },
      {
        id: "it",
        label: "IT is driving it; no business owner yet",
        means: "Without a business owner this becomes another pilot. Finding one is the next step.",
        finding: {
          kind: "hypothesis",
          text: "No business owner yet; this risks becoming another pilot.",
        },
        sets: { concept: "ownership", status: "blocker" },
        action: "Identify the business owner before the design session.",
      },
    ],
  },

  /* ---------------------------------------------------------------------------------------- explore */
  {
    id: "x-where-time-goes",
    stage: "explore",
    concept: "workflows",
    question: "Walk me through the work. Where do the time and the errors go?",
    why: "Symptoms first. Where the time goes tells you whether the problem is gathering, reading, agreeing, approving or the systems.",
    answers: [
      {
        id: "gather",
        label: "Gathering information from several places",
        means:
          "Time goes into assembling, not deciding. That's where agents help: they draft, people decide.",
        finding: {
          kind: "hypothesis",
          text: "Most of the time goes into gathering information, not deciding.",
        },
        sets: { concept: "workflows", status: "partial" },
        next: ["x-human-step", "x-data-where"],
        accelerators: [7],
      },
      {
        id: "documents",
        label: "Reading and keying in documents",
        means:
          "Manual extraction. Structured extraction with confidence scores, people review the uncertain fields.",
        finding: {
          kind: "hypothesis",
          text: "Manual extraction from documents is the bottleneck.",
        },
        next: ["x-documents"],
        accelerators: [9],
      },
      {
        id: "disagree",
        label: "Arguing about whose numbers are right",
        means: "A meaning problem, not a data problem. Go to definitions.",
        finding: { kind: "hypothesis", text: "Teams don't agree what the numbers mean." },
        sets: { concept: "context", status: "partial" },
        next: ["x-definitions"],
      },
      {
        id: "waiting",
        label: "Waiting on approvals or other teams",
        means: "A hand-off problem. Find which decisions must stay with a person.",
        finding: { kind: "hypothesis", text: "Hand-offs and approvals add most of the delay." },
        next: ["x-human-step", "x-approval"],
        accelerators: [7],
      },
      {
        id: "systems",
        label: "Working around old systems",
        means: "Modernization is on the critical path. Find the system and whether it can be read.",
        finding: { kind: "hypothesis", text: "Legacy systems slow the work down." },
        sets: { concept: "modernize", status: "partial" },
        next: ["x-hardest-system"],
      },
    ],
  },
  {
    id: "x-last-pilot",
    stage: "explore",
    concept: "workflows",
    question: "What stopped the last pilot from going live?",
    why: "The answer is rarely the model. It tells you which barrier to work on first.",
    answers: [
      {
        id: "security",
        label: "Security or compliance couldn't approve it",
        means: "There's no approval path for AI workloads. Find out what security needs to see.",
        finding: { kind: "hypothesis", text: "There's no agreed approval path for AI workloads." },
        sets: { concept: "governance", status: "blocker" },
        next: ["x-approval"],
      },
      {
        id: "owner",
        label: "No one owned running it",
        means: "An operating-model gap. Agree who runs it before building anything else.",
        finding: {
          kind: "hypothesis",
          text: "No one owns running AI workloads once they're built.",
        },
        sets: { concept: "ownership", status: "blocker" },
        next: ["x-run"],
      },
      {
        id: "fit",
        label: "It didn't fit how people actually work",
        means: "It was built around the model, not the workflow. Walk the work.",
        finding: {
          kind: "hypothesis",
          text: "The pilot was built around the model, not the workflow.",
        },
        sets: { concept: "workflows", status: "blocker" },
        next: ["x-where-time-goes", "x-human-step"],
      },
      {
        id: "data",
        label: "It couldn't reach the data in production",
        means: "A data availability problem. Find where the data lives and who can reach it.",
        finding: { kind: "hypothesis", text: "Production data wasn't reachable by the pilot." },
        sets: { concept: "data", status: "blocker" },
        next: ["x-data-where", "x-access"],
      },
      {
        id: "trust",
        label: "The answers weren't good enough",
        means: "Don't jump to models. Find out what was missing when the answer was wrong.",
        finding: { kind: "hypothesis", text: "Users didn't trust the answers." },
        sets: { concept: "context", status: "partial" },
        next: ["x-wrong-answer"],
      },
    ],
  },
  {
    id: "x-wrong-answer",
    stage: "explore",
    concept: "context",
    question: "When the answer is wrong, what's usually missing?",
    why: "The discriminating question. It separates missing data (availability), missing meaning (context) and missing permissions (governance), which need different fixes.",
    answers: [
      {
        id: "meaning",
        label: "It doesn't know what our terms mean",
        means:
          "A context problem, not a model problem. Shared definitions fix it for every use case.",
        finding: {
          kind: "hypothesis",
          text: "Business meaning isn't shared or written down; this is a context problem, not a model problem.",
        },
        sets: { concept: "context", status: "blocker" },
        next: ["x-definitions"],
      },
      {
        id: "info",
        label: "The information isn't there, or it's out of date",
        means: "A data availability problem. Better prompts won't fix it.",
        finding: { kind: "hypothesis", text: "The AI can't reach current information." },
        sets: { concept: "data", status: "partial" },
        next: ["x-data-where", "x-freshness"],
      },
      {
        id: "reads",
        label: "It finds the right document but gets the detail wrong",
        means: "Documents need structured extraction and citations, not just search.",
        finding: {
          kind: "hypothesis",
          text: "Documents need structured extraction with citations, not just search.",
        },
        sets: { concept: "context", status: "partial" },
        next: ["x-documents"],
        accelerators: [9, 11],
      },
      {
        id: "access",
        label: "It shows people things they shouldn't see",
        means: "A governance problem first. An agent would amplify it.",
        finding: { kind: "hypothesis", text: "Access control isn't enforced for AI answers." },
        sets: { concept: "governance", status: "blocker" },
        next: ["x-access"],
      },
      {
        id: "unsure",
        label: "Not sure",
        means: "Nobody has looked. A test set of real questions will tell you.",
        finding: { kind: "unknown", text: "Why the answers are wrong." },
        next: ["x-test-set"],
      },
    ],
  },
  {
    id: "x-definitions",
    stage: "explore",
    concept: "context",
    question: "Does a key term mean the same thing everywhere? Give me one example.",
    why: "One concrete example (an asset, a metric, a status) makes the context problem real, and shows whether shared definitions would fix it.",
    answers: [
      {
        id: "differs",
        label: "No, teams define it differently",
        means: "Agreed definitions, built once, would serve every agent and report.",
        finding: { kind: "confirmed", text: "Key terms are defined differently across teams." },
        sets: { concept: "context", status: "blocker" },
        next: ["x-meaning-owner"],
        accelerators: [12, 13],
      },
      {
        id: "same",
        label: "Mostly the same",
        means: "Context is probably not the cause. Look at freshness and access.",
        finding: { kind: "confirmed", text: "Key terms mostly mean the same thing across teams." },
        sets: { concept: "context", status: "ready" },
        next: ["x-freshness"],
      },
    ],
  },
  {
    id: "x-meaning-owner",
    stage: "explore",
    concept: "ownership",
    question: "When teams disagree on a definition, who decides?",
    why: "Shared context needs an owner, or it drifts back.",
    answers: [
      {
        id: "steward",
        label: "A data governance team owns it",
        means: "They're the ones to work with on definitions.",
        finding: { kind: "confirmed", text: "A data governance team owns business definitions." },
      },
      {
        id: "nobody",
        label: "Nobody, formally",
        means: "Agree an owner for the definitions the first workflow needs; don't boil the ocean.",
        finding: { kind: "hypothesis", text: "Nobody owns business definitions." },
        sets: { concept: "ownership", status: "partial" },
        action: "Agree who owns the definitions the first workflow needs.",
      },
    ],
  },
  {
    id: "x-documents",
    stage: "explore",
    concept: "context",
    question: "Where does the knowledge this work needs actually live?",
    why: "Documents, conversations and tables need different approaches. Pick all that apply.",
    multi: true,
    answers: [
      {
        id: "docs",
        label: "Documents: manuals, procedures, permits, forms",
        means: "Index for cited answers; extract fields where the work needs data, not text.",
        finding: { kind: "confirmed", text: "The knowledge lives mostly in documents." },
        accelerators: [9, 11],
      },
      {
        id: "convos",
        label: "Calls, chats and tickets",
        means: "Mine the conversations. Agree how personal data is handled first.",
        finding: { kind: "confirmed", text: "Knowledge is in calls, chats and tickets." },
        accelerators: [10],
      },
      {
        id: "tables",
        label: "Tables in a warehouse or lakehouse",
        means: "Agents can query governed data directly once definitions are agreed.",
        finding: { kind: "confirmed", text: "Knowledge is in structured data." },
        accelerators: [12, 13],
      },
      {
        id: "heads",
        label: "In experienced people's heads",
        means: "Tacit knowledge. Capture it with the experts before automating.",
        finding: { kind: "hypothesis", text: "Key knowledge is tacit, held by a few experts." },
        action: "Run a working session with two experts to capture the rules they apply.",
      },
    ],
  },
  {
    id: "x-data-where",
    stage: "explore",
    concept: "data",
    question: "Where does the data this work needs live today?",
    why: "Data availability, separate from what it means and who can act on it. Pick all that apply.",
    multi: true,
    answers: [
      {
        id: "files",
        label: "SharePoint and file shares",
        means: "Reachable, but permissions vary per site. Index with security trimming.",
        finding: { kind: "confirmed", text: "Data is in SharePoint and file shares." },
        sets: { concept: "data", status: "partial" },
        accelerators: [11, 9],
      },
      {
        id: "ops",
        label: "Operational systems: ERP, maintenance, asset management",
        means: "Reachability depends on the system. Find out if it can be read.",
        finding: { kind: "confirmed", text: "Data is in operational systems." },
        next: ["x-hardest-system"],
        accelerators: [13],
      },
      {
        id: "stream",
        label: "Sensors, SCADA, historians",
        means: "Time-series and events. Ask how current it must be.",
        finding: { kind: "confirmed", text: "Data comes from sensors and historians." },
        next: ["x-freshness"],
        accelerators: [8],
      },
      {
        id: "subsurface",
        label: "Subsurface and well data",
        means: "OSDU and Data Manager for Energy territory.",
        finding: { kind: "confirmed", text: "The work needs subsurface and well data." },
        accelerators: [1, 2, 6],
      },
      {
        id: "lake",
        label: "Already in a lakehouse or warehouse",
        means: "The foundation may exist. Check definitions and access, not storage.",
        finding: { kind: "confirmed", text: "The data is already in a lakehouse or warehouse." },
        sets: { concept: "data", status: "ready" },
        accelerators: [12],
        next: ["x-definitions"],
      },
    ],
  },
  {
    id: "x-freshness",
    stage: "explore",
    concept: "data",
    question: "How current does the information need to be when someone asks?",
    why: "Seconds versus daily changes the architecture and the cost more than anything else.",
    answers: [
      {
        id: "live",
        label: "Seconds to minutes",
        means: "Streaming, not batch.",
        finding: {
          kind: "confirmed",
          text: "Answers must reflect data from the last few minutes.",
        },
        accelerators: [8],
      },
      {
        id: "daily",
        label: "Daily is fine",
        means: "Batch keeps it simple and cheap.",
        finding: { kind: "confirmed", text: "Daily data is current enough." },
      },
      {
        id: "depends",
        label: "Depends on the question",
        means: "Split the questions; most will be daily.",
        finding: {
          kind: "unknown",
          text: "How current each type of question needs the data to be.",
        },
      },
    ],
  },
  {
    id: "x-access",
    stage: "explore",
    concept: "governance",
    question: "Who can see what, and how is that enforced today?",
    why: "An agent inherits the access model. If it's weak, the agent amplifies it.",
    answers: [
      {
        id: "central",
        label: "Centrally, with Entra ID groups and policy",
        means: "Agents can act on behalf of users with the same rules.",
        finding: { kind: "confirmed", text: "Access is enforced centrally through Entra ID." },
        sets: { concept: "governance", status: "ready" },
      },
      {
        id: "per-system",
        label: "Each system has its own permissions",
        means: "Agents must respect each system's permissions; plan identity pass-through.",
        finding: {
          kind: "hypothesis",
          text: "Agents will need to respect per-system permissions.",
        },
        sets: { concept: "governance", status: "partial" },
      },
      {
        id: "shared",
        label: "Shared accounts or exports",
        means: "Fix this before an agent is given access.",
        finding: { kind: "hypothesis", text: "Shared accounts and exports bypass access control." },
        sets: { concept: "governance", status: "blocker" },
        action: "Agree an access model with security before an agent is connected.",
      },
    ],
  },
  {
    id: "x-hardest-system",
    stage: "explore",
    concept: "modernize",
    question: "Which system does this work depend on that's hardest to change?",
    why: "Modernize what blocks this workflow, in that order. Not everything.",
    answers: [
      {
        id: "onprem",
        label: "An on-premises business system",
        means: "Find out whether it can be read today.",
        finding: { kind: "confirmed", text: "The work depends on an on-premises business system." },
        sets: { concept: "modernize", status: "partial" },
        next: ["x-integration"],
      },
      {
        id: "db",
        label: "A database that's costly or near end of support",
        means: "A modernization case with its own clock.",
        finding: { kind: "confirmed", text: "A costly or ageing database sits under this work." },
        sets: { concept: "modernize", status: "partial" },
        next: ["x-cost-driver"],
      },
      {
        id: "custom",
        label: "Custom applications no one wants to touch",
        means: "Look at the code before deciding anything.",
        finding: { kind: "hypothesis", text: "Custom applications are hard to change safely." },
        sets: { concept: "modernize", status: "blocker" },
        next: ["x-repo"],
      },
    ],
  },
  {
    id: "x-integration",
    stage: "explore",
    concept: "modernize",
    question: "Can we read from it today: an API, a replica, a nightly export?",
    why: "Whether an agent can use the system at all, and how current its view will be.",
    answers: [
      {
        id: "api",
        label: "Yes, there's an API",
        means: "No modernization needed for a first step.",
        finding: { kind: "confirmed", text: "There's a supported API to read from the system." },
        sets: { concept: "modernize", status: "ready" },
      },
      {
        id: "export",
        label: "A nightly export or a replica",
        means: "Fine for drafting; not for live status.",
        finding: {
          kind: "confirmed",
          text: "The system can be read through a nightly export or replica.",
        },
        sets: { concept: "modernize", status: "partial" },
      },
      {
        id: "none",
        label: "No supported way",
        means: "Integration is the critical path. Plan it before any agent.",
        finding: { kind: "hypothesis", text: "Integration with the system is the critical path." },
        sets: { concept: "modernize", status: "blocker" },
        action: "Confirm a supported read path with the system's owner.",
      },
    ],
  },
  {
    id: "x-cost-driver",
    stage: "explore",
    concept: "modernize",
    question: "What drives the cost or the risk: licences, hardware, end of support, skills?",
    why: "Modernization justified by its own economics, then connected to the AI case.",
    answers: [
      {
        id: "eos",
        label: "An end-of-support date",
        means: "A date that sets the timing.",
        finding: { kind: "confirmed", text: "An end-of-support date drives the timing." },
      },
      {
        id: "licence",
        label: "Licences and hardware",
        means: "Run-cost case; capture today's cost as a baseline.",
        finding: { kind: "confirmed", text: "Licence and hardware costs drive the case." },
      },
      {
        id: "skills",
        label: "Few people can still run it",
        means: "A risk case, often the strongest one.",
        finding: { kind: "confirmed", text: "Few people can still run the system." },
      },
    ],
  },
  {
    id: "x-repo",
    stage: "explore",
    concept: "modernize",
    question: "Is the code in a repository we could look at together?",
    why: "Importing the repo gives an assessment baseline from the code, not opinions.",
    answers: [
      {
        id: "yes",
        label: "Yes",
        means: "Import it into Cloud Delivery as a baseline.",
        action: "Import the application's repository as an assessment baseline.",
      },
      {
        id: "no",
        label: "No, or not easily",
        means: "Start with an interview of the people who run it.",
        finding: { kind: "unknown", text: "What the custom applications depend on." },
      },
    ],
  },
  {
    id: "x-human-step",
    stage: "explore",
    concept: "workflows",
    question: "Which decisions must always stay with a person?",
    why: "Defines what an agent may draft and what a person approves. This is where agents take action, safely.",
    answers: [
      {
        id: "regulated",
        label: "Approvals with safety or regulatory weight",
        means: "Agents draft; a person approves every plan.",
        finding: {
          kind: "confirmed",
          text: "Safety and regulatory approvals stay with a person, always.",
        },
        sets: { concept: "workflows", status: "partial" },
        accelerators: [7],
      },
      {
        id: "review",
        label: "A final review before anything goes out",
        means: "A human-in-the-loop step at the end.",
        finding: { kind: "confirmed", text: "A person reviews everything before it goes out." },
        accelerators: [7],
      },
      {
        id: "none",
        label: "None. It could run end to end",
        means: "Test this with the risk owner before designing for it.",
        finding: { kind: "hypothesis", text: "The work could run without a person approving it." },
        action: "Check end-to-end automation with the risk owner.",
      },
    ],
  },
  {
    id: "x-approval",
    stage: "explore",
    concept: "governance",
    question: "What would security need to see before approving an AI workload?",
    why: "Makes the approval path explicit, so the proof is designed to pass it.",
    multi: true,
    answers: [
      {
        id: "tenant",
        label: "Data stays in our tenant",
        means: "Deploy into their subscription, not a shared service.",
        finding: { kind: "confirmed", text: "Data must stay in the company's own Azure tenant." },
      },
      {
        id: "lz",
        label: "A landing zone and policy baseline",
        means: "Assess or design the landing zone first.",
        finding: { kind: "confirmed", text: "Security needs a landing zone and policy baseline." },
        sets: { concept: "governance", status: "partial" },
      },
      {
        id: "eval",
        label: "Evaluation and an audit trail of what the AI does",
        means: "Build evaluation and tracing into the proof, not after it.",
        finding: {
          kind: "confirmed",
          text: "Security needs evaluation and an audit trail for AI.",
        },
        sets: { concept: "governance", status: "partial" },
      },
      {
        id: "unknown",
        label: "We've never been asked",
        means: "Find out before designing anything.",
        finding: { kind: "unknown", text: "What security needs to approve an AI workload." },
        action: "Book 30 minutes with the security architect.",
      },
    ],
  },
  {
    id: "x-run",
    stage: "explore",
    concept: "ownership",
    question: "Once it's live, who runs it, fixes it, and ships the next version?",
    why: "Production readiness is an operating model, not a deployment.",
    answers: [
      {
        id: "platform",
        label: "A central platform team",
        means: "Hand off to them with a versioned offering.",
        finding: { kind: "confirmed", text: "A central platform team would run it." },
        sets: { concept: "ownership", status: "ready" },
      },
      {
        id: "partner",
        label: "A partner",
        means: "Bring the partner into the design session.",
        finding: { kind: "confirmed", text: "A partner would run it." },
        sets: { concept: "ownership", status: "partial" },
        action: "Bring the run partner into the design session.",
      },
      {
        id: "nobody",
        label: "Nobody yet",
        means: "Agree run ownership before the proof, or it won't leave the sandbox.",
        finding: { kind: "hypothesis", text: "Nobody would run it in production." },
        sets: { concept: "ownership", status: "blocker" },
        action: "Agree who runs it in production before the proof starts.",
      },
    ],
  },
  {
    id: "x-test-set",
    stage: "explore",
    concept: "context",
    question: "Could we collect 20 real questions with known right answers?",
    why: "A test set turns 'it's not good enough' into something measurable, before anyone builds.",
    answers: [
      {
        id: "yes",
        label: "Yes",
        means: "That's the evaluation set for the proof.",
        action: "Collect 20 real questions with their expected answers.",
      },
      {
        id: "hard",
        label: "It's hard to say what 'right' is",
        means: "Agree what a right answer is before building anything.",
        finding: { kind: "hypothesis", text: "There's no agreed definition of a right answer." },
        sets: { concept: "context", status: "blocker" },
      },
    ],
  },

  /* --------------------------------------------------------------------------------------- validate */
  {
    id: "v-success",
    stage: "validate",
    question: "If we ran a short proof, what would make you confident enough to go further?",
    why: "The customer's success criteria, in their words. These become the proof's measures.",
    capture: "success",
    multi: true,
    answers: [
      {
        id: "measured",
        label: "A measured improvement on today's baseline",
        means: "Agree the target with them; don't set it for them.",
        finding: {
          kind: "confirmed",
          text: "Success means a measured improvement on the baseline.",
        },
      },
      {
        id: "users",
        label: "The people who do the work want to keep it",
        means: "Adoption is the measure. Involve them from the first day.",
        finding: {
          kind: "confirmed",
          text: "Success means the people who do the work want to keep it.",
        },
      },
      {
        id: "security",
        label: "Security signs it off",
        means: "Design the proof to pass the approval path.",
        finding: { kind: "confirmed", text: "Success includes security sign-off." },
      },
    ],
  },
  {
    id: "v-constraints",
    stage: "validate",
    question: "What must a proof respect?",
    why: "Constraints stated up front are easier to design for than to discover.",
    capture: "constraints",
    multi: true,
    answers: [
      {
        id: "tenant",
        label: "Data stays in our tenant",
        means: "Deploy into their subscription.",
        finding: { kind: "confirmed", text: "Data must stay in the company's own Azure tenant." },
      },
      {
        id: "approve",
        label: "A person approves every action",
        means: "Human approval in the design, not as an afterthought.",
        finding: { kind: "confirmed", text: "A person approves every action the AI proposes." },
      },
      {
        id: "identity",
        label: "It uses our existing identity",
        means: "Entra ID and managed identities; no new accounts.",
        finding: { kind: "confirmed", text: "It must use the existing identity platform." },
      },
      {
        id: "readonly",
        label: "Read-only against production systems",
        means: "Agents draft; nothing writes back during the proof.",
        finding: { kind: "confirmed", text: "The proof is read-only against production systems." },
      },
    ],
  },
];

export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
const answerOf = (card: Card, id: string) => card.answers.find((a) => a.id === id);

/* ------------------------------------------------------------------------------------- accelerators */

export const productId = (n: number) => `33333333-3333-4333-8333-1${String(n).padStart(11, "0")}`;
export const productNumber = (id: string) =>
  /^33333333-3333-4333-8333-1\d{11}$/.test(id) ? Number(id.slice(-11)) : null;

/**
 * What each catalog accelerator needs, and its honest limits. Shown as gaps in Fit & gap; a caveat is never hidden
 * because the fit looks good.
 */
export const ACCELERATORS: Record<number, { needs: ConceptKey[]; caveat: string; agent?: string }> =
  {
    1: {
      needs: ["data"],
      caveat:
        "A developer instance to build against, not production. Production means Data Manager for Energy.",
    },
    2: {
      needs: ["data"],
      caveat: "An evaluation environment with sample well data; the customer's data needs loading.",
    },
    3: {
      needs: ["data", "ownership"],
      caveat: "The customer runs the Kubernetes platform, so it needs platform-team skills.",
    },
    4: {
      needs: ["data"],
      caveat: "Administration only; useful once Data Manager for Energy exists.",
    },
    5: { needs: ["data"], caveat: "Loads public reference data, not the customer's." },
    6: {
      needs: ["data", "context"],
      caveat: "A community sample. Use it to illustrate, not as the base of a proof.",
      agent: "Answers in plain language, grounded in Data Manager for Energy.",
    },
    7: {
      needs: ["workflows", "data", "governance"],
      caveat:
        "Provides the orchestration and the human approval. The specialist agents and their tools are configured for this workflow, and each needs a data source it can read.",
      agent:
        "A planner and specialist agents on Microsoft Foundry, in the customer's subscription; a person approves every plan.",
    },
    8: {
      needs: ["data"],
      caveat: "Needs a streaming source connected, and Fabric capacity sized for it.",
      agent: "Answers about operations in plain language over live data.",
    },
    9: {
      needs: ["data"],
      caveat:
        "An extraction schema is defined for each document type, and accuracy depends on document quality. People review the low-confidence fields.",
    },
    10: {
      needs: ["data", "governance"],
      caveat: "Needs transcripts in volume, and agreement on how personal data is handled.",
    },
    11: {
      needs: ["data", "governance"],
      caveat:
        "Answers are only as good as the documents indexed, and results must respect each user's permissions.",
      agent: "A chat grounded in the customer's documents, with citations.",
    },
    12: {
      needs: ["context", "data"],
      caveat: "Assumes Fabric, and agreed definitions for the data agents will query.",
      agent: "Foundry agents that query governed Fabric data in the flow of work.",
    },
    13: {
      needs: ["data", "context"],
      caveat: "A foundation, not a use case. Pair it with one workflow so the value is visible.",
    },
  };

/* ------------------------------------------------------------------------------------------ routing */

export type Suggestion = { card: Card; because: string };

const quote = (s: string) => `“${s.length > 90 ? `${s.slice(0, 87)}…` : s}”`;

/**
 * What to ask next, with the reason. Follow-ups from the most recent answers come first, then the openers for
 * what the customer said they're struggling with, then the basics nobody has captured yet. Always starts from the
 * outcome, before any technology.
 */
export function suggest(e: Engagement): Suggestion[] {
  const touched = new Set(e.trail.map((t) => t.card));
  const out: Suggestion[] = [];
  const add = (id: string, because: string) => {
    const card = CARD_BY_ID.get(id);
    if (card && !touched.has(id) && !out.some((s) => s.card.id === id)) out.push({ card, because });
  };
  const understood = e.trail.some((t) => t.card.startsWith("u-"));
  if (!understood) add("u-outcome", "Start with the outcome, before any technology.");
  for (const t of [...e.trail].reverse()) {
    const card = CARD_BY_ID.get(t.card);
    if (!card || t.parked) continue;
    for (const aid of t.answers) {
      const a = answerOf(card, aid);
      for (const n of a?.next ?? []) add(n, `Because they said ${quote(a!.label)}.`);
    }
  }
  for (const p of PATHS.filter((x) => e.brief.signals?.includes(x.key)))
    add(p.start, `Because they opened with ${quote(p.says)}`);
  const missing: [string, string][] = [
    ["u-workflow", "No workflow named yet. Value comes from one piece of work."],
    ["u-owner", "Nobody owns the result yet."],
    ["u-why-now", "Why now hasn't come up."],
    ["u-baseline", "There's nothing to measure against yet."],
  ];
  for (const [id, why] of missing) add(id, why);
  if (e.trail.filter((t) => t.card.startsWith("x-") && !t.parked).length >= 3) {
    add("v-success", "Enough is known to ask what success would look like.");
    add("v-constraints", "Capture what a proof must respect before proposing one.");
  }
  return out;
}

/* ----------------------------------------------------------------------------------------- reasoning */

const STATUS_RANK: Record<Readiness, number> = {
  blocker: 0,
  partial: 1,
  unknown: 2,
  ready: 3,
  "not-needed": 4,
};

/** Readiness per concept, from what the customer answered. The latest answer about a concept wins. */
export function readinessOf(e: Engagement): ReadinessMap {
  const out: ReadinessMap = {};
  for (const t of e.trail) {
    const card = CARD_BY_ID.get(t.card);
    if (!card || t.parked) continue;
    for (const aid of t.answers) {
      const a = answerOf(card, aid);
      if (a?.sets) out[a.sets.concept] = { status: a.sets.status, note: a.label };
    }
  }
  return out;
}

export type Fit = {
  n: number;
  id: string;
  score: number;
  because: string[];
  gaps: string[];
  caveat: string;
  agent?: string;
};

/** Accelerators ranked by how many answers point to them, with why, and what stands in the way. */
export function fitOf(e: Engagement): Fit[] {
  const map = new Map<number, string[]>();
  for (const t of e.trail) {
    const card = CARD_BY_ID.get(t.card);
    if (!card || t.parked) continue;
    for (const aid of t.answers) {
      const a = answerOf(card, aid);
      for (const n of a?.accelerators ?? [])
        map.set(n, [...(map.get(n) ?? []), `“${a!.label}”, in answer to: ${card.question}`]);
    }
  }
  const readiness = readinessOf(e);
  return [...map.entries()]
    .map(([n, because]) => {
      const meta = ACCELERATORS[n] ?? { needs: [], caveat: "" };
      const gaps = meta.needs.flatMap((k) => {
        const st = readiness[k]?.status ?? "unknown";
        const c = CONCEPT_BY_KEY.get(k)!;
        return st === "blocker"
          ? [`Blocked: ${c.gap}.`]
          : st === "partial"
            ? [`Partly there: ${c.title}.`]
            : st === "unknown"
              ? [`Not yet known: ${c.title}.`]
              : [];
      });
      return {
        n,
        id: productId(n),
        score: because.length,
        because,
        gaps,
        caveat: meta.caveat,
        ...(meta.agent ? { agent: meta.agent } : {}),
      };
    })
    .sort((a, b) => b.score - a.score || a.gaps.length - b.gaps.length);
}

export type Gate = {
  key: string;
  title: string;
  concept: ConceptKey[];
  status: Readiness;
  note: string;
};

/**
 * Is an agent the right answer yet? Three different questions that are easy to blur: can it reach the data
 * (availability), does it know what the data means (context), and can it act safely (action). A blocked gate means
 * a smaller first step, not a platform replacement.
 */
export function agentGates(e: Engagement): { gates: Gate[]; verdict: string } {
  const r = readinessOf(e);
  const worst = (keys: ConceptKey[]): Readiness =>
    keys.map((k) => r[k]?.status ?? "unknown").sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])[0]!;
  const notes = (keys: ConceptKey[]) =>
    keys
      .map((k) => r[k]?.note)
      .filter(Boolean)
      .join(" · ");
  const gates: Gate[] = [
    {
      key: "reach",
      title: "It can reach the data",
      concept: ["data", "modernize"],
      status: worst(["data", "modernize"]),
      note: notes(["data", "modernize"]),
    },
    {
      key: "meaning",
      title: "It knows what the data means",
      concept: ["context"],
      status: worst(["context"]),
      note: notes(["context"]),
    },
    {
      key: "act",
      title: "It can act safely",
      concept: ["workflows", "governance"],
      status: worst(["workflows", "governance"]),
      note: notes(["workflows", "governance"]),
    },
  ];
  const blocked = gates.filter((g) => g.status === "blocker");
  const unknown = gates.filter((g) => g.status === "unknown");
  const verdict = blocked.length
    ? `Not an agent yet. First: ${blocked.map((g) => g.title.toLowerCase()).join(", and ")}. That's a smaller step with value of its own, not a platform rebuild.`
    : unknown.length
      ? `Possibly. Still to find out: ${unknown.map((g) => g.title.toLowerCase()).join(", and ")}.`
      : "Yes: an agent that drafts and a person who approves, scoped to this workflow.";
  return { gates, verdict };
}

/** Next steps the conversation points to, not yet agreed. */
export function proposedActions(e: Engagement, name: (n: number) => string | undefined): string[] {
  const agreed = new Set(e.actions.map((a) => a.text));
  const out: string[] = [];
  for (const t of e.trail) {
    const card = CARD_BY_ID.get(t.card);
    if (!card || t.parked) continue;
    for (const aid of t.answers) {
      const a = answerOf(card, aid);
      if (a?.action && !agreed.has(a.action) && !out.includes(a.action)) out.push(a.action);
    }
  }
  const top = fitOf(e)[0];
  if (top) {
    const step = `A proof on ${name(top.n) ?? "the best-fitting accelerator"}, scoped to the agreed workflow.`;
    if (!agreed.has(step)) out.push(step);
  }
  for (const step of [
    "Architecture design session with the enterprise architect.",
    "Executive briefing with the business owner.",
  ])
    if (!agreed.has(step)) out.push(step);
  return out;
}

/* --------------------------------------------------------------------------------- recording answers */

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/**
 * Record an answer: replace the turn for that card, and replace the findings it produced. Findings the presenter
 * already confirmed or ruled out are kept.
 */
export function recordAnswer(
  e: Engagement,
  input: { card: string; answers: string[]; note: string; session: string; parked?: boolean },
): Pick<Engagement, "trail" | "findings" | "brief"> {
  const card = CARD_BY_ID.get(input.card);
  const at = new Date().toISOString();
  const turn = { ...input, at, ...(input.parked ? { parked: true } : {}) };
  const trail = [...e.trail.filter((t) => t.card !== input.card), turn];
  const kept = e.findings.filter((f) => f.card !== input.card || f.source === "ai" || f.edited);
  const fresh: Finding[] =
    card && !input.parked
      ? input.answers.flatMap((aid) => {
          const a = answerOf(card, aid);
          if (!a?.finding) return [];
          return [
            {
              id: uid(),
              text: a.finding.text,
              kind: a.finding.kind,
              source: a.finding.kind === "confirmed" ? "customer" : "presenter",
              card: card.id,
              at,
              // Their words back up what they confirmed; a name or a metric isn't a quote.
              ...(input.note.trim() &&
              a.finding.kind === "confirmed" &&
              !["owner", "baseline", "workflow"].includes(card.capture ?? "")
                ? { quote: input.note.trim() }
                : {}),
            } satisfies Finding,
          ];
        })
      : [];
  const brief = { ...e.brief };
  const note = input.note.trim();
  if (card?.capture && note && !input.parked) {
    if (card.capture === "baseline") {
      const rest = (brief.baseline ?? []).filter((m) => m.metric.trim() && m.metric !== note);
      brief.baseline = [...rest, { metric: note, value: "", unit: "" }];
    } else brief[card.capture] = note;
  }
  return { trail, findings: [...kept, ...fresh], brief };
}

export const newId = uid;

/** Moving on never moves the engagement backwards. */
export const advance = (e: Engagement, s: Stage) =>
  e.stage !== "decided" && stageIndex(s) > stageIndex(e.stage) ? { stage: s } : {};

export const KIND_LABEL: Record<FindingKind, string> = {
  confirmed: "Confirmed",
  hypothesis: "Hypothesis",
  unknown: "Still unknown",
  "ruled-out": "Ruled out",
};

export const SOURCE_LABEL: Record<Finding["source"], string> = {
  customer: "Customer",
  presenter: "Presenter",
  ai: "AI suggestion",
};

/** How much has happened in each stage. */
export function counts(e: Engagement) {
  const live = e.trail.filter((t) => !t.parked);
  const by = (s: CardStage) => live.filter((t) => CARD_BY_ID.get(t.card)?.stage === s).length;
  return {
    understand: by("understand"),
    explore: by("explore"),
    illustrate: e.trail.filter((t) => t.card.startsWith("show:")).length,
    validate: e.findings.filter((f) => f.kind === "hypothesis").length,
    agree: e.actions.length,
    parked: e.trail.filter((t) => t.parked).length,
  };
}
