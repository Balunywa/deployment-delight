/*
 * Recreates the isolated end-to-end database (never the demo database), applies every migration and loads the
 * demo seed, so each run starts from the same data. Used by the Playwright web server command.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL);
const name = decodeURIComponent(url.pathname.slice(1));
if (!/e2e|demo/.test(name))
  throw new Error(`Refusing to reset "${name}": the database name must contain "e2e" or "demo".`);

const admin = new pg.Client({
  host: url.searchParams.get("host") ?? url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  database: "postgres",
});
await admin.connect();
await admin.query(`drop database if exists "${name}" with (force)`);
await admin.query(`create database "${name}"`);
await admin.end();

const r = spawnSync(process.execPath, ["scripts/db.mjs", "seed"], {
  stdio: "inherit",
  env: process.env,
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`[e2e] ${name} reset and seeded`);
