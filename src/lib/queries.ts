import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

const unwrap = <T>({ data, error }: { data: T; error: { message: string } | null }) => {
  if (error) throw new Error(error.message);
  return data;
};

export const organizationQuery = queryOptions({
  queryKey: ["organization"],
  queryFn: async () => unwrap(await supabase.from("organizations").select("*").limit(1).single()),
});

export const productsQuery = queryOptions({
  queryKey: ["products"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("products")
        .select("*, offerings(id, name, offering_type, status, estimated_monthly_cost_low, estimated_monthly_cost_high)")
        .order("name"),
    ),
});

export const offeringsQuery = queryOptions({
  queryKey: ["offerings"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("offerings")
        .select("*, products(name), offering_versions(id, version, status, release_notes, published_at, manifest_json, ai_generated, created_by, created_at), environments(id)")
        .order("name"),
    ),
});

export const modulesQuery = queryOptions({
  queryKey: ["modules"],
  queryFn: async () => unwrap(await supabase.from("infrastructure_modules").select("*").order("name")),
});

export const policyPacksQuery = queryOptions({
  queryKey: ["policy-packs"],
  queryFn: async () => unwrap(await supabase.from("policy_packs").select("*").order("name")),
});

export const estateQuery = queryOptions({
  queryKey: ["estate"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("environments")
        .select(
          "*, customers(id, name, customer_code, azure_model, industry), offerings(id, name, offering_type), desired:desired_offering_version_id(id, version), actual:actual_offering_version_id(id, version), drift_findings(id, severity, status)",
        )
        .order("name"),
    ),
});

export const customersQuery = queryOptions({
  queryKey: ["customers"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("customers")
        .select(
          "*, environments(id, name, environment_type, status, compliance_score, monthly_cost_estimate, actual:actual_offering_version_id(version), desired:desired_offering_version_id(version), offerings(name)), customer_connections(id, connection_type, subscription_id, status, last_validated_at)",
        )
        .order("name"),
    ),
});

export const customerQuery = (customerId: string) =>
  queryOptions({
    queryKey: ["customer", customerId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("customers")
          .select(
            "*, customer_connections(*), environments(*, offerings(*), desired:desired_offering_version_id(id, version, manifest_json), actual:actual_offering_version_id(id, version), drift_findings(*), compliance_checks(*), deployments(*, approvals(*)))",
          )
          .eq("id", customerId)
          .single(),
      ),
  });

export const deploymentsQuery = queryOptions({
  queryKey: ["deployments"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("deployments")
        .select("*, approvals(*), environments(id, name, environment_type, customers(id, name, customer_code))")
        .order("requested_at", { ascending: false })
        .limit(200),
    ),
});

export const deploymentQuery = (deploymentId: string) =>
  queryOptions({
    queryKey: ["deployment", deploymentId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("deployments")
          .select(
            "*, approvals(*), deployment_steps(*), environments(*, customers(id, name, customer_code), offerings(name, offering_type))",
          )
          .eq("id", deploymentId)
          .single(),
      ),
  });

export const complianceQuery = queryOptions({
  queryKey: ["compliance"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("compliance_checks")
        .select("*, environments(id, name, environment_type, customers(id, name))")
        .order("control_name")
        .limit(2000),
    ),
});

export const driftQuery = queryOptions({
  queryKey: ["drift"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("drift_findings")
        .select("*, environments(id, name, customers(id, name))")
        .order("detected_at", { ascending: false }),
    ),
});

export const auditQuery = queryOptions({
  queryKey: ["audit"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("audit_events")
        .select("*, customers(name), environments(name)")
        .order("timestamp", { ascending: false })
        .limit(300),
    ),
});

export const wavesQuery = queryOptions({
  queryKey: ["waves"],
  queryFn: async () =>
    unwrap(
      await supabase
        .from("upgrade_waves")
        .select("*, offering_versions(version, offerings(name))")
        .order("created_at", { ascending: false }),
    ),
});
