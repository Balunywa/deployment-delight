/*
 * Solution catalog model shared by the server and the UI: who owns a solution, how far it can be trusted
 * (maturity), and the derived facts the catalog filters on. Pure — no database or network access.
 */
import { z } from "zod";

export type Owner = { name: string; email: string; role: string; team: string };
export type Maturity = "community" | "validated" | "featured";
export type CurrentUser = Owner;

export const OWNER_ROLES = ["SE", "CSA", "Partner", "Product team", "Other"] as const;

/** Owners reconfirm a solution at least this often; after that it is flagged in the catalog. */
export const OWNER_REVIEW_DAYS = 90;

export const MATURITY: Record<
  Maturity,
  { label: string; rank: number; body: string; next: string | null }
> = {
  community: {
    label: "Community",
    rank: 0,
    body: "Submitted by its owners. Not yet through architecture review or a test deploy.",
    next: "Publish an offering that passes architecture review to become Validated.",
  },
  validated: {
    label: "Validated",
    rank: 1,
    body: "Has a published offering that passed architecture review, policy and source checks.",
    next: "A reviewer other than its owners can feature it.",
  },
  featured: {
    label: "Featured",
    rank: 2,
    body: "Validated, and recommended by a reviewer for field use.",
    next: null,
  },
};

export const asMaturity = (v: unknown): Maturity =>
  v === "validated" || v === "featured" ? v : "community";

export function ownersOf(v: unknown): Owner[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({
      name: String(o["name"] ?? "").trim(),
      email: String(o["email"] ?? "").trim(),
      role: String(o["role"] ?? "").trim(),
      team: String(o["team"] ?? "").trim(),
    }))
    .filter((o) => o.name);
}

const same = (a: string, b: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Owners match on email when both have one, otherwise on name. */
export const isSameOwner = (a: Owner, b: Owner) =>
  a.email && b.email ? same(a.email, b.email) : same(a.name, b.name);

export const isOwner = (owners: Owner[], user: Owner | null | undefined) =>
  !!user && owners.some((o) => isSameOwner(o, user));

export const ownerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]),
  role: z.string().trim().max(60),
  team: z.string().trim().max(120),
});

/** Owners list with the submitter first and duplicates removed. */
export function withSubmitter(owners: Owner[], user: CurrentUser): Owner[] {
  const all = [user, ...owners];
  return all.filter((o, i) => all.findIndex((x) => isSameOwner(x, o)) === i);
}

export function ownerConfirmationDue(confirmedAt: string | null | undefined, now = Date.now()) {
  if (!confirmedAt) return true;
  return now - new Date(confirmedAt).getTime() > OWNER_REVIEW_DAYS * 86_400_000;
}

export const isSample = (owners: Owner[]) => owners.some((o) => o.role === "Sample");

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Where an offering runs, in the words a customer would use. */
export function runsIn(offeringType: string | null | undefined) {
  switch (offeringType) {
    case "saas_connected":
      return "Hosted";
    case "enterprise_private":
    case "regulated":
      return "Customer landing zone";
    default:
      return "Customer's Azure";
  }
}

export const RUNS_IN_ORDER = ["Hosted", "Customer's Azure", "Customer landing zone"];

export const IAC_LABEL: Record<string, string> = {
  terraform: "Terraform",
  bicep: "Bicep",
  arm: "ARM",
  container: "Container",
  application: "Application",
};

/** Share of Azure services two solutions have in common (Jaccard index). */
export function overlap(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  const shared = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? shared / union : 0;
}

/** Platform plumbing every solution gets; left out of "what it's built from". */
export const PLUMBING = new Set([
  "resource-group",
  "managed-identity",
  "security-baseline",
  "network-spoke",
  "private-endpoints",
  "monitoring",
  "key-vault",
  "defender",
  "budget",
]);
