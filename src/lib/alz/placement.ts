/*
 * Where every customer install lands in the platform landing zones: which foundation (Entra tenant) owns
 * it, and which landing zone management group (Corp / Online / Local / Sandbox) its subscription sits in.
 */
import { fromManifest } from "@/lib/architecture";
import type { LandingZone } from "@/lib/catalog";

type Version = { version: string; manifest_json: unknown };
type OfferingLike = {
  id: string;
  name: string;
  network_profile: string | null;
  offering_versions?: unknown;
};
type CustomerLike = {
  id: string;
  name: string;
  environments?: unknown;
};

export type Placement = {
  customerId: string;
  customerName: string;
  environment: string;
  offering: string;
  landingZone: LandingZone;
  hosted: boolean;
};

export function placements(customers: CustomerLike[], offerings: OfferingLike[]) {
  const out: Placement[] = [];
  for (const c of customers) {
    const envs = (c.environments ?? []) as {
      name: string;
      offering_id: string | null;
      configuration_json: Record<string, unknown> | null;
      desired: { version: string } | null;
    }[];
    for (const e of envs) {
      const offering = offerings.find((o) => o.id === e.offering_id);
      if (!offering) continue;
      const versions = (offering.offering_versions ?? []) as Version[];
      const manifest = versions.find((v) => v.version === e.desired?.version)?.manifest_json;
      const arch = fromManifest(offering, manifest);
      const mode = (e.configuration_json?.["network"] as { mode?: string } | undefined)?.mode;
      const hosted = mode === "isv-hosted";
      out.push({
        customerId: c.id,
        customerName: c.name,
        environment: e.name,
        offering: offering.name,
        landingZone:
          mode === "existing-customer-hub" && arch.topology.landingZone === "online"
            ? "corp"
            : arch.topology.landingZone,
        hosted,
      });
    }
  }
  return out;
}

/** Installs that land in a given foundation: the ISV tenant gets hosted installs, a customer tenant gets theirs. */
export const placementsFor = (all: Placement[], foundation: { customer_id: string | null }) =>
  foundation.customer_id
    ? all.filter((p) => !p.hosted && p.customerId === foundation.customer_id)
    : all.filter((p) => p.hosted);
