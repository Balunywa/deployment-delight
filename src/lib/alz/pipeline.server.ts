/*
 * Landing zone CI/CD in GitHub Actions. Connecting a landing zone provisions, idempotently:
 *   GitHub  cd-delivery-templates (reusable workflows, released at a pinned tag) and lz-<tenant> (private) with
 *           "plan" and "apply" environments, their variables and an OIDC subject pinned to the template;
 *   Azure   a state storage account (Entra-only, versioned), and plan/apply user-assigned identities that trust
 *           exactly those environments running that template: Reader / Owner at the tenant root group, and
 *           Storage Blob Data Contributor on the state container.
 * After that, Plan commits the rendered Terraform to a branch and opens a pull request (GitHub plans it), and
 * Apply merges it (GitHub plans main and applies). The app streams the run's jobs, steps and logs.
 */
import { type Platform, type UnitSpec } from "../delivery/model";
import { type ScaffoldFile, landingZoneRepo } from "../delivery/scaffold";
import { deliveryTemplates } from "../delivery/templates";
import { GitHubError, github, githubDownload, githubMaybe, githubToken } from "../github.server";
import { arm } from "./arm.server";
import { ROLE, armOk, assignRole, ensureState, guid, sleep } from "./state.server";

type Log = (line: string) => void;

export type PipelineIdentity = {
  name: string;
  id: string;
  clientId: string;
  principalId: string;
  subject: string;
  roles: string[];
};

export type PipelineConnection = {
  repo: string;
  url: string;
  templates: string;
  /** "environment": the apply job waits for a reviewer. "merge": merging the pull request is the approval. */
  approval: "environment" | "merge";
  tenantId: string;
  identities: { plan: PipelineIdentity; apply: PipelineIdentity };
  state: {
    account: string;
    container: string;
    key: string;
    resourceGroup: string;
    subscriptionId: string;
  };
  connectedAt: string;
  pr?: { number: number; url: string; branch: string } | null;
};

export type PipelineJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  steps: { number: number; name: string; status: string; conclusion: string | null }[];
};

/** What a run row's summary carries for a GitHub Actions run (foundation_runs.summary.pipeline). */
export type PipelineRun = {
  repo: string;
  kind: "plan" | "apply" | "destroy";
  approval: PipelineConnection["approval"];
  sha?: string | null;
  dispatchedAt?: string | null;
  pr?: { number: number; url: string } | null;
  runId?: number | null;
  runUrl?: string | null;
  status?: string;
  conclusion?: string | null;
  jobs?: PipelineJob[];
  waiting?: { environment: string; canApprove: boolean; id: number }[];
  logged?: number[];
  cancelVended?: boolean;
  /** Set when nothing changed, so no run was needed. */
  noChanges?: boolean;
};

export const BRANCH = "cloud-delivery/plan";
const WORKFLOW = ".github/workflows/landing-zone.yml";
/** GitHub token and owner are set: CD_GITHUB_TOKEN and CD_GITHUB_ORG. */
export const pipelineAvailable = () => !!githubToken() && !!process.env["CD_GITHUB_ORG"]?.trim();

/* ---------------------------------- GitHub ---------------------------------- */

async function ensureRepo(
  owner: string,
  name: string,
  ownerIsUser: boolean,
  description: string,
  log: Log,
) {
  const existing = await githubMaybe<{ html_url: string; default_branch: string }>(
    `/repos/${owner}/${name}`,
  );
  if (existing) return existing;
  log(`Creating private repository ${owner}/${name}…`);
  const created = await github<{ html_url: string; default_branch: string }>(
    ownerIsUser ? "/user/repos" : `/orgs/${owner}/repos`,
    { method: "POST", body: { name, private: true, auto_init: true, description } },
  );
  for (let i = 0; i < 10; i++) {
    if (await githubMaybe(`/repos/${owner}/${name}/git/ref/heads/${created.default_branch}`)) break;
    await sleep(2);
  }
  return created;
}

/**
 * Commits files on top of a branch in one commit. Paths matching `prune` that are no longer generated are
 * deleted, so the repository matches the design exactly. Returns null when nothing changed.
 */
async function commitFiles(
  repo: string,
  base: string,
  files: ScaffoldFile[],
  message: string,
  prune: (path: string) => boolean,
) {
  const ref = await github<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${base}`);
  const parent = await github<{ tree: { sha: string } }>(
    `/repos/${repo}/git/commits/${ref.object.sha}`,
  );
  const tree = await github<{ tree: { path: string; type: string; mode: string }[] }>(
    `/repos/${repo}/git/trees/${parent.tree.sha}?recursive=1`,
  );
  const want = new Set(files.map((f) => f.path));
  const next = await github<{ sha: string }>(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: {
      base_tree: parent.tree.sha,
      tree: [
        ...files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
        ...tree.tree
          .filter((e) => e.type === "blob" && !want.has(e.path) && prune(e.path))
          .map((e) => ({ path: e.path, mode: e.mode, type: "blob", sha: null })),
      ],
    },
  });
  if (next.sha === parent.tree.sha) return { sha: null, parent: ref.object.sha };
  const commit = await github<{ sha: string }>(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: { message, tree: next.sha, parents: [ref.object.sha] },
  });
  return { sha: commit.sha, parent: ref.object.sha };
}

async function setVariable(repo: string, environment: string, name: string, value: string) {
  const path = `/repos/${repo}/environments/${environment}/variables`;
  try {
    await github(`${path}/${name}`, { method: "PATCH", body: { name, value } });
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e;
    await github(path, { method: "POST", body: { name, value } });
  }
}

/** Publishes the reusable workflows at p.templatesRef once. Tags are immutable: identities trust them. */
async function publishTemplates(p: Platform, ownerIsUser: boolean, log: Log) {
  const repo = `${p.org}/${p.templatesRepo}`;
  const meta = await ensureRepo(
    p.org,
    p.templatesRepo,
    ownerIsUser,
    "Reusable workflows every Cloud Delivery unit repository calls at a pinned tag.",
    log,
  );
  // Private reusable workflows are callable only when the repository shares them with the owner's repositories.
  await github(`/repos/${repo}/actions/permissions/access`, {
    method: "PUT",
    body: { access_level: ownerIsUser ? "user" : "organization" },
  });
  if (await githubMaybe(`/repos/${repo}/git/ref/tags/${p.templatesRef}`)) {
    log(`Pipeline templates ${repo}@${p.templatesRef} already released.`);
    return;
  }
  const c = await commitFiles(
    repo,
    meta.default_branch,
    deliveryTemplates(p),
    `Release ${p.templatesRef}`,
    (path) => path.startsWith(".github/workflows/"),
  );
  const sha = c.sha ?? c.parent;
  if (c.sha)
    await github(`/repos/${repo}/git/refs/heads/${meta.default_branch}`, {
      method: "PATCH",
      body: { sha: c.sha },
    });
  await github(`/repos/${repo}/git/refs`, {
    method: "POST",
    body: { ref: `refs/tags/${p.templatesRef}`, sha },
  });
  log(`Released pipeline templates ${repo}@${p.templatesRef}.`);
}

/* ---------------------------------- Azure ----------------------------------- */

async function ensureIdentity(
  sub: string,
  rg: string,
  name: string,
  location: string,
  tags: Record<string, string>,
  subject: string,
  ref: string,
) {
  const id = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${name}`;
  const r = await armOk<{ properties: { clientId: string; principalId: string } }>(
    "PUT",
    `${id}?api-version=2023-01-31`,
    { location, tags },
  );
  // One credential per template release: main keeps working on the previous tag until the next merge moves it.
  // ("github" is the v2 credential's name from before credentials were named per release.)
  const credential = ref === "v2" ? "github" : `github-${ref.replace(/[^A-Za-z0-9-]/g, "-")}`;
  await armOk("PUT", `${id}/federatedIdentityCredentials/${credential}?api-version=2023-01-31`, {
    properties: {
      issuer: "https://token.actions.githubusercontent.com",
      subject,
      audiences: ["api://AzureADTokenExchange"],
    },
  });
  return { id, clientId: r.data.properties.clientId, principalId: r.data.properties.principalId };
}

/* --------------------------------- Connect ---------------------------------- */

export async function connectPipeline(opts: {
  spec: UnitSpec;
  platform: Platform;
  tenantId: string;
  log: Log;
}): Promise<PipelineConnection> {
  const { spec, platform: p, tenantId, log } = opts;
  const sub = process.env["CD_STATE_SUBSCRIPTION_ID"]?.trim();
  const rg = process.env["CD_STATE_RESOURCE_GROUP"]?.trim();
  if (!sub || !rg)
    throw new Error(
      "Set CD_STATE_SUBSCRIPTION_ID and CD_STATE_RESOURCE_GROUP: where pipeline identities and Terraform state live.",
    );
  const owner = await github<{ type: string; login: string }>(`/users/${p.org}`);
  const me = await github<{ id: number; login: string }>("/user");
  const ownerIsUser = owner.type === "User";
  const repo = `${p.org}/${spec.repository.name}`;

  await publishTemplates(p, ownerIsUser, log);
  const meta = await ensureRepo(
    p.org,
    spec.repository.name,
    ownerIsUser,
    `${spec.name} platform landing zone — managed by Cloud Delivery`,
    log,
  );
  // Subjects carry repo, environment and the calling template, so only that workflow at that tag gets in.
  await github(`/repos/${repo}/actions/oidc/customization/sub`, {
    method: "PUT",
    body: { use_default: false, include_claim_keys: ["repo", "context", "job_workflow_ref"] },
  });
  const oidc = await github<{ sub_claim_prefix?: string }>(
    `/repos/${repo}/actions/oidc/customization/sub`,
  );
  const prefix = oidc.sub_claim_prefix ?? `repo:${repo}`;
  const subject = (env: string) =>
    `${prefix}:environment:${env}:job_workflow_ref:${p.org}/${p.templatesRepo}/.github/workflows/lz.yml@refs/tags/${p.templatesRef}`;
  await githubMaybe(`/repos/${repo}/labels`, {
    method: "POST",
    body: { name: "drift", color: "d93f0b", description: "Azure no longer matches main" },
  }).catch(() => null);

  const tags = { "cd-unit": spec.repository.name, "managed-by": "cloud-delivery" };
  const storage = await ensureState({
    unitRepo: spec.repository.name,
    preferredAccount: spec.state[0]!.storageAccount,
    stateKey: spec.state[0]!.key,
    log,
  });
  const location = storage.location;

  const root = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
  const identities = {} as PipelineConnection["identities"];
  for (const [env, role, roleName] of [
    ["plan", ROLE.reader, "Reader"],
    ["apply", ROLE.owner, "Owner"],
  ] as const) {
    const name = `id-${spec.repository.name}-${env}`;
    log(`Identity ${name}: trusts ${repo} environment "${env}" running lz.yml@${p.templatesRef}.`);
    const id = await ensureIdentity(sub, rg, name, location, tags, subject(env), p.templatesRef);
    await assignRole(root, role, id.principalId, log);
    await assignRole(storage.containerScope, ROLE.blobContributor, id.principalId, log);
    identities[env] = {
      name,
      ...id,
      subject: subject(env),
      roles: [`${roleName} · tenant root group`, "Storage Blob Data Contributor · state container"],
    };
  }

  // Required reviewers need GitHub Pro, Team or Enterprise for private repositories; without them, merging
  // the pull request is the approval.
  const branchPolicy = { protected_branches: false, custom_branch_policies: true };
  let approval: PipelineConnection["approval"] = "environment";
  await github(`/repos/${repo}/environments/plan`, { method: "PUT", body: {} });
  try {
    await github(`/repos/${repo}/environments/apply`, {
      method: "PUT",
      body: {
        reviewers: [{ type: "User", id: me.id }],
        prevent_self_review: false,
        deployment_branch_policy: branchPolicy,
      },
    });
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 422)) throw e;
    approval = "merge";
    log(
      "This GitHub plan doesn't offer required reviewers on private repositories: merging the pull request is the approval.",
    );
    await github(`/repos/${repo}/environments/apply`, {
      method: "PUT",
      body: { deployment_branch_policy: branchPolicy },
    });
  }
  await github(`/repos/${repo}/environments/apply/deployment-branch-policies`, {
    method: "POST",
    body: { name: meta.default_branch, type: "branch" },
  }).catch(() => null);
  const state = {
    account: storage.account,
    container: storage.container,
    key: storage.key,
    resourceGroup: rg,
    subscriptionId: sub,
  };
  for (const env of ["plan", "apply"] as const) {
    const vars: Record<string, string> = {
      AZURE_CLIENT_ID: identities[env].clientId,
      AZURE_TENANT_ID: tenantId,
      AZURE_SUBSCRIPTION_ID: sub,
      TF_STATE_ACCOUNT: state.account,
      TF_STATE_CONTAINER: state.container,
      TF_STATE_KEY: state.key,
    };
    for (const [k, v] of Object.entries(vars)) await setVariable(repo, env, k, v);
  }
  log(`Connected: ${meta.html_url}`);
  return {
    repo,
    url: meta.html_url,
    templates: `${p.org}/${p.templatesRepo}@${p.templatesRef}`,
    approval,
    tenantId,
    identities,
    state,
    connectedAt: new Date().toISOString(),
    pr: null,
  };
}

/* ------------------------------ Plan / apply -------------------------------- */

export function repoFiles(
  spec: UnitSpec,
  p: Platform,
  lz: Parameters<typeof landingZoneRepo>[2],
): ScaffoldFile[] {
  const owners = process.env["CD_CODEOWNERS"]?.trim();
  return landingZoneRepo(spec, p, lz).map((f) =>
    f.path === ".github/CODEOWNERS" && owners
      ? { ...f, content: `# Platform owners review every change.\n* ${owners}\n` }
      : f,
  );
}

/** The management subscription Terraform's default providers use. */
export async function setSubscription(conn: PipelineConnection, subscriptionId: string) {
  for (const env of ["plan", "apply"]) {
    await setVariable(conn.repo, env, "AZURE_SUBSCRIPTION_ID", subscriptionId);
  }
}

/** Commits the rendered landing zone to the plan branch and opens (or updates) its pull request. */
export async function openPlanPullRequest(
  conn: PipelineConnection,
  files: ScaffoldFile[],
  title: string,
  body: string,
): Promise<{ sha: string; pr: { number: number; url: string } } | null> {
  const meta = await github<{ default_branch: string }>(`/repos/${conn.repo}`);
  const c = await commitFiles(conn.repo, meta.default_branch, files, title, (path) =>
    path.startsWith("terraform/"),
  );
  if (!c.sha) return null;
  const branchRef = `/repos/${conn.repo}/git/refs/heads/${BRANCH}`;
  if (await githubMaybe(branchRef))
    await github(branchRef, { method: "PATCH", body: { sha: c.sha, force: true } });
  else
    await github(`/repos/${conn.repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${BRANCH}`, sha: c.sha },
    });
  const [owner] = conn.repo.split("/");
  const open = await github<{ number: number; html_url: string }[]>(
    `/repos/${conn.repo}/pulls?state=open&head=${owner}:${encodeURIComponent(BRANCH)}`,
  );
  const pr = open[0]
    ? await github<{ number: number; html_url: string }>(
        `/repos/${conn.repo}/pulls/${open[0].number}`,
        { method: "PATCH", body: { title, body } },
      )
    : await github<{ number: number; html_url: string }>(`/repos/${conn.repo}/pulls`, {
        method: "POST",
        body: { title, body, head: BRANCH, base: meta.default_branch },
      });
  return { sha: c.sha, pr: { number: pr.number, url: pr.html_url } };
}

/** The open plan pull request, if any. */
export async function openPullRequest(conn: PipelineConnection) {
  const [owner] = conn.repo.split("/");
  const open = await github<
    { number: number; html_url: string; title: string; head: { sha: string } }[]
  >(`/repos/${conn.repo}/pulls?state=open&head=${owner}:${encodeURIComponent(BRANCH)}`);
  return open[0]
    ? { number: open[0].number, url: open[0].html_url, title: open[0].title, sha: open[0].head.sha }
    : null;
}

/** Merges the plan pull request; the push to main runs plan and apply. Returns the merge commit. */
export async function mergePlan(conn: PipelineConnection, number: number, title: string) {
  const r = await github<{ sha: string; merged: boolean }>(
    `/repos/${conn.repo}/pulls/${number}/merge`,
    { method: "PUT", body: { merge_method: "squash", commit_title: `${title} (#${number})` } },
  );
  await githubMaybe(`/repos/${conn.repo}/git/refs/heads/${BRANCH}`, { method: "DELETE" }).catch(
    () => null,
  );
  return r.sha;
}

export async function dispatch(conn: PipelineConnection, action: "plan" | "apply" | "destroy") {
  const meta = await github<{ default_branch: string }>(`/repos/${conn.repo}`);
  const at = new Date(Date.now() - 5_000).toISOString();
  await github(`/repos/${conn.repo}/actions/workflows/landing-zone.yml/dispatches`, {
    method: "POST",
    body: { ref: meta.default_branch, inputs: { action } },
  });
  return at;
}

export async function approve(repo: string, runId: number, environmentIds: number[]) {
  await github(`/repos/${repo}/actions/runs/${runId}/pending_deployments`, {
    method: "POST",
    body: {
      environment_ids: environmentIds,
      state: "approved",
      comment: "Approved in Cloud Delivery.",
    },
  });
}

/* --------------------------------- Watching --------------------------------- */

type GhRun = {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  event: string;
  path: string;
  created_at: string;
};

async function findRun(t: PipelineRun): Promise<GhRun | null> {
  const q = t.sha
    ? `head_sha=${t.sha}`
    : `event=workflow_dispatch&created=${encodeURIComponent(`>=${t.dispatchedAt}`)}`;
  const r = await github<{ workflow_runs: GhRun[] }>(
    `/repos/${t.repo}/actions/runs?${q}&per_page=20`,
  );
  return (
    r.workflow_runs
      .filter((x) => x.path === WORKFLOW || x.path.startsWith(`${WORKFLOW}@`))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const clean = (text: string) =>
  text
    .replace(ANSI, "")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\d{4}-\d\d-\d\dT(\d\d:\d\d:\d\d)\.\d+Z /, "$1  ")
        .replace(/##\[(group|endgroup|section)\]/, "")
        .trimEnd(),
    )
    .filter((l) => l.trim())
    .join("\n");

async function planSummary(repo: string, runId: number) {
  const list = await github<{ artifacts: { name: string; archive_download_url: string }[] }>(
    `/repos/${repo}/actions/runs/${runId}/artifacts`,
  );
  const a = list.artifacts.find((x) => x.name === "lz-plan");
  if (!a) return null;
  const { unzipSync } = await import("fflate");
  const files = unzipSync(await githubDownload(a.archive_download_url), {
    filter: (f) => f.name.endsWith("plan-summary.json"),
  });
  const json = Object.values(files)[0];
  return json ? (JSON.parse(new TextDecoder().decode(json)) as Record<string, unknown>) : null;
}

/**
 * Follows one GitHub Actions run to completion: jobs and steps into the run's summary, each job's log into the
 * run's log as it finishes. Survives app restarts: state lives in the row, and getDeployRuns resumes watching.
 */
export async function follow(opts: {
  t: PipelineRun;
  log: Log;
  save: (t: PipelineRun) => Promise<void>;
}): Promise<{ ok: boolean; summary: Record<string, unknown> | null }> {
  const { t, log, save } = opts;
  const started = Date.now();
  let run: GhRun | null = null;
  const seen = new Map<string, string>();
  for (;;) {
    if (!t.runId) {
      run = await findRun(t);
      if (!run) {
        if (Date.now() - started > 4 * 60_000)
          throw new Error(
            `GitHub didn't start a landing-zone workflow run. Check Actions are enabled on ${t.repo}.`,
          );
        await sleep(5);
        continue;
      }
      t.runId = run.id;
      t.runUrl = run.html_url;
      log(`GitHub Actions run started: ${run.html_url}`);
    } else run = await github<GhRun>(`/repos/${t.repo}/actions/runs/${t.runId}`);

    const jobs = await github<{
      jobs: {
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        started_at: string | null;
        completed_at: string | null;
        html_url: string;
        steps?: { number: number; name: string; status: string; conclusion: string | null }[];
      }[];
    }>(`/repos/${t.repo}/actions/runs/${t.runId}/jobs?filter=latest&per_page=50`);
    t.status = run.status;
    t.conclusion = run.conclusion;
    t.jobs = jobs.jobs.map((j) => ({
      id: j.id,
      name: j.name.replace(/^landing-zone \/ /, ""),
      status: j.status,
      conclusion: j.conclusion,
      startedAt: j.started_at,
      completedAt: j.completed_at,
      url: j.html_url,
      steps: (j.steps ?? []).map((s) => ({
        number: s.number,
        name: s.name,
        status: s.status,
        conclusion: s.conclusion,
      })),
    }));
    for (const j of t.jobs) {
      for (const s of j.steps) {
        const key = `${j.id}:${s.number}`;
        const state = s.conclusion ?? s.status;
        if (seen.get(key) !== state && s.status !== "queued" && s.status !== "pending") {
          seen.set(key, state);
          if (s.status === "in_progress") log(`▶ ${j.name} · ${s.name}`);
        }
      }
      if (
        j.status === "completed" &&
        j.conclusion !== "skipped" &&
        !(t.logged ?? []).includes(j.id)
      ) {
        t.logged = [...(t.logged ?? []), j.id];
        try {
          const text = clean(
            new TextDecoder().decode(
              await githubDownload(`/repos/${t.repo}/actions/jobs/${j.id}/logs`),
            ),
          );
          log(`──── ${j.name} (${j.conclusion}) ────`);
          for (const line of text.split("\n").slice(-1500)) log(line);
        } catch {
          log(`${j.name} finished (${j.conclusion}). Logs: ${j.url}`);
        }
      }
    }
    const pending = await github<
      { environment: { id: number; name: string }; current_user_can_approve: boolean }[]
    >(`/repos/${t.repo}/actions/runs/${t.runId}/pending_deployments`).catch(() => []);
    const waiting = pending.map((d) => ({
      environment: d.environment.name,
      id: d.environment.id,
      canApprove: d.current_user_can_approve,
    }));
    if (waiting.length && !t.waiting?.length)
      log(
        `⏸ Waiting for approval on the "${waiting.map((w) => w.environment).join(", ")}" environment.`,
      );
    t.waiting = waiting;
    await save(t);
    if (run.status === "completed") {
      const ok = run.conclusion === "success";
      log(`GitHub Actions run ${run.conclusion}: ${run.html_url}`);
      const summary = await planSummary(t.repo, t.runId).catch(() => null);
      return { ok, summary };
    }
    await sleep(5);
  }
}
