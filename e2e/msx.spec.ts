/*
 * The MSX link: customers keyed by TPID with their context, engagements under an MSX opportunity or proactive, and
 * the MCP endpoint Copilot uses beside msx-mcp. Writes to the e2e database, so not @readonly.
 */
import { type APIRequestContext } from "@playwright/test";

import { expect, loaded, open, test } from "./fixtures";

const TOKEN = "e2e-mcp-token";
const RUN = Date.now().toString().slice(-7);
const TPID = `9${RUN}`;
const OPP = `7-E2E${RUN}`;

async function rpc(request: APIRequestContext, method: string, params?: unknown, token = TOKEN) {
  const r = await request.post("/api/mcp", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
  });
  return { status: r.status(), body: r.status() === 202 ? null : await r.json() };
}

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const { body } = await rpc(request, "tools/call", { name, arguments: args });
  expect(body.result.isError ?? false, JSON.stringify(body.result.content)).toBe(false);
  return body.result.structuredContent;
}

test.describe.serial("MSX link", () => {
  test("MCP: initialize, list tools, and refuse a wrong token", async ({ request }) => {
    expect((await rpc(request, "ping", undefined, "wrong")).status).toBe(401);
    const init = await rpc(request, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    });
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    expect(init.body.result.serverInfo.name).toBe("cloud-delivery");
    const notified = await request.post("/api/mcp", {
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      data: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    expect(notified.status()).toBe(202);
    const tools = await rpc(request, "tools/list");
    expect(tools.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "find_customer",
      "upsert_customer",
      "add_customer_context",
      "list_engagements",
      "create_engagement",
      "link_opportunity",
      "get_msx_update",
    ]);
  });

  test("MCP: a customer by TPID, its context, and one engagement per opportunity", async ({
    request,
  }) => {
    const first = await call(request, "upsert_customer", {
      tpid: TPID,
      name: `E2E Account ${RUN}`,
      accountName: `E2E ACCOUNT ${RUN} LTD`,
    });
    expect(first.created).toBe(true);
    const again = await call(request, "upsert_customer", { tpid: TPID, name: "Another name" });
    expect(again.created).toBe(false);
    expect(again.customer.name).toBe(`E2E Account ${RUN}`);

    await call(request, "add_customer_context", {
      tpid: TPID,
      source: "msx",
      title: "Opportunity notes",
      text: "Wants maintenance planning off spreadsheets before the turnaround.",
    });

    const eng = await call(request, "create_engagement", {
      tpid: TPID,
      name: "Maintenance planning in days",
      opportunityId: OPP,
      opportunityName: "Maintenance AI",
    });
    expect(eng.created).toBe(true);
    expect(eng.engagement.origin).toBe("opportunity");
    const dup = await call(request, "create_engagement", {
      tpid: TPID,
      name: "Duplicate",
      opportunityId: OPP,
    });
    expect(dup.created).toBe(false);
    expect(dup.engagement.id).toBe(eng.engagement.id);

    const update = await call(request, "get_msx_update", { engagementId: eng.engagement.id });
    expect(update.tpid).toBe(TPID);
    expect(update.opportunity.id).toBe(OPP);
    expect(update.update).toContain("Milestone update: Maintenance planning in days");

    const bad = await rpc(request, "tools/call", {
      name: "upsert_customer",
      arguments: { tpid: "not-a-tpid", name: "x" },
    });
    expect(bad.body.result.isError).toBe(true);
  });

  test("the profile, its context and the linked engagement show in the app", async ({ page }) => {
    await open(page, "/customers");
    await page.getByRole("button", { name: "Find or add by TPID" }).click();
    const dialog = page.getByRole("dialog", { name: "Find or add a customer" });
    await dialog.getByLabel("TPID or name").fill(TPID);
    await dialog
      .getByRole("list", { name: "Matches" })
      .getByRole("button", { name: new RegExp(`E2E Account ${RUN}`) })
      .click();
    await loaded(page);
    const profile = page.getByRole("region", { name: "Customer profile" });
    await expect(profile.getByRole("button", { name: TPID })).toBeVisible();
    await expect(profile).toContainText("Opportunity notes");

    await profile.getByRole("button", { name: "Add context" }).click();
    await profile.getByLabel("Title").fill("Discovery call");
    await profile.getByLabel("Context").fill("They measure rework after scheduling.");
    await profile.getByRole("button", { name: "Save context" }).click();
    await expect(profile).toContainText("Discovery call");

    await open(page, "/engagements");
    await page.getByRole("link", { name: "Maintenance planning in days" }).first().click();
    await loaded(page);
    await expect(page.getByRole("button", { name: new RegExp(`MSX ${OPP}`) })).toBeVisible();
  });

  test("a new TPID creates the profile; a proactive engagement links an opportunity later", async ({
    page,
  }) => {
    const tpid = `8${RUN}`;
    await open(page, "/customers");
    await page.getByRole("button", { name: "Find or add by TPID" }).click();
    const dialog = page.getByRole("dialog", { name: "Find or add a customer" });
    await dialog.getByLabel("TPID or name").fill(tpid);
    await dialog.getByLabel("Name", { exact: true }).fill(`E2E New ${RUN}`);
    await dialog.getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByText(`E2E New ${RUN} added.`)).toBeVisible();
    const customerUrl = page.url();

    await open(page, "/engagements");
    await page
      .getByRole("button", { name: /Start an engagement|New engagement/ })
      .first()
      .click();
    const start = page.getByRole("dialog", { name: "Start an engagement" });
    await start.getByLabel("Engagement").fill(`Proactive ${RUN}`);
    await start.getByRole("radio", { name: /Proactive/ }).click();
    await start.getByRole("button", { name: "Start listening" }).click();
    await loaded(page);
    const link = page.getByRole("button", { name: /Proactive · link an opportunity/ });
    await expect(link).toBeVisible();
    await link.click();
    await page.getByLabel("Opportunity ID").fill(`7-NEW${RUN}`);
    await page.getByRole("button", { name: "Link opportunity" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`MSX 7-NEW${RUN}`) })).toBeVisible();
    expect(customerUrl).toContain("/customers/");
  });
});
