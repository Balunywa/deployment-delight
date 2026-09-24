import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { demoProvider, demoPipelineProvider } from "./engine/demo-provider.server";
import { assertTransition, type DeploymentState, type ProviderContext } from "./engine/types";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Db = Awaited<ReturnType<typeof admin>>;

async function audit(
  db: Db,
  event: {
    event_type: string;
    actor_name?: string;
    customer_id?: string | null;
    environment_id?: string | null;
    resource_type?: string;
    resource_id?: string | null;
    previous_value?: unknown;
    new_value?: unknown;
    correlation_id?: string | null;
    result?: string;
    metadata_json?: Record<string, unknown>;
  },
) {
  await db.from("audit_events").insert({
    organization_id: ORG_ID,
    actor_name: event.actor_name ?? "Sarah Chen",
    event_type: event.event_type,
    customer_id: event.customer_id ?? null,
    environment_id: event.environment_id ?? null,
    resource_type: event.resource_type ?? null,
    resource_id: event.resource_id ?? null,
    previous_value: (event.previous_value ?? null) as never,
    new_value: (event.new_value ?? null) as never,
    correlation_id: event.correlation_id ?? null,
    result: event.result ?? "success",
    metadata_json: (event.metadata_json ?? {}) as never,
  });
}

async function loadContext(db: Db, environmentId: string, deploymentType = "initial") {
  const { data: environment, error } = await db
    .from("environments")
    .select("*, customers(*), offerings(*), desired:desired_offering_version_id(*)")
    .eq("id", environmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!environment) throw new Error("Environment not found");

  const { data: connection } = await db
    .from("customer_connections")
    .select("*")
    .eq("customer_id", environment.customer_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = environment.desired as { manifest_json?: Record<string, unknown>; version?: string } | null;

  const ctx: ProviderContext = {
    environment: {
      id: environment.id,
      name: environment.name,
      environment_type: environment.environment_type,
      region: environment.region,
      deployment_boundary: environment.deployment_boundary,
      configuration_json: (environment.configuration_json ?? {}) as Record<string, unknown>,
      monthly_cost_estimate: environment.monthly_cost_estimate,
    },
    manifest: (version?.manifest_json ?? {}) as Record<string, unknown>,
    connection: connection
      ? {
          id: connection.id,
          connection_type: connection.connection_type,
          subscription_id: connection.subscription_id,
          tenant_id: connection.tenant_id,
          management_group_id: connection.management_group_id,
          status: connection.status,
        }
      : null,
    deploymentType,
  };
  return { environment, ctx, version };
}

/* ---------------------------------------------------------------- preflight */

export const runPreflight = createServerFn({ method: "POST" })
  .inputValidator((d: { environmentId: string }) => z.object({ environmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { environment, ctx } = await loadContext(db, data.environmentId);
    const result = await demoProvider.validate(ctx);
    await audit(db, {
      event_type: "environment.preflight_run",
      environment_id: environment.id,
      customer_id: environment.customer_id,
      resource_type: "environment",
      resource_id: environment.name,
      new_value: { pass: result.pass, warning: result.warning, blocking: result.blocking },
    });
    return result;
  });

export const validateConnection = createServerFn({ method: "POST" })
  .inputValidator((d: { connectionId: string }) => z.object({ connectionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: updated, error } = await db
      .from("customer_connections")
      .update({ status: "validated", last_validated_at: new Date().toISOString() })
      .eq("id", data.connectionId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await audit(db, {
      event_type: "customer_connection.validated",
      customer_id: updated.customer_id,
      resource_type: "customer_connection",
      resource_id: updated.subscription_id,
      new_value: { status: "validated", mode: "demo" },
    });
    return {
      status: "validated" as const,
      mode: "demo" as const,
      checks: [
        { name: "Token acquisition (federated identity)", level: "PASS" },
        { name: "Subscription read", level: "PASS" },
        { name: "Role assignment write probe", level: "PASS" },
      ],
    };
  });

/* -------------------------------------------------------------- deployments */

export const createDeployment = createServerFn({ method: "POST" })
  .inputValidator((d: { environmentId: string; deploymentType?: string; requestedBy?: string }) =>
    z
      .object({
        environmentId: z.string().uuid(),
        deploymentType: z
          .enum(["initial", "upgrade", "configuration_change", "repair", "drift_remediation", "decommission"])
          .default("initial"),
        requestedBy: z.string().default("Mike Alvarez"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { environment, ctx, version } = await loadContext(db, data.environmentId, data.deploymentType);

    const preflight = await demoProvider.validate(ctx);
    let state: DeploymentState = "DRAFT";
    assertTransition(state, "VALIDATING");
    state = "VALIDATING";

    if (!preflight.deployable) {
      assertTransition(state, "VALIDATION_FAILED");
      state = "VALIDATION_FAILED";
    } else {
      assertTransition(state, "READY");
      state = "READY";
      assertTransition(state, "PLANNING");
      state = "PLANNING";
    }

    let plan = null;
    if (state === "PLANNING") {
      plan = await demoProvider.plan(ctx);
      assertTransition(state, "AWAITING_PLAN_APPROVAL");
      state = environment.environment_type === "production" ? "AWAITING_APPROVAL" : "AWAITING_PLAN_APPROVAL";
    }

    const { data: actualVersion } = await db
      .from("offering_versions")
      .select("version")
      .eq("id", environment.actual_offering_version_id ?? "")
      .maybeSingle();

    const { data: deployment, error } = await db
      .from("deployments")
      .insert({
        environment_id: environment.id,
        deployment_type: data.deploymentType,
        desired_version: version?.version ?? null,
        previous_version: actualVersion?.version ?? null,
        status: state,
        mode: "demo",
        requested_by: data.requestedBy,
        correlation_id: plan?.correlationId ?? crypto.randomUUID(),
        plan_json: (plan ?? {}) as never,
        preflight_json: preflight as never,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (state === "AWAITING_APPROVAL" || state === "AWAITING_PLAN_APPROVAL") {
      await db.from("approvals").insert({
        deployment_id: deployment.id,
        approval_type:
          environment.environment_type === "production" ? "production_deployment" : "plan_approval",
        requested_from: environment.environment_type === "production" ? "Security Approver" : "Platform Engineer",
        status: "pending",
      });
    }

    await audit(db, {
      event_type: "deployment.plan_generated",
      actor_name: data.requestedBy,
      customer_id: environment.customer_id,
      environment_id: environment.id,
      resource_type: "deployment",
      resource_id: deployment.correlation_id,
      correlation_id: deployment.correlation_id,
      new_value: { status: state, deploymentType: data.deploymentType },
    });

    return { deploymentId: deployment.id, status: state, preflight, plan };
  });

export const decideApproval = createServerFn({ method: "POST" })
  .inputValidator((d: { approvalId: string; decision: "approved" | "rejected"; comments?: string; decidedBy?: string }) =>
    z
      .object({
        approvalId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        comments: z.string().max(2000).optional(),
        decidedBy: z.string().default("Jennifer Park"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: approval, error } = await db
      .from("approvals")
      .select("*, deployments(*, environments(*))")
      .eq("id", data.approvalId)
      .single();
    if (error) throw new Error(error.message);
    if (approval.status !== "pending") throw new Error("This approval has already been decided.");

    const deployment = approval.deployments as { id: string; status: DeploymentState; correlation_id: string; environment_id: string };

    await db
      .from("approvals")
      .update({
        status: data.decision,
        comments: data.comments ?? null,
        decided_by: data.decidedBy,
        decided_at: new Date().toISOString(),
      })
      .eq("id", approval.id);

    const next: DeploymentState = data.decision === "approved" ? "QUEUED" : "CANCELLED";
    assertTransition(deployment.status, next);
    await db.from("deployments").update({ status: next }).eq("id", deployment.id);

    await audit(db, {
      event_type: data.decision === "approved" ? "deployment.approved" : "deployment.rejected",
      actor_name: data.decidedBy,
      environment_id: deployment.environment_id,
      resource_type: "deployment",
      resource_id: deployment.correlation_id,
      correlation_id: deployment.correlation_id,
      previous_value: { status: deployment.status },
      new_value: { status: next, comments: data.comments ?? null },
    });

    return { deploymentId: deployment.id, status: next };
  });

export const executeDeployment = createServerFn({ method: "POST" })
  .inputValidator((d: { deploymentId: string }) => z.object({ deploymentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: deployment, error } = await db
      .from("deployments")
      .select("*, environments(*)")
      .eq("id", data.deploymentId)
      .single();
    if (error) throw new Error(error.message);

    const status = deployment.status as DeploymentState;
    if (status !== "QUEUED") {
      throw new Error(`Deployment must be QUEUED to execute. Current state: ${status}.`);
    }

    const { environment, ctx } = await loadContext(db, deployment.environment_id, deployment.deployment_type);
    assertTransition("QUEUED", "DEPLOYING");
    const startedAt = new Date().toISOString();
    await db.from("deployments").update({ status: "DEPLOYING", started_at: startedAt }).eq("id", deployment.id);

    const run = await demoPipelineProvider.dispatch({
      correlationId: deployment.correlation_id,
      manifest: ctx.manifest,
    });

    const steps = await demoProvider.apply({ ...ctx, plan: deployment.plan_json as never });
    await db.from("deployment_steps").delete().eq("deployment_id", deployment.id);
    await db.from("deployment_steps").insert(
      steps.map((s) => ({
        deployment_id: deployment.id,
        sequence: s.sequence,
        name: s.name,
        module_name: s.module,
        status: s.status,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        log_text: s.log,
      })),
    );

    const failed = steps.some((s) => s.status === "failed");
    const finalState: DeploymentState = failed ? "REQUIRES_REMEDIATION" : "SUCCEEDED";
    assertTransition("DEPLOYING", finalState);

    const outputs = await demoProvider.getOutputs(ctx);
    await db
      .from("deployments")
      .update({
        status: finalState,
        completed_at: new Date().toISOString(),
        result_json: { outcome: finalState.toLowerCase(), outputs, pipelineRun: run.runUrl, mode: "demo" } as never,
      })
      .eq("id", deployment.id);

    if (!failed) {
      await db
        .from("environments")
        .update({
          actual_offering_version_id: environment.desired_offering_version_id,
          status: "healthy",
          compliance_score: 100,
        })
        .eq("id", environment.id);
    }

    await audit(db, {
      event_type: failed ? "deployment.failed" : "deployment.completed",
      actor_name: deployment.requested_by ?? "Mike Alvarez",
      environment_id: environment.id,
      customer_id: environment.customer_id,
      resource_type: "deployment",
      resource_id: deployment.correlation_id,
      correlation_id: deployment.correlation_id,
      result: failed ? "failure" : "success",
      new_value: { status: finalState, mode: "demo" },
    });

    return { status: finalState, steps, outputs };
  });

/* -------------------------------------------------------------------- drift */

export const detectDrift = createServerFn({ method: "POST" })
  .inputValidator((d: { environmentId: string }) => z.object({ environmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { environment, ctx } = await loadContext(db, data.environmentId);
    const findings = await demoProvider.detectDrift(ctx);
    let inserted = 0;
    for (const f of findings) {
      const { data: existing } = await db
        .from("drift_findings")
        .select("id")
        .eq("environment_id", environment.id)
        .eq("resource_id", f.resourceId)
        .eq("status", "open")
        .maybeSingle();
      if (existing) continue;
      await db.from("drift_findings").insert({
        environment_id: environment.id,
        resource_id: f.resourceId,
        category: f.category,
        expected_json: f.expected as never,
        actual_json: f.actual as never,
        severity: f.severity,
        recommended_remediation: f.recommendedRemediation,
      });
      inserted += 1;
    }
    await audit(db, {
      event_type: "environment.drift_scan",
      environment_id: environment.id,
      customer_id: environment.customer_id,
      new_value: { newFindings: inserted, scanned: findings.length },
    });
    return { newFindings: inserted, scanned: findings.length };
  });

export const resolveDrift = createServerFn({ method: "POST" })
  .inputValidator((d: { findingId: string; action: "accept" | "remediate" | "ignore" | "escalate"; actor?: string }) =>
    z
      .object({
        findingId: z.string().uuid(),
        action: z.enum(["accept", "remediate", "ignore", "escalate"]),
        actor: z.string().default("Sarah Chen"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: finding, error } = await db
      .from("drift_findings")
      .select("*, environments(id, customer_id, name)")
      .eq("id", data.findingId)
      .single();
    if (error) throw new Error(error.message);

    const statusMap = {
      accept: "accepted_into_desired_state",
      remediate: "remediated",
      ignore: "ignored",
      escalate: "escalated",
    } as const;

    await db
      .from("drift_findings")
      .update({
        status: statusMap[data.action],
        resolved_at: data.action === "escalate" ? null : new Date().toISOString(),
      })
      .eq("id", finding.id);

    const env = finding.environments as { id: string; customer_id: string; name: string };
    let deploymentId: string | null = null;

    if (data.action === "remediate") {
      const created = await db
        .from("deployments")
        .insert({
          environment_id: env.id,
          deployment_type: "drift_remediation",
          status: "QUEUED",
          mode: "demo",
          requested_by: data.actor,
          plan_json: { remediates: finding.resource_id, module: finding.category } as never,
        })
        .select("id")
        .single();
      deploymentId = created.data?.id ?? null;
    }

    await audit(db, {
      event_type: `drift.${data.action}`,
      actor_name: data.actor,
      environment_id: env.id,
      customer_id: env.customer_id,
      resource_type: "drift_finding",
      resource_id: finding.resource_id,
      previous_value: { status: finding.status, actual: finding.actual_json },
      new_value: { status: statusMap[data.action] },
    });

    return { status: statusMap[data.action], deploymentId };
  });

/* ---------------------------------------------------------------- blueprint */

const blueprintSchema = z.object({
  name: z.string().min(3),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver, e.g. 4.3.0"),
  boundary: z.object({ allowed: z.array(z.string()).min(1) }),
  network: z.object({
    publicAccess: z.boolean(),
    privateEndpoints: z.boolean(),
    modes: z.array(z.string()).min(1),
  }),
  identity: z.object({ managedIdentity: z.boolean() }),
  observability: z.object({
    diagnosticsRequired: z.boolean(),
    customerWorkspaceSupported: z.boolean(),
  }),
  regions: z.array(z.string()).min(1),
  modules: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});

export const draftBlueprintFromDescription = createServerFn({ method: "POST" })
  .inputValidator((d: { description: string; offeringId: string }) =>
    z.object({ description: z.string().min(30).max(6000), offeringId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI drafting is not configured for this environment.");
    const db = await admin();
    const { data: modules } = await db.from("infrastructure_modules").select("name, version, module_type");

    const system = `You convert an ISV's Azure architecture description into a DRAFT deployment blueprint manifest.
Return ONLY JSON matching this shape:
{"name":string,"version":"x.y.z","boundary":{"allowed":string[]},"network":{"publicAccess":boolean,"privateEndpoints":boolean,"modes":string[]},"identity":{"managedIdentity":boolean},"observability":{"diagnosticsRequired":boolean,"customerWorkspaceSupported":boolean},"regions":string[],"modules":[{"name":string,"version":string,"settings":object}]}
Only use module names from this catalog: ${(modules ?? []).map((m) => `${m.name}@${m.version}`).join(", ")}.
Never invent Azure credentials, subscriptions or resource IDs.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.description },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI drafting failed [${response.status}]: ${body}`);
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const json = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();

    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(json);
    } catch {
      throw new Error("The AI draft was not valid JSON. Try describing the architecture again.");
    }

    const parsed = blueprintSchema.safeParse(parsedUnknown);
    const validation = parsed.success
      ? { schema: "PASS" as const, issues: [] as string[] }
      : { schema: "BLOCKING" as const, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };

    const manifest = (parsed.success ? parsed.data : parsedUnknown) as Record<string, unknown>;
    const policyIssues = architecturePolicyCheck(manifest);

    return {
      manifestJson: JSON.stringify(manifest),
      validation,
      policyIssues,
      offeringId: data.offeringId,
      aiGenerated: true,
    };
  });

function architecturePolicyCheck(manifest: Record<string, unknown>) {
  const issues: { level: "WARNING" | "BLOCKING"; message: string }[] = [];
  const network = (manifest["network"] ?? {}) as Record<string, unknown>;
  const identity = (manifest["identity"] ?? {}) as Record<string, unknown>;
  const obs = (manifest["observability"] ?? {}) as Record<string, unknown>;
  const modules = (manifest["modules"] ?? []) as { name?: string }[];

  if (network["publicAccess"] === true)
    issues.push({ level: "BLOCKING", message: "ISV architecture policy requires publicAccess: false." });
  if (network["privateEndpoints"] !== true)
    issues.push({ level: "BLOCKING", message: "Private endpoints are mandatory for all data services." });
  if (identity["managedIdentity"] !== true)
    issues.push({ level: "BLOCKING", message: "Managed identity is mandatory; secrets-based auth is not permitted." });
  if (obs["diagnosticsRequired"] !== true)
    issues.push({ level: "WARNING", message: "Diagnostic settings should be required by every offering." });
  if (!modules.some((m) => m.name === "security-baseline"))
    issues.push({ level: "BLOCKING", message: "security-baseline module must be present." });
  if (!modules.some((m) => m.name === "monitoring"))
    issues.push({ level: "WARNING", message: "monitoring module is recommended in every blueprint." });
  return issues;
}

export const validateBlueprint = createServerFn({ method: "POST" })
  .inputValidator((d: { manifestJson: string }) => z.object({ manifestJson: z.string().max(60000) }).parse(d))
  .handler(async ({ data }) => {
    let manifest: unknown;
    try {
      manifest = JSON.parse(data.manifestJson);
    } catch {
      throw new Error("The blueprint is not valid JSON.");
    }
    const parsed = blueprintSchema.safeParse(manifest);
    return {
      schema: parsed.success ? ("PASS" as const) : ("BLOCKING" as const),
      issues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      policyIssues: architecturePolicyCheck((manifest ?? {}) as Record<string, unknown>),
    };
  });

export const createOfferingVersion = createServerFn({ method: "POST" })
  .inputValidator((d: { offeringId: string; manifestJson: string; releaseNotes?: string; aiGenerated?: boolean }) =>
    z
      .object({
        offeringId: z.string().uuid(),
        manifestJson: z.string().max(60000),
        releaseNotes: z.string().max(4000).optional(),
        aiGenerated: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    let manifestInput: unknown;
    try {
      manifestInput = JSON.parse(data.manifestJson);
    } catch {
      throw new Error("The blueprint is not valid JSON.");
    }
    const parsed = blueprintSchema.safeParse(manifestInput);
    if (!parsed.success) throw new Error("Blueprint failed schema validation; fix the issues before saving a version.");
    const db = await admin();
    const { data: version, error } = await db
      .from("offering_versions")
      .insert({
        offering_id: data.offeringId,
        version: parsed.data.version,
        status: "draft",
        manifest_json: parsed.data as never,
        release_notes: data.releaseNotes ?? null,
        ai_generated: data.aiGenerated,
        created_by: "Sarah Chen",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await audit(db, {
      event_type: "offering_version.created",
      resource_type: "offering_version",
      resource_id: version.version,
      new_value: { status: "draft", aiGenerated: data.aiGenerated },
    });
    return version;
  });

export const publishOfferingVersion = createServerFn({ method: "POST" })
  .inputValidator((d: { versionId: string }) => z.object({ versionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: version, error } = await db
      .from("offering_versions")
      .select("*")
      .eq("id", data.versionId)
      .single();
    if (error) throw new Error(error.message);
    if (version.status === "published")
      throw new Error("Published versions are immutable. Create a new version instead.");

    const check = blueprintSchema.safeParse(version.manifest_json);
    const policyIssues = architecturePolicyCheck((version.manifest_json ?? {}) as Record<string, unknown>);
    const blocking = policyIssues.filter((i) => i.level === "BLOCKING");
    if (!check.success || blocking.length) {
      throw new Error(
        `Cannot publish: ${[...(check.success ? [] : check.error.issues.map((i) => i.message)), ...blocking.map((b) => b.message)].join("; ")}`,
      );
    }

    const { data: published, error: pubError } = await db
      .from("offering_versions")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", data.versionId)
      .select("*")
      .single();
    if (pubError) throw new Error(pubError.message);

    await audit(db, {
      event_type: "offering_version.published",
      resource_type: "offering_version",
      resource_id: published.version,
      previous_value: { status: version.status },
      new_value: { status: "published" },
    });
    return published;
  });

/* --------------------------------------------------------------- onboarding */

export const onboardCustomer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(2).max(120),
        customerCode: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
        tenantId: z.string().min(8).max(64),
        industry: z.string().max(80).optional(),
        azureModel: z.enum(["existing_enterprise_alz", "greenfield"]),
        connectionType: z.enum([
          "existing_subscription",
          "new_subscription",
          "existing_resource_group",
          "managed_application",
          "lighthouse",
          "federated_identity",
        ]),
        subscriptionId: z.string().max(80).optional(),
        resourceGroupId: z.string().max(200).optional(),
        managementGroupId: z.string().max(200).optional(),
        offeringId: z.string().uuid(),
        region: z.string().min(3).max(40),
        secondaryRegion: z.string().max(40).optional(),
        environments: z.array(z.enum(["development", "test", "qa", "staging", "production"])).min(1),
        network: z.object({
          mode: z.enum(["existing-customer-hub", "dedicated-spoke"]),
          vnetId: z.string().max(300).optional(),
          privateEndpoints: z.boolean(),
          publicAccess: z.boolean(),
        }),
        observability: z.object({
          useCustomerWorkspace: z.boolean(),
          logAnalyticsWorkspaceId: z.string().max(300).optional(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();

    const { data: offering, error: offeringError } = await db
      .from("offerings")
      .select("*, offering_versions(id, version, status, published_at)")
      .eq("id", data.offeringId)
      .single();
    if (offeringError) throw new Error(offeringError.message);

    const published = (offering.offering_versions as { id: string; version: string; status: string }[])
      .filter((v) => v.status === "published")
      .sort((a, b) => b.version.localeCompare(a.version))[0];
    if (!published) throw new Error("This offering has no published version to deploy.");

    const { data: customer, error } = await db
      .from("customers")
      .insert({
        organization_id: ORG_ID,
        name: data.name,
        customer_code: data.customerCode,
        tenant_id: data.tenantId,
        industry: data.industry ?? null,
        azure_model: data.azureModel,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message.includes("duplicate") ? "That customer code is already in use." : error.message);

    const { data: connection } = await db
      .from("customer_connections")
      .insert({
        customer_id: customer.id,
        connection_type: data.connectionType,
        tenant_id: data.tenantId,
        subscription_id: data.subscriptionId ?? null,
        resource_group_id: data.resourceGroupId ?? null,
        management_group_id: data.managementGroupId ?? null,
        credential_reference: `kv://gridworks-platform-kv/secrets/oidc-${data.customerCode}`,
        status: "validated",
        last_validated_at: new Date().toISOString(),
        metadata_json: { federatedIdentity: true, mode: "demo" } as never,
      })
      .select("*")
      .single();

    const costPerEnv = Number(offering.estimated_monthly_cost_low ?? 0);
    const { data: environments } = await db
      .from("environments")
      .insert(
        data.environments.map((type) => ({
          customer_id: customer.id,
          offering_id: offering.id,
          desired_offering_version_id: published.id,
          actual_offering_version_id: null,
          name: type === "production" ? "PROD" : type.slice(0, 4).toUpperCase(),
          environment_type: type,
          region: data.region,
          secondary_region: data.secondaryRegion ?? null,
          deployment_boundary: offering.deployment_boundary,
          status: "pending_deployment",
          compliance_score: 0,
          monthly_cost_estimate: type === "production" ? costPerEnv : Math.round(costPerEnv * 0.25),
          configuration_json: { network: data.network, observability: data.observability } as never,
        })),
      )
      .select("*");

    await audit(db, {
      event_type: "customer.onboarded",
      customer_id: customer.id,
      resource_type: "customer",
      resource_id: customer.customer_code,
      new_value: {
        offering: offering.name,
        version: published.version,
        environments: data.environments,
        azureModel: data.azureModel,
      },
    });

    return {
      customerId: customer.id,
      connectionId: connection?.id ?? null,
      environments: environments ?? [],
      version: published.version,
    };
  });

/* ----------------------------------------------------------------- upgrades */

export const planUpgrades = createServerFn({ method: "POST" })
  .inputValidator((d: { offeringVersionId: string }) => z.object({ offeringVersionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: target, error } = await db
      .from("offering_versions")
      .select("*, offerings(id, name)")
      .eq("id", data.offeringVersionId)
      .single();
    if (error) throw new Error(error.message);

    const { data: environments } = await db
      .from("environments")
      .select("id, name, environment_type, compliance_score, customers(name), actual:actual_offering_version_id(version)")
      .eq("offering_id", (target.offerings as { id: string }).id);

    const current: string[] = [];
    const compatible: string[] = [];
    const manualReview: { id: string; reason: string }[] = [];

    for (const env of environments ?? []) {
      const actual = (env.actual as { version?: string } | null)?.version ?? null;
      if (actual === target.version) current.push(env.id);
      else if (!actual) manualReview.push({ id: env.id, reason: "Environment has never been deployed." });
      else if (Number(actual.split(".")[0]) < Number(target.version.split(".")[0]))
        manualReview.push({ id: env.id, reason: `Major version gap (${actual} → ${target.version}) requires review.` });
      else if (Number(env.compliance_score) < 95)
        manualReview.push({ id: env.id, reason: `Compliance at ${env.compliance_score}% — remediate before upgrading.` });
      else compatible.push(env.id);
    }

    return {
      targetVersion: target.version,
      offeringName: (target.offerings as { name: string }).name,
      current,
      compatible,
      manualReview,
      environments: environments ?? [],
    };
  });

export const createRollout = createServerFn({ method: "POST" })
  .inputValidator((d: { offeringVersionId: string; waves: { name: string; environmentIds: string[] }[] }) =>
    z
      .object({
        offeringVersionId: z.string().uuid(),
        waves: z
          .array(z.object({ name: z.string().min(1).max(80), environmentIds: z.array(z.string().uuid()).min(1) }))
          .min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: waves, error } = await db
      .from("upgrade_waves")
      .insert(
        data.waves.map((w, index) => ({
          organization_id: ORG_ID,
          offering_version_id: data.offeringVersionId,
          name: w.name,
          sequence: index + 1,
          status: "planned",
          environment_ids: w.environmentIds,
        })),
      )
      .select("*");
    if (error) throw new Error(error.message);

    await audit(db, {
      event_type: "upgrade_rollout.created",
      resource_type: "upgrade_wave",
      resource_id: data.offeringVersionId,
      new_value: { waves: data.waves.map((w) => ({ name: w.name, count: w.environmentIds.length })) },
    });
    return waves;
  });

export const startWave = createServerFn({ method: "POST" })
  .inputValidator((d: { waveId: string }) => z.object({ waveId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: wave, error } = await db.from("upgrade_waves").select("*").eq("id", data.waveId).single();
    if (error) throw new Error(error.message);
    if (wave.status !== "planned") throw new Error("This wave has already been started.");

    let created = 0;
    for (const environmentId of wave.environment_ids) {
      const { environment, ctx } = await loadContext(db, environmentId, "upgrade");
      const preflight = await demoProvider.validate(ctx);
      const plan = preflight.deployable ? await demoProvider.plan(ctx) : null;
      await db.from("deployments").insert({
        environment_id: environmentId,
        deployment_type: "upgrade",
        status: preflight.deployable ? "AWAITING_APPROVAL" : "VALIDATION_FAILED",
        mode: "demo",
        requested_by: "Rollout automation",
        plan_json: (plan ?? {}) as never,
        preflight_json: preflight as never,
        correlation_id: plan?.correlationId ?? crypto.randomUUID(),
      });
      created += 1;
      await audit(db, {
        event_type: "upgrade_wave.deployment_queued",
        actor_name: "Rollout automation",
        environment_id: environmentId,
        customer_id: environment.customer_id,
        resource_type: "upgrade_wave",
        resource_id: wave.name,
      });
    }

    await db.from("upgrade_waves").update({ status: "in_progress" }).eq("id", wave.id);
    return { created };
  });

/* ----------------------------------------------------------------- branding */

export const updateBranding = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(2).max(80),
        portalTitle: z.string().min(2).max(120),
        supportUrl: z.string().url().max(300).or(z.literal("")),
        primaryColor: z.string().min(3).max(60),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: previous } = await db.from("organizations").select("*").eq("id", ORG_ID).single();
    const { data: updated, error } = await db
      .from("organizations")
      .update({
        name: data.name,
        portal_title: data.portalTitle,
        support_url: data.supportUrl || null,
        primary_color: data.primaryColor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ORG_ID)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await audit(db, {
      event_type: "organization.branding_updated",
      resource_type: "organization",
      resource_id: ORG_ID,
      previous_value: { name: previous?.name, portal_title: previous?.portal_title },
      new_value: { name: updated.name, portal_title: updated.portal_title },
    });
    return updated;
  });
