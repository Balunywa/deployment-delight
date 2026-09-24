#!/usr/bin/env node
/*
 * Applies db/migrations/*.sql in order (once each) and, with `seed`, loads db/seed/*.sql into an
 * empty database. Uses the same connection settings as the app: DATABASE_URL or PG* variables,
 * AZURE_POSTGRES_ENTRA_AUTH=true for Microsoft Entra token auth, PGSSLMODE=disable for local only.
 *
 *   node scripts/db.mjs migrate
 *   node scripts/db.mjs seed
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const command = process.argv[2] ?? "migrate";

async function connect() {
  const url = process.env.DATABASE_URL;
  const host = url ? new URL(url).hostname : (process.env.PGHOST ?? "localhost");
  const azure = host.endsWith(".postgres.database.azure.com");
  let password;
  if (/^true$/i.test(process.env.AZURE_POSTGRES_ENTRA_AUTH ?? "")) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    const credential = new DefaultAzureCredential();
    password = async () =>
      (await credential.getToken("https://ossrdbms-aad.database.windows.net/.default")).token;
  }
  // Discrete fields, not connectionString: pg would let the URL override the Entra token callback.
  const fields = url
    ? (() => {
        const u = new URL(url);
        return {
          host: u.searchParams.get("host") ?? u.hostname,
          port: u.port ? Number(u.port) : 5432,
          user: decodeURIComponent(u.username),
          database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
          ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
        };
      })()
    : {};
  const client = new pg.Client({
    ...fields,
    ...(password ? { password } : {}),
    ssl:
      process.env.PGSSLMODE === "disable"
        ? false
        : azure
          ? { rejectUnauthorized: true }
          : undefined,
  });
  await client.connect();
  return client;
}

async function files(dir) {
  return (await readdir(path.join(root, dir))).filter((f) => f.endsWith(".sql")).sort();
}

async function migrate(client) {
  await client.query(
    "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set(
    (await client.query("select name from public.schema_migrations")).rows.map((r) => r.name),
  );
  for (const file of await files("db/migrations")) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(root, "db/migrations", file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`${file}: ${err.message}`);
    }
  }
}

async function seed(client) {
  // Each seed runs once, tracked as "seed/<file>"; a database seeded before tracking keeps its base data.
  const seeded = new Set(
    (
      await client.query("select name from public.schema_migrations where name like 'seed/%'")
    ).rows.map((r) => r.name),
  );
  const list = await files("db/seed");
  for (const [i, file] of list.entries()) {
    const key = `seed/${file}`;
    if (seeded.has(key)) continue;
    if (i === 0) {
      const { rows } = await client.query("select count(*)::int as n from public.organizations");
      if (rows[0].n > 0) {
        await client.query("insert into public.schema_migrations (name) values ($1)", [key]);
        console.log(`${file}: database already has data — recorded`);
        continue;
      }
    }
    await client.query("begin");
    try {
      await client.query(await readFile(path.join(root, "db/seed", file), "utf8"));
      await client.query("insert into public.schema_migrations (name) values ($1)", [key]);
      await client.query("commit");
      console.log(`seeded ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`${file}: ${err.message}`);
    }
  }
}

const client = await connect();
try {
  if (command === "migrate") await migrate(client);
  else if (command === "seed") {
    await migrate(client);
    await seed(client);
  } else throw new Error(`Unknown command "${command}". Use migrate or seed.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
