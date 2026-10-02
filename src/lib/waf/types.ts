/*
 * The Azure Well-Architected Framework as data the design is checked against. Every recommendation belongs to one
 * of the five pillars, cites Microsoft Learn, and may carry a check: a function of the actual design (the service's
 * settings, the rest of the workload, its topology and requirements) that says pass, warn or fail, and a fix that
 * can be applied in one click. Recommendations without a check are advice, shown but not scored.
 */
import type { Selected, Topology } from "../catalog";

export type Pillar = "reliability" | "security" | "cost" | "operations" | "performance";

export const PILLARS: {
  id: Pillar;
  title: string;
  short: string;
  /** One sentence an executive understands. */
  meaning: string;
  learn: string;
}[] = [
  {
    id: "reliability",
    title: "Reliability",
    short: "Reliability",
    meaning: "The workload keeps working, and recovers to its targets, when parts of it fail.",
    learn: "https://learn.microsoft.com/azure/well-architected/reliability/",
  },
  {
    id: "security",
    title: "Security",
    short: "Security",
    meaning:
      "Data and access are protected: least privilege, no secrets in code, private by default.",
    learn: "https://learn.microsoft.com/azure/well-architected/security/",
  },
  {
    id: "cost",
    title: "Cost Optimization",
    short: "Cost",
    meaning: "Spend is deliberate: the right size and tier for each environment, and it's tracked.",
    learn: "https://learn.microsoft.com/azure/well-architected/cost-optimization/",
  },
  {
    id: "operations",
    title: "Operational Excellence",
    short: "Operations",
    meaning: "It's deployed, observed and changed safely and repeatably.",
    learn: "https://learn.microsoft.com/azure/well-architected/operational-excellence/",
  },
  {
    id: "performance",
    title: "Performance Efficiency",
    short: "Performance",
    meaning: "It scales to demand and stays responsive without overprovisioning.",
    learn: "https://learn.microsoft.com/azure/well-architected/performance-efficiency/",
  },
];

/** What the workload must achieve: the requirements the checks are judged against. */
export type Workload = {
  /** Mission-critical: the business stops without it; business-critical: serious impact; standard: tolerable. */
  criticality: "mission-critical" | "business-critical" | "standard";
  /** Availability target, e.g. "99.9". */
  slo: string;
  /** Recovery time and data-loss targets, in minutes. */
  rtoMinutes: number;
  rpoMinutes: number;
  /** Highest classification of data it holds. */
  data: "public" | "internal" | "confidential" | "regulated";
  /** Who uses it. */
  audience: "internal" | "external" | "both";
};

export const DEFAULT_WORKLOAD: Workload = {
  criticality: "business-critical",
  slo: "99.9",
  rtoMinutes: 240,
  rpoMinutes: 60,
  data: "confidential",
  audience: "external",
};

export type WafResult = "pass" | "warn" | "fail" | "na";

/** A change that makes a check pass: settings on this service, services to add, or topology. */
export type WafFix = {
  label: string;
  settings?: Record<string, string>;
  add?: string[];
  topology?: Partial<Topology>;
};

export type WafContext = {
  /** The service being judged (absent for workload-level checks). */
  svc: Selected | undefined;
  selected: Selected[];
  topology: Topology;
  workload: Workload;
  has: (id: string) => boolean;
  setting: (id: string, key: string) => string | undefined;
};

export type WafCheck = (ctx: WafContext) => { result: WafResult; detail: string; fix?: WafFix };

export type WafRec = {
  /** Stable id, e.g. "app-service.zone-redundancy". */
  id: string;
  pillar: Pillar;
  /** The recommendation, as an instruction. */
  title: string;
  /** Why it matters, in plain words. */
  why: string;
  /** The Learn page (or section) this comes from. */
  learn?: string;
  check?: WafCheck;
};

export type WafServiceGuide = {
  /** Catalog service id. */
  service: string;
  /** The WAF service guide, or the closest official guidance if there's no service guide. */
  learn: string;
  /** What the service is for, and the design decisions that matter most. */
  summary: string;
  recs: WafRec[];
};
