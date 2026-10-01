import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "../db-types";
import type { PipelineConnection, PipelineRun } from "./pipeline.server";
import {
  type Answers,
  LATEST_REF,
  deployedGroups,
  hasHub,
  mgIdFor,
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
  /** Management groups this app created ahead of Terraform so subscriptions could be vended into them. */
  precreatedGroups?: string[];
  /** Set once Terraform runs in GitHub Actions instead of this app. */
  pipeline?: PipelineConnection;
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

/** Where this landing zone's Terraform runs, and the GitHub pull request waiting to be applied. */
async function pipelineInfo(f: FoundationRow) {
  const pipeline = await import("./pipeline.server");
  const conn = f.deployment?.pipeline ?? null;
  if (!conn) {
    if (!pipeline.pipelineAvailable())
      return { available: false, connection: null, repo: null, pr: null };
    const units = await import("../delivery/units.server");
    const db = await import("../db.server");
    const unit = await units.ensureUnit(db, { foundation_id: f.id }).catch(() => null);
    return {
      available: true,
      connection: null,
      repo: unit ? `${units.platformFromEnv().org}/${unit.repository}` : null,
      pr: null,
    };
  }
  const pr = await pipeline.openPullRequest(conn).catch(() => null);
  return { available: true, connection: conn, repo: conn.repo, pr };
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
    const unusable = Object.entries(f.deployment?.targets ?? {}).flatMap(([key, id]) => {
      const s = subscriptions.find((x) => x.id === id);
      return s && s.state !== "Enabled" ? [{ key, s }] : [];
    });
    if (unusable.length)
      checks.push({
        id: "subscriptions",
        level: "warn",
        title: `${unusable.map((u) => `${u.key[0]!.toUpperCase()}${u.key.slice(1)}`).join(", ")} subscription${unusable.length === 1 ? " is" : "s are"} read-only`,
        detail: unusable
          .map((u) => `${u.s.name} (${u.s.id}): ${arm.SUBSCRIPTION_STATE[u.s.state] ?? u.s.state}.`)
          .join(" ")
          .concat(" Pick another subscription below; nothing can be deployed into it."),
      });
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
      pipeline: await pipelineInfo(f),
    };
  });

const running = new Set<string>();

type Db = typeof import("../db.server");
type Answers_ = ReturnType<typeof withDefaults>;
type RunAction = "plan" | "apply" | "destroy" | "connect";

const runInput = z.object({
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
});
type RunInput = z.infer<typeof runInput>;

/** A run row's log, flushed to the database every 2 seconds, and how it ends. */
function runLogger(db: Db, runId: string, foundationId: string, initial = "") {
  let buffer = initial;
  let dirty = false;
  let summary: Record<string, unknown> | null = null;
  const log = (line: string) => {
    buffer += `${new Date().toISOString().slice(11, 19)}  ${line}\n`;
    if (buffer.length > 400_000) buffer = buffer.slice(-300_000);
    dirty = true;
  };
  const flush = async () => {
    if (!dirty) return;
    dirty = false;
    await db.update(
      "foundation_runs",
      { log: buffer, ...(summary ? { summary } : {}) },
      { id: runId },
    );
  };
  const timer = setInterval(() => void flush().catch(() => {}), 2000);
  return {
    log,
    recent: () => buffer.slice(-60_000),
    /** Live summary (GitHub jobs and steps), saved with the next flush. */
    setSummary: async (s: Record<string, unknown>) => {
      summary = s;
      dirty = true;
    },
    finish: async (ok: boolean, final: Record<string, unknown>) => {
      clearInterval(timer);
      summary = null;
      dirty = true;
      await flush();
      await db.update(
        "foundation_runs",
        {
          status: ok ? "succeeded" : "failed",
          summary: final as Json,
          finished_at: new Date().toISOString(),
        },
        { id: runId },
      );
      running.delete(foundationId);
    },
  };
}

async function beginRun(
  db: Db,
  f: FoundationRow,
  action: RunAction,
  startedBy: string,
  targets = {},
) {
  if (running.has(f.id)) throw new Error("A run is already in progress for this landing zone.");
  await resumePipelineRuns(
    db,
    f.id,
    await db.query<DeployRun>(
      "select id, action, status, started_by, summary, log, created_at, finished_at from public.foundation_runs where foundation_id = $1 and status = 'running'",
      [f.id],
    ),
  );
  const active = await db.maybeOne(
    "select id from public.foundation_runs where foundation_id = $1 and status = 'running' and created_at > now() - interval '3 hours'",
    [f.id],
  );
  if (active) throw new Error("A run is already in progress for this landing zone.");
  const run = await db.insert<{ id: string }>("foundation_runs", {
    foundation_id: f.id,
    action,
    status: "running",
    started_by: startedBy,
    targets,
  });
  running.add(f.id);
  return { runId: run.id, ...runLogger(db, run.id, f.id) };
}

/**
 * Everything Plan does before Terraform: builds the hierarchy and vends subscriptions when needed, registers
 * providers, and renders the configuration, its variables and the imports that adopt what already exists.
 */
async function prepare(
  db: Db,
  f: FoundationRow,
  answers: Answers_,
  data: RunInput,
  deployment: Deployment,
  log: (l: string) => void,
  inState: Set<string>,
) {
  const arm = await import("./arm.server");
  const targets: Partial<Record<TargetKey, string>> = { ...(deployment.targets ?? {}) };
  const vended = [...(deployment.vended ?? [])];
  const precreated = new Set(deployment.precreatedGroups ?? []);
  const root = answers.intermediateRootId || "alz";
  const groupOf = (key: TargetKey) => mgIdFor(answers, placementGroup(answers, key));
  const plan = targetsFor(answers).map((t) => {
    const choice = data.targets[t.key];
    const alias = `${root}-${t.key}`;
    const ours = vended.find((v) => v.alias === alias);
    const vend =
      choice?.mode === "new" ||
      (!choice && !targets[t.key]) ||
      // Subscriptions this app vended stay under its control, including ones stranded at the root.
      (!!ours && (choice?.mode !== "existing" || choice.subscriptionId === ours.subscriptionId));
    return { ...t, choice, alias, vend, ours };
  });
  // Build the designed hierarchy before vending, so each new subscription is created straight in its
  // management group instead of the tenant root. Policy and access follow on apply.
  if (plan.some((t) => t.vend)) {
    const tenantId = (await arm.whoAmI()).tenantId;
    for (const g of deployedGroups(f.library_ref, answers)) {
      const created = await arm.ensureManagementGroup({
        id: g.id,
        displayName: g.displayName,
        parentId: g.parentId ?? tenantId,
        log,
      });
      if (created) precreated.add(g.id);
    }
    deployment.precreatedGroups = [...precreated];
    await db.update("foundations", { deployment }, { id: f.id });
  }
  const billingScope = data.billingScope || deployment.billingScope || "";
  for (const t of plan) {
    if (t.vend) {
      if (!billingScope && !t.ours)
        throw new Error(`Pick a billing scope to create the ${t.label} subscription.`);
      const group = groupOf(t.key);
      const id = await arm.vendSubscription({
        alias: t.alias,
        displayName: `${answers.intermediateRootName || "ALZ"} ${t.label}`,
        billingScope,
        workload: "Production",
        managementGroupId: group,
        log,
      });
      if (!(await arm.subscriptionInGroup(id, group))) {
        log(`Moving ${t.label} subscription ${id} into ${group}.`);
        await arm.moveSubscription(id, group);
      }
      targets[t.key] = id;
      if (!vended.some((v) => v.subscriptionId === id))
        vended.push({ key: t.key, subscriptionId: id, alias: t.alias });
      // Record each subscription as soon as it exists, so a later failure never loses track of it.
      await db.update(
        "foundations",
        { deployment: { ...deployment, targets, vended, billingScope } },
        { id: f.id },
      );
    } else if (t.choice?.mode === "existing") targets[t.key] = t.choice.subscriptionId;
    const state = await arm.subscriptionState(targets[t.key]!);
    if (state !== "Enabled" && state !== "Unknown")
      throw new Error(
        `The ${t.label} subscription ${targets[t.key]} is ${arm.SUBSCRIPTION_STATE[state] ?? state}. Nothing can be deployed into it: pick another subscription for ${t.label}.`,
      );
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
  if (answers.defaultGroup) vars["apply_tenant_hierarchy_settings"] = data.applyHierarchySettings;
  for (const p of principalVars(files)) {
    if (!data.principals[p]) throw new Error(`Enter the Microsoft Entra object ID for ${p}.`);
    vars[p] = data.principals[p];
  }
  // Groups and placements that already exist in Azure (made above, by an earlier run, or by hand) are adopted
  // instead of created. Importing an address already in state is a no-op, so the pipeline keeps them all.
  const imports: { to: string; id: string }[] = [];
  for (const g of deployedGroups(f.library_ref, answers)) {
    const to = `module.alz.azapi_resource.management_groups_level_${g.level}[${JSON.stringify(g.id)}]`;
    if (
      !inState.has(to) &&
      (precreated.has(g.id) || (await arm.managementGroupExists(g.id).catch(() => false)))
    )
      imports.push({
        to,
        id: `/providers/Microsoft.Management/managementGroups/${g.id}?api-version=2023-04-01`,
      });
  }
  for (const t of targetsFor(answers)) {
    const to = `module.alz.azapi_resource.subscription_placement[${JSON.stringify(t.key)}]`;
    const group = groupOf(t.key);
    if (!inState.has(to) && (await arm.subscriptionInGroup(targets[t.key]!, group)))
      imports.push({
        to,
        id: `/providers/Microsoft.Management/managementGroups/${group}/subscriptions/${targets[t.key]}?api-version=2023-04-01`,
      });
  }
  log(`Configuration: ${files.length} files, ALZ library ${shortRef(f.library_ref)}.`);
  if (imports.length)
    log(`Adopting ${imports.length} existing management group(s) and placement(s) into Terraform.`);
  return { files, vars, imports, vending: plan.some((t) => t.vend), targets };
}

const importsTf = (imports: { to: string; id: string }[]) =>
  imports.map((i) => `import {\n  to = ${i.to}\n  id = ${JSON.stringify(i.id)}\n}\n`).join("\n");

async function markDeployed(db: Db, f: FoundationRow, answers: Answers_, deployment: Deployment) {
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

/** After a successful destroy: remove groups this app made ahead of Terraform, optionally cancel subscriptions. */
async function cleanUpAfterDestroy(
  db: Db,
  f: FoundationRow,
  answers: Answers_,
  deployment: Deployment,
  cancelVended: boolean,
  log: (l: string) => void,
) {
  const arm = await import("./arm.server");
  if (deployment.precreatedGroups?.length) {
    const tenantId = (await arm.whoAmI()).tenantId;
    const levels = new Map(deployedGroups(f.library_ref, answers).map((g) => [g.id, g.level]));
    // Deepest first: a management group can only be deleted once it has no children.
    const leftover = [...deployment.precreatedGroups].sort(
      (a, b) => (levels.get(b) ?? 99) - (levels.get(a) ?? 99),
    );
    for (const id of leftover) await arm.removeManagementGroup(id, tenantId, log);
    deployment.precreatedGroups = [];
    await db.update("foundations", { deployment }, { id: f.id });
  }
  if (cancelVended) {
    for (const v of deployment.vended ?? []) {
      log(`Cancelling subscription ${v.subscriptionId} (${v.alias})`);
      const status = await arm.cancelSubscription(v.subscriptionId, v.alias);
      log(`Cancel returned ${status}.`);
    }
    deployment.vended = [];
    deployment.targets = {};
    await db.update("foundations", { deployment }, { id: f.id });
  }
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
}

/** Follows a GitHub Actions run to the end, then records what it means for the landing zone. */
async function trackPipeline(
  db: Db,
  f: FoundationRow,
  answers: Answers_,
  t: import("./pipeline.server").PipelineRun,
  r: ReturnType<typeof runLogger>,
) {
  const pipeline = await import("./pipeline.server");
  try {
    const res = await pipeline.follow({
      t,
      log: r.log,
      save: (x) => r.setSummary({ pipeline: x }),
    });
    const fresh = await db.one<FoundationRow>("select * from public.foundations where id = $1", [
      f.id,
    ]);
    const deployment: Deployment = { ...(fresh.deployment ?? {}) };
    if (res.ok && t.kind === "apply") await markDeployed(db, fresh, answers, deployment);
    if (res.ok && t.kind === "destroy")
      await cleanUpAfterDestroy(db, fresh, answers, deployment, !!t.cancelVended, r.log);
    if (res.ok && t.kind === "plan")
      r.log(
        t.pr
          ? `Plan complete. Review it on pull request #${t.pr.number}, then Apply merges it and GitHub applies main.`
          : "Plan complete: Azure already matches main.",
      );
    await r.finish(res.ok, { ...(res.summary ?? {}), pipeline: t });
  } catch (e) {
    r.log(`Error: ${(e as Error).message}`);
    await r.finish(false, { error: (e as Error).message, pipeline: t });
  }
}

/** Plan, apply and destroy through the landing zone's GitHub Actions pipeline. */
async function runInPipeline(
  db: Db,
  f: FoundationRow,
  answers: Answers_,
  data: RunInput,
  r: ReturnType<typeof runLogger>,
) {
  const pipeline = await import("./pipeline.server");
  const deployment: Deployment = { ...(f.deployment ?? {}) };
  let conn = deployment.pipeline!;
  const units = await import("../delivery/units.server");
  const platform = units.platformFromEnv();
  if (conn.templates !== `${platform.org}/${platform.templatesRepo}@${platform.templatesRef}`) {
    // New pipeline template release: identities must trust it before the pull request's run can sign in.
    r.log(`Moving to pipeline templates ${platform.templatesRef}…`);
    const unit = await units.ensureUnit(db, { foundation_id: f.id });
    const arm = await import("./arm.server");
    conn = {
      ...(await pipeline.connectPipeline({
        spec: unit!.spec,
        platform,
        tenantId: (await arm.whoAmI()).tenantId,
        log: r.log,
      })),
      pr: conn.pr ?? null,
    };
    deployment.pipeline = conn;
    await db.update("foundations", { deployment }, { id: f.id });
  }
  const base = { repo: conn.repo, approval: conn.approval } as const;
  let t: import("./pipeline.server").PipelineRun;
  if (data.action === "plan") {
    const prep = await prepare(db, f, answers, data, deployment, r.log, new Set());
    await pipeline.setSubscription(conn, prep.targets.management!);
    const unit = await units.ensureUnit(db, { foundation_id: f.id });
    if (!unit) throw new Error("This landing zone has no delivery unit.");
    const files = pipeline.repoFiles(unit.spec, platform, {
      tenantId: conn.tenantId,
      managementGroupId: answers.intermediateRootId,
      libraryRef: f.library_ref,
      answers,
      terraform: [
        ...prep.files,
        {
          path: "cloud-delivery.auto.tfvars.json",
          content: `${JSON.stringify(prep.vars, null, 2)}\n`,
        },
        ...(prep.imports.length
          ? [{ path: "cloud-delivery.imports.tf", content: importsTf(prep.imports) }]
          : []),
      ],
    });
    const title = `Landing zone ${f.name}: ALZ ${shortRef(f.library_ref)}`;
    const body = [
      `Rendered by Cloud Delivery from the saved design of **${f.name}** (started by ${data.startedBy}).`,
      "",
      `- \`landing-zone.yaml\`: the design answers.`,
      `- \`terraform/\`: the generated configuration, its variables${prep.imports.length ? ` and ${prep.imports.length} import(s) for groups and placements that already exist` : ""}.`,
      "",
      `The **Plan** job comments the plan here. ${conn.approval === "merge" ? "Merging is the approval: main is planned again and applied." : `Merging plans main again; the **Apply** job then waits for approval on the \`apply\` environment.`}`,
    ].join("\n");
    r.log(`Committing ${files.length} files to ${conn.repo} (${pipeline.BRANCH})…`);
    const opened = await pipeline.openPlanPullRequest(conn, files, title, body);
    if (opened) {
      r.log(`Pull request #${opened.pr.number}: ${opened.pr.url}`);
      deployment.pipeline = { ...conn, pr: { ...opened.pr, branch: pipeline.BRANCH } };
      t = { ...base, kind: "plan", sha: opened.sha, pr: opened.pr };
    } else {
      r.log("main already has this design. Planning main against Azure…");
      t = {
        ...base,
        kind: "plan",
        dispatchedAt: await pipeline.dispatch(conn, "plan"),
        noChanges: true,
      };
    }
    await db.update("foundations", { deployment }, { id: f.id });
  } else if (data.action === "apply") {
    const pr = await pipeline.openPullRequest(conn);
    if (pr) {
      r.log(`Merging pull request #${pr.number} into main…`);
      const sha = await pipeline.mergePlan(conn, pr.number, pr.title);
      t = { ...base, kind: "apply", sha, pr: { number: pr.number, url: pr.url } };
    } else {
      r.log("No open pull request: planning and applying main.");
      t = { ...base, kind: "apply", dispatchedAt: await pipeline.dispatch(conn, "apply") };
    }
    deployment.pipeline = { ...conn, pr: null };
    await db.update("foundations", { deployment }, { id: f.id });
  } else {
    r.log("Requesting a destroy run on main…");
    t = {
      ...base,
      kind: "destroy",
      dispatchedAt: await pipeline.dispatch(conn, "destroy"),
      cancelVended: data.cancelVended,
    };
  }
  await r.setSummary({ pipeline: t });
  await trackPipeline(db, f, answers, t, r);
}

export const startDeployRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => runInput.parse(d))
  .handler(async ({ data }) => {
    const { db, f, answers } = await load(data.foundationId);
    const r = await beginRun(db, f, data.action, data.startedBy, data.targets);

    void (async () => {
      try {
        if (f.deployment?.pipeline) return await runInPipeline(db, f, answers, data, r);
        const runner = await import("./runner.server");
        const deployment: Deployment = { ...(f.deployment ?? {}) };
        const log = r.log;
        if (data.action === "plan") {
          const prep = await prepare(
            db,
            f,
            answers,
            data,
            deployment,
            log,
            new Set(await runner.stateAddresses(f.id)),
          );
          await runner.writeConfig(f.id, prep.files, prep.vars);
          await runner.writeImports(f.id, prep.imports);
          const res = await runner.terraform("plan", f.id, log);
          if (res.ok)
            log(
              prep.vending
                ? "Plan complete. The management group hierarchy exists and new platform subscriptions are in their groups. Apply plan assigns policy and access and places any existing subscriptions."
                : "Plan complete. Apply plan creates the management group hierarchy, moves the platform subscriptions into it, and assigns policy and access.",
            );
          await r.finish(res.ok, res.summary);
          return;
        }
        if (data.action === "apply") {
          // Azure is eventually consistent: a policy definition or role can be created and still be "not found"
          // for a few seconds. Those errors clear on a second pass, so re-plan and apply again.
          const transient =
            /PolicyDefinitionNotFound|PolicySetDefinitionNotFound|RoleDefinitionDoesNotExist|PrincipalNotFound|ReferencedResourceNotProvisioned|AnotherOperationInProgress|ManagementGroupNotFound|AuthorizationFailed|RetryableError|Conflict/;
          let res = await runner.terraform("apply", f.id, log);
          for (let attempt = 2; !res.ok && attempt <= 4; attempt++) {
            const recent = r.recent();
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
            res = await runner.terraform("apply", f.id, log);
          }
          if (res.ok) await markDeployed(db, f, answers, deployment);
          await r.finish(res.ok, res.summary);
          return;
        }
        await runner.writeImports(f.id, []);
        const res = await runner.terraform("destroy", f.id, log);
        if (res.ok) await cleanUpAfterDestroy(db, f, answers, deployment, data.cancelVended, log);
        await r.finish(res.ok, res.summary);
      } catch (e) {
        r.log(`Error: ${(e as Error).message}`);
        await r.finish(false, { error: (e as Error).message });
      }
    })();

    return { runId: r.runId };
  });

/** Moves this landing zone's Terraform to GitHub Actions: repository, environments, identities and state. */
export const connectPipeline = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        foundationId: z.string().uuid(),
        startedBy: z.string().max(120).default("Platform engineer"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, f } = await load(data.foundationId);
    const pipeline = await import("./pipeline.server");
    if (!pipeline.pipelineAvailable())
      throw new Error(
        "Set CD_GITHUB_TOKEN and CD_GITHUB_ORG to run landing zones in GitHub Actions.",
      );
    const runner = await import("./runner.server");
    if ((await runner.stateAddresses(f.id)).length)
      throw new Error(
        "This landing zone's Terraform state is in this app (deployed by the in-app runner). Destroy it first, or move the state to the pipeline's backend, before connecting.",
      );
    const r = await beginRun(db, f, "connect", data.startedBy);
    void (async () => {
      try {
        const units = await import("../delivery/units.server");
        const arm = await import("./arm.server");
        const unit = await units.ensureUnit(db, { foundation_id: f.id });
        if (!unit) throw new Error("This landing zone has no delivery unit.");
        const conn = await pipeline.connectPipeline({
          spec: unit.spec,
          platform: units.platformFromEnv(),
          tenantId: (await arm.whoAmI()).tenantId,
          log: r.log,
        });
        const fresh = await db.one<FoundationRow>(
          "select * from public.foundations where id = $1",
          [f.id],
        );
        await db.update(
          "foundations",
          { deployment: { ...(fresh.deployment ?? {}), pipeline: conn } },
          { id: f.id },
        );
        await db.query(
          "update public.delivery_units set status = 'active', request_url = $2, updated_at = now() where id = $1",
          [unit.id, conn.url],
        );
        await r.finish(true, { pipeline: { repo: conn.repo, url: conn.url, kind: "connect" } });
      } catch (e) {
        r.log(`Error: ${(e as Error).message}`);
        await r.finish(false, { error: (e as Error).message });
      }
    })();
    return { runId: r.runId };
  });

/** Approves the apply environment of a run waiting for review (the token's user must be a reviewer). */
export const approvePipelineRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ foundationId: z.string().uuid(), runId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await import("../db.server");
    const row = await db.one<{ summary: { pipeline?: import("./pipeline.server").PipelineRun } }>(
      "select summary from public.foundation_runs where id = $1 and foundation_id = $2",
      [data.runId, data.foundationId],
    );
    const t = row.summary.pipeline;
    if (!t?.runId || !t.waiting?.length) throw new Error("Nothing is waiting for approval.");
    const pipeline = await import("./pipeline.server");
    await pipeline.approve(
      t.repo,
      t.runId,
      t.waiting.map((w) => w.id),
    );
    return { ok: true };
  });

export type DeployRun = {
  id: string;
  action: RunAction;
  status: "queued" | "running" | "succeeded" | "failed";
  started_by: string | null;
  summary: Json;
  log: string;
  created_at: string;
  finished_at: string | null;
};

/** GitHub Actions runs whose watcher died with an app restart: pick them up again. */
async function resumePipelineRuns(db: Db, foundationId: string, rows: DeployRun[]) {
  for (const row of rows) {
    const t = (row.summary as { pipeline?: PipelineRun } | null)?.pipeline;
    if (row.status === "running" && !t && !running.has(foundationId)) {
      // In-app Terraform and connect runs die with the process; say so instead of blocking new runs for hours.
      const note = `${new Date().toISOString().slice(11, 19)}  Interrupted: the app restarted while this run was in progress. Start it again.\n`;
      await db.update(
        "foundation_runs",
        {
          status: "failed",
          log: row.log + note,
          summary: { error: "Interrupted by an app restart." },
          finished_at: new Date().toISOString(),
        },
        { id: row.id },
      );
      row.status = "failed";
      row.log += note;
      row.summary = { error: "Interrupted by an app restart." };
      continue;
    }
    if (
      row.status !== "running" ||
      !t ||
      t.kind === ("connect" as never) ||
      running.has(foundationId)
    )
      continue;
    if (Date.now() - new Date(row.created_at).getTime() > 24 * 3600_000) continue;
    const f = await db.one<FoundationRow>("select * from public.foundations where id = $1", [
      foundationId,
    ]);
    running.add(foundationId);
    const r = runLogger(db, row.id, foundationId, row.log);
    r.log("Resuming: following the GitHub Actions run after an app restart.");
    void trackPipeline(db, f, withDefaults(f.answers), t, r);
  }
}

export const getDeployRuns = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ foundationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await import("../db.server");
    const rows = await db.query<DeployRun>(
      "select id, action, status, started_by, summary, log, created_at, finished_at from public.foundation_runs where foundation_id = $1 order by created_at desc limit 10",
      [data.foundationId],
    );
    await resumePipelineRuns(db, data.foundationId, rows).catch((e) =>
      console.error("[pipeline] resume failed:", (e as Error).message),
    );
    return rows;
  });
