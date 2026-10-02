/*
 * Cloud Delivery as an MCP server, to sit beside msx-mcp in Copilot (VS Code or the Copilot CLI). msx-mcp reads and
 * writes MSX as the signed-in seller or SE; these tools record the Cloud Delivery side: the customer profile keyed by
 * TPID, its context, and engagements linked to an MSX opportunity or started proactively. Cloud Delivery never
 * holds MSX credentials.
 *
 * Streamable HTTP, stateless: every POST is one JSON-RPC message answered with JSON (no SSE stream, no sessions).
 * Off unless MCP_TOKEN is set; clients send it as a bearer token.
 */
import { createFileRoute } from "@tanstack/react-router";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Ctx = { by: string; origin: string };

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  run: (args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;
};

const str = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "string",
  description,
  ...extra,
});
const req = (a: Record<string, unknown>, k: string) => {
  const v = a[k];
  if (typeof v !== "string" || !v.trim()) throw new Error(`${k} is required.`);
  return v.trim();
};
const opt = (a: Record<string, unknown>, k: string) =>
  typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : undefined;

async function msx() {
  return import("@/lib/msx.server");
}

/** The customer for a call: by TPID or by Cloud Delivery ID. */
async function customerOf(a: Record<string, unknown>) {
  const m = await msx();
  const id = opt(a, "customerId");
  if (id) return m.getCustomer(id);
  const tpid = req(a, "tpid");
  const [c] = await m.findCustomers({ tpid });
  if (!c) throw new Error(`No customer with TPID ${tpid}. Create it with upsert_customer first.`);
  return c;
}

const TOOLS: Tool[] = [
  {
    name: "find_customer",
    title: "Find a customer",
    description:
      "Find customer profiles in Cloud Delivery by TPID (exact) or by name, MSX account name or TPID fragment. Returns each profile with its context entries and engagement count.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        tpid: str("MSX top parent ID (digits)."),
        query: str("Name or part of a name."),
      },
    },
    run: async (a, { origin }) => {
      const m = await msx();
      const list = await m.findCustomers({ tpid: opt(a, "tpid"), query: opt(a, "query") });
      return list.map((c) => ({ ...c, url: `${origin}/customers/${c.id}` }));
    },
  },
  {
    name: "upsert_customer",
    title: "Find or create a customer by TPID",
    description:
      "Returns the customer profile with this TPID, or creates it. Use the account name and TPID from MSX (msx-mcp). MSX stays the system of record; Cloud Delivery keeps the TPID as the link.",
    inputSchema: {
      type: "object",
      required: ["tpid", "name"],
      properties: {
        tpid: str("MSX top parent ID (digits)."),
        name: str("Customer name as the team refers to it."),
        accountName: str("The MSX account name, if different."),
        industry: str("Industry, e.g. Energy."),
      },
    },
    run: async (a, { by, origin }) => {
      const m = await msx();
      const r = await m.upsertCustomer({
        tpid: req(a, "tpid"),
        name: req(a, "name"),
        accountName: opt(a, "accountName"),
        industry: opt(a, "industry"),
        by,
      });
      return { ...r, url: `${origin}/customers/${r.customer.id}` };
    },
  },
  {
    name: "add_customer_context",
    title: "Add context to a customer",
    description:
      "Adds context that MSX doesn't hold to the customer's profile, for meeting prep: a summary of MSX opportunity notes, meeting notes, an email, a call transcript, or a plain-language brief. Don't include anything the customer shouldn't see in a recap; this stays internal.",
    inputSchema: {
      type: "object",
      required: ["source", "title", "text"],
      properties: {
        tpid: str("The customer's TPID (or give customerId)."),
        customerId: str("Cloud Delivery customer ID."),
        source: str("Where it came from.", {
          enum: ["msx", "notes", "email", "transcript", "prompt", "other"],
        }),
        title: str("A short title, e.g. 'Discovery call 3 Oct'."),
        text: str("The content."),
      },
    },
    run: async (a, { by, origin }) => {
      const m = await msx();
      const c = await customerOf(a);
      const source = req(a, "source");
      if (!["msx", "notes", "email", "transcript", "prompt", "other"].includes(source))
        throw new Error("source must be msx, notes, email, transcript, prompt or other.");
      return m.addContext({
        customerId: c.id,
        source: source as "msx",
        title: req(a, "title"),
        text: req(a, "text"),
        by,
      });
    },
  },
  {
    name: "list_engagements",
    title: "List engagements",
    description:
      "Engagements in Cloud Delivery, for one customer (tpid or customerId) or the most recent across all. Each shows its stage and whether it's linked to an MSX opportunity or proactive.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        tpid: str("The customer's TPID."),
        customerId: str("Cloud Delivery customer ID."),
      },
    },
    run: async (a, { origin }) => {
      const m = await msx();
      const c = opt(a, "tpid") || opt(a, "customerId") ? await customerOf(a) : null;
      const list = await m.engagementsFor(c?.id);
      return list.map((e) => ({ ...e, url: `${origin}/engagements/${e.id}` }));
    },
  },
  {
    name: "create_engagement",
    title: "Start an engagement",
    description:
      "Starts an engagement for a customer, under an MSX opportunity (give opportunityId from msx-mcp) or proactively when there's no opportunity yet. If an engagement already exists for that opportunity, returns it instead of creating a duplicate. Name it after the outcome the customer wants.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        tpid: str("The customer's TPID (or give customerId)."),
        customerId: str("Cloud Delivery customer ID."),
        name: str("The outcome the customer wants, e.g. 'Maintenance work packages in days'."),
        opportunityId: str("MSX opportunity number or ID. Omit for a proactive engagement."),
        opportunityName: str("The MSX opportunity name."),
        problem: str("What the customer is struggling with, in their words, if known."),
      },
    },
    run: async (a, { by, origin }) => {
      const m = await msx();
      const c = opt(a, "tpid") || opt(a, "customerId") ? await customerOf(a) : null;
      const r = await m.startEngagement({
        name: req(a, "name"),
        customerId: c?.id ?? null,
        opportunityId: opt(a, "opportunityId"),
        opportunityName: opt(a, "opportunityName"),
        problem: opt(a, "problem"),
        by,
      });
      return { ...r, url: `${origin}/engagements/${r.engagement.id}` };
    },
  },
  {
    name: "link_opportunity",
    title: "Link an engagement to an MSX opportunity",
    description:
      "Links an existing engagement to an MSX opportunity, e.g. when a proactive engagement gets one. Pass opportunityId null to make it proactive again.",
    inputSchema: {
      type: "object",
      required: ["engagementId"],
      properties: {
        engagementId: str("Cloud Delivery engagement ID."),
        opportunityId: { type: ["string", "null"], description: "MSX opportunity number or ID." },
        opportunityName: str("The MSX opportunity name."),
      },
    },
    run: async (a, { by, origin }) => {
      const m = await msx();
      return m.linkOpportunity({
        engagementId: req(a, "engagementId"),
        opportunityId: a["opportunityId"] === null ? null : (opt(a, "opportunityId") ?? null),
        opportunityName: opt(a, "opportunityName"),
        by,
      });
    },
  },
  {
    name: "get_msx_update",
    title: "Get the milestone update for MSX",
    description:
      "The milestone update for an engagement (status, what's in production, results against the baseline, open next steps), with the TPID and opportunity to post it under. Cloud Delivery doesn't write to MSX: show the text to the user, and post it with msx-mcp only after they confirm.",
    readOnly: true,
    inputSchema: {
      type: "object",
      required: ["engagementId"],
      properties: { engagementId: str("Cloud Delivery engagement ID.") },
    },
    run: async (a, { origin }) => {
      const m = await msx();
      return m.msxUpdate(req(a, "engagementId"));
    },
  },
];

type Rpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const reply = (id: Rpc["id"], result: unknown) => json({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string, status = 200) =>
  json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

function authorized(request: Request) {
  const token = process.env["MCP_TOKEN"]?.trim();
  if (!token) return "off" as const;
  const given =
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ?? "";
  // Constant-time comparison, so the token can't be guessed from response times.
  let diff = given.length ^ token.length;
  for (let i = 0; i < token.length; i++) diff |= (given.charCodeAt(i) || 0) ^ token.charCodeAt(i);
  return diff === 0 ? ("ok" as const) : ("denied" as const);
}

async function handle(request: Request) {
  const auth = authorized(request);
  if (auth === "off")
    return fail(
      null,
      -32001,
      "The Cloud Delivery MCP server is off. Set MCP_TOKEN on the app to turn it on.",
      503,
    );
  if (auth === "denied") return fail(null, -32001, "Unauthorized.", 401);

  let msg: Rpc;
  try {
    msg = (await request.json()) as Rpc;
  } catch {
    return fail(null, -32700, "Parse error.", 400);
  }
  if (Array.isArray(msg)) return fail(null, -32600, "Batches aren't supported.", 400);
  // Notifications (no id) get no response body.
  if (msg.id === undefined) return new Response(null, { status: 202 });

  const by = `${request.headers.get("x-cloud-delivery-user")?.trim() || "Copilot"} (via MCP)`;
  // Behind App Service's front end the app sees plain HTTP; links should use what the client called.
  const url = new URL(request.url);
  const origin = `${request.headers.get("x-forwarded-proto")?.split(",")[0] ?? url.protocol.replace(":", "")}://${request.headers.get("x-forwarded-host") ?? url.host}`;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.["protocolVersion"] ?? "");
      return reply(msg.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cloud-delivery", title: "Cloud Delivery", version: "1.0.0" },
        instructions:
          "Cloud Delivery records the SE/CSA side of customer work: customer profiles keyed by TPID, context for meeting prep, and engagements linked to MSX opportunities or proactive. Use msx-mcp to read and write MSX; use these tools to record what you found here. Confirm with the user before any write to MSX.",
      });
    }
    case "ping":
      return reply(msg.id, {});
    case "tools/list":
      return reply(msg.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !!t.readOnly, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(msg.params?.["name"] ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.["arguments"] ?? {}) as Record<string, unknown>;
      try {
        const out = await tool.run(args, { by, origin });
        return reply(msg.id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          structuredContent: Array.isArray(out) ? { items: out } : out,
        });
      } catch (e) {
        // Tool errors go back to the model so it can correct itself.
        return reply(msg.id, {
          content: [{ type: "text", text: (e as Error).message }],
          isError: true,
        });
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      // No server-initiated stream: this server only answers requests.
      GET: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
      DELETE: () => new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
