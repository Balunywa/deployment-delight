import { useQuery } from "@tanstack/react-query";

import {
  type Deviation,
  type ReleaseTone,
  type Stage,
  deviationsOf,
  latestOf,
  median,
  onboardingHours,
  releaseLabel,
  stageOf,
} from "@/lib/fleet";
import { customersQuery, deploymentsQuery, offeringsQuery } from "@/lib/queries";

export type Install = {
  id: string;
  name: string;
  environmentType: string;
  region: string;
  offeringId: string | null;
  offeringName: string;
  actual: string | null;
  desired: string | null;
  compliance: number;
  monthly: number;
  openDrift: number;
  deviations: Deviation[];
  tone: ReleaseTone | "none";
};

export type FleetCustomer = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  azureModel: string;
  stage: Stage;
  stageDetail: string;
  installs: Install[];
  onboardingHours: number | null;
  lastActivity: string | null;
};

type VersionRow = { version: string; status: string };

/** Composes the control-plane queries into the ISV's view of its customers and installs. */
export function useFleet() {
  const customers = useQuery(customersQuery);
  const deployments = useQuery(deploymentsQuery);
  const offerings = useQuery(offeringsQuery);

  const releases = new Map<
    string,
    { preferred: string | undefined; statusOf: Map<string, string> }
  >();
  for (const o of offerings.data ?? []) {
    const versions = (o.offering_versions ?? []) as VersionRow[];
    releases.set(o.id, {
      preferred: latestOf(versions.filter((v) => v.status === "published").map((v) => v.version)),
      statusOf: new Map(versions.map((v) => [v.version, v.status])),
    });
  }

  const depsByCustomer = new Map<string, NonNullable<typeof deployments.data>>();
  for (const d of deployments.data ?? []) {
    const cid = (d.environments as { customers?: { id?: string } } | null)?.customers?.id;
    if (!cid) continue;
    depsByCustomer.set(cid, [...(depsByCustomer.get(cid) ?? []), d]);
  }

  const fleet: FleetCustomer[] = (customers.data ?? []).map((c) => {
    const envs = (c.environments ?? []) as unknown as {
      id: string;
      name: string;
      environment_type: string;
      region: string;
      offering_id: string | null;
      compliance_score: number;
      monthly_cost_estimate: number | null;
      configuration_json: Record<string, unknown> | null;
      drift_findings: { status: string; category: string }[] | null;
      actual: { version?: string } | null;
      desired: { version?: string } | null;
      offerings: { name?: string } | null;
    }[];
    const deps = depsByCustomer.get(c.id) ?? [];
    const stage = stageOf(
      { customer_connections: c.customer_connections as { status: string }[], environments: envs },
      deps,
    );
    const latestDep = [...deps].sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0];

    const installs: Install[] = envs.map((e) => {
      const rel = e.offering_id ? releases.get(e.offering_id) : undefined;
      const actual = e.actual?.version ?? null;
      return {
        id: e.id,
        name: e.name,
        environmentType: e.environment_type,
        region: e.region,
        offeringId: e.offering_id,
        offeringName: e.offerings?.name ?? "—",
        actual,
        desired: e.desired?.version ?? null,
        compliance: Number(e.compliance_score ?? 0),
        monthly: Number(e.monthly_cost_estimate ?? 0),
        openDrift: (e.drift_findings ?? []).filter((f) => f.status === "open").length,
        deviations: deviationsOf(e),
        tone: actual
          ? releaseLabel(actual, rel?.statusOf.get(actual) ?? "published", rel?.preferred)
          : "none",
      };
    });

    const stageDetail =
      stage === "blocked"
        ? `${latestDep?.status.replace(/_/g, " ").toLowerCase()} · ${(latestDep?.environments as { name?: string } | null)?.name ?? ""}`
        : stage === "awaiting_access"
          ? "Install link not completed"
          : stage === "awaiting_approval"
            ? "Plan waiting for approver"
            : stage === "deploying"
              ? "Central pipeline running"
              : stage === "ready_to_plan"
                ? "Access granted"
                : `${installs.filter((i) => i.actual).length} install(s) live`;

    return {
      id: c.id,
      name: c.name,
      code: c.customer_code,
      createdAt: c.created_at,
      azureModel: c.azure_model,
      stage,
      stageDetail,
      installs,
      onboardingHours: onboardingHours(c.created_at, deps),
      lastActivity: latestDep?.requested_at ?? null,
    };
  });

  const installs = fleet.flatMap((c) => c.installs.map((i) => ({ ...i, customer: c })));
  const prodLive = installs.filter((i) => i.environmentType === "production" && i.actual);

  return {
    isLoading: customers.isLoading || deployments.isLoading || offerings.isLoading,
    fleet,
    installs,
    releases,
    deployments: deployments.data ?? [],
    offerings: offerings.data ?? [],
    kpis: {
      customers: fleet.length,
      live: fleet.filter((c) => c.stage === "live").length,
      onboarding: fleet.filter((c) => c.stage !== "live").length,
      medianOnboardHours: median(
        fleet.map((c) => c.onboardingHours).filter((h): h is number => h !== null),
      ),
      measuredOnboardings: fleet.filter((c) => c.onboardingHours !== null).length,
      prodLive: prodLive.length,
      onPreferred: prodLive.filter((i) => i.tone === "preferred").length,
      deprecated: prodLive.filter((i) => i.tone === "deprecated").length,
      custom: installs.filter((i) => i.actual && i.deviations.length).length,
      liveInstalls: installs.filter((i) => i.actual).length,
    },
  };
}

export const TONE_STYLE: Record<ReleaseTone | "none", { cell: string; label: string }> = {
  preferred: { cell: "bg-success/12 text-success border-success/25", label: "Preferred release" },
  supported: { cell: "bg-warning/12 text-warning border-warning/30", label: "Upgrade available" },
  deprecated: { cell: "bg-danger/10 text-danger border-danger/25", label: "Deprecated release" },
  draft: { cell: "bg-muted text-muted-foreground border-border", label: "Draft" },
  none: {
    cell: "bg-transparent text-muted-foreground border-dashed border-border",
    label: "Not deployed",
  },
};
