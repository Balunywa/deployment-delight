/*
 * Which of the playbook's four CAIP conversations to lead with, from what MSX and the notes show. A conversation
 * scores when its products appear in the account's open milestones (what the account team is driving), its open
 * opportunities, what already runs in production, or the technical areas the notes mention. Every recommendation
 * says why, so the SE can disagree.
 */
import type { MsxMilestone } from "./msx-connector";
import { cleanWorkload } from "./msx-signals";
import type { Prep } from "./prep";
import { CONVERSATIONS, type Conversation, type ConversationId } from "./se-playbook";

export type Recommendation = {
  id: ConversationId;
  title: string;
  score: number;
  reasons: string[];
};

/** Technical areas the prep finds in the notes, by the conversation they point to. */
const AREA_TO_CONVERSATION: Record<string, ConversationId> = {
  "azure-local": "modernize",
  aks: "modernize",
  oracle: "modernize",
  migration: "modernize",
  vmware: "modernize",
  sap: "modernize",
  sql: "modernize",
  avd: "modernize",
  "landing-zone": "modernize",
  network: "modernize",
  resilience: "modernize",
  apps: "modernize",
  hpc: "modernize",
  data: "data-ai-platform",
  iot: "data-ai-platform",
  ai: "ubiquitous-innovation",
  security: "ubiquitous-innovation",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * How MSX names workloads, beyond the product names the playbook uses ("Data: Data Platform - Databases - SQL",
 * "Lakehouse, Warehouse", "Infra | SQL Server Modernization"). Our addition, not the playbook's.
 */
const MSX_ALIASES: Record<ConversationId, string[]> = {
  "ubiquitous-innovation": ["github", "devops", "agentic", "copilot studio", "dev tools"],
  "amplify-intelligence": ["ai search", "knowledge", "work iq", "copilot"],
  modernize: [
    "sql",
    "databases",
    "infra",
    "migration",
    "modernize",
    "modernization",
    "windows",
    "iaas",
    "paas",
    "avd",
  ],
  "data-ai-platform": [
    "analytics",
    "lakehouse",
    "warehouse",
    "data platform",
    "data & ai",
    "data and ai",
    "real-time",
  ],
};
const termsOf = (c: Conversation) => [...c.msxTerms, ...MSX_ALIASES[c.id]];

/** Whether a conversation's product term appears in a text (whole words for short terms like "sql" or "aks"). */
export function mentions(c: Conversation, text: string | null | undefined) {
  const t = (text ?? "").toLowerCase();
  if (!t) return [];
  return termsOf(c).filter((term) =>
    term.length <= 4 ? new RegExp(`\\b${escape(term)}\\b`, "i").test(t) : t.includes(term),
  );
}

const list = (xs: string[], n = 3) => {
  const u = [...new Set(xs)];
  return u.length > n ? `${u.slice(0, n).join(", ")} and ${u.length - n} more` : u.join(", ");
};

export function recommendConversations(prep: Prep | null | undefined): Recommendation[] {
  const s = prep?.msx;
  return CONVERSATIONS.map((c) => {
    let score = 0;
    const reasons: string[] = [];
    const motion = (s?.inMotion ?? []).filter((w) => mentions(c, w.workload).length);
    if (motion.length) {
      score += 3 * motion.length + motion.reduce((n, w) => n + w.flagged, 0);
      reasons.push(
        `MSX milestones in motion: ${list(motion.map((w) => cleanWorkload(w.workload)))}`,
      );
    }
    // What the account team is actually driving (milestones) weighs most; opportunity names and notes add a little.
    // Solution areas and sales plays are too broad ("AI Business Solutions") to tell the conversations apart.
    const opps = (s?.opportunities ?? []).filter((o) => mentions(c, o.name).length);
    if (opps.length) {
      score += Math.min(5, opps.length);
      reasons.push(
        `Open opportunities: ${list(
          opps.map((o) => o.name),
          2,
        )}`,
      );
    }
    const live = (s?.live ?? []).filter((l) => mentions(c, l.workload).length);
    if (live.length) {
      score += live.length;
      reasons.push(`Already in production: ${list(live.map((l) => cleanWorkload(l.workload)))}`);
    }
    const areas = (prep?.areas ?? []).filter((a) => AREA_TO_CONVERSATION[a.id] === c.id);
    if (areas.length) {
      score += Math.min(3, areas.length);
      reasons.push(`Your notes mention ${list(areas.flatMap((a) => a.matched))}`);
    }
    return { id: c.id, title: c.title, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

/** The conversation to lead with, when anything points to one. */
export const topConversation = (prep: Prep | null | undefined) => {
  const r = recommendConversations(prep)[0];
  return r && r.score > 0 ? r.id : null;
};

export const conversationById = (id: ConversationId | null | undefined) =>
  CONVERSATIONS.find((c) => c.id === id) ?? null;

/** Open milestones whose workload belongs to this conversation: the ones the SE drives from uncommitted to committed. */
export function milestonesFor(c: Conversation, open: MsxMilestone[]) {
  return open.filter((m) => mentions(c, `${m.workload ?? ""} ${m.name}`).length);
}

/** Customer contacts whose titles match the conversation's decision makers (CIO, CTO, CISO…). */
export function decisionMakersAmong(
  c: Conversation,
  contacts: { name: string; title: string | null }[],
) {
  const roles = c.decisionMakers
    .flatMap((d) => d.split(/[,/]| and /))
    .map((r) => r.trim())
    .filter((r) => r.length >= 2 && r.length <= 40);
  const acronyms = roles.filter((r) => /^[A-Z]{2,5}s?$/.test(r)).map((r) => r.replace(/s$/, ""));
  return contacts.filter((p) => {
    const t = p.title ?? "";
    return (
      acronyms.some((a) => new RegExp(`\\b${a}\\b`).test(t)) ||
      roles.some((r) => r.length > 5 && t.toLowerCase().includes(r.toLowerCase()))
    );
  });
}
