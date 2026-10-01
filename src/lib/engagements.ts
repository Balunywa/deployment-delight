/*
 * Engagements: listen and consult before solutioning. Pure: the six concepts an engagement is assessed on, the
 * stages, and the story generated for each audience from what was captured. Nothing here invents numbers: a
 * baseline is either measured or shown as "to measure".
 */

export type ConceptKey =
  "workflows" | "context" | "modernize" | "data" | "governance" | "ownership";
export type Readiness = "ready" | "partial" | "blocker" | "not-needed" | "unknown";
export type Audience = "executive" | "technical" | "internal";
export type Stage = "listen" | "assess" | "map" | "propose" | "prove" | "decided";

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
  { key: "listen", title: "Listen", sub: "The business problem and baseline" },
  { key: "assess", title: "Assess", sub: "Readiness across six concepts" },
  { key: "map", title: "Map", sub: "Priorities to accelerators" },
  { key: "propose", title: "Propose", sub: "The story, per audience" },
  { key: "prove", title: "Prove", sub: "Deploy, measure, decide" },
];

export type Stakeholder = { name: string; role: string; audience: Audience };
export type Metric = { metric: string; value: string; unit: string };

export type Brief = {
  problem?: string;
  workflow?: string;
  outcome?: string;
  whyNow?: string;
  owner?: string;
  constraints?: string;
  stakeholders?: Stakeholder[];
  baseline?: Metric[];
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
  created_at: string;
  updated_at: string;
};

/** What's missing before each stage is done; empty means done. */
export function gaps(
  e: Pick<Engagement, "brief" | "readiness" | "solution_map" | "results" | "decision">,
) {
  const b = e.brief;
  return {
    listen: [
      !b.workflow?.trim() && "the workflow",
      !b.problem?.trim() && "the business problem",
      !b.outcome?.trim() && "the outcome",
      !b.owner?.trim() && "an accountable owner",
      !(b.baseline ?? []).some((m) => m.metric.trim()) && "a baseline metric",
    ].filter(Boolean) as string[],
    assess: CONCEPTS.filter(
      (c) => !e.readiness[c.key] || e.readiness[c.key]!.status === "unknown",
    ).map((c) => c.title),
    map: e.solution_map.some((m) => m.products.length) ? [] : ["an accelerator for a priority"],
    propose: [] as string[],
    prove: e.decision ? [] : ["a decision"],
  };
}

/** Where an engagement is: the stages done, the current one, and what it needs next. */
export function progressOf(e: Engagement) {
  const g = gaps(e);
  const current = e.stage === "decided" ? 5 : STAGES.findIndex((s) => s.key === e.stage);
  const next =
    e.stage === "decided"
      ? `Decided: ${e.decision?.choice ?? ""}`
      : (g[e.stage as keyof typeof g] as string[]).length
        ? `Needs ${(g[e.stage as keyof typeof g] as string[]).slice(0, 2).join(" and ")}`
        : `Ready for ${STAGES[Math.min(current + 1, STAGES.length - 1)]!.title}`;
  return { current, next };
}

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const sentence = (s: string) => (s && !/[.!?]$/.test(s.trim()) ? `${s.trim()}.` : s.trim());

export type Story = {
  audience: Audience;
  title: string;
  /** For internal material: never shown to the customer. */
  internalOnly: boolean;
  opening: string[];
  messages: string[];
  ask: string;
  sections: { title: string; items: string[] }[];
};

/**
 * The same strategic narrative for three audiences, filled from the engagement. Emphasis changes; facts don't.
 * Claims are only what was captured; anything unmeasured says so.
 */
export function buildStory(
  e: Engagement,
  audience: Audience,
  productName: (id: string) => string | undefined,
): Story {
  const b = e.brief;
  const customer = e.customer_name ?? "the customer";
  const workflow = b.workflow?.trim() || "the first workflow";
  const outcome = b.outcome?.trim() || "a measurable change in that workflow";
  const owner = b.owner?.trim() || "";
  const status = (k: ConceptKey) => e.readiness[k]?.status ?? "unknown";
  const barriers = CONCEPTS.filter(
    (c) => status(c.key) === "blocker" || status(c.key) === "partial",
  );
  const blockers = CONCEPTS.filter((c) => status(c.key) === "blocker");
  const mapped = e.solution_map.flatMap((m) =>
    m.products.map((id) => ({
      concept: m.concept,
      name: productName(id) ?? "an accelerator",
      note: m.note,
    })),
  );
  const metrics = (b.baseline ?? []).filter((m) => m.metric.trim());
  const measured = (m: Metric) =>
    m.value.trim()
      ? `${m.metric}: ${m.value}${m.unit ? ` ${m.unit}` : ""} today`
      : `${m.metric}: baseline to measure`;
  const solutions = mapped.length
    ? `We'd start from ${list([...new Set(mapped.map((m) => m.name))])}, proven Microsoft accelerators packaged to deploy the same way every time`
    : "We'd start from a proven, reusable accelerator";

  if (audience === "executive")
    return {
      audience,
      title: `${customer}: ${workflow}`,
      internalOnly: false,
      opening: [
        `Most organizations now have AI pilots; far fewer have AI that changes how work gets done. For ${customer}, the work that matters most right now is ${lower(workflow)}. ${sentence(b.problem ?? "")}`.trim(),
        barriers.length
          ? `What's in the way isn't the model. It's ${list(barriers.map((c) => c.gap))}.`
          : "What's in the way usually isn't the model: it's reachable data, shared business meaning, and a safe way for AI to act.",
        `${solutions}. We'd modernize only what blocks this workflow, run it under the same security and cost controls as everything else, and measure it against today's baseline.`,
        `The goal: ${lower(sentence(outcome))}`,
        b.whyNow ? `Why now: ${lower(sentence(b.whyNow))}` : "",
      ].filter(Boolean),
      messages: [
        `Value comes from changing ${lower(workflow)}, not from more pilots.`,
        "Reachable data, shared business meaning and safe action are different problems; we solve them for this workflow first, without replacing everything.",
        owner
          ? `${owner} owns the outcome, and it's measured from day one.`
          : "The outcome needs a named owner, and a measure from day one.",
      ],
      ask: `Agree ${lower(workflow)} as the first workflow, ${owner ? `confirm ${owner} as its owner` : "name an accountable owner"}, and agree the baseline${metrics.length ? ` (${list(metrics.map((m) => lower(m.metric)))})` : ""}. We'll come back with a 90-day plan to put it into production.`,
      sections: [
        {
          title: "Briefing outline",
          items: [
            `Most of our AI investment hasn't changed how ${lower(workflow)} gets done yet.`,
            `The goal: ${lower(sentence(outcome))}`,
            "Three barriers stand between pilots and value: reachable data, shared meaning, and safe action.",
            `Modernize what blocks ${lower(workflow)} first.`,
            "One connected approach: agents act on trusted context, over governed data, on modern systems.",
            "Security, governance and cost control are what let AI scale.",
            "How we'll prove it: measured against today's baseline.",
            "A 90-day path: one workflow, owned, deployed and measured.",
            "The decision: confirm the workflow, the owner and the measures.",
          ],
        },
        {
          title: "How the customer will measure success",
          items: metrics.length
            ? metrics.map(measured)
            : ["Agree the baseline metric for this workflow"],
        },
        {
          title: "Check before presenting",
          items: [
            "Every statistic has a source and a date, or it comes out.",
            "Competitive comparisons are like-for-like, or they come out.",
            "Preview capabilities are labelled preview; offers state their conditions.",
            "No ROI figure without the customer's baseline and a method.",
          ],
        },
      ],
    };

  if (audience === "technical")
    return {
      audience,
      title: `${workflow}: dependencies and validation`,
      internalOnly: false,
      opening: [
        `Workflow: ${workflow}. ${sentence(b.problem ?? "")}`.trim(),
        b.constraints ? `Constraints: ${sentence(b.constraints)}` : "",
        blockers.length
          ? `Blocking today: ${list(blockers.map((c) => c.gap))}.`
          : "Nothing is recorded as blocking; confirm the partly-ready areas before the PoC.",
      ].filter(Boolean),
      messages: [
        "Start from a pinned, reviewed accelerator release, not a fork.",
        "Prove it in a sandbox against the customer's constraints, then promote the same release.",
        "Production readiness is checked, not assumed: landing zone, identity, data access, evaluation and cost.",
      ],
      ask: "Agree the PoC environment and access, and who signs off production readiness.",
      sections: [
        {
          title: "Dependencies",
          items: CONCEPTS.map((c) => {
            const r = e.readiness[c.key];
            return `${c.title}: ${READINESS[r?.status ?? "unknown"].label.toLowerCase()}${r?.note ? ` (${r.note})` : ""}`;
          }),
        },
        {
          title: "Technical validation (PoC)",
          items: mapped.length
            ? mapped.map(
                (m) =>
                  `Deploy ${m.name} into a sandbox from its pinned release${m.note ? `: ${lower(sentence(m.note))}` : "."}`,
              )
            : ["Map an accelerator to the workflow first"],
        },
        {
          title: "Production readiness",
          items: [
            `Landing zone and policy: ${READINESS[status("governance")].label.toLowerCase()}`,
            `Data access for the workflow: ${READINESS[status("data")].label.toLowerCase()}`,
            `Business context: ${READINESS[status("context")].label.toLowerCase()}`,
            "Evaluation and monitoring of AI answers and actions",
            "Cost guardrails and an owner for spend",
          ],
        },
        {
          title: "Handoffs",
          items: [
            "SE → CSA: engagement brief, readiness and the solution map travel with the engagement",
            "CSA → delivery or partner: the offering is pinned to a version, deployed through the customer's own pipeline",
            "Delivery → operations: the install shows in the installed base, with releases rolled out ring by ring",
          ],
        },
      ],
    };

  return {
    audience,
    title: `${customer}: priorities and accountability`,
    internalOnly: true,
    opening: [
      `${customer} · ${workflow}. Stage: ${e.stage}. ${owner ? `Customer owner: ${owner}.` : "No customer owner yet."}`,
      e.owner_name ? `Our owner: ${e.owner_name}.` : "No owner on our side yet.",
    ],
    messages: [
      "Lead with the customer's workflow and baseline, never with products or our metrics.",
      "Reuse a catalog accelerator before building anything new.",
      "Every next step has a named owner and a date.",
    ],
    ask: "Commit delivery resources for the 90-day plan, and confirm who owns each next step.",
    sections: [
      {
        title: "Priorities",
        items: [
          `First workflow: ${workflow}`,
          ...barriers.map(
            (c) =>
              `Unblock: ${c.title}${e.readiness[c.key]?.note ? ` (${e.readiness[c.key]!.note})` : ""}`,
          ),
        ],
      },
      {
        title: "Resources to reuse",
        items: mapped.length
          ? [...new Set(mapped.map((m) => `${m.name} (catalog accelerator)`))]
          : ["Pick an accelerator in Map"],
      },
      {
        title: "Commercial measures (internal only, never in customer material)",
        items: [
          "Azure consumption from the deployed offering",
          "Workloads in production",
          "Accelerator reuse across customers",
          "Pipeline stage and next milestone",
        ],
      },
    ],
  };
}

export function storyText(s: Story) {
  return [
    s.internalOnly ? "INTERNAL — NOT FOR CUSTOMERS" : "",
    s.title,
    "",
    ...s.opening,
    "",
    "Remember:",
    ...s.messages.map((m, i) => `${i + 1}. ${m}`),
    "",
    `The ask: ${s.ask}`,
    ...s.sections.flatMap((sec) => ["", `${sec.title}:`, ...sec.items.map((i) => `- ${i}`)]),
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();
}
