#!/usr/bin/env node
/*
 * Stages what the desktop installer bundles into desktop-dist/app (Tauri copies it into the install folder):
 * the app build (.output), the launcher, the SQL migrations, PGlite, and a Node runtime for the target CPU.
 *
 *   node scripts/stage-desktop.mjs [--arch x64|arm64]      (run `vite build` first)
 *
 * Node is the current LTS from nodejs.org, checked against its published SHA-256.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archArg = process.argv.indexOf("--arch");
const arch = archArg > 0 ? process.argv[archArg + 1] : process.arch;
if (!["x64", "arm64"].includes(arch))
  throw new Error(`Unsupported --arch ${arch}. Use x64 or arm64.`);

const out = path.join(root, "desktop-dist", "app");
const copy = (from, to = from) => {
  const src = path.join(root, from);
  if (!existsSync(src))
    throw new Error(`${from} is missing.${from === ".output" ? " Run vite build first." : ""}`);
  cpSync(src, path.join(out, to), { recursive: true });
};

rmSync(path.join(root, "desktop-dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copy(".output");
copy("desktop/launcher.mjs");
copy("db/migrations");
copy("node_modules/@electric-sql/pglite");
copy("node_modules/@electric-sql/pglite-socket");

const index = await (await fetch("https://nodejs.org/dist/index.json")).json();
const lts = index.find((r) => r.lts && r.files.includes(`win-${arch}-zip`));
if (!lts) throw new Error(`No Node LTS build for win-${arch}.`);
const name = `node-${lts.version}-win-${arch}`;
const base = `https://nodejs.org/dist/${lts.version}`;
const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const want = sums
  .split("\n")
  .find((l) => l.endsWith(`  ${name}.zip`))
  ?.split(" ")[0];
const zip = new Uint8Array(await (await fetch(`${base}/${name}.zip`)).arrayBuffer());
const got = createHash("sha256").update(zip).digest("hex");
if (!want || got !== want) throw new Error(`${name}.zip failed its SHA-256 check.`);
const files = unzipSync(zip, { filter: (f) => f.name === `${name}/node.exe` });
writeFileSync(path.join(out, "node.exe"), files[`${name}/node.exe`]);
writeFileSync(path.join(out, "NODE_VERSION"), `${lts.version} win-${arch}\n`);

console.log(`Staged desktop-dist/app with Node ${lts.version} (win-${arch}).`);
