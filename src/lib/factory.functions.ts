import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { demoProvider, demoPipelineProvider } from "./engine/demo-provider.server";
import { assertTransition, type DeploymentState, type ProviderContext } from "./engine/types";
import type { Tables } from "./db-types";
import { fromManifest, toManifest } from "./architecture";
import {
  DEFAULT_DELIVERY,
  ENV_KEYS,
  envName,
  namesFor,
  reviewOffering,
  verdict,
} from "./onboarding";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

// Server-only Postgres access (Azure Database for PostgreSQL); imported lazily so it never reaches the client bundle.
async function admin() {
  return import("./db.server");
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
  await db.insert("audit_events", {
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
  const environment = await db.maybeOne<Tables<"environments">>(
    "select * from public.environments where id = $1",
    [environmentId],
  );
  if (!environment) throw new Error("Environment not found");

  const connection = await db.maybeOne<Tables<"customer_connections">>(
    "select * from public.customer_connections where customer_id = $1 order by created_at desc limit 1",
    [environment.customer_id],
  );

  const version = environment.desired_offering_version_id
    ? await db.maybeOne<{ manifest_json: Record<string, unknown>; version: string }>(
        "select manifest_json, version from public.offering_versions where id = $1",
        [environment.desired_offering_version_id],
      )
    : null;

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
  .inputValidator((d: { environmentId: string }) =>
    z.object({ environmentId: z.string().uuid() }).parse(d),
  )
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
  .inputValidator((d: { connectionId: string }) =>
    z.object({ connectionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const [updated] = await db.update<Tables<"customer_connections">>(
      "customer_connections",
      { status: "validated", last_validated_at: new Date().toISOString() },
      { id: data.connectionId },
    );
    if (!updated) throw new Error("Connection not found");
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
          .enum([
            "initial",
            "upgrade",
            "configuration_change",
            "repair",
            "drift_remediation",
            "decommission",
          ])
          .default("initial"),
        requestedBy: z.string().default("Mike Alvarez"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { environment, ctx, version } = await loadContext(
      db,
      data.environmentId,
      data.deploymentType,
    );

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
      state =
        environment.environment_type === "production"
          ? "AWAITING_APPROVAL"
          : "AWAITING_PLAN_APPROVAL";
    }

    const actualVersion = environment.actual_offering_version_id
      ? await db.maybeOne<{ version: string }>(
          "select version from public.offering_versions where id = $1",
          [environment.actual_offering_version_id],
        )
      : null;

    const deployment = await db.insert<Tables<"deployments">>("deployments", {
      environment_id: environment.id,
      deployment_type: data.deploymentType,
      desired_version: version?.version ?? null,
      previous_version: actualVersion?.version ?? null,
      status: state,
      mode: "demo",
      requested_by: data.requestedBy,
      correlation_id: plan?.correlationId ?? crypto.randomUUID(),
      plan_json: plan ?? {},
      preflight_json: preflight,
    });

    if (state === "AWAITING_APPROVAL" || state === "AWAITING_PLAN_APPROVAL") {
      await db.insert("approvals", {
        deployment_id: deployment.id,
        approval_type:
          environment.environment_type === "production" ? "production_deployment" : "plan_approval",
        requested_from:
          environment.environment_type === "production" ? "Security Approver" : "Platform Engineer",
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
  .inputValidator(
    (d: {
      approvalId: string;
      decision: "approved" | "rejected";
      comments?: string;
      decidedBy?: string;
    }) =>
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
    const approval = await db.one<Tables<"approvals">>(
      "select * from public.approvals where id = $1",
      [data.approvalId],
    );
    if (approval.status !== "pending") throw new Error("This approval has already been decided.");

    const deployment = await db.one<{
      id: string;
      status: DeploymentState;
      correlation_id: string;
      environment_id: string;
    }>("select id, status, correlation_id, environment_id from public.deployments where id = $1", [
      approval.deployment_id,
    ]);

    await db.update(
      "approvals",
      {
        status: data.decision,
        comments: data.comments ?? null,
        decided_by: data.decidedBy,
        decided_at: new Date().toISOString(),
      },
      { id: approval.id },
    );

    const next: DeploymentState = data.decision === "approved" ? "QUEUED" : "CANCELLED";
    assertTransition(deployment.status, next);
    await db.update("deployments", { status: next }, { id: deployment.id });

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
  .inputValidator((d: { deploymentId: string }) =>
    z.object({ deploymentId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const deployment = await db.one<Tables<"deployments">>(
      "select * from public.deployments where id = $1",
      [data.deploymentId],
    );

    const status = deployment.status as DeploymentState;
    if (status !== "QUEUED") {
      throw new Error(`Deployment must be QUEUED to execute. Current state: ${status}.`);
    }

    const { environment, ctx } = await loadContext(
      db,
      deployment.environment_id,
      deployment.deployment_type,
    );
    assertTransition("QUEUED", "DEPLOYING");
    const startedAt = new Date().toISOString();
    await db.update(
      "deployments",
      { status: "DEPLOYING", started_at: startedAt },
      { id: deployment.id },
    );

    const run = await demoPipelineProvider.dispatch({
      correlationId: deployment.correlation_id,
      manifest: ctx.manifest,
    });

    const steps = await demoProvider.apply({ ...ctx, plan: deployment.plan_json as never });
    await db.query("delete from public.deployment_steps where deployment_id = $1", [deployment.id]);
    await db.insertMany(
      "deployment_steps",
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
    await db.update(
      "deployments",
      {
        status: finalState,
        completed_at: new Date().toISOString(),
        result_json: {
          outcome: finalState.toLowerCase(),
          outputs,
          pipelineRun: run.runUrl,
          mode: "demo",
        },
      },
      { id: deployment.id },
    );

    if (!failed) {
      await db.update(
        "environments",
        {
          actual_offering_version_id: environment.desired_offering_version_id,
          status: "healthy",
          compliance_score: 100,
        },
        { id: environment.id },
      );
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
  .inputValidator((d: { environmentId: string }) =>
    z.object({ environmentId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { environment, ctx } = await loadContext(db, data.environmentId);
    const findings = await demoProvider.detectDrift(ctx);
    let inserted = 0;
    for (const f of findings) {
      const existing = await db.maybeOne(
        "select id from public.drift_findings where environment_id = $1 and resource_id = $2 and status = 'open' limit 1",
        [environment.id, f.resourceId],
      );
      if (existing) continue;
      await db.insert("drift_findings", {
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
  .inputValidator(
    (d: {
      findingId: string;
      action: "accept" | "remediate" | "ignore" | "escalate";
      actor?: string;
    }) =>
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
    const finding = await db.one<Tables<"drift_findings">>(
      "select * from public.drift_findings where id = $1",
      [data.findingId],
    );

    const statusMap = {
      accept: "accepted_into_desired_state",
      remediate: "remediated",
      ignore: "ignored",
      escalate: "escalated",
    } as const;

    await db.update(
      "drift_findings",
      {
        status: statusMap[data.action],
        resolved_at: data.action === "escalate" ? null : new Date().toISOString(),
      },
      { id: finding.id },
    );

    const env = await db.one<{ id: string; customer_id: string; name: string }>(
      "select id, customer_id, name from public.environments where id = $1",
      [finding.environment_id],
    );
    let deploymentId: string | null = null;

    if (data.action === "remediate") {
      const created = await db.insert<{ id: string }>("deployments", {
        environment_id: env.id,
        deployment_type: "drift_remediation",
        status: "QUEUED",
        mode: "demo",
        requested_by: data.actor,
        plan_json: { remediates: finding.resource_id, module: finding.category },
      });
      deploymentId = created.id;
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
  deploymentOptions: z
    .object({
      azureModels: z.array(z.enum(["existing_enterprise_alz", "greenfield"])).min(1),
      connectionModes: z.array(z.string()).min(1),
      environments: z.array(z.string()).min(1),
    })
    .optional(),
  customerInputs: z
    .array(
      z.object({
        key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "Input keys must be camelCase identifiers"),
        label: z.string().min(1),
        help: z.string().optional(),
        type: z.enum(["text", "resource-id", "cidr", "boolean", "select"]),
        required: z.boolean(),
        source: z.enum(["customer", "isv"]),
        discoverable: z.boolean().optional(),
        options: z.array(z.string()).optional(),
        placeholder: z.string().optional(),
      }),
    )
    .optional(),
  overridable: z.array(z.string()).optional(),
  landingZone: z.object({ archetype: z.enum(["corp", "online", "local", "sandbox"]) }).optional(),
  source: z
    .object({
      repository: z.string().min(3),
      path: z.string(),
      iac: z.enum(["bicep", "terraform"]),
      pipeline: z.enum(["github-actions", "azure-devops"]),
    })
    .optional(),
});

export const draftBlueprintFromDescription = createServerFn({ method: "POST" })
  .inputValidator((d: { description: string; offeringId: string }) =>
    z.object({ description: z.string().min(30).max(6000), offeringId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env["AI_API_KEY"];
    const endpoint = process.env["AI_CHAT_COMPLETIONS_URL"];
    const model = process.env["AI_MODEL"] ?? "gpt-4.1";
    if (!apiKey || !endpoint)
      throw new Error(
        "AI drafting is not configured. Set AI_CHAT_COMPLETIONS_URL and AI_API_KEY (any OpenAI-compatible endpoint, e.g. Azure OpenAI).",
      );
    const db = await admin();
    const modules = await db.query<{ name: string; version: string; module_type: string }>(
      "select name, version, module_type from public.infrastructure_modules",
    );

    const system = `You convert an ISV's Azure architecture description into a DRAFT deployment blueprint manifest.
Return ONLY JSON matching this shape:
{"name":string,"version":"x.y.z","boundary":{"allowed":string[]},"network":{"publicAccess":boolean,"privateEndpoints":boolean,"modes":string[]},"identity":{"managedIdentity":boolean},"observability":{"diagnosticsRequired":boolean,"customerWorkspaceSupported":boolean},"regions":string[],"modules":[{"name":string,"version":string,"settings":object}]}
Only use module names from this catalog: ${(modules ?? []).map((m) => `${m.name}@${m.version}`).join(", ")}.
Never invent Azure credentials, subscriptions or resource IDs.`;

    const response = await fetch(endpoint, {
      method: "POST",
      // Bearer for OpenAI-compatible gateways; api-key for Azure OpenAI.
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
    const json = raw
      .replace(/^```(?:json)?/m, "")
      .replace(/```$/m, "")
      .trim();

    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(json);
    } catch {
      throw new Error("The AI draft was not valid JSON. Try describing the architecture again.");
    }

    const parsed = blueprintSchema.safeParse(parsedUnknown);
    const validation = parsed.success
      ? { schema: "PASS" as const, issues: [] as string[] }
      : {
          schema: "BLOCKING" as const,
          issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        };

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
    issues.push({
      level: "BLOCKING",
      message: "ISV architecture policy requires publicAccess: false.",
    });
  if (network["privateEndpoints"] !== true)
    issues.push({
      level: "BLOCKING",
      message: "Private endpoints are mandatory for all data services.",
    });
  if (identity["managedIdentity"] !== true)
    issues.push({
      level: "BLOCKING",
      message: "Managed identity is mandatory; secrets-based auth is not permitted.",
    });
  if (obs["diagnosticsRequired"] !== true)
    issues.push({
      level: "WARNING",
      message: "Diagnostic settings should be required by every offering.",
    });
  if (!modules.some((m) => m.name === "security-baseline"))
    issues.push({ level: "BLOCKING", message: "security-baseline module must be present." });
  if (!modules.some((m) => m.name === "monitoring"))
    issues.push({
      level: "WARNING",
      message: "monitoring module is recommended in every blueprint.",
    });
  return issues;
}

export const validateBlueprint = createServerFn({ method: "POST" })
  .inputValidator((d: { manifestJson: string }) =>
    z.object({ manifestJson: z.string().max(60000) }).parse(d),
  )
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
      issues: parsed.success
        ? []
        : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      policyIssues: architecturePolicyCheck((manifest ?? {}) as Record<string, unknown>),
    };
  });

export const createOfferingVersion = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      offeringId: string;
      manifestJson: string;
      releaseNotes?: string;
      aiGenerated?: boolean;
    }) =>
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
    if (!parsed.success)
      throw new Error(
        "Blueprint failed schema validation; fix the issues before saving a version.",
      );
    const db = await admin();
    const version = await db
      .insert<Tables<"offering_versions">>("offering_versions", {
        offering_id: data.offeringId,
        version: parsed.data.version,
        status: "draft",
        manifest_json: parsed.data,
        release_notes: data.releaseNotes ?? null,
        ai_generated: data.aiGenerated,
        created_by: "Sarah Chen",
      })
      .catch((e: Error) => {
        throw new Error(
          e.message.includes("duplicate")
            ? `Version ${parsed.data.version} already exists.`
            : e.message,
        );
      });
    await audit(db, {
      event_type: "offering_version.created",
      resource_type: "offering_version",
      resource_id: version.version,
      new_value: { status: "draft", aiGenerated: data.aiGenerated },
    });
    return version;
  });

export const updateDraftVersion = createServerFn({ method: "POST" })
  .inputValidator((d: { versionId: string; manifestJson: string; releaseNotes?: string }) =>
    z
      .object({
        versionId: z.string().uuid(),
        manifestJson: z.string().max(60000),
        releaseNotes: z.string().max(4000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const parsed = blueprintSchema.safeParse(JSON.parse(data.manifestJson));
    if (!parsed.success)
      throw new Error(
        `Blueprint failed schema validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    const db = await admin();
    const current = await db.one<Tables<"offering_versions">>(
      "select * from public.offering_versions where id = $1",
      [data.versionId],
    );
    if (current.status !== "draft")
      throw new Error("Only draft versions can be edited. Published versions are immutable.");
    const [updated] = await db.update<Tables<"offering_versions">>(
      "offering_versions",
      {
        manifest_json: { ...parsed.data, version: current.version },
        ...(data.releaseNotes !== undefined ? { release_notes: data.releaseNotes } : {}),
      },
      { id: data.versionId },
    );
    if (!updated) throw new Error("Version not found");
    await audit(db, {
      event_type: "offering_version.draft_updated",
      resource_type: "offering_version",
      resource_id: current.version,
      previous_value: {
        modules: ((current.manifest_json as { modules?: unknown[] })?.modules ?? []).length,
      },
      new_value: { modules: parsed.data.modules.length },
    });
    return updated;
  });

export const publishOfferingVersion = createServerFn({ method: "POST" })
  .inputValidator((d: { versionId: string }) => z.object({ versionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const version = await db.one<Tables<"offering_versions">>(
      "select * from public.offering_versions where id = $1",
      [data.versionId],
    );
    if (version.status === "published")
      throw new Error("Published versions are immutable. Create a new version instead.");

    const check = blueprintSchema.safeParse(version.manifest_json);
    const policyIssues = architecturePolicyCheck(
      (version.manifest_json ?? {}) as Record<string, unknown>,
    );
    const offering = await db.one<Tables<"offerings">>(
      "select * from public.offerings where id = $1",
      [version.offering_id],
    );
    const hosting = await db.maybeOne<{ answers: unknown }>(
      "select answers from public.foundations where organization_id = $1 and customer_id is null",
      [ORG_ID],
    );
    const arch = fromManifest(offering, version.manifest_json);
    const review = reviewOffering({ ...arch, hostingAnswers: hosting?.answers ?? {} });
    const blocking = [
      ...policyIssues.filter((i) => i.level === "BLOCKING"),
      ...review
        .filter((c) => c.level === "fail")
        .map((c) => ({ message: `${c.title}. ${c.detail}` })),
    ];
    if (!check.success || blocking.length) {
      throw new Error(
        `Cannot publish: ${[...(check.success ? [] : check.error.issues.map((i) => i.message)), ...blocking.map((b) => b.message)].join("; ")}`,
      );
    }

    const [published] = await db.update<Tables<"offering_versions">>(
      "offering_versions",
      { status: "published", published_at: new Date().toISOString() },
      { id: data.versionId },
    );
    if (!published) throw new Error("Version not found");

    await audit(db, {
      event_type: "offering_version.published",
      resource_type: "offering_version",
      resource_id: published.version,
      previous_value: { status: version.status },
      new_value: { status: "published", architectureReview: verdict(review) },
    });
    return published;
  });

/** New offering: starts as a v1.0.0 draft copied from a template offering, then goes through review. */
export const createOffering = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(3).max(80),
        description: z.string().max(400).default(""),
        templateOfferingId: z.string().uuid(),
        landing: z.enum(["existing-customer-hub", "dedicated-spoke", "isv-hosted"]),
        landingZone: z.enum(["corp", "online", "local", "sandbox"]),
        regions: z.array(z.string().min(3).max(40)).min(1).max(60),
        environments: z.array(z.enum(ENV_KEYS)).min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const template = await db.one<Tables<"offerings">>(
      "select * from public.offerings where id = $1",
      [data.templateOfferingId],
    );
    const base = await db.maybeOne<{ manifest_json: Record<string, unknown> }>(
      `select manifest_json from public.offering_versions where offering_id = $1
       order by (status = 'published') desc, created_at desc limit 1`,
      [template.id],
    );
    const profile =
      data.landing === "existing-customer-hub"
        ? "customer-hub"
        : data.landing === "isv-hosted"
          ? "isv-hosted"
          : "dedicated-spoke";
    const offering = await db
      .insert<Tables<"offerings">>("offerings", {
        product_id: template.product_id,
        name: data.name,
        description: data.description || null,
        offering_type:
          data.landing === "isv-hosted"
            ? "saas_connected"
            : data.landing === "existing-customer-hub"
              ? "enterprise_private"
              : "customer_hosted",
        deployment_boundary: template.deployment_boundary,
        network_profile: profile,
        security_profile: template.security_profile,
        supported_regions: data.regions,
        estimated_monthly_cost_low: template.estimated_monthly_cost_low,
        estimated_monthly_cost_high: template.estimated_monthly_cost_high,
      })
      .catch((e: Error) => {
        throw new Error(e.message);
      });
    const arch = fromManifest(template, base?.manifest_json ?? {});
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const manifest = toManifest(
      slug,
      "1.0.0",
      {
        selected: arch.selected,
        topology: {
          ...arch.topology,
          landing: data.landing,
          landingZone: data.landingZone,
          regions: data.regions,
          environments: data.environments,
        },
      },
      {
        repository: "github.com/gridworks/grid-analytics-infra",
        path: `offerings/${slug}`,
        iac: "bicep",
        pipeline: "github-actions",
      },
    );
    const version = await db.insert<Tables<"offering_versions">>("offering_versions", {
      offering_id: offering.id,
      version: "1.0.0",
      status: "draft",
      manifest_json: manifest,
      release_notes: `New offering, started from ${template.name}.`,
      ai_generated: false,
      created_by: "Sarah Chen",
    });
    await audit(db, {
      event_type: "offering.created",
      resource_type: "offering",
      resource_id: offering.name,
      new_value: { template: template.name, regions: data.regions, landingZone: data.landingZone },
    });
    return { offeringId: offering.id, versionId: version.id };
  });

/* --------------------------------------------------------------- onboarding */

export const onboardCustomer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(2).max(120),
        customerCode: z
          .string()
          .min(2)
          .max(60)
          .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
        tenantId: z.string().max(64).optional(),
        accessMethod: z.enum(["customer_link", "engineer"]).default("engineer"),
        inputs: z.record(z.string(), z.union([z.string().max(400), z.boolean()])).default({}),
        overrides: z.record(z.string(), z.string().max(200)).default({}),
        industry: z.string().max(80).optional(),
        azureModel: z.enum(["existing_enterprise_alz", "greenfield", "isv_hosted"]),
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
        environments: z.array(z.enum(ENV_KEYS)).min(1),
        plans: z
          .array(
            z.object({
              env: z.enum(ENV_KEYS),
              region: z.string().min(3).max(40),
              target: z.enum([
                "new_subscription",
                "existing_subscription",
                "existing_resource_group",
              ]),
              subscriptionId: z.string().max(80).default(""),
              resourceGroup: z.string().max(90).default(""),
            }),
          )
          .default([]),
        delivery: z
          .object({
            tool: z.enum(["github-actions", "azure-devops"]),
            repo: z.string().min(3).max(140),
            autoDeployNonProd: z.boolean(),
            prodApprovers: z.string().max(120),
            prodWaitMinutes: z.number().int().min(0).max(43200),
            driftSchedule: z.boolean(),
          })
          .optional(),
        placement: z
          .array(z.object({ id: z.string().max(90), name: z.string().max(120) }))
          .max(8)
          .default([]),
        network: z.object({
          mode: z.enum(["existing-customer-hub", "dedicated-spoke", "isv-hosted"]),
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

    const offering = await db.one<Tables<"offerings">>(
      "select * from public.offerings where id = $1",
      [data.offeringId],
    );
    const offeringVersions = await db.query<{ id: string; version: string; status: string }>(
      "select id, version, status from public.offering_versions where offering_id = $1",
      [offering.id],
    );

    const published = offeringVersions
      .filter((v) => v.status === "published")
      .sort((a, b) => b.version.localeCompare(a.version))[0];
    if (!published) throw new Error("This offering has no published version to deploy.");

    const viaLink = data.accessMethod === "customer_link";
    const customer = await db
      .insert<Tables<"customers">>("customers", {
        organization_id: ORG_ID,
        name: data.name,
        customer_code: data.customerCode,
        tenant_id: data.tenantId || null,
        industry: data.industry ?? null,
        azure_model: data.azureModel,
        status: viaLink ? "onboarding" : "active",
      })
      .catch((e: Error) => {
        throw new Error(
          e.message.includes("duplicate") ? "That customer code is already in use." : e.message,
        );
      });

    const connection = await db.insert<Tables<"customer_connections">>("customer_connections", {
      customer_id: customer.id,
      connection_type: data.connectionType,
      tenant_id: data.tenantId || null,
      subscription_id: data.subscriptionId || null,
      resource_group_id: data.resourceGroupId ?? null,
      management_group_id: data.managementGroupId ?? null,
      credential_reference: `kv://gridworks-platform-kv/secrets/oidc-${data.customerCode}`,
      status: viaLink ? "awaiting_customer" : "validated",
      last_validated_at: viaLink ? null : new Date().toISOString(),
      metadata_json: {
        federatedIdentity: true,
        mode: "demo",
        accessMethod: data.accessMethod,
      },
    });

    const costPerEnv = Number(offering.estimated_monthly_cost_low ?? 0);
    const delivery = data.delivery ?? DEFAULT_DELIVERY;
    const environments = await db.insertMany<Tables<"environments">>(
      "environments",
      data.environments.map((type) => {
        const plan = data.plans.find((p) => p.env === type) ?? {
          env: type,
          region: data.region,
          target: "new_subscription" as const,
          subscriptionId: data.subscriptionId ?? "",
          resourceGroup: "",
        };
        const names = namesFor(data.customerCode, plan, delivery);
        return {
          customer_id: customer.id,
          offering_id: offering.id,
          desired_offering_version_id: published.id,
          actual_offering_version_id: null,
          name: envName(type),
          environment_type: type,
          region: plan.region,
          secondary_region: data.secondaryRegion ?? null,
          deployment_boundary: offering.deployment_boundary,
          status: "pending_deployment",
          compliance_score: 0,
          monthly_cost_estimate: type === "production" ? costPerEnv : Math.round(costPerEnv * 0.25),
          configuration_json: {
            network: data.network,
            observability: data.observability,
            inputs: {
              ...data.inputs,
              ...(plan.target !== "new_subscription" && plan.subscriptionId
                ? { subscriptionId: plan.subscriptionId }
                : {}),
            },
            overrides: data.overrides,
            target: { ...plan, ...names, managementGroup: data.placement.at(-1)?.id ?? null },
            delivery: {
              ...delivery,
              environment: names.environment,
              oidcSubject: names.oidcSubject,
            },
          },
        };
      }),
    );

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
        accessMethod: data.accessMethod,
        delivery: delivery.tool,
        repo: delivery.repo,
        installFile: `installs/${data.customerCode}.yaml`,
        overrides: Object.keys(data.overrides),
      },
    });

    return {
      customerId: customer.id,
      connectionId: connection?.id ?? null,
      environments: environments ?? [],
      version: published.version,
    };
  });

/**
 * Called from the customer-facing install page once the customer's Azure admin has granted access.
 * Records the connection as validated and merges discovered platform resources into every environment.
 */
export const completeCustomerLink = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        tenantId: z.string().min(8).max(64),
        subscriptionId: z.string().min(8).max(80),
        inputs: z.record(z.string(), z.union([z.string().max(400), z.boolean()])).default({}),
        grantedBy: z.string().max(120).default("Customer administrator"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const customer = await db.one<Tables<"customers">>(
      "select * from public.customers where id = $1",
      [data.customerId],
    );

    await db.update(
      "customers",
      { tenant_id: data.tenantId, status: "active" },
      { id: customer.id },
    );
    await db.update(
      "customer_connections",
      {
        tenant_id: data.tenantId,
        subscription_id: data.subscriptionId,
        status: "validated",
        last_validated_at: new Date().toISOString(),
      },
      { customer_id: customer.id },
    );

    const envs = await db.query<{ id: string; configuration_json: unknown }>(
      "select id, configuration_json from public.environments where customer_id = $1",
      [customer.id],
    );
    for (const env of envs ?? []) {
      const cfg = (env.configuration_json ?? {}) as Record<string, Record<string, unknown>>;
      const inputs = {
        ...(cfg["inputs"] ?? {}),
        ...data.inputs,
        subscriptionId: data.subscriptionId,
      };
      await db.update(
        "environments",
        {
          configuration_json: {
            ...cfg,
            inputs,
            network: {
              ...(cfg["network"] ?? {}),
              vnetId: data.inputs["vnetId"] ?? cfg["network"]?.["vnetId"],
            },
            observability: {
              ...(cfg["observability"] ?? {}),
              logAnalyticsWorkspaceId:
                data.inputs["logAnalyticsWorkspaceId"] ??
                cfg["observability"]?.["logAnalyticsWorkspaceId"],
            },
          },
        },
        { id: env.id },
      );
    }

    await audit(db, {
      event_type: "customer.access_granted",
      actor_name: data.grantedBy,
      customer_id: customer.id,
      resource_type: "customer_connection",
      resource_id: data.subscriptionId,
      new_value: { status: "validated", discovered: Object.keys(data.inputs), mode: "demo" },
    });
    return { customerId: customer.id, status: "validated" as const };
  });

/* ----------------------------------------------------------------- upgrades */

export const planUpgrades = createServerFn({ method: "POST" })
  .inputValidator((d: { offeringVersionId: string }) =>
    z.object({ offeringVersionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const target = await db.one<
      Tables<"offering_versions"> & { offerings: { id: string; name: string } }
    >(
      `select v.*, jsonb_build_object('id', o.id, 'name', o.name) as offerings
       from public.offering_versions v join public.offerings o on o.id = v.offering_id where v.id = $1`,
      [data.offeringVersionId],
    );

    const environments = await db.query<{
      id: string;
      name: string;
      environment_type: string;
      compliance_score: number;
      customers: { name: string } | null;
      actual: { version: string } | null;
    }>(
      `select e.id, e.name, e.environment_type, e.compliance_score,
         (select jsonb_build_object('name', c.name) from public.customers c where c.id = e.customer_id) as customers,
         (select jsonb_build_object('version', v.version) from public.offering_versions v where v.id = e.actual_offering_version_id) as actual
       from public.environments e where e.offering_id = $1`,
      [target.offerings.id],
    );

    const current: string[] = [];
    const compatible: string[] = [];
    const manualReview: { id: string; reason: string }[] = [];

    for (const env of environments ?? []) {
      const actual = (env.actual as { version?: string } | null)?.version ?? null;
      if (actual === target.version) current.push(env.id);
      else if (!actual)
        manualReview.push({ id: env.id, reason: "Environment has never been deployed." });
      else if (Number(actual.split(".")[0]) < Number(target.version.split(".")[0]))
        manualReview.push({
          id: env.id,
          reason: `Major version gap (${actual} → ${target.version}) requires review.`,
        });
      else if (Number(env.compliance_score) < 95)
        manualReview.push({
          id: env.id,
          reason: `Compliance at ${env.compliance_score}% — remediate before upgrading.`,
        });
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
  .inputValidator(
    (d: { offeringVersionId: string; waves: { name: string; environmentIds: string[] }[] }) =>
      z
        .object({
          offeringVersionId: z.string().uuid(),
          waves: z
            .array(
              z.object({
                name: z.string().min(1).max(80),
                environmentIds: z.array(z.string().uuid()).min(1),
              }),
            )
            .min(1),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const waves = await db.insertMany<Tables<"upgrade_waves">>(
      "upgrade_waves",
      data.waves.map((w, index) => ({
        organization_id: ORG_ID,
        offering_version_id: data.offeringVersionId,
        name: w.name,
        sequence: index + 1,
        status: "planned",
        environment_ids: w.environmentIds,
      })),
    );

    await audit(db, {
      event_type: "upgrade_rollout.created",
      resource_type: "upgrade_wave",
      resource_id: data.offeringVersionId,
      new_value: {
        waves: data.waves.map((w) => ({ name: w.name, count: w.environmentIds.length })),
      },
    });
    return waves;
  });

export const startWave = createServerFn({ method: "POST" })
  .inputValidator((d: { waveId: string }) => z.object({ waveId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const wave = await db.one<Tables<"upgrade_waves">>(
      "select * from public.upgrade_waves where id = $1",
      [data.waveId],
    );
    if (wave.status !== "planned") throw new Error("This wave has already been started.");

    let created = 0;
    for (const environmentId of wave.environment_ids) {
      // The wave's release becomes the install's desired state before it is planned.
      await db.update(
        "environments",
        { desired_offering_version_id: wave.offering_version_id },
        { id: environmentId },
      );
      const { environment, ctx, version } = await loadContext(db, environmentId, "upgrade");
      const actualVersion = environment.actual_offering_version_id
        ? await db.maybeOne<{ version: string }>(
            "select version from public.offering_versions where id = $1",
            [environment.actual_offering_version_id],
          )
        : null;
      const preflight = await demoProvider.validate(ctx);
      const plan = preflight.deployable ? await demoProvider.plan(ctx) : null;
      const deployment = await db.insert<{ id: string }>("deployments", {
        environment_id: environmentId,
        deployment_type: "upgrade",
        desired_version: version?.version ?? null,
        previous_version: actualVersion?.version ?? null,
        status: preflight.deployable ? "AWAITING_APPROVAL" : "VALIDATION_FAILED",
        mode: "demo",
        requested_by: "Rollout automation",
        plan_json: plan ?? {},
        preflight_json: preflight,
        correlation_id: plan?.correlationId ?? crypto.randomUUID(),
      });
      if (preflight.deployable) {
        await db.insert("approvals", {
          deployment_id: deployment.id,
          approval_type:
            environment.environment_type === "production"
              ? "production_deployment"
              : "plan_approval",
          requested_from:
            environment.environment_type === "production"
              ? "Security Approver"
              : "Platform Engineer",
          status: "pending",
        });
      }
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

    await db.update("upgrade_waves", { status: "in_progress" }, { id: wave.id });
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
    const previous = await db.maybeOne<Tables<"organizations">>(
      "select * from public.organizations where id = $1",
      [ORG_ID],
    );
    const [updated] = await db.update<Tables<"organizations">>(
      "organizations",
      {
        name: data.name,
        portal_title: data.portalTitle,
        support_url: data.supportUrl || null,
        primary_color: data.primaryColor,
        updated_at: new Date().toISOString(),
      },
      { id: ORG_ID },
    );
    if (!updated) throw new Error("Organization not found");
    await audit(db, {
      event_type: "organization.branding_updated",
      resource_type: "organization",
      resource_id: ORG_ID,
      previous_value: { name: previous?.name, portal_title: previous?.portal_title },
      new_value: { name: updated.name, portal_title: updated.portal_title },
    });
    return updated;
  });

/* -------------------------------------------------------------- foundations */

const answersSchema = z.object({
  intermediateRootId: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,30}$/, "Lowercase letters, numbers and hyphens"),
  intermediateRootName: z.string().min(2).max(80),
  primaryRegion: z.string().min(3).max(40),
  connectivity: z.enum(["hub_and_spoke", "virtual_wan", "none"]),
  firewall: z.enum(["Premium", "Standard", "Basic", "none"]),
  bastion: z.enum(["yes", "no"]),
  vpnGateway: z.enum(["yes", "no"]),
  expressRoute: z.enum(["yes", "no"]),
  ddosPlan: z.enum(["yes", "no"]),
  privateDns: z.enum(["platform", "none"]),
  monitoring: z.enum(["azure_monitor", "third_party"]),
  logRetentionDays: z.number().int().min(30).max(730),
  siem: z.enum(["sentinel", "other"]),
  identity: z.enum(["yes", "no"]),
  securitySubscription: z.enum(["yes", "no"]),
  customGroups: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
        name: z.string().min(1).max(80),
        parent: z.string().max(40),
        archetype: z.enum(["corp", "online", "local", "sandbox", "inherit"]),
      }),
    )
    .max(30),
  removedGroups: z.array(
    z.enum(["management", "connectivity", "identity", "security", "decommissioned"]),
  ),
  groupNames: z.record(z.string().max(40), z.string().min(1).max(80)),
  environments: z
    .array(z.string().regex(/^[a-z][a-z0-9-]{0,19}$/))
    .min(1)
    .max(10),
  extraSubscriptions: z
    .array(
      z.object({
        id: z.string().max(60),
        name: z.string().min(1).max(64),
        group: z.string().max(40),
        environment: z.string().max(20),
      }),
    )
    .max(50),
  defaultGroup: z.string().max(40),
  workloads: z.array(z.object({ group: z.string().max(40), id: z.string().max(20) })).max(60),
  rbac: z
    .array(
      z.object({
        persona: z.string().max(40),
        role: z.string().max(80),
        scope: z.string().max(40),
      }),
    )
    .max(40),
  policyAdds: z.array(z.object({ id: z.string().max(60), scope: z.string().max(40) })).max(40),
  customerTag: z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/),
  secondaryRegion: z.string().max(40),
  defender: z.enum(["yes", "no"]),
  updateManager: z.enum(["yes", "no"]),
  serviceHealth: z.enum(["yes", "no"]),
  vmBackup: z.enum(["yes", "no"]),
  landingZones: z.array(z.enum(["corp", "online", "local", "sandbox"])),
  policyOverrides: z.record(
    z.string().regex(/^[a-z][a-z0-9_-]*\/[A-Za-z0-9-]+$/),
    z.enum(["audit", "remove"]),
  ),
  securityContactEmail: z.string().email().or(z.literal("")),
});

async function managedFoundation(db: Db, id: string) {
  const f = await db.one<Tables<"foundations">>("select * from public.foundations where id = $1", [
    id,
  ]);
  if (f.mode !== "managed")
    throw new Error("This landing zone belongs to the customer's platform team and is read-only.");
  return f;
}

export const saveFoundationAnswers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ foundationId: z.string().uuid(), answers: answersSchema }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const f = await managedFoundation(db, data.foundationId);
    await db.update(
      "foundations",
      {
        answers: data.answers,
        status: f.status === "deployed" ? "changes_pending" : f.status,
        updated_at: new Date().toISOString(),
      },
      { id: f.id },
    );
    await audit(db, {
      event_type: "foundation.answers_updated",
      customer_id: f.customer_id,
      resource_type: "foundation",
      resource_id: f.name,
      previous_value: f.answers,
      new_value: data.answers,
    });
    return { ok: true };
  });

export const pinFoundationLibrary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        foundationId: z.string().uuid(),
        libraryRef: z.string().regex(/^platform\/alz\/\d{4}\.\d{2}\.\d+$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const f = await managedFoundation(db, data.foundationId);
    await db.update(
      "foundations",
      {
        library_ref: data.libraryRef,
        status: f.deployed_ref && f.deployed_ref !== data.libraryRef ? "changes_pending" : f.status,
        updated_at: new Date().toISOString(),
      },
      { id: f.id },
    );
    await audit(db, {
      event_type: "foundation.library_pinned",
      customer_id: f.customer_id,
      resource_type: "foundation",
      resource_id: f.name,
      previous_value: { libraryRef: f.library_ref },
      new_value: { libraryRef: data.libraryRef },
    });
    return { ok: true };
  });

/** Demo engine: records a platform landing zone deployment. Real mode runs the generated Terraform. */
export const deployFoundation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ foundationId: z.string().uuid(), approvedBy: z.string().default("Sarah Chen") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const f = await managedFoundation(db, data.foundationId);
    const now = new Date().toISOString();
    await db.update(
      "foundations",
      { deployed_ref: f.library_ref, status: "deployed", last_deployed_at: now, updated_at: now },
      { id: f.id },
    );
    await audit(db, {
      event_type: "foundation.deployed",
      actor_name: data.approvedBy,
      customer_id: f.customer_id,
      resource_type: "foundation",
      resource_id: f.name,
      previous_value: { deployedRef: f.deployed_ref },
      new_value: { deployedRef: f.library_ref, mode: "demo" },
    });
    return { deployedRef: f.library_ref };
  });
