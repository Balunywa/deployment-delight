/*
 * Real offering deployments. An offering version's generated Terraform goes into a subscription ring by
 * ring: Land (access, providers, review, validate, resource groups), then each environment (plan, approval
 * for production, apply, verify). Each environment has its own Terraform state, so a re-deploy is a diff,
 * not a rebuild. The run's stages and step logs are saved as they happen for the pipeline view.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "../db-types";
import { regionsSupporting } from "../onboarding";
import { SKU_OPTIONS, VM_SIZES } from "../skus";

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
export type NetworkChoice = {
  mode: "new" | "existing";
  /** New spokes: a range split into one /22 per environment. */
  baseRange?: string | undefined;
  hubId?: string | undefined;
  firewallIp?: string | undefined;
  dnsZoneResourceGroupId?: string | undefined;
  /** Existing network: the customer's VNet and a subnet per role. */
  vnetId?: string | undefined;
  subnetIds?: Record<string, string> | undefined;
};
type RunSettings = {
  network?: NetworkChoice | undefined;
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
        available: regionsSupporting(arch.selected),
        environments: ENV_ORDER.filter((e) => arch.topology.environments.includes(e)),
        error: null as string | null,
      };
    } catch (e) {
      return {
        identity: null,
        subscriptions: [],
        regions: arch.topology.regions,
        available: regionsSupporting(arch.selected),
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
        network: z
          .object({
            mode: z.enum(["new", "existing"]),
            baseRange: z
              .string()
              .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/(1[2-9]|2[0-2])$/)
              .optional(),
            hubId: z.string().max(400).optional(),
            firewallIp: z
              .string()
              .regex(/^\d{1,3}(\.\d{1,3}){3}$/)
              .optional(),
            dnsZoneResourceGroupId: z.string().max(300).optional(),
            vnetId: z.string().max(400).optional(),
            subnetIds: z.record(z.string(), z.string().max(500)).optional(),
          })
          .optional(),
        enableDefender: z.boolean().default(false),
        startedBy: z.string().max(120).default("Platform engineer"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, offering, version, arch } = await loadOffering(data.offeringId, data.versionId);
    // Test deploys can go to any region where every service exists; customer installs stay in the
    // offering's approved regions.
    if (!regionsSupporting(arch.selected).includes(data.region))
      throw new Error(`Not every service in this architecture is available in ${data.region}.`);
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
      network: data.network,
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
          { id: "network", name: "Network & hub", status: "queued", log: "" },
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
        let aiVersions: Record<string, string> = {};
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
        if (!arch.topology.regions.includes(data.region))
          log(
            `${data.region} isn't one of the offering's approved regions (${arch.topology.regions.join(", ")}) — test deploy only; add it to the offering before onboarding customers there.`,
          );
        end(current, "succeeded", sub.data.displayName);

        current = stepOf(land, "providers");
        start(land, current);
        await arm.registerProviders(data.subscriptionId, logTo(current));
        logTo(current)("Service-specific providers are registered by Terraform as it deploys.");
        end(current, "succeeded");

        current = stepOf(land, "network");
        start(land, current);
        await networkCheck(arm, data.network, envs, arch, logTo(current));
        end(
          current,
          "succeeded",
          data.network?.mode === "existing"
            ? "existing VNet"
            : data.network?.hubId
              ? "spoke + hub"
              : "new spoke",
        );

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
          const { problems, versions } = await quotaCheck(
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
              `Can't deploy to ${data.region} with this subscription yet: ${problems.join("; ")}. Pick the suggested size or tier, request quota, or choose another region — nothing was created.`,
            );
          }
          aiVersions = versions;
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
          // A /22 per environment so rings never overlap, peered to the hub or not.
          address_space: spokeRange(data.network?.baseRange ?? "10.60.0.0/19", i),
          private_dns_mode: data.network?.dnsZoneResourceGroupId ? "platform" : "local",
          private_dns_zone_resource_group_id: data.network?.dnsZoneResourceGroupId ?? "",
          hub_virtual_network_id: data.network?.mode === "new" ? (data.network.hubId ?? "") : "",
          firewall_private_ip: data.network?.firewallIp ?? "",
          existing_virtual_network_id:
            data.network?.mode === "existing" ? (data.network.vnetId ?? "") : "",
          existing_subnet_ids:
            data.network?.mode === "existing" ? (data.network.subnetIds ?? {}) : {},
          allowed_regions: [...new Set([...arch.topology.regions, data.region])],
          ai_model_versions: aiVersions,
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
              let r = await runner.terraform("destroy", key, logTo(current));
              // Azure releases NICs, endpoints and delegations a little after their owner is gone.
              for (
                let attempt = 2;
                !r.ok &&
                attempt <= 4 &&
                /InUseSubnetCannotBeDeleted|InUse|AnotherOperationInProgress|Conflict|RetryableError/.test(
                  current.log.slice(-8000),
                );
                attempt++
              ) {
                logTo(current)(
                  `Azure is still releasing resources — retrying in a minute (attempt ${attempt} of 4).`,
                );
                await new Promise((res) => setTimeout(res, 60_000));
                r = await runner.terraform("destroy", key, logTo(current));
              }
              // A failed deploy can leave resources Azure created outside Terraform's state (scale set
              // instances and their NICs). The install owns its resource group, so delete the group itself.
              if (
                !r.ok &&
                settings.resourceGroup.mode === "new" &&
                /InUseSubnetCannotBeDeleted|InUse/.test(current.log.slice(-8000))
              ) {
                const rg = rgNameFor(settings, e);
                const path = `/subscriptions/${data.subscriptionId}/resourcegroups/${rg}`;
                const g = await arm.arm<{ tags?: Record<string, string> }>(
                  "GET",
                  `${path}?api-version=2021-04-01`,
                );
                if (g.status === 200 && g.data.tags?.["managed-by"] === "cloud-delivery") {
                  logTo(current)(
                    `${rg} still holds resources Azure created outside Terraform (e.g. scale set instances from a failed deploy) — deleting the install's resource group.`,
                  );
                  await arm.arm("DELETE", `${path}?api-version=2021-04-01`);
                  for (let i = 0; i < 120; i++) {
                    await new Promise((res) => setTimeout(res, 15_000));
                    if ((await arm.arm("GET", `${path}?api-version=2021-04-01`)).status === 404)
                      break;
                  }
                  logTo(current)(`${rg} deleted. Clearing Terraform state.`);
                  r = await runner.terraform("destroy", key, logTo(current));
                }
              }
              end(current, r.ok ? "succeeded" : "failed");
              if (!r.ok)
                throw new Error(`Destroy failed in ${ENV_LABEL[e]}: ${azureErrors(current.log)}`);
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
            /RetryableError|AnotherOperationInProgress|Conflict|PrincipalNotFound|429|ReferencedResourceNotProvisioned|context deadline exceeded|Diagnostics Setting[^\n]*404 Not Found|ResourceNotFound/;
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
          const edge = shown["web_tier_endpoint"] ?? shown["gateway_public_ip"];
          const url = (shown["app_url"] ??
            shown["front_door_url"] ??
            (typeof edge === "string" && /^\d/.test(edge) && !edge.startsWith("10.")
              ? `http://${edge}`
              : undefined)) as string | undefined;
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

const SKU_LABEL: Record<string, string> = {
  Standard: "Standard",
  GlobalStandard: "Global standard",
  DataZoneStandard: "Data zone standard",
  ProvisionedManaged: "Provisioned (PTU)",
};
const skuLabel = (s: string) => SKU_LABEL[s] ?? s;

export type AiModel = {
  name: string;
  kind: "chat" | "embedding";
  versions: { version: string; lifecycle: string; retires: string | null; skus: string[] }[];
};
const aiCache = new Map<string, { at: number; models: AiModel[] }>();

/** Current OpenAI chat and embedding models in a region, from Azure's model catalog (cached an hour). */
async function aiCatalog(arm: Arm, subscriptionId: string, region: string): Promise<AiModel[]> {
  const hit = aiCache.get(region);
  if (hit && Date.now() - hit.at < 3600_000) return hit.models;
  const r = await arm.arm<{
    value?: {
      kind: string;
      model: {
        name: string;
        version: string;
        format?: string;
        lifecycleStatus?: string;
        isDefaultVersion?: boolean;
        deprecation?: { inference?: string };
        skus?: { name: string; deprecationDate?: string }[];
      };
    }[];
  }>(
    "GET",
    `/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/locations/${region}/models?api-version=2024-10-01`,
  );
  const now = Date.now();
  const by = new Map<string, AiModel>();
  for (const x of r.data.value ?? []) {
    const m = x.model;
    if (x.kind !== "OpenAI" || m.format !== "OpenAI") continue;
    const kind = /^text-embedding/.test(m.name)
      ? "embedding"
      : /^(gpt-|o\d)/.test(m.name) &&
          !/audio|realtime|transcribe|tts|image|sora|codex|chat-latest|live|oss|search|35/.test(
            m.name,
          )
        ? "chat"
        : null;
    if (!kind || m.lifecycleStatus === "Preview") continue;
    if (m.deprecation?.inference && new Date(m.deprecation.inference).getTime() < now) continue;
    const skus = [
      ...new Set(
        (m.skus ?? [])
          .filter((k) => !k.deprecationDate || new Date(k.deprecationDate).getTime() > now)
          .map((k) => k.name)
          .filter((k) => k in SKU_LABEL),
      ),
    ];
    if (!skus.length) continue;
    const entry = by.get(m.name) ?? { name: m.name, kind, versions: [] };
    entry.versions.push({
      version: m.version,
      lifecycle: m.lifecycleStatus ?? "",
      retires: m.deprecation?.inference?.slice(0, 10) ?? null,
      skus,
    });
    by.set(m.name, entry);
  }
  // Newest version first, so the first one offering a SKU is the one to deploy.
  const models = [...by.values()]
    .map((m) => ({ ...m, versions: m.versions.sort((a, b) => b.version.localeCompare(a.version)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  aiCache.set(region, { at: Date.now(), models });
  return models;
}

/** The live model catalog for the offering designer, read with the app's Azure identity. */
export const listAiModels = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ region: z.string().min(3).max(40) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const arm = await import("../alz/arm.server");
      const sub = (await arm.listSubscriptions()).find((s) => s.state === "Enabled");
      if (!sub)
        return { models: [] as AiModel[], error: "No subscription to read the catalog with." };
      return { models: await aiCatalog(arm, sub.id, data.region), error: null as string | null };
    } catch (e) {
      return { models: [] as AiModel[], error: (e as Error).message };
    }
  });
type Usage = { name: { value: string }; limit: number; currentValue: number };

/**
 * Checks what Azure would otherwise reject minutes into an apply: whether each model and VM size is
 * offered in the region to this subscription, and whether there's quota for it. Returns what's short;
 * logs everything it checked.
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
  const envOf = (e: string) => (e === "production" ? ("prod" as const) : ("dev" as const));
  const versions: Record<string, string> = {};
  const ai = selected.find((s) => s.id === "ai-foundry");
  if (ai) {
    const { aiDeployments } = await import("./ai-services");
    const { models, capacity } = aiDeployments(ai.settings);
    const [usage, catalog] = await Promise.all([
      arm.arm<{ value?: Usage[] }>(
        "GET",
        `/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/locations/${region}/usages?api-version=2024-10-01`,
      ),
      aiCatalog(arm, subscriptionId, region),
    ]);
    const usages = usage.data.value ?? [];
    for (const m of models) {
      const offered = catalog.find((x) => x.name === m.name);
      const version = offered?.versions.find((v) => v.skus.includes(m.sku));
      if (!version) {
        const other = offered?.versions[0]?.skus ?? [];
        log(
          `${m.name}: no current ${m.sku} version in ${region}${other.length ? ` (offered as ${other.join(", ")})` : ""}.`,
        );
        problems.push(
          `${m.name} isn't offered as ${m.sku} in ${region}${other.length ? ` — pick ${other.map(skuLabel).join(" or ")}` : " — pick another model"}`,
        );
        continue;
      }
      versions[m.name] = version.version;
      log(
        `${m.name} ${version.version} (${version.lifecycle}, retires ${version.retires ?? "—"}) as ${m.sku}.`,
      );
      // Each environment is its own AI account, so capacity adds up across environments.
      const need = envs.reduce((n, e) => n + capacity(m, envOf(e)), 0);
      // Quota names drop the dash in some model names (OpenAI.Standard.gpt4.1-mini).
      const keys = [
        `OpenAI.${m.sku}.${m.name}`,
        `OpenAI.${m.sku}.${m.name.replace(/^gpt-(\d)/, "gpt$1")}`,
      ];
      const q = usages.find((x) => keys.includes(x.name.value));
      const free = q ? q.limit - q.currentValue : 0;
      log(
        `Quota ${q?.name.value ?? keys[0]}: ${free} available, ${need} needed (${m.sku === "ProvisionedManaged" ? "PTU" : "thousand tokens per minute"}).`,
      );
      if (free < need) {
        const alt = usages
          .filter(
            (x) =>
              keys.some((k) => x.name.value.endsWith(`.${k.split(".").pop()}`)) &&
              !/Batch|finetune/i.test(x.name.value) &&
              x.limit - x.currentValue >= need,
          )
          .map((x) => `${skuLabel(x.name.value.split(".")[1]!)} has ${x.limit - x.currentValue}`);
        problems.push(
          `${m.name} ${skuLabel(m.sku)} needs ${need}K TPM, ${free} available${alt.length ? ` (${alt.join(", ")})` : ""}`,
        );
      }
    }
  }
  // Compute: AKS nodes, VM scale sets and VMs, all drawing on the same regional vCPU quota.
  const { sizing: sizeOf } = await import("../skus");
  const counts = (v: string | undefined, d: number[]) => v?.match(/\d+/g)?.map(Number) ?? d;
  const computeUse: {
    label: string;
    size: (env: "prod" | "dev") => string;
    n: (env: "prod" | "dev") => number;
  }[] = [];
  const aks = selected.find((s) => s.id === "aks");
  if (aks) {
    const [, node] = sizeOf("aks", aks.settings);
    computeUse.push({
      label: "AKS nodes",
      size: (env) => (env === "prod" ? node!.prod.value : node!.dev.value),
      n: (env) =>
        counts(
          aks.settings[env === "prod" ? "nodes" : "devNodes"],
          env === "prod" ? [3, 3] : [1, 1],
        ).reduce((a, b) => a + b, 0),
    });
  }
  for (const [id, label, k, dk, d, dd] of [
    ["web-vmss", "Web tier scale set", "instances", "devInstances", 3, 1],
    ["app-vmss", "App tier scale set", "instances", "devInstances", 3, 1],
    ["vm", "Data tier VMs", "count", "devCount", 2, 1],
  ] as const) {
    const svc = selected.find((s) => s.id === id);
    if (!svc) continue;
    const [sz] = sizeOf(id, svc.settings);
    computeUse.push({
      label,
      size: (env) => (env === "prod" ? sz!.prod.value : sz!.dev.value),
      n: (env) => counts(svc.settings[env === "prod" ? k : dk], [env === "prod" ? d : dd])[0]!,
    });
  }
  if (computeUse.length) {
    const [skus, usage] = await Promise.all([
      arm.arm<{
        value?: {
          name: string;
          family?: string;
          capabilities?: { name: string; value: string }[];
          restrictions?: { type: string; reasonCode?: string }[];
        }[];
      }>(
        "GET",
        `/subscriptions/${subscriptionId}/providers/Microsoft.Compute/skus?api-version=2021-07-01&$filter=location eq '${region}'`,
      ),
      arm.arm<{ value?: Usage[] }>(
        "GET",
        `/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${region}/usages?api-version=2023-07-01`,
      ),
    ]);
    // Sizes from the catalog this subscription can actually run here, for the error message.
    const suggest = (vcpusPer: number, n: number) =>
      VM_SIZES.map((c) => {
        const k = skus.data.value?.find((x) => x.name === c.value);
        if (!k || k.restrictions?.some((r) => r.type === "Location")) return null;
        const q = usage.data.value?.find(
          (u) => u.name.value.toLowerCase() === (k.family ?? "").toLowerCase(),
        );
        const per = Number(k.capabilities?.find((x) => x.name === "vCPUs")?.value ?? 0);
        return q && per >= vcpusPer && q.limit - q.currentValue >= per * n
          ? `${c.value} (≈$${c.monthly}/mo)`
          : null;
      })
        .filter(Boolean)
        .slice(0, 3);
    const byFamily = new Map<string, number>();
    for (const u of computeUse)
      for (const e of envs) {
        const size = u.size(envOf(e));
        const n = u.n(envOf(e));
        const sku = skus.data.value?.find((k) => k.name === size);
        if (!sku) {
          problems.push(`${u.label}: ${size} isn't offered in ${region}`);
          log(`${u.label}: ${size} not offered in ${region}.`);
          continue;
        }
        const per = Number(sku.capabilities?.find((c) => c.name === "vCPUs")?.value ?? 2);
        const blocked = sku.restrictions?.find((r) => r.type === "Location");
        if (blocked) {
          const alt = suggest(per, n);
          problems.push(
            `${u.label}: ${size} is restricted for this subscription in ${region} (${blocked.reasonCode})${alt.length ? ` — sizes that fit: ${alt.join(", ")}` : ""}`,
          );
          log(`${u.label}: ${size} restricted (${blocked.reasonCode}).`);
          continue;
        }
        log(`${u.label} (${ENV_LABEL[e]}): ${n} × ${size} (${per} vCPU, ${sku.family}).`);
        byFamily.set(sku.family ?? "", (byFamily.get(sku.family ?? "") ?? 0) + per * n);
      }
    const total = [...byFamily.values()].reduce((a, b) => a + b, 0);
    for (const [family, vcpus] of [...byFamily, ["cores", total] as [string, number]]) {
      const q = usage.data.value?.find((x) => x.name.value.toLowerCase() === family.toLowerCase());
      const free = q ? q.limit - q.currentValue : 0;
      log(`${family === "cores" ? "Regional vCPUs" : family}: ${free} available, ${vcpus} needed.`);
      if (free < vcpus)
        problems.push(
          `Compute needs ${vcpus} ${family === "cores" ? "regional" : family} vCPUs, ${free} available`,
        );
    }
  }
  const pg = selected.find((s) => s.id === "postgres");
  if (pg) {
    const { sizing } = await import("../skus");
    const [c] = sizing("postgres", pg.settings);
    const cap = await arm.arm<{
      value?: {
        supportedServerEditions?: { name: string; supportedServerSkus?: { name: string }[] }[];
      }[];
    }>(
      "GET",
      `/subscriptions/${subscriptionId}/providers/Microsoft.DBforPostgreSQL/locations/${region}/capabilities?api-version=2024-08-01`,
    );
    const offered = new Set(
      (cap.data.value ?? []).flatMap((v) =>
        (v.supportedServerEditions ?? []).flatMap((ed) =>
          (ed.supportedServerSkus ?? []).map((k) => {
            const prefix =
              ed.name === "Burstable" ? "B" : ed.name === "GeneralPurpose" ? "GP" : "MO";
            return `${prefix}_${k.name}`;
          }),
        ),
      ),
    );
    for (const e of envs) {
      const sku = envOf(e) === "prod" ? c!.prod.value : c!.dev.value;
      if (!offered.size) {
        log("PostgreSQL capabilities not returned for the region; skipping the SKU check.");
        break;
      }
      log(`PostgreSQL ${sku}: ${offered.has(sku) ? "offered" : "not offered"} in ${region}.`);
      if (!offered.has(sku)) problems.push(`PostgreSQL ${sku} isn't offered in ${region}`);
    }
  }
  if (selected.some((s) => s.id === "sql")) {
    const cap = await arm.arm<{ status?: string; reason?: string | null }>(
      "GET",
      `/subscriptions/${subscriptionId}/providers/Microsoft.Sql/locations/${region}/capabilities?api-version=2023-08-01&include=supportedEditions`,
    );
    log(
      `Azure SQL in ${region}: ${cap.data.status ?? "unknown"}${cap.data.reason ? ` — ${cap.data.reason}` : ""}`,
    );
    if (cap.data.status && cap.data.status !== "Available")
      problems.push(`Azure SQL provisioning is restricted for this subscription in ${region}`);
  }
  // App Service plans have per-SKU instance quotas (many new subscriptions only have Premium v4).
  const { sizing } = await import("../skus");
  const plans = new Map<string, number>();
  for (const s of selected.filter((x) => x.id === "app-service" || x.id === "functions")) {
    const [p] = sizing(s.id, s.settings);
    for (const e of envs) {
      const sku = envOf(e) === "prod" ? p!.prod : p!.dev;
      if (sku.value === "FC1") continue;
      const zoned = s.id === "app-service" && envOf(e) === "prod" && !!sku.zones;
      const key = zoned ? `${sku.value}_AZ` : sku.value;
      plans.set(key, (plans.get(key) ?? 0) + (zoned ? 3 : 1));
    }
  }
  if (plans.size) {
    await arm.arm(
      "POST",
      `/subscriptions/${subscriptionId}/providers/Microsoft.Quota/register?api-version=2021-04-01`,
    );
    const qs = await arm.arm<{
      value?: { name: string; properties: { limit?: { value?: number } } }[];
      error?: { code: string };
    }>(
      "GET",
      `/subscriptions/${subscriptionId}/providers/Microsoft.Web/locations/${region}/providers/Microsoft.Quota/quotas?api-version=2023-02-01`,
    );
    const limit = (k: string) => qs.data.value?.find((x) => x.name === k)?.properties.limit?.value;
    if (!qs.data.value)
      log(
        `App Service quota couldn't be read yet (${qs.data.error?.code ?? qs.status}); Azure checks it during apply.`,
      );
    else
      for (const [k, n] of plans) {
        const l = limit(k) ?? 0;
        log(`App Service ${k}: quota ${l} instances, ${n} needed.`);
        if (l < n) {
          const alt = (SKU_OPTIONS["app-service"]?.[0]?.skus ?? [])
            .filter((x) => (limit(k.endsWith("_AZ") ? `${x.value}_AZ` : x.value) ?? 0) >= n)
            .slice(0, 3)
            .map((x) => x.value);
          problems.push(
            `App Service plan ${k.replace("_AZ", " (zone redundant)")} has quota ${l}, needs ${n}${alt.length ? ` — plans with quota: ${alt.join(", ")}` : ""}`,
          );
        }
      }
  }
  if (!ai && !computeUse.length && !pg && !plans.size)
    log("No quota-bound services in this architecture.");
  return { problems, versions };
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

export type DiscoveredVnet = {
  id: string;
  name: string;
  subscriptionId: string;
  location: string;
  addressSpace: string[];
  subnets: { id: string; name: string; prefix: string; delegations: string[] }[];
  hub: boolean;
  firewallIp: string | null;
  kind: "vnet" | "vhub";
};

/**
 * Every VNet and Virtual WAN hub the app can see, marked as a hub when it holds a firewall or gateway,
 * with the firewall's private IP and the resource group of the platform's private DNS zones.
 */
export const discoverNetworks = createServerFn({ method: "POST" }).handler(async () => {
  const arm = await import("../alz/arm.server");
  const subs = (await arm.listSubscriptions()).filter((s) => s.state === "Enabled");
  const vnets: DiscoveredVnet[] = [];
  const dnsGroups = new Map<string, { count: number; linked: Set<string> }>();
  await Promise.all(
    subs.map(async (sub) => {
      const [nets, fws, hubs, zones] = await Promise.all([
        arm.arm<{
          value?: {
            id: string;
            name: string;
            location: string;
            properties: {
              addressSpace?: { addressPrefixes?: string[] };
              subnets?: {
                id: string;
                name: string;
                properties: {
                  addressPrefix?: string;
                  addressPrefixes?: string[];
                  delegations?: { properties: { serviceName: string } }[];
                };
              }[];
            };
          }[];
        }>(
          "GET",
          `/subscriptions/${sub.id}/providers/Microsoft.Network/virtualNetworks?api-version=2024-05-01`,
        ),
        arm.arm<{
          value?: {
            properties: {
              ipConfigurations?: {
                properties: { privateIPAddress?: string; subnet?: { id: string } };
              }[];
              virtualHub?: { id: string };
              hubIPAddresses?: { privateIPAddress?: string };
            };
          }[];
        }>(
          "GET",
          `/subscriptions/${sub.id}/providers/Microsoft.Network/azureFirewalls?api-version=2024-05-01`,
        ),
        arm.arm<{
          value?: {
            id: string;
            name: string;
            location: string;
            properties: { addressPrefix?: string };
          }[];
        }>(
          "GET",
          `/subscriptions/${sub.id}/providers/Microsoft.Network/virtualHubs?api-version=2024-05-01`,
        ),
        arm.arm<{ value?: { id: string; name: string }[] }>(
          "GET",
          `/subscriptions/${sub.id}/providers/Microsoft.Network/privateDnsZones?api-version=2024-06-01`,
        ),
      ]);
      const fwByVnet = new Map<string, string>();
      for (const f of fws.data.value ?? []) {
        const ip = f.properties.ipConfigurations?.[0];
        const subnet = ip?.properties.subnet?.id;
        if (subnet && ip?.properties.privateIPAddress)
          fwByVnet.set(subnet.split("/subnets/")[0]!.toLowerCase(), ip.properties.privateIPAddress);
        if (f.properties.virtualHub?.id && f.properties.hubIPAddresses?.privateIPAddress)
          fwByVnet.set(
            f.properties.virtualHub.id.toLowerCase(),
            f.properties.hubIPAddresses.privateIPAddress,
          );
      }
      for (const n of nets.data.value ?? []) {
        const subnets = (n.properties.subnets ?? []).map((x) => ({
          id: x.id,
          name: x.name,
          prefix: x.properties.addressPrefix ?? x.properties.addressPrefixes?.[0] ?? "",
          delegations: (x.properties.delegations ?? []).map((d) => d.properties.serviceName),
        }));
        const fw = fwByVnet.get(n.id.toLowerCase()) ?? null;
        vnets.push({
          id: n.id,
          name: n.name,
          subscriptionId: sub.id,
          location: n.location,
          addressSpace: n.properties.addressSpace?.addressPrefixes ?? [],
          subnets,
          hub:
            !!fw ||
            subnets.some((x) =>
              ["AzureFirewallSubnet", "GatewaySubnet", "AzureBastionSubnet"].includes(x.name),
            ),
          firewallIp: fw,
          kind: "vnet",
        });
      }
      for (const h of hubs.data.value ?? [])
        vnets.push({
          id: h.id,
          name: h.name,
          subscriptionId: sub.id,
          location: h.location,
          addressSpace: h.properties.addressPrefix ? [h.properties.addressPrefix] : [],
          subnets: [],
          hub: true,
          firewallIp: fwByVnet.get(h.id.toLowerCase()) ?? null,
          kind: "vhub",
        });
      await Promise.all(
        (zones.data.value ?? [])
          .filter((z) => z.name.startsWith("privatelink."))
          .map(async (z) => {
            const rg = z.id.split("/providers/")[0]!;
            const g = dnsGroups.get(rg) ?? { count: 0, linked: new Set<string>() };
            g.count++;
            dnsGroups.set(rg, g);
            const links = await arm.arm<{
              value?: { properties: { virtualNetwork?: { id: string } } }[];
            }>("GET", `${z.id}/virtualNetworkLinks?api-version=2024-06-01`);
            for (const l of links.data.value ?? [])
              if (l.properties.virtualNetwork?.id)
                g.linked.add(l.properties.virtualNetwork.id.toLowerCase());
          }),
      );
    }),
  );
  // Platform DNS: the resource groups of privatelink zones and the VNets (hubs) they're linked to.
  return {
    vnets: vnets.sort((a, b) => Number(b.hub) - Number(a.hub) || a.name.localeCompare(b.name)),
    dnsGroups: [...dnsGroups].map(([id, g]) => ({ id, count: g.count, linked: [...g.linked] })),
  };
});

/** The Nth /22 of a range (10.60.0.0/20 → 10.60.0.0/22, 10.60.4.0/22, …). */
export function spokeRange(base: string, n: number) {
  const [ip, bits] = base.split("/");
  const parts = ip!.split(".").map(Number);
  const start = ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
  const mask = Number(bits);
  const aligned = start - (start % 2 ** (32 - mask));
  const v = aligned + n * 1024;
  return `${[v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".")}/22`;
}

const toRange = (cidr: string) => {
  const [ip, bits] = cidr.split("/");
  const p = ip!.split(".").map(Number);
  const start = ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
  const size = 2 ** (32 - Number(bits ?? 32));
  return [start - (start % size), start - (start % size) + size - 1] as const;
};

/** Whether two CIDR ranges overlap. */
export function overlaps(a: string, b: string) {
  const [a1, a2] = toRange(a);
  const [b1, b2] = toRange(b);
  return a1 <= b2 && b1 <= a2;
}

/** Checks the network plan before anything is created: ranges vs the hub and its spokes, or existing subnets. */
async function networkCheck(
  arm: Arm,
  net: NetworkChoice | undefined,
  envs: string[],
  arch: {
    selected: { id: string; settings: Record<string, string> }[];
    topology: import("../catalog").Topology;
  },
  log: (l: string) => void,
) {
  const { requiredSubnets } = await import("./terraform");
  const needed = requiredSubnets(arch.selected, arch.topology);
  if (net?.mode === "existing") {
    if (!net.vnetId) throw new Error("Pick the customer's VNet.");
    const v = await arm.arm<{
      properties?: {
        subnets?: {
          id: string;
          name: string;
          properties: { delegations?: { properties: { serviceName: string } }[] };
        }[];
      };
    }>("GET", `${net.vnetId}?api-version=2024-05-01`);
    if (v.status !== 200) throw new Error(`Can't read ${net.vnetId} (${v.status}).`);
    const subnets = v.data.properties?.subnets ?? [];
    for (const n of needed) {
      const id = net.subnetIds?.[n.name];
      const sn = subnets.find((x) => x.id.toLowerCase() === id?.toLowerCase());
      if (!sn) throw new Error(`Map a subnet of the customer's VNet for ${n.name}.`);
      const del = (sn.properties.delegations ?? []).map((d) => d.properties.serviceName);
      if (n.delegation && !del.includes(n.delegation))
        throw new Error(`${sn.name} must be delegated to ${n.delegation} for ${n.name}.`);
      log(`${n.name} → ${sn.name}${del.length ? ` (delegated to ${del.join(", ")})` : ""}`);
    }
    if (envs.length > 1) log("Every environment deploys into these same subnets.");
    return;
  }
  const base = net?.baseRange ?? "10.60.0.0/19";
  if (Number(base.split("/")[1]) > 19)
    throw new Error("Use a /19 or larger base range — each environment gets its own /22.");
  const ranges = envs.map((e) => ({ e, r: spokeRange(base, ENV_ORDER.indexOf(e)) }));
  for (const x of ranges) log(`${ENV_LABEL[x.e]}: new spoke ${x.r}`);
  log(`${needed.length} subnets per spoke: ${needed.map((n) => n.name).join(", ")}`);
  if (!net?.hubId) {
    log("Not connected to a hub — the spoke is standalone.");
    return;
  }
  const hub = await arm.arm<{
    properties?: {
      addressSpace?: { addressPrefixes?: string[] };
      addressPrefix?: string;
      virtualNetworkPeerings?: {
        properties: {
          remoteAddressSpace?: { addressPrefixes?: string[] };
          remoteVirtualNetwork?: { id: string };
        };
      }[];
    };
  }>("GET", `${net.hubId}?api-version=2024-05-01`);
  if (hub.status !== 200) throw new Error(`Can't read the hub ${net.hubId} (${hub.status}).`);
  const taken = [
    ...(hub.data.properties?.addressSpace?.addressPrefixes ?? []),
    ...(hub.data.properties?.addressPrefix ? [hub.data.properties.addressPrefix] : []),
    ...(hub.data.properties?.virtualNetworkPeerings ?? []).flatMap(
      (p) => p.properties.remoteAddressSpace?.addressPrefixes ?? [],
    ),
  ];
  const ours = new Set(ranges.map((x) => x.r));
  for (const x of ranges) {
    const clash = taken.find((t) => !ours.has(t) && overlaps(t, x.r));
    if (clash)
      throw new Error(
        `${ENV_LABEL[x.e]}'s range ${x.r} overlaps ${clash}, already used by the hub or one of its spokes. Pick another base range.`,
      );
  }
  log(
    `Hub ${net.hubId.split("/").pop()}: ${taken.length} ranges in use, no overlap. Peering both ways${net.firewallIp ? `, egress through ${net.firewallIp}` : ""}.`,
  );
  if (net.dnsZoneResourceGroupId)
    log(
      `Private endpoints register in the platform's DNS zones in ${net.dnsZoneResourceGroupId.split("/").pop()}.`,
    );
}
