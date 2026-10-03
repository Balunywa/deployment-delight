/*
 * The MSX link: customer onboarding by TPID (MSX through the connector, context, prep, engagement under an MSX
 * opportunity or proactive), and the MCP endpoint Copilot uses beside msx-mcp. Writes to the e2e database, so not
 * @readonly.
 */
import { type APIRequestContext } from "@playwright/test";

import { expect, loaded, open, test } from "./fixtures";

const TOKEN = "e2e-mcp-token";
const RUN = Date.now().toString().slice(-7);
const TPID = `9${RUN}`;
const OPP = `7-E2E${RUN}`;
const CONNECTOR = "http://127.0.0.1:47615";

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

  test("onboarding reuses the profile by TPID; added context drives the prep", async ({ page }) => {
    // No MSX connector on this machine: the page says so and onboarding still works.
    await page.route(`${CONNECTOR}/**`, (r) => r.abort());
    await open(page, "/customers/onboard");
    await page.getByLabel("TPID").fill(TPID);
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("region", { name: "MSX connection" })).toContainText(
      "MSX isn't connected on this PC.",
    );
    await expect(page.getByRole("region", { name: "In Cloud Delivery" })).toContainText(
      `Already onboarded as E2E Account ${RUN}`,
    );
    await page.getByRole("button", { name: "Continue with this customer" }).click();

    await expect(page.getByRole("radio", { name: /Proactive/ })).toBeChecked();
    await page.getByRole("button", { name: "Next: add context" }).click();
    const profile = page.getByRole("region", { name: "Customer profile" });
    await expect(profile).toContainText("Opportunity notes");
    await profile.getByRole("button", { name: "Add context" }).click();
    await profile.getByLabel("Title").fill("Discovery call");
    await profile
      .getByLabel("Context")
      .fill(
        "They want to move 40 Oracle databases off Exadata before the datacenter lease ends in June 2027. The CIO sponsors it. New apps would run on AKS.",
      );
    await profile.getByRole("button", { name: "Save context" }).click();
    await expect(profile).toContainText("Discovery call");

    await page.getByRole("button", { name: "Next: prep" }).click();
    const prep = page.getByRole("region", { name: "Prep" });
    const questions = prep.getByRole("group", { name: "Discovery questions" });
    await expect(questions).toContainText("Wants maintenance planning off spreadsheets");
    await expect(questions).toContainText("Which Oracle features do they depend on");
    const areas = prep.getByRole("group", { name: "Technical areas" });
    await expect(areas).toContainText("Oracle workloads");
    await expect(areas).toContainText("Containers and AKS");
    await expect(areas.getByRole("link", { name: /Oracle Database@Azure/ })).toHaveAttribute(
      "href",
      /^https:\/\/learn\.microsoft\.com\//,
    );
    const map = prep.getByRole("group", { name: "Context map" });
    await expect(map).toContainText("lease ends in June 2027");
    await expect(map).toContainText("The CIO sponsors it.");

    await open(page, "/engagements");
    await page.getByRole("link", { name: "Maintenance planning in days" }).first().click();
    await loaded(page);
    await expect(page.getByRole("button", { name: new RegExp(`MSX ${OPP}`) })).toBeVisible();
  });

  test("with MSX: pull by TPID, pick the opportunity, prep, start the engagement", async ({
    page,
  }) => {
    const tpid = `8${RUN}`;
    const opp = `7-MSX${RUN}`;
    const snapshot = {
      tpid,
      fetchedAt: new Date().toISOString(),
      account: { id: "a0000000-0000-4000-8000-000000000001", name: `CONTOSO ENERGY ${RUN}` },
      accounts: 3,
      opportunities: [
        {
          id: "b0000000-0000-4000-8000-000000000001",
          number: opp,
          name: "Azure Local for refinery sites",
          stage: "2 - Qualify",
          solutionArea: "Infrastructure",
          salesPlay: "Migrate and Modernize",
          closeDate: "2027-03-31T00:00:00Z",
          createdOn: "2026-09-01T00:00:00Z",
          owner: "Pat Seller",
          account: `Contoso Energy ${RUN}`,
          description:
            "Customer wants to run control-room apps at 12 refinery sites when disconnected. Hardware refresh is due by Q2 2027.",
          forecastComments: null,
        },
        {
          id: "b0000000-0000-4000-8000-000000000002",
          number: `7-OTHER${RUN}`,
          name: "Data platform",
          stage: "1 - Listen & Consult",
          solutionArea: "Data & AI",
          salesPlay: null,
          closeDate: null,
          createdOn: null,
          owner: null,
          account: null,
          description: null,
          forecastComments: null,
        },
      ],
    };
    // The connector on the SE's PC, stood in for: signed in, and MSX knows this TPID.
    await page.route(`${CONNECTOR}/**`, (r) => {
      const path = new URL(r.request().url()).pathname;
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(
          path === "/status" ? { connector: "1", msx: "ready", detail: null } : snapshot,
        ),
      });
    });

    await open(page, "/customers/onboard");
    await page.getByLabel("TPID").fill(tpid);
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByText("MSX connected")).toBeVisible();
    const inMsx = page.getByRole("region", { name: "In MSX" });
    await expect(inMsx).toContainText(`CONTOSO ENERGY ${RUN}`);
    await expect(inMsx).toContainText("3 active accounts · 2 open opportunities");
    await expect(page.getByLabel("Name the team uses")).toHaveValue(`CONTOSO ENERGY ${RUN}`);
    await page.getByLabel("Name the team uses").fill(`Contoso Energy ${RUN}`);
    await page.getByRole("button", { name: "Create profile and continue" }).click();

    await page.getByRole("radio", { name: /Azure Local for refinery sites/ }).check();
    await page.getByRole("button", { name: "Next: add context" }).click();
    await expect(page.getByRole("region", { name: "Customer profile" })).toContainText(
      `MSX: CONTOSO ENERGY ${RUN}`,
    );
    await page.getByRole("button", { name: "Next: prep" }).click();

    const prep = page.getByRole("region", { name: "Prep" });
    const map = prep.getByRole("group", { name: "Context map" });
    await expect(map).toContainText("Azure Local for refinery sites · 2 - Qualify");
    await expect(map).toContainText("owner Pat Seller");
    await expect(map).toContainText("Hardware refresh is due by Q2 2027.");
    await expect(map).toContainText("No sponsor or decision maker is named.");
    await expect(prep.getByRole("group", { name: "Technical areas" })).toContainText(
      "Azure Local (edge and on-premises)",
    );
    await expect(prep.getByRole("group", { name: "Discovery questions" })).toContainText(
      "Customer wants to run control-room apps",
    );

    const start = page.getByRole("region", { name: "Start the engagement" });
    await expect(start).toContainText(`Linked to MSX opportunity ${opp}`);
    await expect(start.getByLabel("Engagement")).toHaveValue("Azure Local for refinery sites");
    await start.getByRole("button", { name: "Start the engagement" }).click();
    await loaded(page);
    await expect(page).toHaveURL(/\/engagements\//);
    await expect(page.getByRole("button", { name: new RegExp(`MSX ${opp}`) })).toBeVisible();
  });

  test("a proactive engagement links an opportunity later", async ({ page }) => {
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
  });
});
