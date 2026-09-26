/*
 * Real offering deployments. An offering version's generated Terraform goes into a subscription ring by
 * ring: Land (access, providers, review, validate, resource groups), then each environment (plan, approval
 * for production, apply, verify). Each environment has its own Terraform state, so a re-deploy is a diff,
 * not a rebuild. The run's stages and step logs are saved as they happen for the pipeline view.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "../db-types";

export type StepStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "waiting";
export type RunStep = {
  id: string;
  name: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
  log: string;
};
export type RunStage = {
  id: string;
  name: string;
  env?: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  summary?: Record<string, string | number | null>;
  steps: RunStep[];
};
export type OfferingRun = {
  id: string;
  offering_id: string;
  version: string;
  action: "plan" | "deploy" | "destroy";
  status: "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  started_by: string | null;
  subscription_id: string;
  region: string;
  environments: string[];
  settings: RunSettings;
  stages: RunStage[];
  summary: Json;
  approval: { decision: "approved" | "rejected"; by: string; at: string } | null;
  created_at: string;
  finished_at: string | null;
};
type RunSettings = {
  installPrefix: string;
  resourceGroup: { mode: "new" | "existing"; name?: string | undefined };
  approvalFor: string[];
  enableDefender: boolean;
};

const ENV_SHORT: Record<string, string> = {
  development: "dev",
  test: "test",
  qa: "qa",
  uat: "uat",
  staging: "stg",
  production: "prod",
};
const ENV_ORDER = ["development", "test", "qa", "uat", "staging", "production"];
const ENV_LABEL: Record<string, string> = {
  development: "Dev",
  test: "Test",
  qa: "QA",
  uat: "UAT",
  staging: "Staging",
  production: "Prod",
};

const running = new Set<string>();
const workspace = (offeringId: string, env: string) =>
  `installs/${offeringId}/${ENV_SHORT[env] ?? env}`;
const installName = (prefix: string, env: string) => `${prefix}-${ENV_SHORT[env] ?? env}`;
const rgNameFor = (s: RunSettings, env: string) =>
  s.resourceGroup.mode === "existing" && s.resourceGroup.name
    ? s.resourceGroup.name
    : `rg-${installName(s.installPrefix, env)}`;

async function loadOffering(offeringId: string, versionId?: string) {
  const db = await import("../db.server");
  const offering = await db.one<{ id: string; name: string; product_id: string }>(
    "select id, name, product_id, network_profile, deployment_boundary from public.offerings where id = $1",
    [offeringId],
  );
  const versions = await db.query<{
    id: string;
    version: string;
    status: string;
    manifest_json: unknown;
  }>(
    "select id, version, status, manifest_json from public.offering_versions where offering_id = $1",
    [offeringId],
  );
  const { semverCompare } = await import("../fleet");
  const version =
    versions.find((v) => v.id === versionId) ??
    versions
      .filter((v) => v.status === "published")
      .sort((a, b) => semverCompare(b.version, a.version))[0] ??
    versions.sort((a, b) => semverCompare(b.version, a.version))[0];
  if (!version) throw new Error("This offering has no version to deploy.");
  const { fromManifest } = await import("../architecture");
  const arch = fromManifest(offering as never, version.manifest_json);
  return { db, offering, version, arch };
}

/** What the deploy form needs: where it can go, and what would happen to each environment's resource group. */
export const getOfferingDeployOptions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ offeringId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { arch } = await loadOffering(data.offeringId);
    const arm = await import("../alz/arm.server");
    try {
      const identity = await arm.whoAmI();
      const subscriptions = (await arm.listSubscriptions()).filter((s) => s.state === "Enabled");
      return {
        identity: { name: identity.name, tenantId: identity.tenantId, mode: identity.mode },
        subscriptions: subscriptions.map((s) => ({ id: s.id, name: s.name })),
        regions: arch.topology.regions,
        environments: ENV_ORDER.filter((e) => arch.topology.environments.includes(e)),
        error: null as string | null,
      };
    } catch (e) {
      return {
        identity: null,
        subscriptions: [],
        regions: arch.topology.regions,
        environments: ENV_ORDER.filter((e) => arch.topology.environments.includes(e)),
        error: (e as Error).message,
      };
    }
  });

/** Resource groups in a subscription, for "deploy into an existing resource group". */
export const listResourceGroups = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ subscriptionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const arm = await import("../alz/arm.server");
    const r = await arm.arm<{
      value?: { name: string; location: string; tags?: Record<string, string> }[];
    }>("GET", `/subscriptions/${data.subscriptionId}/resourcegroups?api-version=2021-04-01`);
    return (r.data.value ?? []).map((g) => ({
      name: g.name,
      location: g.location,
      managed: g.tags?.["managed-by"] === "cloud-delivery",
    }));
  });

export const getOfferingRuns = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ offeringId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("../db.server");
    return db.query<OfferingRun>(
      "select * from public.offering_runs where offering_id = $1 order by created_at desc limit 12",
      [data.offeringId],
    );
  });

export const decideOfferingRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        runId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        by: z.string().max(120).default("Platform engineer"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("../db.server");
    await db.update(
      "offering_runs",
      { approval: { decision: data.decision, by: data.by, at: new Date().toISOString() } as Json },
      { id: data.runId },
    );
    return { ok: true };
  });

export const startOfferingRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        offeringId: z.string().uuid(),
        versionId: z.string().uuid().optional(),
        action: z.enum(["plan", "deploy", "destroy"]),
        subscriptionId: z.string().uuid(),
        region: z.string().min(3).max(40),
        environments: z.array(z.enum(ENV_ORDER as [string, ...string[]])).min(1),
        installPrefix: z
          .string()
          .regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/, "Lowercase letters, numbers and hyphens"),
        resourceGroup: z.object({
          mode: z.enum(["new", "existing"]),
          name: z.string().max(90).optional(),
        }),
        approvalFor: z.array(z.string()).default(["production"]),
        enableDefender: z.boolean().default(false),
        startedBy: z.string().max(120).default("Platform engineer"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, offering, version, arch } = await loadOffering(data.offeringId, data.versionId);
    if (!arch.topology.regions.includes(data.region))
      throw new Error(`This offering supports ${arch.topology.regions.join(", ")}.`);
    if (running.has(offering.id))
      throw new Error("A run is already in progress for this offering.");
    const active = await db.maybeOne(
      "select id from public.offering_runs where offering_id = $1 and status in ('running', 'waiting') and created_at > now() - interval '4 hours'",
      [offering.id],
    );
    if (active) throw new Error("A run is already in progress for this offering.");

    const envs = ENV_ORDER.filter((e) => data.environments.includes(e));
    const ordered = data.action === "destroy" ? [...envs].reverse() : envs;
    const settings: RunSettings = {
      installPrefix: data.installPrefix,
      resourceGroup: data.resourceGroup,
      approvalFor: data.approvalFor,
      enableDefender: data.enableDefender,
    };
    const stages: RunStage[] = [
      {
        id: "land",
        name: "Land",
        status: "queued",
        steps: [
          { id: "access", name: "Check access to the subscription", status: "queued", log: "" },
          { id: "providers", name: "Register resource providers", status: "queued", log: "" },
          ...(data.action !== "destroy"
            ? [
                {
                  id: "review",
                  name: "Architecture review",
                  status: "queued" as StepStatus,
                  log: "",
                },
                {
                  id: "quota",
                  name: "Quota & capacity",
                  status: "queued" as StepStatus,
                  log: "",
                },
              ]
            : []),
          { id: "generate", name: "Generate Terraform", status: "queued", log: "" },
          { id: "validate", name: "terraform init + validate", status: "queued", log: "" },
          { id: "rg", name: "Resource groups", status: "queued", log: "" },
        ],
      },
      ...ordered.map<RunStage>((e) => ({
        id: e,
        name: `${data.action === "destroy" ? "Destroy · " : ""}${ENV_LABEL[e] ?? e}`,
        env: e,
        status: "queued",
        steps:
          data.action === "destroy"
            ? [{ id: "destroy", name: "terraform destroy", status: "queued", log: "" }]
            : data.action === "plan"
              ? [{ id: "plan", name: "terraform plan", status: "queued", log: "" }]
              : [
                  { id: "plan", name: "terraform plan", status: "queued", log: "" },
                  ...(data.approvalFor.includes(e)
                    ? [
                        {
                          id: "approval",
                          name: "Approval",
                          status: "queued" as StepStatus,
                          log: "",
                        },
                      ]
                    : []),
                  { id: "apply", name: "terraform apply", status: "queued", log: "" },
                  { id: "verify", name: "Verify", status: "queued", log: "" },
                ],
      })),
    ];

    const run = await db.insert<{ id: string }>("offering_runs", {
      offering_id: offering.id,
      offering_version_id: version.id,
      version: version.version,
      action: data.action,
      status: "running",
      started_by: data.startedBy,
      subscription_id: data.subscriptionId,
      region: data.region,
      environments: envs,
      settings: settings as unknown as Json,
      stages: JSON.stringify(stages),
    });
    running.add(offering.id);

    let dirty = false;
    const flush = async () => {
      if (!dirty) return;
      dirty = false;
      await db.update("offering_runs", { stages: JSON.stringify(stages) }, { id: run.id });
    };
    const timer = setInterval(() => void flush().catch(() => {}), 1500);
    const now = () => new Date().toISOString();
    const stepOf = (stage: RunStage, id: string) => stage.steps.find((s) => s.id === id)!;
    const start = (stage: RunStage, step: RunStep) => {
      if (stage.status === "queued") {
        stage.status = "running";
        stage.startedAt = now();
      }
      step.status = "running";
      step.startedAt = now();
      dirty = true;
    };
    const end = (step: RunStep, status: StepStatus, detail?: string) => {
      step.status = status;
      step.finishedAt = now();
      if (detail) step.detail = detail;
      dirty = true;
    };
    const logTo = (step: RunStep) => (line: string) => {
      step.log += `${new Date().toISOString().slice(11, 19)}  ${line}\n`;
      if (step.log.length > 120_000) step.log = step.log.slice(-90_000);
      dirty = true;
    };
    const finish = async (status: OfferingRun["status"], summary: Record<string, unknown>) => {
      clearInterval(timer);
      for (const st of stages) {
        for (const s of st.steps) if (s.status === "queued") s.status = "skipped";
        if (st.status === "running" || st.status === "waiting")
          st.status = status === "succeeded" ? "succeeded" : "failed";
        if (st.status === "queued") st.status = "skipped";
      }
      dirty = true;
      await flush();
      await db.update(
        "offering_runs",
        { status, summary: summary as Json, finished_at: now() },
        { id: run.id },
      );
      running.delete(offering.id);
    };

    void (async () => {
      const land = stages[0]!;
      let current: RunStep | null = null;
      try {
        const arm = await import("../alz/arm.server");
        const runner = await import("../alz/runner.server");
        const { offeringTerraform } = await import("./terraform");
        const { reviewOffering, verdict } = await import("../onboarding");

        // ---------------------------------------------------------------- Land
        current = stepOf(land, "access");
        start(land, current);
        const log = logTo(current);
        const me = await arm.whoAmI();
        log(`Signed in as ${me.name} (${me.mode}) in tenant ${me.tenantId}.`);
        const sub = await arm.arm<{ displayName?: string; state?: string }>(
          "GET",
          `/subscriptions/${data.subscriptionId}?api-version=2022-12-01`,
        );
        if (sub.status !== 200)
          throw new Error(`Can't read subscription ${data.subscriptionId} (${sub.status}).`);
        log(`Subscription ${sub.data.displayName} (${data.subscriptionId}) · ${sub.data.state}.`);
        end(current, "succeeded", sub.data.displayName);

        current = stepOf(land, "providers");
        start(land, current);
        await arm.registerProviders(data.subscriptionId, logTo(current));
        logTo(current)("Service-specific providers are registered by Terraform as it deploys.");
        end(current, "succeeded");

        const files = offeringTerraform({
          product: offering.name.split(" · ")[0] ?? offering.name,
          selected: arch.selected,
          topology: arch.topology,
        });

        if (data.action !== "destroy") {
          current = stepOf(land, "review");
          start(land, current);
          const isv = await db.maybeOne<{ answers: unknown }>(
            "select answers from public.foundations where customer_id is null limit 1",
          );
          const checks = reviewOffering({
            selected: arch.selected,
            topology: arch.topology,
            hostingAnswers: isv?.answers ?? {},
          });
          for (const c of checks)
            logTo(current)(`${c.level.toUpperCase().padEnd(4)}  ${c.title} — ${c.detail}`);
          const v = verdict(checks);
          if (v === "fail") {
            end(current, "failed", "Failing checks");
            throw new Error("The architecture review has failing checks.");
          }
          end(
            current,
            "succeeded",
            `${checks.filter((c) => c.level === "pass").length} pass · ${checks.filter((c) => c.level === "warn").length} warn`,
          );
        }

        if (data.action !== "destroy") {
          current = stepOf(land, "quota");
          start(land, current);
          const problems = await quotaCheck(
            arm,
            data.subscriptionId,
            data.region,
            arch.selected,
            envs,
            logTo(current),
          );
          if (problems.length) {
            end(current, "failed", `${problems.length} short`);
            throw new Error(
              `Not enough quota in ${data.region}: ${problems.join("; ")}. Request more quota, or pick another subscription or region — nothing was created.`,
            );
          }
          end(current, "succeeded");
        }

        current = stepOf(land, "generate");
        start(land, current);
        const vars = (env: string, create: boolean, i: number) => ({
          subscription_id: data.subscriptionId,
          location: data.region,
          install_name: installName(data.installPrefix, env),
          environment: ENV_SHORT[env] ?? "dev",
          resource_group_name: rgNameFor(settings, env),
          create_resource_group: create,
          // A /22 per environment so rings never overlap if they're peered later.
          address_space: `10.60.${i * 4}.0/22`,
          private_dns_mode: "local",
          enable_defender: data.enableDefender,
        });
        for (const e of envs) {
          await runner.writeConfig(
            workspace(offering.id, e),
            files,
            vars(e, true, ENV_ORDER.indexOf(e)),
          );
        }
        logTo(current)(`${files.length} files: ${files.map((f) => f.path).join(", ")}`);
        logTo(current)(
          `One workspace and state per environment: ${envs.map((e) => workspace(offering.id, e)).join(", ")}`,
        );
        end(
          current,
          "succeeded",
          `${files.filter((f) => f.path.endsWith(".tf")).length} Terraform files`,
        );

        current = stepOf(land, "validate");
        start(land, current);
        const first = workspace(offering.id, envs[0]!);
        if (
          (await runner.terraformCmd(
            first,
            ["init", "-input=false", "-no-color"],
            logTo(current),
          )) !== 0
        )
          throw new Error("terraform init failed.");
        if ((await runner.terraformCmd(first, ["validate", "-no-color"], logTo(current))) !== 0)
          throw new Error("terraform validate failed.");
        end(current, "succeeded");

        // Resource groups: new, re-deploy (in state), adopt (ours, lost from state) or existing (theirs).
        current = stepOf(land, "rg");
        start(land, current);
        const rgLog = logTo(current);
        const decisions: Record<string, string> = {};
        for (const e of envs) {
          const key = workspace(offering.id, e);
          const name = rgNameFor(settings, e);
          const inState = (await runner.stateAddresses(key)).includes(
            "azurerm_resource_group.this[0]",
          );
          const g = await arm.arm<{
            id?: string;
            location?: string;
            tags?: Record<string, string>;
          }>(
            "GET",
            `/subscriptions/${data.subscriptionId}/resourcegroups/${name}?api-version=2021-04-01`,
          );
          let create = true;
          if (inState) {
            decisions[e] = "redeploy";
            rgLog(
              `${ENV_LABEL[e]}: ${name} is managed by this install — re-deploy updates it in place.`,
            );
          } else if (g.status === 404) {
            if (settings.resourceGroup.mode === "existing")
              throw new Error(`Resource group ${name} doesn't exist.`);
            decisions[e] = "new";
            rgLog(`${ENV_LABEL[e]}: ${name} doesn't exist — it will be created in ${data.region}.`);
          } else if (
            g.status === 200 &&
            g.data.tags?.["managed-by"] === "cloud-delivery" &&
            g.data.tags?.["cd-install"] === installName(data.installPrefix, e)
          ) {
            decisions[e] = "adopt";
            rgLog(
              `${ENV_LABEL[e]}: ${name} was created by Cloud Delivery but isn't in state — adopting it.`,
            );
            const { writeFile } = await import("node:fs/promises");
            const path = await import("node:path");
            await writeFile(
              path.join(runner.workDir(key), "imports.tf"),
              `import {\n  to = azurerm_resource_group.this[0]\n  id = "${g.data.id}"\n}\n`,
            );
          } else if (g.status === 200) {
            if (settings.resourceGroup.mode !== "existing" && data.action !== "destroy")
              throw new Error(
                `${name} already exists and isn't managed by Cloud Delivery. Pick "Use an existing resource group" to deploy into it, or another install prefix.`,
              );
            create = false;
            decisions[e] = "existing";
            rgLog(
              `${ENV_LABEL[e]}: deploying into the existing resource group ${name} (${g.data.location}); it stays when the install is removed.`,
            );
          } else throw new Error(`Couldn't check resource group ${name} (${g.status}).`);
          if (!create) await runner.writeConfig(key, files, vars(e, false, ENV_ORDER.indexOf(e)));
        }
        end(
          current,
          "succeeded",
          Object.entries(decisions)
            .map(([e, d]) => `${ENV_SHORT[e]}: ${d}`)
            .join(" · "),
        );
        land.status = "succeeded";
        land.finishedAt = now();
        dirty = true;

        // ---------------------------------------------------------------- Environments
        const results: Record<string, unknown> = {};
        for (const e of ordered) {
          const stage = stages.find((s) => s.id === e)!;
          const key = workspace(offering.id, e);
          if (data.action === "destroy") {
            current = stepOf(stage, "destroy");
            start(stage, current);
            if (!(await runner.stateAddresses(key)).length) {
              logTo(current)("Nothing deployed in this environment.");
              end(current, "skipped", "Nothing deployed");
            } else {
              await runner.terraformCmd(key, ["init", "-input=false", "-no-color"], logTo(current));
              const r = await runner.terraform("destroy", key, logTo(current));
              end(current, r.ok ? "succeeded" : "failed");
              if (!r.ok) throw new Error(`Destroy failed in ${ENV_LABEL[e]}.`);
            }
            stage.status = "succeeded";
            stage.finishedAt = now();
            continue;
          }

          current = stepOf(stage, "plan");
          start(stage, current);
          const plan = await runner.terraform("plan", key, logTo(current));
          if (!plan.ok) {
            end(current, "failed");
            throw new Error(`Plan failed in ${ENV_LABEL[e]}: ${azureErrors(current.log)}`);
          }
          const ps = plan.summary as { add?: number; change?: number; destroy?: number };
          stage.summary = { add: ps.add ?? 0, change: ps.change ?? 0, destroy: ps.destroy ?? 0 };
          end(current, "succeeded", `+${ps.add ?? 0} ~${ps.change ?? 0} −${ps.destroy ?? 0}`);
          if (data.action === "plan") {
            results[e] = stage.summary;
            stage.status = "succeeded";
            stage.finishedAt = now();
            continue;
          }

          if (data.approvalFor.includes(e)) {
            current = stepOf(stage, "approval");
            start(stage, current);
            current.status = "waiting";
            stage.status = "waiting";
            logTo(current)(
              `Waiting for approval to change ${ENV_LABEL[e]}: +${ps.add ?? 0} to add, ~${ps.change ?? 0} to change, −${ps.destroy ?? 0} to destroy.`,
            );
            await db.update("offering_runs", { status: "waiting", approval: null }, { id: run.id });
            dirty = true;
            await flush();
            let decision: string | null = null;
            for (let i = 0; i < 1200 && !decision; i++) {
              await new Promise((r) => setTimeout(r, 3000));
              const row = await db.one<{ approval: { decision: string; by: string } | null }>(
                "select approval from public.offering_runs where id = $1",
                [run.id],
              );
              if (row.approval) {
                decision = row.approval.decision;
                logTo(current)(
                  `${row.approval.decision === "approved" ? "Approved" : "Rejected"} by ${row.approval.by}.`,
                );
              }
            }
            await db.update("offering_runs", { status: "running" }, { id: run.id });
            stage.status = "running";
            if (decision !== "approved") {
              end(current, "failed", decision ? "Rejected" : "Timed out");
              await finish("cancelled", { ...results, stoppedAt: e });
              return;
            }
            end(current, "succeeded", "Approved");
          }

          current = stepOf(stage, "apply");
          start(stage, current);
          const transient =
            /RetryableError|AnotherOperationInProgress|Conflict|PrincipalNotFound|429|ReferencedResourceNotProvisioned|context deadline exceeded/;
          let r = await runner.terraform("apply", key, logTo(current));
          for (
            let attempt = 2;
            !r.ok && attempt <= 3 && transient.test(current.log.slice(-6000));
            attempt++
          ) {
            logTo(current)(
              `Transient Azure error — re-planning and applying again (attempt ${attempt} of 3).`,
            );
            const p = await runner.terraform("plan", key, logTo(current));
            if (!p.ok) break;
            r = await runner.terraform("apply", key, logTo(current));
          }
          if (!r.ok) {
            end(current, "failed");
            throw new Error(`Apply failed in ${ENV_LABEL[e]}: ${azureErrors(current.log)}`);
          }
          end(current, "succeeded");

          current = stepOf(stage, "verify");
          start(stage, current);
          const vlog = logTo(current);
          const out = await runner.terraformOutputs(key);
          const shown = Object.fromEntries(
            Object.entries(out)
              .filter(([, v]) => !v.sensitive)
              .map(([k, v]) => [k, v.value]),
          );
          for (const [k, v] of Object.entries(shown)) vlog(`output ${k} = ${JSON.stringify(v)}`);
          const rg = String(shown["resource_group_name"] ?? rgNameFor(settings, e));
          const res = await arm.arm<{ value?: { type: string }[] }>(
            "GET",
            `/subscriptions/${data.subscriptionId}/resourceGroups/${rg}/resources?api-version=2021-04-01`,
          );
          const types = (res.data.value ?? []).reduce<Record<string, number>>((m, x) => {
            m[x.type] = (m[x.type] ?? 0) + 1;
            return m;
          }, {});
          vlog(
            `${res.data.value?.length ?? 0} resources in ${rg}: ${Object.entries(types)
              .map(([t, n]) => `${t.split("/").slice(-1)[0]}×${n}`)
              .join(", ")}`,
          );
          const url = (shown["app_url"] ?? shown["front_door_url"]) as string | undefined;
          let probe: number | null = null;
          if (url && arch.topology.publicAccess) {
            try {
              const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
              probe = resp.status;
              vlog(`GET ${url} → ${resp.status}`);
            } catch (err) {
              vlog(`GET ${url} failed: ${(err as Error).message}`);
            }
          } else if (url)
            vlog(`${url} is internal only (no public ingress) — reachable from the network.`);
          const pol = await arm.arm<{
            value?: {
              results?: { nonCompliantResources?: number; nonCompliantPolicies?: number };
            }[];
          }>(
            "POST",
            `/subscriptions/${data.subscriptionId}/resourceGroups/${rg}/providers/Microsoft.PolicyInsights/policyStates/latest/summarize?api-version=2019-10-01`,
          );
          const nc = pol.data.value?.[0]?.results?.nonCompliantResources;
          vlog(
            nc === undefined
              ? "Policy compliance: not evaluated yet (Azure scans within ~30 minutes of a deployment)."
              : `Policy compliance: ${nc} non-compliant resource${nc === 1 ? "" : "s"} (latest scan).`,
          );
          results[e] = {
            outputs: shown,
            resources: res.data.value?.length ?? 0,
            probe,
            nonCompliant: nc ?? null,
          };
          stage.summary = {
            ...(stage.summary ?? {}),
            resources: res.data.value?.length ?? 0,
            url: url ?? null,
          };
          end(current, "succeeded", `${res.data.value?.length ?? 0} resources`);
          stage.status = "succeeded";
          stage.finishedAt = now();
          dirty = true;
        }
        await finish("succeeded", results);
      } catch (e) {
        if (current && current.status === "running") {
          logTo(current)((e as Error).message);
          end(current, "failed");
        }
        await finish("failed", { error: (e as Error).message });
      }
    })();

    return { runId: run.id };
  });

type Arm = typeof import("../alz/arm.server");
type Usage = { name: { value: string }; limit: number; currentValue: number };

/**
 * Checks the quotas Azure would otherwise reject minutes into an apply: model capacity for AI Foundry
 * deployments and vCPUs for AKS node pools. Returns what's short; logs everything it checked.
 */
async function quotaCheck(
  arm: Arm,
  subscriptionId: string,
  region: string,
  selected: { id: string; settings: Record<string, string> }[],
  envs: string[],
  log: (l: string) => void,
) {
  const problems: string[] = [];
  const ai = selected.find((s) => s.id === "ai-foundry");
  if (ai) {
    const { MODELS, DEPLOYMENT_SKU } = await import("./ai-services");
    const models = MODELS[ai.settings["models"] ?? ""] ?? MODELS["gpt-4.1-mini"]!;
    const sku = DEPLOYMENT_SKU[ai.settings["deployment"] ?? ""] ?? "DataZoneStandard";
    const u = await arm.arm<{ value?: Usage[] }>(
      "GET",
      `/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/locations/${region}/usages?api-version=2024-10-01`,
    );
    const usages = u.data.value ?? [];
    for (const m of models) {
      // Each environment is its own AI account, so capacity adds up across environments.
      const need = envs.reduce(
        (n, e) =>
          n +
          (sku === "ProvisionedManaged"
            ? e === "production"
              ? 50
              : 15
            : e === "production"
              ? 100
              : 10),
        0,
      );
      const key = `OpenAI.${sku}.${m.name}`;
      const q = usages.find((x) => x.name.value === key);
      const free = q ? q.limit - q.currentValue : 0;
      log(
        `${key}: ${free} available, ${need} needed (${sku === "ProvisionedManaged" ? "PTU" : "thousand tokens per minute"}).`,
      );
      if (free < need) {
        const alt = usages
          .filter(
            (x) =>
              x.name.value.endsWith(`.${m.name}`) &&
              !x.name.value.includes("Batch") &&
              x.limit - x.currentValue > 0,
          )
          .map((x) => `${x.name.value.split(".")[1]} has ${x.limit - x.currentValue}`);
        problems.push(
          `${m.name} ${sku} needs ${need}, ${free} available${alt.length ? ` (${alt.join(", ")})` : ""}`,
        );
      }
    }
  }
  const aks = selected.find((s) => s.id === "aks");
  if (aks) {
    const [sys, user] = (aks.settings["nodes"] ?? "3 + 3 (zonal)").match(/\d+/g)?.map(Number) ?? [
      3, 3,
    ];
    const vcpus = envs.reduce((n, e) => n + 4 * (e === "production" ? sys! + user! : 2), 0);
    const u = await arm.arm<{ value?: Usage[] }>(
      "GET",
      `/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2023-07-01`,
    );
    for (const key of ["standardDDSv5Family", "cores"]) {
      const q = u.data.value?.find((x) => x.name.value === key);
      const free = q ? q.limit - q.currentValue : 0;
      log(
        `${key === "cores" ? "Regional vCPUs" : "Ddsv5 vCPUs (Standard_D4ds_v5 nodes)"}: ${free} available, ${vcpus} needed.`,
      );
      if (free < vcpus)
        problems.push(
          `AKS needs ${vcpus} ${key === "cores" ? "regional" : "Ddsv5"} vCPUs, ${free} available`,
        );
    }
  }
  if (selected.some((s) => ["app-service", "functions"].includes(s.id)))
    log(
      "App Service plan quota isn't exposed by Azure's API — if the plan is refused, request App Service quota for the region.",
    );
  if (!ai && !aks) log("No quota-bound services in this architecture.");
  return problems;
}

/** The Azure error codes and messages from a Terraform log, short enough for a headline. */
function azureErrors(log: string) {
  const found = new Map<string, string>();
  for (const m of log.matchAll(
    /(?:error: |Code":")([A-Z][A-Za-z]+)(?:"[^:]*"Message":"|: )([^"\n]{0,160})/g,
  )) {
    if (found.size >= 3) break;
    if (!found.has(m[1]!)) found.set(m[1]!, m[2]!.replace(/\\r\\n.*/, "").trim());
  }
  if (!found.size)
    for (const m of log.matchAll(/Error: ([^\n]{0,160})/g)) {
      if (found.size >= 3) break;
      found.set(m[1]!, "");
    }
  return [...found].map(([k, v]) => (v ? `${k}: ${v}` : k)).join(" · ") || "see the step log";
}
