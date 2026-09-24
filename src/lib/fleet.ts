/*
 * Fleet helpers: turn raw control-plane rows into the ISV's view of its installed base —
 * where each customer is in onboarding, which release each install runs, and how far it deviates
 * from the standard product.
 */

export const semverCompare = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

export const latestOf = (versions: string[]) => [...versions].sort(semverCompare).at(-1);

export type Stage =
  "awaiting_access" | "ready_to_plan" | "blocked" | "awaiting_approval" | "deploying" | "live";

export const STAGES: { id: Stage; label: string; hint: string }[] = [
  {
    id: "awaiting_access",
    label: "Awaiting customer",
    hint: "Install link sent — customer admin has not granted access yet",
  },
  {
    id: "ready_to_plan",
    label: "Ready to plan",
    hint: "Access granted — run the landing-zone check and generate a plan",
  },
  { id: "blocked", label: "Blocked", hint: "Preflight or deployment failed — needs remediation" },
  {
    id: "awaiting_approval",
    label: "Awaiting approval",
    hint: "Plan generated — waiting on an approver",
  },
  {
    id: "deploying",
    label: "Deploying",
    hint: "Approved and running through the central pipeline",
  },
  { id: "live", label: "Live", hint: "Running your product in the customer's Azure" },
];

type Dep = {
  status: string;
  requested_at: string;
  completed_at?: string | null;
  deployment_type?: string;
};
type Conn = { status: string };
type EnvRow = { actual?: { version?: string } | null };

const BLOCKED = ["VALIDATION_FAILED", "PLAN_FAILED", "FAILED", "REQUIRES_REMEDIATION"];
const APPROVAL = ["AWAITING_APPROVAL", "AWAITING_PLAN_APPROVAL"];
const RUNNING = ["QUEUED", "DEPLOYING", "VALIDATING", "PLANNING", "READY"];

export function stageOf(
  customer: { customer_connections?: Conn[] | null; environments?: EnvRow[] | null },
  deployments: Dep[],
): Stage {
  if ((customer.environments ?? []).some((e) => e.actual?.version)) return "live";
  const latest = [...deployments].sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];
  if (latest && BLOCKED.includes(latest.status)) return "blocked";
  if (latest && APPROVAL.includes(latest.status)) return "awaiting_approval";
  if (latest && RUNNING.includes(latest.status)) return "deploying";
  const conn = customer.customer_connections?.[0];
  if (!conn || conn.status !== "validated") return "awaiting_access";
  return "ready_to_plan";
}

/**
 * Hours from customer creation to its first successful initial deployment. Only counts customers
 * onboarded through the platform (completion after creation); seeded history is excluded.
 */
export function onboardingHours(customerCreatedAt: string, deployments: Dep[]) {
  const created = new Date(customerCreatedAt).getTime();
  const done = deployments
    .filter((d) => d.status === "SUCCEEDED" && d.deployment_type === "initial" && d.completed_at)
    .map((d) => new Date(d.completed_at as string).getTime())
    .filter((t) => t > created)
    .sort((a, b) => a - b)[0];
  return done ? (done - created) / 3_600_000 : null;
}

export const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

export const formatDuration = (hours: number | null | undefined) => {
  if (hours === null || hours === undefined) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
};

/* ------------------------------------------------------------- deviation */

export type Deviation = {
  key: string;
  label: string;
  standard: string;
  actual: string;
  kind: "override" | "drift" | "exception";
};

const STANDARD_NETWORK: Record<string, unknown> = { publicAccess: false, privateEndpoints: true };

/**
 * Everything that makes this install differ from the standard product: approved overrides,
 * accepted drift and guardrail exceptions. Zero means a pure product install.
 */
export function deviationsOf(env: {
  configuration_json?: Record<string, unknown> | null;
  drift_findings?: { status: string; category: string; resource_id?: string }[] | null;
}): Deviation[] {
  const out: Deviation[] = [];
  const cfg = (env.configuration_json ?? {}) as Record<string, unknown>;
  const network = (cfg["network"] ?? {}) as Record<string, unknown>;
  for (const [k, standard] of Object.entries(STANDARD_NETWORK)) {
    if (k in network && network[k] !== standard)
      out.push({
        key: `network.${k}`,
        label: k === "publicAccess" ? "Public network access" : "Private endpoints",
        standard: String(standard),
        actual: String(network[k]),
        kind: "exception",
      });
  }
  const overrides = (cfg["overrides"] ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(overrides))
    out.push({
      key: k,
      label: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      standard: "product default",
      actual: String(v),
      kind: "override",
    });
  for (const f of env.drift_findings ?? [])
    if (f.status === "accepted")
      out.push({
        key: `drift.${f.category}`,
        label: `Accepted drift · ${f.category.replace(/_/g, " ")}`,
        standard: "desired state",
        actual: "accepted into this install",
        kind: "drift",
      });
  return out;
}

/* --------------------------------------------------------------- versions */

export type ReleaseTone = "preferred" | "supported" | "deprecated" | "draft";

export function releaseLabel(
  version: string,
  status: string | undefined,
  preferred: string | undefined,
): ReleaseTone {
  if (status === "draft" || status === "testing") return "draft";
  if (status === "deprecated" || status === "retired") return "deprecated";
  // A major-version gap to the preferred release cannot join an automatic wave.
  if (preferred && Number(version.split(".")[0]) < Number(preferred.split(".")[0]))
    return "deprecated";
  return version === preferred ? "preferred" : "supported";
}

export const RELEASE_TONE = {
  preferred: "success",
  supported: "info",
  deprecated: "danger",
  draft: "neutral",
} as const;
