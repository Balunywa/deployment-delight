/*
 * Team space: on the desktop, each SE's Cloud Delivery shares customers and engagements with their team through the
 * team's SharePoint document library (Microsoft Graph), inside the Microsoft 365 boundary, under the team's own
 * permissions. No server of ours holds anyone's data.
 *
 *   <team library>/Cloud Delivery/customers/<TPID>.json      one file per customer with a TPID
 *   <team library>/Cloud Delivery/engagements/<id>.json      one file per engagement
 *
 * Sync pulls first, then pushes. Customers merge by TPID: context entries are unioned and the latest status mark on
 * each brief item wins. Engagements are whole records: if only one side changed, it wins; if both did, the newer
 * edit wins and the conflict is counted. Only changes move: a file is uploaded when its shared content differs from
 * what was last exchanged, with If-Match so someone else's newer upload is never overwritten blindly.
 *
 * Graph access uses the Microsoft sign-in msx-mcp already holds on this PC (Azure CLI profile ~/.azure-msx); its
 * Group.ReadWrite.All covers the team's files. Tokens stay in memory.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { WorkspaceEngagement } from "./workspace";
import type { ContextEntry, CustomerProfile } from "./msx.server";
import type { EvidenceStore } from "./workspace";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const GRAPH = "https://graph.microsoft.com/v1.0";
const FOLDER = "Cloud Delivery";

export const isDesktop = () => process.env["CD_DESKTOP"] === "1";

export type TeamSetting = { groupId: string; name: string; by: string; at: string };
export type SyncResult = {
  at: string;
  pulled: number;
  pushed: number;
  conflicts: number;
  skipped: number;
  errors: string[];
};

/* ----------------------------------------------------------------------------------------------- graph */

let token: { value: string; exp: number } | null = null;

async function graphToken(): Promise<string> {
  if (token && token.exp - Date.now() > 120_000) return token.value;
  const configDir = process.env["CD_AZ_CONFIG_DIR"] || path.join(homedir(), ".azure-msx");
  const [cmd, args] =
    process.platform === "win32"
      ? [
          "cmd.exe",
          ["/d", "/s", "/c", "az account get-access-token --resource-type ms-graph -o json"],
        ]
      : ["az", ["account", "get-access-token", "--resource-type", "ms-graph", "-o", "json"]];
  const out = await new Promise<string>((resolve, reject) => {
    let text = "";
    let err = "";
    const p = spawn(cmd, args, {
      env: { ...process.env, AZURE_CONFIG_DIR: configDir },
      windowsHide: true,
    });
    const t = setTimeout(() => p.kill(), 45_000);
    p.stdout.on("data", (d) => (text += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => reject(new Error("The Azure CLI isn't installed on this PC.")));
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(text);
      else
        reject(
          new Error(
            /login|expired|AADSTS/i.test(err)
              ? "Sign in to MSX first (Onboard customer → Sign in to MSX); the team space uses the same sign-in."
              : "Couldn't get a Microsoft sign-in for the team space.",
          ),
        );
    });
  });
  const j = JSON.parse(out) as { accessToken: string; expires_on?: number; expiresOn?: string };
  const exp = j.expires_on ? j.expires_on * 1000 : new Date(j.expiresOn ?? 0).getTime();
  token = { value: j.accessToken, exp: exp || Date.now() + 30 * 60_000 };
  return token.value;
}

class GraphError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function graph(url: string, init: RequestInit = {}) {
  const r = await fetch(url.startsWith("https://") ? url : `${GRAPH}${url}`, {
    ...init,
    headers: { authorization: `Bearer ${await graphToken()}`, ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GraphError(r.status, body.error?.message ?? `Microsoft Graph answered ${r.status}.`);
  }
  return r;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/* -------------------------------------------------------------------------------------------- settings */

async function db() {
  return import("./db.server");
}

export async function getTeam(): Promise<TeamSetting | null> {
  const d = await db();
  const row = await d.maybeOne<{ value: TeamSetting }>(
    "select value from public.app_settings where key = 'team_space'",
  );
  return row?.value ?? null;
}

export async function lastSync(): Promise<SyncResult | null> {
  const d = await db();
  const row = await d.maybeOne<{ value: SyncResult }>(
    "select value from public.app_settings where key = 'team_space_last_sync'",
  );
  return row?.value ?? null;
}

async function setSetting(key: string, value: unknown) {
  const d = await db();
  await d.query(
    `insert into public.app_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** Teams (Microsoft 365 groups with a team) the signed-in person belongs to. */
export async function listTeams(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let url: string | null =
    `/me/memberOf/microsoft.graph.group?$filter=groupTypes/any(c:c eq 'Unified')&$count=true` +
    `&$select=id,displayName,resourceProvisioningOptions&$top=100`;
  for (let page = 0; url && page < 10; page++) {
    const r = await graph(url, { headers: { ConsistencyLevel: "eventual" } });
    const j = (await r.json()) as {
      value: { id: string; displayName: string; resourceProvisioningOptions?: string[] }[];
      "@odata.nextLink"?: string;
    };
    for (const g of j.value)
      if (g.resourceProvisioningOptions?.includes("Team"))
        out.push({ id: g.id, name: g.displayName });
    url = j["@odata.nextLink"] ?? null;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureFolder(groupId: string, parent: string, name: string) {
  const at = parent
    ? `/groups/${groupId}/drive/root:/${enc(parent)}:/children`
    : `/groups/${groupId}/drive/root/children`;
  try {
    await graph(at, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
  } catch (e) {
    if (!(e instanceof GraphError && e.status === 409)) throw e;
  }
}

/** Shares this PC's work with a team: creates the Cloud Delivery folder in its library (proving we can write). */
export async function chooseTeam(groupId: string, name: string, by: string) {
  try {
    await ensureFolder(groupId, "", FOLDER);
    await ensureFolder(groupId, FOLDER, "customers");
    await ensureFolder(groupId, FOLDER, "engagements");
  } catch (e) {
    if (e instanceof GraphError && (e.status === 403 || e.status === 401))
      throw new Error(
        `Your sign-in can't write to ${name}'s files. Pick a team where you're a member.`,
      );
    throw e;
  }
  const setting: TeamSetting = { groupId, name, by, at: new Date().toISOString() };
  await setSetting("team_space", setting);
  const d = await db();
  // A different team starts from scratch: nothing has been exchanged with it yet.
  await d.query("delete from public.sync_state");
  return setting;
}

export async function leaveTeam() {
  const d = await db();
  await d.query(
    "delete from public.app_settings where key in ('team_space', 'team_space_last_sync')",
  );
  await d.query("delete from public.sync_state");
}

/* ------------------------------------------------------------------------------------------- documents */

type CustomerDoc = {
  schema: 1;
  kind: "customer";
  tpid: string;
  name: string;
  msxAccountName: string | null;
  industry: string | null;
  context: ContextEntry[];
  evidence: EvidenceStore;
  updatedBy?: string;
  updatedAt?: string;
};

const ENGAGEMENT_FIELDS = [
  "name",
  "stage",
  "owner_name",
  "status",
  "origin",
  "msx_opportunity_id",
  "msx_opportunity_name",
  "brief",
  "readiness",
  "solution_map",
  "results",
  "decision",
  "sessions",
  "trail",
  "findings",
  "actions",
  "realization",
  "workspace",
  "created_at",
  "updated_at",
] as const;
const JSON_FIELDS = new Set([
  "brief",
  "readiness",
  "solution_map",
  "results",
  "decision",
  "sessions",
  "trail",
  "findings",
  "actions",
  "realization",
  "workspace",
]);
type EngagementRow = Pick<WorkspaceEngagement, (typeof ENGAGEMENT_FIELDS)[number]> & {
  id: string;
  customer_id: string | null;
};
type EngagementDoc = {
  schema: 1;
  kind: "engagement";
  id: string;
  customer: { tpid: string; name: string } | null;
  row: Omit<EngagementRow, "id" | "customer_id">;
  updatedBy?: string;
};

/** Stable JSON: keys sorted, so the same content always hashes the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
/** What's shared, without who uploaded it and when: two identical records hash the same. */
function contentHash(doc: CustomerDoc | EngagementDoc) {
  const { updatedBy: _b, ...rest } = doc as CustomerDoc;
  const { updatedAt: _a, ...shared } = rest;
  return createHash("sha256").update(stable(shared)).digest("hex");
}

function customerDoc(c: CustomerProfile): CustomerDoc {
  return {
    schema: 1,
    kind: "customer",
    tpid: c.tpid!,
    name: c.name,
    msxAccountName: c.msx_account_name,
    industry: c.industry,
    context: c.context ?? [],
    evidence: c.evidence ?? {},
  };
}

function engagementDoc(
  e: EngagementRow,
  customer: { tpid: string | null; name: string } | null,
): EngagementDoc {
  const { id, customer_id: _c, ...row } = e;
  return {
    schema: 1,
    kind: "engagement",
    id,
    customer: customer?.tpid ? { tpid: customer.tpid, name: customer.name } : null,
    row,
  };
}

/** Unions context by entry; the newest MSX snapshot stays the only snapshot; the latest status mark wins. */
function mergeCustomer(local: CustomerDoc, remote: CustomerDoc): CustomerDoc {
  const byId = new Map<string, ContextEntry>();
  for (const e of [...local.context, ...remote.context]) if (!byId.has(e.id)) byId.set(e.id, e);
  let context = [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
  const snaps = context.filter((e) => e.msx);
  if (snaps.length > 1) {
    const keep = snaps.reduce((a, b) => (a.at > b.at ? a : b));
    context = context.filter((e) => !e.msx || e === keep);
  }
  const marks = { ...(remote.evidence.marks ?? {}) };
  for (const [k, m] of Object.entries(local.evidence.marks ?? {}))
    if (!marks[k] || marks[k]!.at < m.at) marks[k] = m;
  const items = new Map((remote.evidence.items ?? []).map((i) => [i.id, i]));
  for (const i of local.evidence.items ?? []) items.set(i.id, i);
  return {
    ...local,
    msxAccountName: local.msxAccountName ?? remote.msxAccountName,
    industry: local.industry ?? remote.industry,
    context,
    evidence: { marks, items: [...items.values()] },
  };
}

/* ------------------------------------------------------------------------------------------------ sync */

/*
 * Each record is a .json file in the team's library (readable in SharePoint) whose document is also kept in the
 * file's Description column (_ExtendedDescription). Sync reads that column with the folder listing: the Microsoft
 * tenant blocks downloading file content with this sign-in, but list fields come back as plain Graph JSON.
 * Writing the column changes the file's eTag, which is what sync compares.
 */
type RemoteFile = { id: string; name: string; eTag: string; doc: string | null };
type State = {
  kind: string;
  local_id: string;
  remote_name: string;
  etag: string | null;
  local_hash: string | null;
};

async function listFolder(groupId: string, sub: string): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  let url: string | null =
    `/groups/${groupId}/drive/root:/${enc(`${FOLDER}/${sub}`)}:/children` +
    `?$select=id,name,eTag,file&$top=200&$expand=listItem($select=id;$expand=fields($select=${DOC_FIELD}))`;
  while (url) {
    const r = await graph(url);
    const j = (await r.json()) as {
      value: {
        id: string;
        name: string;
        eTag: string;
        file?: unknown;
        listItem?: { fields?: Record<string, unknown> };
      }[];
      "@odata.nextLink"?: string;
    };
    for (const f of j.value) {
      if (!f.file || !f.name.endsWith(".json")) continue;
      const doc = f.listItem?.fields?.[DOC_FIELD];
      out.push({
        id: f.id,
        name: f.name,
        eTag: f.eTag,
        doc: typeof doc === "string" && doc ? doc : null,
      });
    }
    url = j["@odata.nextLink"] ?? null;
  }
  return out;
}

const DOC_FIELD = "_ExtendedDescription";
// SharePoint HTML-encodes text in that column (even ":"), so the document is stored as base64url behind a
// letters-only version tag, and entities are decoded on read.
const DOC_PREFIX = "cdv1";

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

function parseDoc<T>(f: RemoteFile): T | null {
  // Empty while another SE's upload is between its two writes, or written by an older version.
  const raw = f.doc ? decodeEntities(f.doc) : "";
  if (!raw.startsWith(DOC_PREFIX)) return null;
  return JSON.parse(Buffer.from(raw.slice(DOC_PREFIX.length), "base64url").toString("utf8")) as T;
}

async function upload(groupId: string, file: string, doc: unknown, etag: string | null) {
  const text = JSON.stringify(doc, null, 2);
  const r = await graph(`/groups/${groupId}/drive/root:/${enc(`${FOLDER}/${file}`)}:/content`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(etag ? { "if-match": etag } : {}) },
    body: text,
  });
  const { id } = (await r.json()) as { id: string };
  await graph(`/groups/${groupId}/drive/items/${id}/listItem/fields`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      [DOC_FIELD]: DOC_PREFIX + Buffer.from(text, "utf8").toString("base64url"),
    }),
  });
  const item = await graph(`/groups/${groupId}/drive/items/${id}?$select=eTag`);
  return ((await item.json()) as { eTag: string }).eTag;
}

let running: Promise<SyncResult> | null = null;

/** One sync at a time: a second request while one runs gets that run's result. */
export function syncNow(by: string): Promise<SyncResult> {
  running ??= runSync(by).finally(() => {
    running = null;
  });
  return running;
}

async function runSync(by: string): Promise<SyncResult> {
  const team = await getTeam();
  if (!team) throw new Error("Choose a team in Settings first.");
  const d = await db();
  const m = await import("./msx.server");
  const result: SyncResult = {
    at: new Date().toISOString(),
    pulled: 0,
    pushed: 0,
    conflicts: 0,
    skipped: 0,
    errors: [],
  };
  const states = await d.query<State>("select * from public.sync_state");
  const stateOf = (kind: string, name: string) =>
    states.find((s) => s.kind === kind && s.remote_name === name);
  const saveState = (kind: string, localId: string, name: string, etag: string, hash: string) =>
    d.query(
      `insert into public.sync_state (kind, local_id, remote_name, etag, local_hash, synced_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (kind, local_id) do update set remote_name = excluded.remote_name, etag = excluded.etag,
         local_hash = excluded.local_hash, synced_at = now()`,
      [kind, localId, name, etag, hash],
    );
  // A file without a readable document (an older version wrote it, or an upload was cut off between its two
  // writes) is uploaded again by whoever has it, over the file's current version.
  const needsUpload = (kind: string, f: RemoteFile) =>
    d.query(
      "update public.sync_state set local_hash = null, etag = $3 where kind = $1 and remote_name = $2",
      [kind, f.name, f.eTag],
    );

  const findByTpid = async (tpid: string) => (await m.findCustomers({ tpid }))[0] ?? null;
  async function writeCustomer(id: string, doc: CustomerDoc) {
    await d.query(
      `update public.customers set context = $1::jsonb, evidence = $2::jsonb,
         msx_account_name = coalesce(msx_account_name, $3), industry = coalesce(industry, $4)
       where id = $5 and organization_id = $6`,
      [
        JSON.stringify(doc.context),
        JSON.stringify(doc.evidence),
        doc.msxAccountName,
        doc.industry,
        id,
        ORG_ID,
      ],
    );
  }
  async function customerFor(doc: { tpid: string; name: string }) {
    const found = await findByTpid(doc.tpid);
    if (found) return found;
    return (await m.upsertCustomer({ tpid: doc.tpid, name: doc.name, by })).customer;
  }

  /* 1. Pull customers. */
  for (const f of await listFolder(team.groupId, "customers")) {
    try {
      const st = stateOf("customer", f.name);
      const remote = parseDoc<CustomerDoc>(f);
      if (!remote) {
        if (st) await needsUpload("customer", f);
        continue;
      }
      if (st?.etag === f.eTag) continue;
      if (remote.kind !== "customer" || !/^\d{3,12}$/.test(remote.tpid)) continue;
      const local = await customerFor(remote);
      const merged = mergeCustomer(customerDoc(local), remote);
      await writeCustomer(local.id, merged);
      // What's on the server now; if the merge added local items, the push step uploads them.
      await saveState("customer", local.id, f.name, f.eTag, contentHash(remote));
      result.pulled++;
    } catch (e) {
      result.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }

  /* 2. Pull engagements. */
  const localEngagement = async (id: string) => {
    const row = await d.maybeOne<
      EngagementRow & { tpid: string | null; customer_name: string | null }
    >(
      `select e.id, e.customer_id, ${ENGAGEMENT_FIELDS.map((f) => `e.${f}`).join(", ")}, c.tpid, c.name as customer_name
       from public.engagements e left join public.customers c on c.id = e.customer_id where e.id = $1`,
      [id],
    );
    if (!row) return null;
    const { tpid, customer_name, ...rest } = row;
    return engagementDoc(rest, customer_name ? { tpid, name: customer_name } : null);
  };
  for (const f of await listFolder(team.groupId, "engagements")) {
    try {
      const st = stateOf("engagement", f.name);
      const remote = parseDoc<EngagementDoc>(f);
      if (!remote) {
        if (st) await needsUpload("engagement", f);
        continue;
      }
      if (st?.etag === f.eTag) continue;
      if (remote.kind !== "engagement" || !/^[0-9a-f-]{36}$/.test(remote.id)) continue;
      const local = await localEngagement(remote.id);
      if (local) {
        const localChanged = !!st?.local_hash && contentHash(local) !== st.local_hash;
        if (localChanged) {
          result.conflicts++;
          // Both changed since the last exchange: the newer edit wins; the older stays in the file's version history.
          if (local.row.updated_at >= remote.row.updated_at) {
            await saveState("engagement", remote.id, f.name, f.eTag, contentHash(remote));
            continue;
          }
        }
      }
      const customerId = remote.customer ? (await customerFor(remote.customer)).id : null;
      const cols = ["id", "organization_id", "customer_id", ...ENGAGEMENT_FIELDS];
      const vals = [
        remote.id,
        ORG_ID,
        customerId,
        ...ENGAGEMENT_FIELDS.map((k) => {
          const v = remote.row[k as keyof typeof remote.row];
          return JSON_FIELDS.has(k) ? (v == null ? null : JSON.stringify(v)) : v;
        }),
      ];
      await d.query(
        `insert into public.engagements (${cols.join(", ")})
         values (${cols.map((c, i) => `$${i + 1}${JSON_FIELDS.has(c) ? "::jsonb" : ""}`).join(", ")})
         on conflict (id) do update set ${cols
           .filter((c) => c !== "id" && c !== "organization_id")
           .map((c) => `${c} = excluded.${c}`)
           .join(", ")}`,
        vals,
      );
      await saveState("engagement", remote.id, f.name, f.eTag, contentHash(remote));
      result.pulled++;
    } catch (e) {
      result.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }

  /* 3. Push what changed here. */
  const fresh = await d.query<State>("select * from public.sync_state");
  const pushOne = async (
    kind: "customer" | "engagement",
    localId: string,
    name: string,
    doc: CustomerDoc | EngagementDoc,
  ) => {
    const hash = contentHash(doc);
    const st = fresh.find((s) => s.kind === kind && s.local_id === localId);
    if (st?.local_hash === hash) {
      result.skipped++;
      return;
    }
    try {
      const etag = await upload(
        team.groupId,
        `${kind}s/${name}`,
        { ...doc, updatedBy: by, updatedAt: new Date().toISOString() },
        st?.etag ?? null,
      );
      await saveState(kind, localId, name, etag, hash);
      result.pushed++;
    } catch (e) {
      // Someone uploaded a newer version since our pull: the next sync merges it first.
      if (e instanceof GraphError && e.status === 412) result.conflicts++;
      else result.errors.push(`${name}: ${(e as Error).message}`);
    }
  };
  const customers = await d.query<CustomerProfile>(
    `select c.id, c.name, c.customer_code, c.tpid, c.msx_account_name, c.industry, c.context, c.evidence, 0 as engagements
     from public.customers c where c.organization_id = $1 and c.tpid is not null`,
    [ORG_ID],
  );
  for (const c of customers) await pushOne("customer", c.id, `${c.tpid}.json`, customerDoc(c));
  const engagements = await d.query<
    EngagementRow & { tpid: string | null; customer_name: string | null }
  >(
    `select e.id, e.customer_id, ${ENGAGEMENT_FIELDS.map((f) => `e.${f}`).join(", ")}, c.tpid, c.name as customer_name
     from public.engagements e left join public.customers c on c.id = e.customer_id where e.organization_id = $1`,
    [ORG_ID],
  );
  for (const e of engagements) {
    const { tpid, customer_name, ...row } = e;
    await pushOne(
      "engagement",
      e.id,
      `${e.id}.json`,
      engagementDoc(row, customer_name ? { tpid, name: customer_name } : null),
    );
  }

  await setSetting("team_space_last_sync", result);
  await d.insert("audit_events", {
    organization_id: ORG_ID,
    actor_name: by,
    event_type: "team.synced",
    resource_type: "team",
    resource_id: team.groupId,
    new_value: {
      pulled: result.pulled,
      pushed: result.pushed,
      conflicts: result.conflicts,
    } as never,
    result: result.errors.length ? "partial" : "success",
    metadata_json: { team: team.name } as never,
  });
  return result;
}
