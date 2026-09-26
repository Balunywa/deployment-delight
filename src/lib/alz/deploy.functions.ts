import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "../db-types";
import {
  type Answers,
  LATEST_REF,
  hasHub,
  on,
  placementGroup,
  shortRef,
  terraformFor,
  withDefaults,
} from "./engine";

/*
 * Real platform landing zone deployments. The design, library pin and generated Terraform are the same the
 * Infrastructure as code tab shows; these functions put them into Azure.
 */

type TargetKey = "management" | "connectivity" | "identity" | "security";
export type Target = { key: TargetKey; label: string; variable: string };

export function targetsFor(a: Answers): Target[] {
  return [
    { key: "management", label: "Management", variable: "management_subscription_id" },
    ...(hasHub(a)
      ? [
          {
            key: "connectivity" as const,
            label: "Connectivity",
            variable: "connectivity_subscription_id",
          },
        ]
      : []),
    ...(on(a.identity)
      ? [{ key: "identity" as const, label: "Identity", variable: "identity_subscription_id" }]
      : []),
    ...(on(a.securitySubscription)
      ? [{ key: "security" as const, label: "Security", variable: "security_subscription_id" }]
      : []),
  ];
}

/** Variables for Microsoft Entra group object IDs the design's role assignments need. */
function principalVars(files: { path: string; content: string }[]) {
  const vars = files.find((f) => f.path === "variables.tf")?.content ?? "";
  return [...vars.matchAll(/variable "([a-z_]+_principal_id)"/g)].map((m) => m[1]!);
}

export type Deployment = {
  targets?: Partial<Record<TargetKey, string>>;
  vended?: { key: string; subscriptionId: string; alias: string }[];
  billingScope?: string;
};

type FoundationRow = {
  id: string;
  name: string;
  mode: string;
  library_ref: string;
  answers: unknown;
  deployment: Deployment | null;
  status: string;
};

async function load(foundationId: string) {
  const db = await import("../db.server");
  const f = await db.one<FoundationRow>("select * from public.foundations where id = $1", [
    foundationId,
  ]);
  if (f.mode !== "managed") throw new Error("Only landing zones this app builds can be deployed.");
  return { db, f, answers: withDefaults(f.answers) };
}

export const getDeployReadiness = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ foundationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { f, answers } = await load(data.foundationId);
    const arm = await import("./arm.server");
    const files = terraformFor(f.library_ref, answers);
    const checks: { id: string; level: "pass" | "warn" | "fail"; title: string; detail: string }[] =
      [];
    let identity: Awaited<ReturnType<typeof arm.whoAmI>> | null = null;
    try {
      identity = await arm.whoAmI();
    } catch (e) {
      checks.push({
        id: "identity",
        level: "fail",
        title: "No Azure identity",
        detail: `${(e as Error).message} Locally, sign in with az login. On App Service, set DEPLOY_CLIENT_ID.`,
      });
    }
    const [subscriptions, billing, roles, rootExists] = identity
      ? await Promise.all([
          arm.listSubscriptions().catch(() => []),
          arm.listBillingScopes().catch(() => []),
          arm
            .rootRoles(identity)
            .catch(() => ({ owner: false, contributor: false, accessAdmin: false, status: 0 })),
          arm.managementGroupExists(answers.intermediateRootId || "alz").catch(() => false),
        ])
      : [[], [], { owner: false, contributor: false, accessAdmin: false, status: 0 }, false];
    if (identity) {
      checks.push({
        id: "identity",
        level: "pass",
        title: `Deploys as ${identity.name || identity.objectId}`,
        detail:
          identity.mode === "cli"
            ? "Your Azure CLI sign-in (running locally)."
            : identity.mode === "app-registration"
              ? "The app registration that trusts this web app's managed identity."
              : "The web app's managed identity.",
      });
      const canDeploy = roles.owner || (roles.contributor && roles.accessAdmin);
      checks.push(
        canDeploy
          ? {
              id: "roles",
              level: "pass",
              title: "Owner at the tenant root management group",
              detail:
                "Needed to create management groups, policy and role assignments, and move subscriptions.",
            }
          : {
              id: "roles",
              level: "fail",
              title: "Needs Owner at the tenant root management group",
              detail: `Grant it once: az role assignment create --assignee-object-id ${identity.objectId} --assignee-principal-type ${identity.kind === "user" ? "User" : "ServicePrincipal"} --role Owner --scope /providers/Microsoft.Management/managementGroups/${identity.tenantId}`,
            },
      );
      checks.push(
        rootExists && f.status !== "deployed" && !f.deployment?.targets
          ? {
              id: "root",
              level: "warn",
              title: `Management group "${answers.intermediateRootId}" already exists`,
              detail:
                "The deployment will adopt it. Pick another prefix on the Design tab if that's not intended.",
            }
          : {
              id: "root",
              level: "pass",
              title: `Intermediate root "${answers.intermediateRootId}"`,
              detail: rootExists
                ? "Deployed by this app."
                : "Will be created under the tenant root group.",
            },
      );
    }
    if (f.library_ref !== LATEST_REF)
      checks.push({
        id: "library",
        level: "warn",
        title: `ALZ ${shortRef(f.library_ref)} is older than the latest (${shortRef(LATEST_REF)})`,
        detail:
          "Microsoft updates built-in policies over time; older library releases can be rejected by Azure (for example a changed allowed value). Upgrade on the ALZ version tab before deploying.",
      });
    return {
      identity,
      tenantId: identity?.tenantId ?? null,
      subscriptions,
      billingScopes: billing,
      checks,
      targets: targetsFor(answers),
      principals: principalVars(files),
      needsBillingScope: answers.extraSubscriptions.length > 0,
      hierarchySettings: !!answers.defaultGroup,
      deployment: f.deployment ?? {},
      libraryRef: shortRef(f.library_ref),
      status: f.status,
    };
  });

const running = new Set<string>();

export const startDeployRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        foundationId: z.string().uuid(),
        action: z.enum(["plan", "apply", "destroy"]),
        targets: z
          .record(
            z.enum(["management", "connectivity", "identity", "security"]),
            z.union([
              z.object({ mode: z.literal("existing"), subscriptionId: z.string().uuid() }),
              z.object({ mode: z.literal("new") }),
            ]),
          )
          .default({}),
        billingScope: z.string().max(400).default(""),
        principals: z.record(z.string(), z.string().uuid()).default({}),
        applyHierarchySettings: z.boolean().default(false),
        cancelVended: z.boolean().default(false),
        startedBy: z.string().max(120).default("Platform engineer"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, f, answers } = await load(data.foundationId);
    if (running.has(f.id)) throw new Error("A run is already in progress for this landing zone.");
    const active = await db.maybeOne(
      "select id from public.foundation_runs where foundation_id = $1 and status = 'running' and created_at > now() - interval '3 hours'",
      [f.id],
    );
    if (active) throw new Error("A run is already in progress for this landing zone.");
    const run = await db.insert<{ id: string }>("foundation_runs", {
      foundation_id: f.id,
      action: data.action,
      status: "running",
      started_by: data.startedBy,
      targets: data.targets,
    });
    running.add(f.id);

    let buffer = "";
    let dirty = false;
    const log = (line: string) => {
      buffer += `${new Date().toISOString().slice(11, 19)}  ${line}\n`;
      if (buffer.length > 400_000) buffer = buffer.slice(-300_000);
      dirty = true;
    };
    const flush = async () => {
      if (!dirty) return;
      dirty = false;
      await db.update("foundation_runs", { log: buffer }, { id: run.id });
    };
    const timer = setInterval(() => void flush().catch(() => {}), 2000);
    const finish = async (ok: boolean, summary: Record<string, unknown>) => {
      clearInterval(timer);
      dirty = true;
      await flush();
      await db.update(
        "foundation_runs",
        { status: ok ? "succeeded" : "failed", summary, finished_at: new Date().toISOString() },
        { id: run.id },
      );
      running.delete(f.id);
    };

    void (async () => {
      try {
        const arm = await import("./arm.server");
        const runner = await import("./runner.server");
        const deployment: Deployment = { ...(f.deployment ?? {}) };
        if (data.action === "plan") {
          const targets: Partial<Record<TargetKey, string>> = { ...(deployment.targets ?? {}) };
          const vended = [...(deployment.vended ?? [])];
          for (const t of targetsFor(answers)) {
            const choice = data.targets[t.key];
            if (choice?.mode === "existing") targets[t.key] = choice.subscriptionId;
            else if (choice?.mode === "new" || !targets[t.key]) {
              if (!data.billingScope)
                throw new Error(`Pick a billing scope to create the ${t.label} subscription.`);
              const alias = `${answers.intermediateRootId || "alz"}-${t.key}`;
              // Straight into its platform group when the landing zone already exists; on a first deploy
              // it's created in the tenant's default group and Terraform moves it during apply.
              const group = `${answers.intermediateRootId || "alz"}-${placementGroup(answers, t.key)}`;
              const exists = await arm.managementGroupExists(group).catch(() => false);
              if (!exists)
                log(
                  `${t.label} subscription is created in the tenant's default management group; apply moves it into ${group}.`,
                );
              const id = await arm.vendSubscription({
                alias,
                displayName: `${answers.intermediateRootName || "ALZ"} ${t.label}`,
                billingScope: data.billingScope,
                workload: "Production",
                managementGroupId: exists ? group : undefined,
                log,
              });
              targets[t.key] = id;
              if (!vended.some((v) => v.subscriptionId === id))
                vended.push({ key: t.key, subscriptionId: id, alias });
            }
            await arm.registerProviders(targets[t.key]!, log);
          }
          deployment.targets = targets;
          deployment.vended = vended;
          if (data.billingScope) deployment.billingScope = data.billingScope;
          await db.update("foundations", { deployment }, { id: f.id });

          const files = terraformFor(f.library_ref, answers);
          const vars: Record<string, unknown> = {};
          for (const t of targetsFor(answers)) vars[`${t.key}_subscription_id`] = targets[t.key];
          if (answers.extraSubscriptions.length)
            vars["billing_scope"] = data.billingScope || deployment.billingScope;
          if (answers.defaultGroup)
            vars["apply_tenant_hierarchy_settings"] = data.applyHierarchySettings;
          for (const p of principalVars(files)) {
            if (!data.principals[p])
              throw new Error(`Enter the Microsoft Entra object ID for ${p}.`);
            vars[p] = data.principals[p];
          }
          await runner.writeConfig(f.id, files, vars);
          log(`Configuration: ${files.length} files, ALZ library ${shortRef(f.library_ref)}.`);
          const r = await runner.terraform("plan", f.id, log);
          await finish(r.ok, r.summary);
          return;
        }
        if (data.action === "apply") {
          // Azure is eventually consistent: a policy definition or role can be created and still be "not found"
          // for a few seconds. Those errors clear on a second pass, so re-plan and apply again.
          const transient =
            /PolicyDefinitionNotFound|PolicySetDefinitionNotFound|RoleDefinitionDoesNotExist|PrincipalNotFound|ReferencedResourceNotProvisioned|AnotherOperationInProgress|ManagementGroupNotFound|AuthorizationFailed|RetryableError|Conflict/;
          let r = await runner.terraform("apply", f.id, log);
          for (let attempt = 2; !r.ok && attempt <= 4; attempt++) {
            const recent = buffer.slice(-60_000);
            // "Resource already exists": Azure created it but the read-back failed, so adopt it into state.
            const orphans = [
              ...recent.matchAll(
                /Error: Resource already exists[\s\S]*?with (\S+?),[\s\S]*?a resource with the ID[\s\S]*?"(\/[^"]+)"/g,
              ),
            ].map((m) => ({ address: m[1]!, id: m[2]! }));
            if (!orphans.length && !transient.test(recent)) break;
            for (const o of orphans) {
              log(`Adopting ${o.id} into state as ${o.address}.`);
              await runner.importResource(f.id, o.address, o.id, log);
            }
            log(
              `Azure reported a transient error — planning and applying again (attempt ${attempt} of 4).`,
            );
            await new Promise((res) => setTimeout(res, 30_000));
            const p = await runner.terraform("plan", f.id, log);
            if (!p.ok) break;
            r = await runner.terraform("apply", f.id, log);
          }
          if (r.ok) {
            const now = new Date().toISOString();
            await db.update(
              "foundations",
              {
                status: "deployed",
                deployed_ref: f.library_ref,
                last_deployed_at: now,
                updated_at: now,
                // What was applied, so the Review step can show what a later design changes.
                deployment: { ...deployment, appliedAnswers: answers },
              },
              { id: f.id },
            );
          }
          await finish(r.ok, r.summary);
          return;
        }
        const r = await runner.terraform("destroy", f.id, log);
        if (r.ok && data.cancelVended) {
          for (const v of deployment.vended ?? []) {
            log(`Cancelling subscription ${v.subscriptionId} (${v.alias})`);
            const status = await arm.cancelSubscription(v.subscriptionId, v.alias);
            log(`Cancel returned ${status}.`);
          }
          deployment.vended = [];
          deployment.targets = {};
          await db.update("foundations", { deployment }, { id: f.id });
        }
        if (r.ok)
          await db.update(
            "foundations",
            {
              status: "draft",
              deployed_ref: null,
              last_deployed_at: null,
              deployment: { ...deployment, appliedAnswers: null },
            },
            { id: f.id },
          );
        await finish(r.ok, r.summary);
      } catch (e) {
        log(`Error: ${(e as Error).message}`);
        await finish(false, { error: (e as Error).message });
      }
    })();

    return { runId: run.id };
  });

export type DeployRun = {
  id: string;
  action: "plan" | "apply" | "destroy";
  status: "queued" | "running" | "succeeded" | "failed";
  started_by: string | null;
  summary: Json;
  log: string;
  created_at: string;
  finished_at: string | null;
};

export const getDeployRuns = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ foundationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("../db.server");
    return db.query<DeployRun>(
      "select id, action, status, started_by, summary, log, created_at, finished_at from public.foundation_runs where foundation_id = $1 order by created_at desc limit 10",
      [data.foundationId],
    );
  });
