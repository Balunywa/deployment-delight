#!/usr/bin/env node
/*
 * Cloud Delivery MSX connector. Runs on the SE's own PC, beside msx-mcp, so the Cloud Delivery web app can read MSX
 * as that person without ever holding MSX credentials. The browser calls it on http://127.0.0.1:47615; it answers
 * only Cloud Delivery's origins, only a few fixed read-only questions (account and open opportunities by TPID),
 * and asks msx-mcp (github.com/mcaps-microsoft/msx-mcp) for the data. No dependencies beyond Node 22.
 *
 *   node msx-connector.mjs              run it (leave the window open)
 *   node msx-connector.mjs --install    Windows: also start it, hidden, whenever you sign in
 *   node msx-connector.mjs --uninstall  Windows: stop starting it at sign-in
 *
 * Environment (all optional):
 *   MSX_MCP_PATH            msx-mcp's msx server (default ~/msx-mcp/bundle/msx.mjs)
 *   MSX_CONNECTOR_PORT      default 47615
 *   MSX_CONNECTOR_ORIGINS   extra allowed web origins, comma-separated
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1";
const PORT = Number(process.env.MSX_CONNECTOR_PORT || 47615);
const MSX_MCP = process.env.MSX_MCP_PATH || path.join(homedir(), "msx-mcp", "bundle", "msx.mjs");
const ORIGINS = new Set([
  "https://clouddelivery-nzdefv.azurewebsites.net",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.MSX_CONNECTOR_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
]);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const TPID = /^\d{3,12}$/;
const F = "@OData.Community.Display.V1.FormattedValue";

/* ------------------------------------------------------------------------- start at Windows sign-in */

const STARTUP = path.join(
  process.env.APPDATA ?? "",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup",
  "cloud-delivery-msx-connector.vbs",
);
const HOME_COPY = path.join(
  process.env.LOCALAPPDATA ?? homedir(),
  "CloudDelivery",
  "msx-connector.mjs",
);

const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = () =>
  fetch(`${BASE}/status`, { signal: AbortSignal.timeout(60_000) }).then(
    (r) => r.ok,
    () => false,
  );

/** Stops a connector already running (an older version, say), so the installed one takes its place. */
async function stopRunning() {
  const r = await fetch(`${BASE}/shutdown`, {
    method: "POST",
    headers: { "x-cloud-delivery": "1" },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!r) return;
  for (let i = 0; i < 20; i++) {
    const up = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(1_000) }).then(
      () => true,
      () => false,
    );
    if (!up) return;
    await sleep(250);
  }
}

const CLI = process.argv.includes("--install") || process.argv.includes("--uninstall");

/*
 * Install or uninstall, then end. Never process.exit() after a fetch here: on Windows that can crash Node on the way
 * out (libuv "UV_HANDLE_CLOSING" assertion), which turns success into an error code.
 */
async function cli() {
  if (process.platform !== "win32") {
    console.log("--install is for Windows. Elsewhere, start it from your login items.");
    return 1;
  }
  await stopRunning();
  if (process.argv.includes("--uninstall")) {
    rmSync(STARTUP, { force: true });
    console.log("Stopped, and it no longer starts when you sign in to Windows.");
    return 0;
  }
  mkdirSync(path.dirname(HOME_COPY), { recursive: true });
  const self = fileURLToPath(import.meta.url);
  if (path.resolve(self) !== path.resolve(HOME_COPY)) copyFileSync(self, HOME_COPY);
  // A hidden window: the connector has nothing to show.
  const q = (s) => `""${s}""`;
  mkdirSync(path.dirname(STARTUP), { recursive: true });
  writeFileSync(
    STARTUP,
    `CreateObject("WScript.Shell").Run "${q(process.execPath)} ${q(HOME_COPY)}", 0, False\r\n`,
  );
  spawn("wscript.exe", [STARTUP], { detached: true, stdio: "ignore" }).unref();
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await sleep(500);
    up = await alive();
  }
  console.log(
    up
      ? `Installed and running: ${HOME_COPY}\nIt starts whenever you sign in to Windows.`
      : `Installed (${HOME_COPY}), but it didn't answer yet. Sign out and in, or run: node "${HOME_COPY}"`,
  );
  if (!existsSync(MSX_MCP)) console.log(`Note: msx-mcp isn't at ${MSX_MCP} yet.`);
  return up ? 0 : 1;
}

if (CLI) process.exitCode = await cli();

/* ------------------------------------------------------------------ msx-mcp over stdio (MCP JSON-RPC) */

let child = null;
let ready = null;
let nextId = 1;
const pending = new Map();

function start() {
  if (ready) return ready;
  if (!existsSync(MSX_MCP))
    return Promise.reject(
      Object.assign(new Error(`msx-mcp not found at ${MSX_MCP}. Set MSX_MCP_PATH.`), {
        code: "MSX_MCP_MISSING",
      }),
    );
  child = spawn(process.execPath, [MSX_MCP], {
    stdio: ["pipe", "pipe", "pipe"],
    // Reads never open a browser on their own; signing in is an explicit click in the app.
    env: { ...process.env, MSX_MCP_DATAVERSE_AUTH_MODE: "silent" },
  });
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      const p = m.id != null && pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message || "msx-mcp error"));
        else p.resolve(m.result);
      }
    }
  });
  child.stderr.on("data", () => {});
  child.on("exit", () => {
    for (const p of pending.values()) p.reject(new Error("msx-mcp stopped."));
    pending.clear();
    child = null;
    ready = null;
  });
  ready = rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "cloud-delivery-msx-connector", version: VERSION },
  }).then(() => notify("notifications/initialized"));
  ready.catch(() => (ready = null));
  return ready;
}

function rpc(method, params, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error("MSX took too long to answer."), { code: "TIMEOUT" }));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => (clearTimeout(timer), resolve(v)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
}

async function tool(name, args = {}, timeoutMs) {
  await start();
  const r = await rpc("tools/call", { name, arguments: args }, timeoutMs);
  const s = r?.structuredContent;
  if (r?.isError || (s && s.ok === false)) {
    const e = s?.error;
    throw Object.assign(new Error(e?.message || r?.content?.[0]?.text || "MSX request failed."), {
      code: e?.code || "MSX_ERROR",
    });
  }
  return s ?? {};
}

/* ------------------------------------------------------------------------------- the fixed questions */

async function status() {
  try {
    const d = (await tool("msx_auth_status", {}, 45_000)).data ?? {};
    return {
      connector: VERSION,
      msx: d.status === "ready" ? "ready" : d.signInRequired ? "signed-out" : "error",
      detail: d.status === "ready" ? null : (d.failure?.message ?? d.status ?? null),
    };
  } catch (e) {
    return { connector: VERSION, msx: "error", detail: e.message, code: e.code ?? null };
  }
}

const fv = (r, k) => r[`${k}${F}`] ?? null;
const clip = (s, n) => (typeof s === "string" && s.trim() ? s.trim().slice(0, n) : null);

async function customer(tpid) {
  const [top, all, opps] = await Promise.all([
    tool("dataverse_query", {
      entity_set: "accounts",
      select: "accountid,name,msp_mstopparentid,statecode",
      filter: `msp_mstopparentid eq '${tpid}' and msp_parentinglevelcode eq 861980000`,
      top: 5,
    }),
    tool("dataverse_query", {
      entity_set: "accounts",
      filter: `msp_mstopparentid eq '${tpid}' and statecode eq 0`,
      count_only: true,
    }).catch(() => null),
    tool("dataverse_fetchxml", {
      entity_set: "opportunities",
      top: 50,
      fetchxml: `<fetch>
  <entity name="opportunity">
    <attribute name="opportunityid" /><attribute name="name" /><attribute name="msp_opportunitynumber" />
    <attribute name="msp_activesalesstage" /><attribute name="estimatedclosedate" /><attribute name="createdon" />
    <attribute name="msp_solutionarea" /><attribute name="msp_salesplay" /><attribute name="msp_forecastcomments" />
    <attribute name="description" /><attribute name="ownerid" /><attribute name="parentaccountid" />
    <order attribute="modifiedon" descending="true" />
    <filter><condition attribute="statecode" operator="eq" value="0" /></filter>
    <link-entity name="account" from="accountid" to="parentaccountid" alias="acct">
      <filter><condition attribute="msp_mstopparentid" operator="eq" value="${tpid}" /></filter>
    </link-entity>
  </entity>
</fetch>`,
    }),
  ]);
  const account = (top.data?.records ?? [])[0] ?? null;
  // The account team on the top-parent account, when MSX lets this person see it. Optional: never fails the look-up.
  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const team =
    account && GUID.test(account.accountid)
      ? await tool("dataverse_query", {
          entity_set: "msp_accountteams",
          select: "msp_fullname,msp_rolename,msp_title,msp_qualifier1",
          filter: `_msp_accountid_value eq ${account.accountid}`,
          top: 50,
        })
          .then((r) =>
            (r.data?.records ?? [])
              .filter((m) => m.msp_fullname)
              .map((m) => ({
                name: m.msp_fullname,
                role: m.msp_rolename ?? m.msp_title ?? m.msp_qualifier1 ?? null,
              })),
          )
          .catch(() => null)
      : null;
  return {
    tpid,
    fetchedAt: new Date().toISOString(),
    account: account ? { id: account.accountid, name: account.name } : null,
    accounts: all?.meta?.totalCount ?? null,
    team,
    opportunities: (opps.data?.records ?? []).map((o) => ({
      id: o.opportunityid,
      number: o.msp_opportunitynumber ?? null,
      name: o.name,
      stage: o.msp_activesalesstage ?? null,
      solutionArea: fv(o, "msp_solutionarea"),
      salesPlay: fv(o, "msp_salesplay"),
      closeDate: o.estimatedclosedate ?? null,
      createdOn: o.createdon ?? null,
      owner: fv(o, "_ownerid_value"),
      account: fv(o, "_parentaccountid_value"),
      description: clip(o.description, 2000),
      forecastComments: clip(o.msp_forecastcomments, 1500),
    })),
  };
}

/* ------------------------------------------------------------------------------------------- server */

function send(res, origin, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
  });
  res.end(JSON.stringify(body));
}

function serve() {
  createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Only Cloud Delivery's pages may read MSX through this, and only via this host name (no DNS rebinding).
    if (!HOSTS.has(String(req.headers.host)) || (origin && !ORIGINS.has(origin)))
      return send(res, null, 403, { error: "Not allowed." });
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": origin ?? "",
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "content-type, x-cloud-delivery",
        "access-control-allow-private-network": "true",
        "access-control-max-age": "600",
        vary: "Origin",
      });
      return res.end();
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    try {
      if (req.method === "POST" && url.pathname === "/shutdown") {
        // Only a local program (an install replacing this one) can stop it: browsers always send an Origin.
        if (origin || req.headers["x-cloud-delivery"] !== "1")
          return send(res, origin, 403, { error: "Not allowed." });
        send(res, null, 200, { stopping: true });
        child?.kill();
        return setTimeout(() => process.exit(0), 100);
      }
      if (req.method === "GET" && url.pathname === "/status")
        return send(res, origin, 200, await status());
      if (req.method === "POST" && url.pathname === "/signin") {
        // A custom header forces a CORS preflight, so other sites can't trigger a sign-in window.
        if (req.headers["x-cloud-delivery"] !== "1")
          return send(res, origin, 400, { error: "Missing header." });
        await tool("msx_login", {}, 300_000);
        return send(res, origin, 200, await status());
      }
      if (req.method === "GET" && url.pathname === "/customer") {
        const tpid = url.searchParams.get("tpid") ?? "";
        if (!TPID.test(tpid)) return send(res, origin, 400, { error: "A TPID is 3 to 12 digits." });
        return send(res, origin, 200, await customer(tpid));
      }
      return send(res, origin, 404, { error: "Not found." });
    } catch (e) {
      const code = e.code ?? "MSX_ERROR";
      return send(res, origin, code === "AUTH_REQUIRED" ? 401 : 502, { error: e.message, code });
    }
  })
    .listen(PORT, "127.0.0.1", () => {
      console.log(`Cloud Delivery MSX connector on http://127.0.0.1:${PORT}`);
      console.log(
        `msx-mcp: ${MSX_MCP}${existsSync(MSX_MCP) ? "" : "  (NOT FOUND: set MSX_MCP_PATH)"}`,
      );
      console.log(`Allowed: ${[...ORIGINS].join(", ")}`);
    })
    .on("error", (e) => {
      console.error(
        e.code === "EADDRINUSE"
          ? `Already running on port ${PORT}.`
          : `Couldn't start: ${e.message}`,
      );
      process.exit(1);
    });
}

if (!CLI) serve();
