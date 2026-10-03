#!/usr/bin/env node
/*
 * Cloud Delivery on the desktop. Starts everything the app needs on this PC, for this person only:
 *
 *   - the database: PostgreSQL in-process (PGlite), kept in the app's data folder, exposed only on loopback;
 *   - the app server (the same build that runs on Azure), on a random loopback port;
 *   - a gate in front of it: only the app window, which gets a per-launch secret, can use the server;
 *   - the MSX connector (beside msx-mcp), unless one is already running.
 *
 * Prints one JSON line {"event":"ready","url":...} when the window can open, then runs until stdin closes (the
 * desktop shell exits) or it's stopped. Run it directly to try the desktop build without the shell:
 *
 *   node desktop/launcher.mjs --open          (uses ./.output from `vite build`)
 *
 * Environment (set by the desktop shell; all optional here):
 *   CD_APP_DIR    folder holding .output/ (default: the repository root)
 *   CD_DATA_DIR   data folder (default: %LOCALAPPDATA%\CloudDelivery, or ~/.cloud-delivery)
 */
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.CD_APP_DIR || path.resolve(here, "..");
const DATA_DIR =
  process.env.CD_DATA_DIR ||
  (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "CloudDelivery")
    : path.join(homedir(), ".cloud-delivery"));
const SERVER = path.join(APP_DIR, ".output", "server", "index.mjs");
const CONNECTOR = path.join(APP_DIR, ".output", "public", "msx-connector.mjs");
const DB_DIR = path.join(APP_DIR, "db");
const SECRET = randomBytes(32).toString("hex");
// Between the gate and the app server: the server refuses anything without it (other programs on the PC).
const GATE_KEY = randomBytes(32).toString("hex");
const COOKIE = "cd_session";
const children = [];
const log = (...a) => console.error("[desktop]", ...a);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
      (r) => r.status < 500,
      () => false,
    );
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Runs a fixed az command (no user input) with msx-mcp's signed-in profile; Windows runs az through cmd.exe. */
function azMsx(command, ms = 10_000) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", `az ${command}`]]
      : ["az", command.split(" ")];
  return new Promise((resolve) => {
    let text = "";
    const p = spawn(cmd, args, {
      env: { ...process.env, AZURE_CONFIG_DIR: path.join(homedir(), ".azure-msx") },
      windowsHide: true,
    });
    const t = setTimeout(() => p.kill(), ms);
    p.stdout.on("data", (d) => (text += d));
    p.on("error", () => resolve(""));
    p.on("close", () => (clearTimeout(t), resolve(text.trim())));
  });
}

/**
 * Who's using the app: the Microsoft account msx-mcp signed in with (display name from Microsoft Graph, kept in
 * the data folder so later starts don't wait for it), else the Windows user.
 */
async function whoAmI() {
  const fallback = { name: userInfo().username, email: "" };
  const email = await azMsx("account show --query user.name -o tsv");
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return fallback;
  const file = path.join(DATA_DIR, "profile.json");
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // First start.
  }
  const lookUp = azMsx("ad signed-in-user show --query displayName -o tsv").then((name) => {
    if (name && !/[\r\n]/.test(name)) writeFileSync(file, JSON.stringify({ email, name }));
    return name;
  });
  if (cached?.email === email && cached.name) return { name: cached.name, email };
  return { name: (await lookUp) || email.split("@")[0], email };
}

async function startDatabase() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const dir = path.join(DATA_DIR, "db");
  mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  // PGlite is one session: one connection, so a transaction can never interleave with other queries.
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0 });
  await server.start();
  const addr = server.server?.address?.();
  const port = typeof addr === "object" && addr ? addr.port : server.port;
  return { db, server, port };
}

function startServer(port, dbPort, user) {
  const p = spawn(process.execPath, [SERVER], {
    cwd: path.dirname(SERVER),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: `postgres://postgres@127.0.0.1:${dbPort}/postgres`,
      PGSSLMODE: "disable",
      PGPOOL_MAX: "1",
      AUTO_MIGRATE: "true",
      SEED_DEMO_DATA: "false",
      DB_DIR,
      CD_DESKTOP: "1",
      CD_GATE_KEY: GATE_KEY,
      CD_DATA_DIR: DATA_DIR,
      CATALOG_USER_NAME: process.env.CATALOG_USER_NAME || user.name,
      CATALOG_USER_EMAIL: process.env.CATALOG_USER_EMAIL || user.email,
      CATALOG_USER_ROLE: process.env.CATALOG_USER_ROLE || "SE",
    },
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  children.push(p);
  p.on("exit", (code) => {
    log(`app server exited (${code})`);
    shutdown(code ?? 1);
  });
}

async function startConnector(origin) {
  const probe = () =>
    fetch("http://127.0.0.1:47615/status", {
      headers: { origin },
      signal: AbortSignal.timeout(3_000),
    }).then(
      (r) => r.status,
      () => 0,
    );
  let status = await probe();
  // An older connector that doesn't accept the desktop app: replace it with the one bundled here.
  if (status === 403) {
    await fetch("http://127.0.0.1:47615/shutdown", {
      method: "POST",
      headers: { "x-cloud-delivery": "1" },
      signal: AbortSignal.timeout(3_000),
    }).catch(() => null);
    await new Promise((r) => setTimeout(r, 800));
    status = await probe();
  }
  if (status === 200) return "running";
  if (!existsSync(CONNECTOR)) return "missing";
  const p = spawn(process.execPath, [CONNECTOR], {
    env: { ...process.env, MSX_CONNECTOR_ORIGINS: origin },
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  children.push(p);
  return "started";
}

/**
 * The gate: loopback only, this port's Host only (no DNS rebinding), and the session cookie the window got from
 * its one-time link. Everything else is refused before it reaches the app.
 */
function startGate(port, target) {
  const want = Buffer.from(SECRET);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const authed = (req) => {
    const m = /(?:^|;\s*)cd_session=([0-9a-f]{64})/.exec(req.headers.cookie ?? "");
    return !!m && timingSafeEqual(Buffer.from(m[1]), want);
  };
  const server = http.createServer((req, res) => {
    if (!hosts.has(String(req.headers.host))) {
      res.writeHead(403).end("Not allowed.");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/__cd/health") {
      http
        .get(
          { host: "127.0.0.1", port: target, path: "/", headers: { "x-cd-gate": GATE_KEY } },
          (r) => {
            r.resume();
            res.writeHead(r.statusCode && r.statusCode < 500 ? 204 : 503).end();
          },
        )
        .on("error", () => res.writeHead(503).end());
      return;
    }
    if (url.pathname === "/__cd/session") {
      const k = url.searchParams.get("k") ?? "";
      if (k.length === SECRET.length && timingSafeEqual(Buffer.from(k), want)) {
        res.writeHead(302, {
          "set-cookie": `${COOKIE}=${SECRET}; HttpOnly; SameSite=Strict; Path=/`,
          location: "/",
        });
        res.end();
      } else res.writeHead(403).end("Not allowed.");
      return;
    }
    if (!authed(req)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Open Cloud Delivery from its desktop app.");
      return;
    }
    const up = http.request(
      {
        host: "127.0.0.1",
        port: target,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${target}`, "x-cd-gate": GATE_KEY },
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

let db;
const LOCK = path.join(DATA_DIR, "app.lock");

/** One app per data folder: two would corrupt the local database. */
function lockDataDir() {
  let pid = 0;
  try {
    pid = Number(readFileSync(LOCK, "utf8"));
  } catch {
    // No lock yet.
  }
  if (pid && pid !== process.pid) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (e) {
      alive = e.code === "EPERM";
    }
    if (alive) throw new Error("Cloud Delivery is already running on this PC.");
  }
  writeFileSync(LOCK, String(process.pid));
}
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  try {
    if (Number(readFileSync(LOCK, "utf8")) === process.pid) rmSync(LOCK);
  } catch {
    // Not ours, or already gone.
  }
  try {
    await db?.server.stop();
    await db?.db.close();
  } catch {
    // Closing is best effort; PGlite keeps its files consistent.
  }
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
// The desktop shell passes --shell and holds stdin open; when it goes, so do we.
if (process.argv.includes("--shell")) {
  process.stdin.on("end", () => void shutdown(0));
  process.stdin.resume();
}

try {
  if (!existsSync(SERVER)) throw new Error(`App build not found at ${SERVER}. Run vite build.`);
  if (!existsSync(path.join(DB_DIR, "migrations")))
    throw new Error(`Database migrations not found at ${DB_DIR}.`);
  mkdirSync(DATA_DIR, { recursive: true });
  lockDataDir();
  const [user, appPort, gatePort] = await Promise.all([whoAmI(), freePort(), freePort()]);
  db = await startDatabase();
  startServer(appPort, db.port, user);
  const origin = `http://127.0.0.1:${gatePort}`;
  await startGate(gatePort, appPort);
  if (!(await waitFor(`http://127.0.0.1:${gatePort}/__cd/health`, 120_000)))
    throw new Error("The app server didn't start.");
  const msx = await startConnector(origin);
  const url = `${origin}/__cd/session?k=${SECRET}`;
  writeFileSync(path.join(DATA_DIR, "last-start.json"), JSON.stringify({ at: new Date(), msx }));
  console.log(JSON.stringify({ event: "ready", url, dataDir: DATA_DIR, user: user.name, msx }));
  if (process.argv.includes("--open")) {
    const opener =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["open", [url]];
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
  }
} catch (e) {
  console.log(JSON.stringify({ event: "error", message: e.message }));
  log(e.stack);
  await shutdown(1);
}
