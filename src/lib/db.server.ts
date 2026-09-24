/*
 * PostgreSQL access for the control plane. Targets Azure Database for PostgreSQL Flexible Server.
 *
 * Configuration (standard libpq variables are honoured):
 *   DATABASE_URL                     postgres://user:pass@host:5432/db   (or PGHOST/PGUSER/PGDATABASE/PGPASSWORD/PGPORT)
 *   AZURE_POSTGRES_ENTRA_AUTH=true   authenticate with a Microsoft Entra token (managed identity /
 *                                    workload identity / az login) instead of a password
 *   PGSSLMODE=disable                only for local development; TLS is required otherwise on Azure
 */
import pg from "pg";

const ENTRA_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

// Numeric → number, bigint → number, timestamps → ISO strings, matching what the UI expects.
// Guarded so module re-evaluation (dev hot reload) never wraps the parser twice.
const TYPES_SET = Symbol.for("cloud-delivery.pg-types");
const g = globalThis as { [TYPES_SET]?: boolean };
if (!g[TYPES_SET]) {
  const parseTimestamptz = pg.types.getTypeParser(1184);
  pg.types.setTypeParser(1700, (v) => Number(v));
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1184, (v) => (parseTimestamptz(v) as Date).toISOString());
  g[TYPES_SET] = true;
}

let pool: pg.Pool | undefined;

async function entraPassword() {
  const { DefaultAzureCredential } = await import("@azure/identity");
  const credential = new DefaultAzureCredential();
  return async () => (await credential.getToken(ENTRA_SCOPE)).token;
}

export async function db() {
  if (pool) return pool;
  const url = process.env["DATABASE_URL"];
  const host = url ? new URL(url).hostname : (process.env["PGHOST"] ?? "localhost");
  const azure = host.endsWith(".postgres.database.azure.com");
  const sslDisabled = process.env["PGSSLMODE"] === "disable";
  const entra = process.env["AZURE_POSTGRES_ENTRA_AUTH"] === "true";

  pool = new pg.Pool({
    ...(url ? { connectionString: url } : {}),
    ...(entra ? { password: await entraPassword() } : {}),
    ssl: sslDisabled ? false : azure ? { rejectUnauthorized: true } : undefined,
    max: Number(process.env["PGPOOL_MAX"] ?? 10),
  });
  // Idle connections can be terminated by the server (maintenance, failover). Log and let the pool reconnect.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await (await db()).query(text, params.map(toParam));
  return result.rows as T[];
}

export async function maybeOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  const row = await maybeOne<T>(text, params);
  if (!row) throw new Error("Record not found");
  return row;
}

/** Plain objects are sent as JSON (jsonb columns); arrays stay Postgres arrays (uuid[] / text[]). */
function toParam(v: unknown) {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date))
    return JSON.stringify(v);
  return v;
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
};

export async function insert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const sql = `insert into public.${ident(table)} (${cols.map(ident).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return one<T>(
    sql,
    cols.map((c) => row[c]),
  );
}

export async function insertMany<T = Record<string, unknown>>(
  table: string,
  rows: Record<string, unknown>[],
): Promise<T[]> {
  const out: T[] = [];
  for (const row of rows) out.push(await insert<T>(table, row));
  return out;
}

export async function update<T = Record<string, unknown>>(
  table: string,
  patch: Record<string, unknown>,
  where: Record<string, unknown>,
): Promise<T[]> {
  const set = Object.keys(patch).filter((k) => patch[k] !== undefined);
  const keys = Object.keys(where);
  const sql = `update public.${ident(table)} set ${set.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ")} where ${keys
    .map((c, i) => `${ident(c)} = $${set.length + i + 1}`)
    .join(" and ")} returning *`;
  return query<T>(sql, [...set.map((c) => patch[c]), ...keys.map((c) => where[c])]);
}
