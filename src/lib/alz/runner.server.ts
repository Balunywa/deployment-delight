/*
 * Runs the generated platform landing zone Terraform for real: plan, apply and destroy, with live logs.
 * Server-only. One run per foundation at a time; state lives next to the configuration in a persistent folder
 * (/home on App Service), so later plans and destroys see what was deployed.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { deployClientId, federatedAssertion, whoAmI } from "./arm.server";

const TF_VERSION = "1.13.4";
const home = () =>
  process.env["CD_DATA_DIR"] ??
  (process.env["IDENTITY_ENDPOINT"]
    ? "/home/cloud-delivery"
    : path.join(os.tmpdir(), "cloud-delivery"));

export const workDir = (foundationId: string) => path.join(home(), "foundations", foundationId);

async function which(bin: string) {
  return new Promise<string | null>((resolve) => {
    const p = spawn(process.platform === "win32" ? "where" : "which", [bin]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve(code === 0 ? out.trim().split("\n")[0]! : null));
    p.on("error", () => resolve(null));
  });
}

/** Terraform on PATH, TERRAFORM_PATH, or downloaded once from releases.hashicorp.com. */
export async function terraformBinary(log: (l: string) => void) {
  const configured = process.env["TERRAFORM_PATH"];
  if (configured && existsSync(configured)) return configured;
  const onPath = await which("terraform");
  if (onPath) return onPath;
  const dir = path.join(home(), "tools", `terraform-${TF_VERSION}`);
  const bin = path.join(dir, "terraform");
  if (existsSync(bin)) return bin;
  const osName = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const url = `https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_${osName}_${arch}.zip`;
  log(`Downloading Terraform ${TF_VERSION} (${osName}/${arch})…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download Terraform: ${res.status}`);
  const { unzipSync } = await import("fflate");
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  await mkdir(dir, { recursive: true });
  await writeFile(bin, files["terraform"]!);
  await chmod(bin, 0o755);
  return bin;
}

/** Terraform fetches modules and the ALZ Library with git. App Service's Node image doesn't ship it. */
async function ensureGit(log: Logger) {
  if (await which("git")) return;
  if (!(await which("apt-get")))
    throw new Error("git isn't installed and can't be installed here. Install git on this host.");
  log("Installing git (one time per app restart)…");
  const sh = (cmd: string) =>
    new Promise<number>((resolve) => {
      const p = spawn("sh", ["-c", cmd], {
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      });
      p.stdout.on("data", () => {});
      p.stderr.on("data", (d) => log(String(d).trim()));
      p.on("close", (c) => resolve(c ?? 1));
    });
  const code = await sh(
    "apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates",
  );
  if (code !== 0 || !(await which("git"))) throw new Error("Installing git failed.");
  log("git installed.");
}

/** Environment Terraform authenticates with — the same identity as the app's own Azure calls. */
async function authEnv(): Promise<Record<string, string>> {
  const me = await whoAmI();
  const env: Record<string, string> = { ARM_TENANT_ID: me.tenantId };
  if (!process.env["IDENTITY_ENDPOINT"]) {
    // Local runs use the Azure CLI sign-in; refresh it so subscriptions created a moment ago are known.
    const az = await which("az");
    if (az)
      await new Promise((resolve) =>
        spawn(az, ["account", "list", "--refresh", "--only-show-errors", "-o", "none"]).on(
          "close",
          resolve,
        ),
      );
  }
  if (process.env["IDENTITY_ENDPOINT"]) {
    if (!deployClientId())
      throw new Error(
        "DEPLOY_CLIENT_ID isn't set: on App Service, Terraform deploys as an app registration that trusts the web app's managed identity.",
      );
    Object.assign(env, {
      ARM_USE_OIDC: "true",
      ARM_OIDC_TOKEN: await federatedAssertion(),
      ARM_CLIENT_ID: deployClientId(),
      ARM_USE_CLI: "false",
      ARM_USE_MSI: "false",
    });
  }
  return env;
}

type Logger = (line: string) => void;

function run(bin: string, args: string[], cwd: string, env: Record<string, string>, log: Logger) {
  return new Promise<number>((resolve, reject) => {
    log(`$ terraform ${args.join(" ")}`);
    const p = spawn(bin, args, { cwd, env: { ...process.env, ...env } });
    const pipe = (d: Buffer) =>
      d
        .toString()
        .split("\n")
        .filter((l) => l.trim())
        .forEach((l) => log(l));
    p.stdout.on("data", pipe);
    p.stderr.on("data", pipe);
    p.on("error", reject);
    p.on("close", (code) => resolve(code ?? 1));
  });
}

async function capture(bin: string, args: string[], cwd: string, env: Record<string, string>) {
  return new Promise<string>((resolve, reject) => {
    const p = spawn(bin, args, { cwd, env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.slice(-800)))));
  });
}

export type PlanSummary = {
  add: number;
  change: number;
  destroy: number;
  byType: Record<string, number>;
  managementGroups: string[];
  policyAssignments: number;
  roleAssignments: number;
};

function summarize(plan: {
  resource_changes?: {
    type: string;
    change: { actions: string[]; after?: Record<string, unknown> };
  }[];
}): PlanSummary {
  const s: PlanSummary = {
    add: 0,
    change: 0,
    destroy: 0,
    byType: {},
    managementGroups: [],
    policyAssignments: 0,
    roleAssignments: 0,
  };
  for (const r of plan.resource_changes ?? []) {
    const a = r.change.actions;
    if (a.includes("no-op") || a.includes("read")) continue;
    if (a.includes("create")) s.add++;
    if (a.includes("update")) s.change++;
    if (a.includes("delete")) s.destroy++;
    const body = (r.change.after?.["body"] ?? {}) as Record<string, unknown>;
    const type =
      r.type === "azapi_resource"
        ? String(r.change.after?.["type"] ?? "azapi_resource").split("@")[0]!
        : r.type;
    s.byType[type] = (s.byType[type] ?? 0) + 1;
    if (type === "Microsoft.Management/managementGroups" && a.includes("create"))
      s.managementGroups.push(String(r.change.after?.["name"] ?? ""));
    if (type.endsWith("policyAssignments")) s.policyAssignments++;
    if (type.endsWith("roleAssignments")) s.roleAssignments++;
    void body;
  }
  return s;
}

export async function writeConfig(
  foundationId: string,
  files: { path: string; content: string }[],
  vars: Record<string, unknown>,
) {
  const dir = workDir(foundationId);
  await mkdir(dir, { recursive: true });
  // Replace generated files; keep state, lock file, provider cache and the saved plan.
  for (const f of await readdir(dir).catch(() => [] as string[]))
    if (f.endsWith(".tf") || f === "lib")
      await rm(path.join(dir, f), { recursive: true, force: true });
  for (const f of files) {
    const p = path.join(dir, f.path);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, f.content);
  }
  await writeFile(path.join(dir, "cloud-delivery.auto.tfvars.json"), JSON.stringify(vars, null, 2));
  return dir;
}

/** Adopts a resource Azure created but Terraform lost track of (create succeeded, read-back failed). */
export async function importResource(
  foundationId: string,
  address: string,
  id: string,
  log: Logger,
) {
  const dir = workDir(foundationId);
  const bin = await terraformBinary(log);
  const env = {
    ...(await authEnv()),
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    TF_PLUGIN_CACHE_DIR: path.join(home(), "plugin-cache"),
    TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE: "true",
    CHECKPOINT_DISABLE: "1",
  };
  return (
    (await run(
      bin,
      ["import", "-input=false", "-no-color", "-lock-timeout=60s", address, id],
      dir,
      env,
      log,
    )) === 0
  );
}

export async function terraform(
  action: "plan" | "apply" | "destroy",
  foundationId: string,
  log: Logger,
): Promise<{ ok: boolean; summary: PlanSummary | Record<string, unknown> }> {
  const dir = workDir(foundationId);
  const bin = await terraformBinary(log);
  await ensureGit(log);
  const cache = path.join(home(), "plugin-cache");
  await mkdir(cache, { recursive: true });
  const env = {
    ...(await authEnv()),
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    TF_PLUGIN_CACHE_DIR: cache,
    TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE: "true",
    CHECKPOINT_DISABLE: "1",
  };
  if (action !== "apply") {
    const init = await run(bin, ["init", "-input=false", "-no-color"], dir, env, log);
    if (init !== 0) return { ok: false, summary: { stage: "init" } };
  }
  if (action === "plan") {
    const code = await run(
      bin,
      ["plan", "-input=false", "-no-color", "-lock-timeout=60s", "-out=tfplan"],
      dir,
      env,
      log,
    );
    if (code !== 0) return { ok: false, summary: { stage: "plan" } };
    const json = await capture(bin, ["show", "-json", "tfplan"], dir, env);
    return { ok: true, summary: summarize(JSON.parse(json)) };
  }
  if (action === "apply") {
    if (!existsSync(path.join(dir, "tfplan"))) {
      log("No saved plan. Run a plan first.");
      return { ok: false, summary: { stage: "apply" } };
    }
    const code = await run(
      bin,
      ["apply", "-input=false", "-no-color", "-lock-timeout=60s", "-parallelism=20", "tfplan"],
      dir,
      env,
      log,
    );
    await rm(path.join(dir, "tfplan"), { force: true });
    return { ok: code === 0, summary: { stage: "apply" } };
  }
  const code = await run(
    bin,
    [
      "destroy",
      "-input=false",
      "-no-color",
      "-auto-approve",
      "-lock-timeout=60s",
      "-parallelism=20",
    ],
    dir,
    env,
    log,
  );
  return { ok: code === 0, summary: { stage: "destroy" } };
}
