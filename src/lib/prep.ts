/*
 * Pre-call prep from what we hold about a customer: the MSX snapshot plus the notes, emails, transcripts and briefs
 * the SE added. It builds a context map, two or three discovery questions, technical areas to review (hints, not a
 * solution) and similar engagements by peers. Rules only, grounded in the stored text: it quotes, it doesn't invent.
 */
import type { MsxSnapshot } from "./msx-connector";
import { type MsxSignals, cleanWorkload, msxSignals } from "./msx-signals";

export type PrepEntry = {
  id?: string | undefined;
  source: "msx" | "notes" | "email" | "transcript" | "prompt" | "other";
  title: string;
  text: string;
  at?: string | undefined;
  msx?: MsxSnapshot | undefined;
};

export type Area = {
  id: string;
  label: string;
  terms: RegExp[];
  review: { title: string; url: string }[];
  ask: string[];
};

const L = (path: string) => `https://learn.microsoft.com/${path}`;

/** Technical areas an SE should review when the context mentions them. Links are Microsoft Learn. */
export const AREAS: Area[] = [
  {
    id: "azure-local",
    label: "Azure Local (edge and on-premises)",
    terms: [/\bazure local\b/i, /\bazure stack( hci)?\b/i, /\bHCI\b/, /\bdisconnected\b/i],
    review: [{ title: "Azure Local overview", url: L("azure/azure-local/overview") }],
    ask: [
      "Which sites must keep running when disconnected from Azure, and for how long?",
      "What runs at those sites today, on what hardware, and who operates it?",
    ],
  },
  {
    id: "aks",
    label: "Containers and AKS",
    terms: [
      /\bAKS\b/,
      /\bkubernetes\b/i,
      /\bk8s\b/i,
      /\bcontaineri[sz]/i,
      /\bcontainers?\b/i,
      /\bopenshift\b/i,
    ],
    review: [
      { title: "What is AKS?", url: L("azure/aks/what-is-aks") },
      {
        title: "AKS baseline architecture",
        url: L("azure/architecture/reference-architectures/containers/aks/baseline-aks"),
      },
    ],
    ask: [
      "How many teams would deploy to the clusters, and how do they ship today?",
      "Is there a platform team that owns Kubernetes, or would this be the first?",
    ],
  },
  {
    id: "oracle",
    label: "Oracle workloads",
    terms: [/\boracle\b/i, /\bexadata\b/i, /\bRAC\b/],
    review: [
      { title: "Oracle Database@Azure", url: L("azure/oracle/oracle-db/database-overview") },
      {
        title: "Oracle on Azure (Cloud Adoption Framework)",
        url: L("azure/cloud-adoption-framework/scenarios/oracle-iaas/"),
      },
    ],
    ask: [
      "Which Oracle features do they depend on (RAC, Data Guard, Exadata), and what's the licence position?",
      "Which applications use these databases, and how sensitive are they to latency?",
    ],
  },
  {
    id: "migration",
    label: "Datacenter migration",
    terms: [
      /\bdata ?cent(er|re)s?\b/i,
      /\bDC exit\b/i,
      /\bmigrat(e|ion|ing)\b/i,
      /\blift[- ]and[- ]shift\b/i,
      /\brehost/i,
      /\bon[- ]prem(ise|ises)?\b/i,
      /\bcolo(cation)?\b/i,
    ],
    review: [
      { title: "Azure Migrate overview", url: L("azure/migrate/migrate-services-overview") },
      {
        title: "Migrate (Cloud Adoption Framework)",
        url: L("azure/cloud-adoption-framework/migrate/"),
      },
    ],
    ask: [
      "What sets the date: a lease, a hardware refresh, a contract?",
      "Is there an inventory of servers and applications, and which apps can't move as they are?",
    ],
  },
  {
    id: "vmware",
    label: "VMware estate",
    terms: [/\bvmware\b/i, /\bvsphere\b/i, /\bvcenter\b/i, /\bAVS\b/, /\bbroadcom\b/i],
    review: [{ title: "Azure VMware Solution", url: L("azure/azure-vmware/introduction") }],
    ask: [
      "When does the VMware renewal land, and what did the new terms change?",
      "Would they move as VMware (Azure VMware Solution) or convert to Azure VMs?",
    ],
  },
  {
    id: "sap",
    label: "SAP",
    terms: [/\bSAP\b/, /\bS\/?4 ?HANA\b/i, /\bHANA\b/i, /\bECC\b/, /\bRISE\b/],
    review: [
      { title: "SAP on Azure", url: L("azure/sap/workloads/get-started") },
      {
        title: "SAP (Cloud Adoption Framework)",
        url: L("azure/cloud-adoption-framework/scenarios/sap/"),
      },
    ],
    ask: [
      "Is this RISE with SAP or customer-managed, and where is ECC end of maintenance in their plan?",
    ],
  },
  {
    id: "ai",
    label: "AI and agents",
    terms: [
      /\bAI\b/,
      /\bGenAI\b/i,
      /\bgenerative\b/i,
      /\bopen ?ai\b/i,
      /\bGPT/i,
      /\bLLMs?\b/i,
      /\bcopilots?\b/i,
      /\bagent(s|ic)?\b/i,
      /\bfoundry\b/i,
      /\bRAG\b/,
      /\bchat ?bot/i,
    ],
    review: [
      { title: "What is Azure AI Foundry?", url: L("azure/ai-foundry/what-is-azure-ai-foundry") },
      {
        title: "Baseline chat architecture",
        url: L("azure/architecture/ai-ml/architecture/baseline-openai-e2e-chat"),
      },
    ],
    ask: [
      "Which task or decision should this change, and who does it today?",
      "Where is the data it needs, who may see it, and how will they judge the answers good enough?",
    ],
  },
  {
    id: "data",
    label: "Data and analytics",
    terms: [
      /\bfabric\b/i,
      /\bsynapse\b/i,
      /\bdatabricks\b/i,
      /\bdata ?lake/i,
      /\blakehouse\b/i,
      /\bdata ?warehouse/i,
      /\bpower ?bi\b/i,
      /\bETL\b/,
    ],
    review: [
      {
        title: "Microsoft Fabric overview",
        url: L("fabric/fundamentals/microsoft-fabric-overview"),
      },
    ],
    ask: [
      "Which report or decision is slow or wrong today because of the data?",
      "Where does the data live, and who owns its definitions?",
    ],
  },
  {
    id: "sql",
    label: "SQL Server estate",
    terms: [/\bSQL ?Server\b/i, /\bAzure SQL\b/i, /\bmanaged instance\b/i, /\bSSIS\b/, /\bSSRS\b/],
    review: [
      {
        title: "What is Azure SQL?",
        url: L("azure/azure-sql/azure-sql-iaas-vs-paas-what-is-overview"),
      },
    ],
    ask: [
      "Which SQL Server versions and features do they rely on (SSIS, SSRS, CLR, cross-database queries)?",
    ],
  },
  {
    id: "avd",
    label: "Virtual desktops",
    terms: [/\bAVD\b/, /\bvirtual desktops?\b/i, /\bVDI\b/, /\bcitrix\b/i, /\bwindows 365\b/i],
    review: [{ title: "Azure Virtual Desktop", url: L("azure/virtual-desktop/overview") }],
    ask: ["Who are the users, where are they, and which apps and profiles must follow them?"],
  },
  {
    id: "landing-zone",
    label: "Azure foundation (landing zone)",
    terms: [
      /\blanding zones?\b/i,
      /\bgovernance\b/i,
      /\bmanagement groups?\b/i,
      /\bazure polic(y|ies)\b/i,
      /\bhub[- ]and[- ]spoke\b/i,
      /\bCAF\b/,
      /\bESLZ\b/,
      /\bALZ\b/,
    ],
    review: [
      {
        title: "Azure landing zones (Cloud Adoption Framework)",
        url: L("azure/cloud-adoption-framework/ready/landing-zone/"),
      },
    ],
    ask: [
      "Is there an Azure foundation today, who owns it, and which policies must every workload meet?",
    ],
  },
  {
    id: "network",
    label: "Hybrid networking",
    terms: [
      /\bexpress ?route\b/i,
      /\bVPN\b/,
      /\bhybrid\b/i,
      /\bfirewall\b/i,
      /\bprivate endpoints?\b/i,
      /\bSD-?WAN\b/i,
    ],
    review: [
      { title: "ExpressRoute overview", url: L("azure/expressroute/expressroute-introduction") },
    ],
    ask: [
      "How do their sites connect to Azure today, and what bandwidth and latency do they need?",
    ],
  },
  {
    id: "security",
    label: "Security and compliance",
    terms: [
      /\bsentinel\b/i,
      /\bdefender\b/i,
      /\bzero trust\b/i,
      /\bSIEM\b/,
      /\bSOC\b/,
      /\bcompliance\b/i,
      /\bransomware\b/i,
      /\bsovereign/i,
      /\bregulat(ed|ion|ory)\b/i,
    ],
    review: [
      { title: "Microsoft Sentinel overview", url: L("azure/sentinel/overview") },
      { title: "Zero Trust overview", url: L("security/zero-trust/zero-trust-overview") },
    ],
    ask: ["Which regulations or audits apply, and who runs security operations?"],
  },
  {
    id: "resilience",
    label: "Resilience and recovery",
    terms: [
      /\bdisaster recovery\b/i,
      /\bDR\b/,
      /\bbackups?\b/i,
      /\bRTO\b/,
      /\bRPO\b/,
      /\bbusiness continuity\b/i,
      /\bhigh availability\b/i,
      /\bdowntime\b/i,
    ],
    review: [
      { title: "Azure Site Recovery", url: L("azure/site-recovery/site-recovery-overview") },
      { title: "Well-Architected: Reliability", url: L("azure/well-architected/reliability/") },
    ],
    ask: ["How long can it be down, and how much data can they afford to lose?"],
  },
  {
    id: "iot",
    label: "Industrial IoT and OT",
    terms: [
      /\bIoT\b/i,
      /\bOT\b/,
      /\bSCADA\b/i,
      /\bhistorians?\b/i,
      /\bsensors?\b/i,
      /\bOPC ?UA\b/i,
      /\bPI System\b/i,
      /\bplants?\b/i,
      /\brefiner(y|ies)\b/i,
    ],
    review: [
      { title: "Azure IoT Operations", url: L("azure/iot-operations/overview-iot-operations") },
    ],
    ask: ["Which OT systems and protocols are involved, and what may leave the plant network?"],
  },
  {
    id: "apps",
    label: "Application modernization",
    terms: [
      /\bmoderni[sz](e|ation|ing)\b/i,
      /\bapp service\b/i,
      /\bweb apps?\b/i,
      /\bmicroservices?\b/i,
      /\blegacy app/i,
      /\b\.NET\b/i,
      /\bjava\b/i,
      /\bmainframe\b/i,
    ],
    review: [{ title: "Azure App Service", url: L("azure/app-service/overview") }],
    ask: ["What makes the current application hard to change, and what would they change first?"],
  },
  {
    id: "hpc",
    label: "High-performance computing",
    terms: [
      /\bHPC\b/,
      /\bseismic\b/i,
      /\breservoir simulation\b/i,
      /\bGPUs?\b/,
      /\brender(ing)?\b/i,
    ],
    review: [
      {
        title: "High-performance computing on Azure",
        url: L("azure/architecture/topics/high-performance-computing"),
      },
    ],
    ask: ["Which jobs, how often, and what limits them today: capacity, queue time or cost?"],
  },
];

/** A sentence from a source, with where and when it came from. */
export type Quote = {
  text: string;
  from: string;
  /** When the source says it was written (MSX: the opportunity's created date; context: when it was added). */
  at?: string | null;
  /** When it was pulled from MSX, for MSX sources. */
  retrieved?: string | null;
  origin?: "msx" | "context" | "brief";
};
export type MatchedArea = Omit<Area, "terms"> & { matched: string[] };
export type Similar = {
  customerId: string;
  customerName: string;
  engagement: { id: string; name: string; stage: string } | null;
  shared: string[];
};
export type Prep = {
  sources: { msx: boolean; added: number };
  account: { name: string | null; accounts: number | null; fetchedAt: string | null };
  origin: Quote[];
  goals: Quote[];
  whyNow: Quote[];
  people: Quote[];
  areas: MatchedArea[];
  gaps: string[];
  questions: { text: string; because: string }[];
  similar: Similar[];
  /** What the MSX snapshot shows: milestones, production workloads, attention, contacts, partners. */
  msx?: MsxSignals | null | undefined;
};

const GOAL =
  /\b(wants?|needs?|goals?|objectives?|looking to|plans? to|planning to|aims?|so that|in order to|reduce|improve|moderni[sz]e|migrate|consolidate|retire|replace|automate|scale|exit)\b/i;
const WHY_NOW =
  /\b(by (Q[1-4]|end of|the end|[A-Z][a-z]+ 20\d\d|20\d\d)|deadline|renewal|renew|expir(e|es|y|ing)|end of (support|life|maintenance)|EOL|contract|lease|turnaround|mandate|audit|board|before|urgent|this (year|quarter)|next (year|quarter))\b/i;
const PEOPLE =
  /\b(CIO|CTO|CDO|CISO|CEO|CFO|VP|vice president|director|head of|architect|owner|sponsor|decision[- ]maker|signs? off|budget holder)\b/i;
const BOILERPLATE =
  /^(MSX account:|Microsoft account team:|\d+ open opportunit|No open opportunities|- .+\(.*\)$|MSX has no description)/;

function sentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^\s*(Description|Forecast comments):\s*/i, "").trim())
    .filter((s) => s.length >= 12 && s.length <= 400 && !BOILERPLATE.test(s));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

type Passage = Omit<Quote, "text"> & { text: string };

/** Text to read for each source, labelled so every quote says where and when it came from. */
function passages(entries: PrepEntry[]): Passage[] {
  const out: Passage[] = [];
  for (const e of entries) {
    if (e.msx) {
      for (const o of e.msx.opportunities) {
        for (const t of [o.name, o.description, o.forecastComments])
          if (t)
            out.push({
              text: t,
              from: `MSX · ${o.name}`,
              at: o.createdOn,
              retrieved: e.msx.fetchedAt,
              origin: "msx",
            });
      }
    } else {
      const label =
        {
          msx: "MSX",
          notes: "Notes",
          email: "Email",
          transcript: "Transcript",
          prompt: "Brief",
          other: "Context",
        }[e.source] ?? "Context";
      out.push({
        text: e.text,
        from: `${label} · ${e.title}`,
        at: e.at ?? null,
        origin: e.source === "prompt" ? "brief" : "context",
      });
    }
  }
  return out;
}

function pick(ps: Passage[], re: RegExp, max: number): Quote[] {
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const p of ps)
    for (const s of sentences(p.text)) {
      const key = s.toLowerCase();
      if (re.test(s) && !seen.has(key)) {
        seen.add(key);
        out.push({ ...p, text: clip(s, 280) });
        if (out.length >= max) return out;
      }
    }
  return out;
}

export function matchAreas(text: string): MatchedArea[] {
  const found: MatchedArea[] = [];
  for (const { terms, ...a } of AREAS) {
    const matched = [
      ...new Set(
        terms.flatMap((re) => {
          const m = text.match(re);
          return m ? [m[0]] : [];
        }),
      ),
    ];
    if (matched.length) found.push({ ...a, matched });
  }
  return found.sort((x, y) => y.matched.length - x.matched.length);
}

export type Peer = {
  customerId: string;
  customerName: string;
  engagements: { id: string; name: string; stage: string }[];
  text: string;
};

export function buildPrep(input: {
  customer: { name: string; msx_account_name: string | null };
  context: PrepEntry[];
  peers: Peer[];
}): Prep {
  const snap = [...input.context].reverse().find((e) => e.msx)?.msx ?? null;
  const ps = passages(input.context);
  const all = ps.map((p) => p.text).join("\n");
  const areas = matchAreas(all);

  const origin: Quote[] = (snap?.opportunities ?? []).map((o) => ({
    text: [
      o.name,
      [o.stage, o.solutionArea, o.salesPlay].filter(Boolean).join(", "),
      o.owner && `owner ${o.owner}`,
      o.createdOn && `opened ${o.createdOn.slice(0, 10)}`,
      o.closeDate && `est. close ${o.closeDate.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    from: `MSX${o.number ? ` · ${o.number}` : ""}`,
    at: o.createdOn,
    retrieved: snap?.fetchedAt ?? null,
    origin: "msx" as const,
  }));
  const goals = pick(ps, GOAL, 5);
  const whyNow = pick(ps, WHY_NOW, 4);
  const people = pick(ps, PEOPLE, 3);
  const added = input.context.filter((e) => !e.msx).length;
  const signals = snap ? msxSignals(snap) : null;

  const gaps: string[] = [];
  if (!snap) gaps.push("No MSX snapshot yet: look the TPID up in MSX.");
  else if (!snap.opportunities.length)
    gaps.push("MSX has no open opportunity for this TPID: treat it as proactive until one exists.");
  else if (snap.opportunities.every((o) => !o.description))
    gaps.push("The MSX opportunities have no description: the seller's intent isn't written down.");
  if (snap && snap.milestones === undefined)
    gaps.push("This MSX snapshot predates milestones, contacts and partners: refresh it from MSX.");
  else if (snap?.opportunities.length && signals && !signals.inMotion.length)
    gaps.push(
      "No open milestones on the MSX opportunities: nothing is planned or committed for a workload yet.",
    );
  if (!goals.length) gaps.push("Nothing says what the customer wants to achieve.");
  if (!whyNow.length) gaps.push("Nothing says why now: no deadline, renewal or event.");
  if (!people.length) gaps.push("No sponsor or decision maker is named.");
  if (!added)
    gaps.push(
      "Only MSX so far: add the seller's or specialist's notes, emails or a call transcript.",
    );

  const questions: Prep["questions"] = [];
  const g = goals[0];
  questions.push(
    g
      ? {
          text: `"${clip(g.text, 140)}" Is that still the outcome that matters most, and how will you measure it?`,
          because: `Validates the stated goal (${g.from}) before any solutioning.`,
        }
      : {
          text: "What has to be true a year from now for this to count as a success, and who measures it?",
          because: "Nothing in MSX or the notes states the outcome.",
        },
  );
  const w = whyNow[0];
  questions.push(
    w
      ? {
          text: "What happens if this slips by six months?",
          because: `Tests the urgency behind "${clip(w.text, 100)}" (${w.from}).`,
        }
      : {
          text: "Why now? What happens if this waits a year?",
          because: "Nothing says why now.",
        },
  );
  const top = areas[0];
  // What MSX shows the account team driving: a stuck milestone is the most useful thing to ask about.
  const stuck = signals?.attention.find((a) =>
    a.flags.some((f) => f === "blocked" || f === "at-risk" || f === "overdue"),
  );
  const live = signals?.live[0];
  if (stuck)
    questions.push({
      text: `Where are you with ${cleanWorkload(stuck.milestone.workload) || "this work"}, and what's getting in the way?`,
      because: `MSX: ${stuck.text}`,
    });
  else if (live)
    questions.push({
      text: `How is ${cleanWorkload(live.workload)} working for you in production, and what would you change?`,
      because: `MSX shows a completed production milestone, “${live.milestone.name}” (${live.milestone.date?.slice(0, 10) ?? "no date"}).`,
    });
  if (top)
    questions.push({
      text: top.ask[0]!,
      because: `The context mentions ${top.matched.slice(0, 3).join(", ")}.`,
    });
  else if (!people.length)
    questions.push({
      text: "Who owns this outcome on your side, and who else has to say yes?",
      because: "No sponsor or decision maker is named.",
    });

  const mine = new Set(areas.map((a) => a.id));
  const similar: Similar[] = input.peers
    .map((p) => {
      const theirs = matchAreas(p.text);
      return {
        customerId: p.customerId,
        customerName: p.customerName,
        engagement: p.engagements[0] ?? null,
        shared: theirs.filter((a) => mine.has(a.id)).map((a) => a.label),
      };
    })
    .filter((s) => s.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, 5);

  return {
    sources: { msx: !!snap, added },
    account: {
      name: snap?.account?.name ?? input.customer.msx_account_name,
      accounts: snap?.accounts ?? null,
      fetchedAt: snap?.fetchedAt ?? null,
    },
    origin,
    goals,
    whyNow,
    people,
    areas,
    gaps,
    questions: questions.slice(0, 4),
    similar,
    msx: signals,
  };
}

/**
 * Puts the engagement's own MSX opportunity first: its technical areas lead, and quotes from it come before quotes
 * from other opportunities or notes. Nothing is removed.
 */
export function focusOn(p: Prep, opportunity: { name: string; text: string } | null): Prep {
  if (!opportunity) return p;
  const mine = new Set(matchAreas(opportunity.text).map((a) => a.id));
  const from = `MSX · ${opportunity.name}`;
  const first = <T>(xs: T[], test: (x: T) => boolean) => [
    ...xs.filter(test),
    ...xs.filter((x) => !test(x)),
  ];
  return {
    ...p,
    areas: first(p.areas, (a) => mine.has(a.id)),
    goals: first(p.goals, (q) => q.from === from),
    whyNow: first(p.whyNow, (q) => q.from === from),
    origin: first(p.origin, (q) => q.text.startsWith(opportunity.name)),
  };
}
