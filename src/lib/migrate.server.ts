/*
 * Applies db/migrations (and, when SEED_DEMO_DATA=true, db/seed into an empty database) on first use.
 * Enabled with AUTO_MIGRATE=true so a one-click Azure deployment needs no manual database step.
 * A Postgres advisory lock keeps concurrent instances from migrating at the same time.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

const LOCK_ID = 7_302_451;

async function sqlFiles(dir: string) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return [];
  }
}

export async function migrate(pool: pg.Pool) {
  const root = process.env["DB_DIR"] ?? path.join(process.cwd(), "db");
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(
      "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const applied = new Set(
      (await client.query<{ name: string }>("select name from public.schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );
    for (const file of await sqlFiles(path.join(root, "migrations"))) {
      if (applied.has(file)) continue;
      await client.query("begin");
      try {
        await client.query(await readFile(path.join(root, "migrations", file), "utf8"));
        await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`[db] applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    if (/^true$/i.test(process.env["SEED_DEMO_DATA"] ?? "")) {
      // Each seed runs once, tracked as "seed/<file>". A database seeded before tracking existed already
      // has the base data, so the first seed is recorded rather than re-run.
      const seeded = new Set(
        (
          await client.query<{ name: string }>(
            "select name from public.schema_migrations where name like 'seed/%'",
          )
        ).rows.map((r) => r.name),
      );
      const files = await sqlFiles(path.join(root, "seed"));
      for (const [i, file] of files.entries()) {
        const key = `seed/${file}`;
        if (seeded.has(key)) continue;
        if (i === 0) {
          const { rows } = await client.query<{ n: number }>(
            "select count(*)::int as n from public.organizations",
          );
          if ((rows[0]?.n ?? 0) > 0) {
            await client.query("insert into public.schema_migrations (name) values ($1)", [key]);
            continue;
          }
        }
        await client.query("begin");
        try {
          await client.query(await readFile(path.join(root, "seed", file), "utf8"));
          await client.query("insert into public.schema_migrations (name) values ($1)", [key]);
          await client.query("commit");
          console.log(`[db] seeded ${file}`);
        } catch (err) {
          await client.query("rollback");
          throw err;
        }
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
