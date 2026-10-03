/*
 * The MSX link: customer onboarding by TPID (MSX through the connector, context, prep, engagement under an MSX
 * opportunity or proactive), and the MCP endpoint Copilot uses beside msx-mcp. Writes to the e2e database, so not
 * @readonly.
 */
import { type APIRequestContext } from "@playwright/test";

import { expect, loaded, open, sql, test } from "./fixtures";

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

  test("onboarding without MSX: reuse the profile, brief from added context, POV and call plan", async ({
    page,
  }) => {
    // No MSX connector on this machine: the page says so and onboarding still works.
    await page.route(`${CONNECTOR}/**`, (r) => r.abort());
    await open(page, "/customers/onboard");
    await page.getByLabel("TPID").fill(TPID);
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("region", { name: "MSX connection" })).toContainText(
      "MSX isn't connected on this PC.",
    );
    const cd = page.getByRole("region", { name: "In Cloud Delivery" });
    await expect(cd).toContainText(`Already onboarded as E2E Account ${RUN}`);
    await cd.getByRole("button", { name: "This is the customer: continue" }).click();

    // The existing engagement is one click away; a new one starts as a draft.
    await expect(page.getByRole("region", { name: "Continue an engagement" })).toContainText(
      "Maintenance planning in days",
    );
    const start = page.getByRole("region", { name: "Start a new engagement" });
    await start.getByRole("radio", { name: /Proactive/ }).check();
    await start.getByRole("button", { name: /Prepare discovery/ }).click();
    await page.waitForURL(/\/engagements\/[0-9a-f-]{36}\?tab=context/);
    await loaded(page);
    await expect(page.getByText("Preparing: not started with the customer.")).toBeVisible();

    // Context: add the account team's notes; the brief reads them, with source and status.
    await page.getByRole("button", { name: "Notes, emails and transcripts" }).click();
    const profile = page.getByRole("region", { name: "Customer profile" });
    await profile.getByRole("button", { name: "Add context" }).click();
    await profile.getByLabel("Title").fill("Discovery call");
    await profile
      .getByLabel("Context")
      .fill(
        "They want to move 40 Oracle databases off Exadata before the datacenter lease ends in June 2027. The CIO sponsors it. New apps would run on AKS.",
      );
    await profile.getByRole("button", { name: "Save context" }).click();
    const technical = page.getByRole("region", { name: "Technical environment" });
    await expect(technical).toContainText(
      "Oracle workloads: the context mentions Oracle, Exadata.",
    );
    const priorities = page.getByRole("region", { name: "Business priorities and why now" });
    const lease = priorities.getByRole("listitem").filter({ hasText: "lease ends in June 2027" });
    await expect(lease).toContainText("Documented");
    await lease.getByRole("combobox").selectOption("confirmed");
    await expect(
      page.getByRole("region", { name: "What matters for this conversation" }),
    ).toContainText("lease ends in June 2027");

    // Point of view from the evidence; the opening is a working hypothesis built from it.
    const tabs = page.getByRole("navigation", { name: "Engagement" });
    await tabs.getByRole("button", { name: "Point of view" }).click();
    await page.getByRole("button", { name: "Draft from the evidence" }).click();
    await expect(page.getByRole("textbox", { name: "Opening" })).toHaveValue(
      /^From what we've seen, .*Oracle.*What are we missing\?$/,
    );
    await expect(page.getByRole("region", { name: "Plausible paths" })).toContainText(
      "Keeps today's approach",
    );

    // Call plan: built for discovery, with the technical question the context calls for.
    await page
      .getByRole("region", { name: "Opening statement" })
      .getByRole("button", { name: "Prepare the conversation" })
      .click();
    await page.getByRole("button", { name: "Prepare initial discovery" }).click();
    const plan = page.getByRole("region", { name: "Questions, in priority order" });
    await expect(plan).toContainText("Tests an assumption");
    const questions = await page
      .getByRole("textbox", { name: /^Question \d+$/ })
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(questions.some((q) => q.includes("Which Oracle features do they depend on"))).toBe(true);
    await expect(page.getByRole("region", { name: "Prepare with" })).toContainText(
      "Oracle Database@Azure",
    );
    await expect(page.getByRole("region", { name: "Agenda" })).toContainText("60 of 60 minutes");

    await open(page, "/engagements");
    await page.getByRole("link", { name: "Maintenance planning in days" }).first().click();
    await loaded(page);
    await expect(page.getByRole("button", { name: new RegExp(`MSX ${OPP}`) })).toBeVisible();
  });

  test("with MSX: resolve, prepare, meet, confirm findings, create; the recap has only what was confirmed", async ({
    page,
  }) => {
    const tpid = `8${RUN}`;
    const opp = `7-MSX${RUN}`;
    const snapshot = {
      tpid,
      fetchedAt: new Date().toISOString(),
      account: { id: "a0000000-0000-4000-8000-000000000001", name: `CONTOSO ENERGY ${RUN}` },
      accounts: 3,
      team: [{ name: "Pat Seller", role: "Account Executive" }],
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
      milestones: [
        {
          id: "c0000000-0000-4000-8000-000000000001",
          number: `7-MS1${RUN}`,
          name: "Refinery site pilot",
          opportunityId: "b0000000-0000-4000-8000-000000000001",
          workload: "Infra: Azure Local",
          status: "Blocked",
          category: "POC/Pilot",
          commitment: "Committed",
          date: new Date(Date.now() + 90 * 864e5).toISOString(),
          owner: "Pat Seller",
          ownerTeam: "ATU",
          modifiedOn: new Date().toISOString(),
        },
        {
          id: "c0000000-0000-4000-8000-000000000002",
          number: `7-MS2${RUN}`,
          name: "Historian on Azure SQL",
          opportunityId: "b0000000-0000-4000-8000-000000000002",
          workload: "Data: SQL",
          status: "Completed",
          category: "Production",
          commitment: "Committed",
          date: new Date(Date.now() - 120 * 864e5).toISOString(),
          owner: "Pat Seller",
          ownerTeam: "ATU",
          modifiedOn: new Date(Date.now() - 100 * 864e5).toISOString(),
        },
      ],
      contacts: [{ name: "Dana Ortiz", title: "VP, Operations Technology" }],
      partners: [
        {
          opportunityId: "b0000000-0000-4000-8000-000000000001",
          partner: "Fabrikam Integrators",
          type: "Co-Sell Referral",
          status: "Accepted",
        },
      ],
    };
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

    // A. Resolve the customer.
    await open(page, "/customers/onboard");
    await page.getByLabel("TPID").fill(tpid);
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByText("MSX connected")).toBeVisible();
    const inMsx = page.getByRole("region", { name: "In MSX" });
    await expect(inMsx).toContainText(`CONTOSO ENERGY ${RUN}`);
    await expect(inMsx).toContainText("3 active accounts (parent and subsidiaries)");
    await expect(inMsx).toContainText("Pat Seller · Account Executive");
    // What MSX shows the account team doing: milestones, production, partners, contacts.
    const shows = page.getByRole("region", { name: "What MSX shows" });
    await expect(shows.getByRole("region", { name: "In motion" })).toContainText(
      "Infra: Azure Local",
    );
    await expect(shows.getByRole("region", { name: "Needs attention" })).toContainText(
      "“Refinery site pilot” (Infra: Azure Local) is marked Blocked.",
    );
    await expect(shows.getByRole("region", { name: "Already in production" })).toContainText(
      "Data: SQL",
    );
    await expect(shows.getByRole("region", { name: "Co-sell partners" })).toContainText(
      "Fabrikam Integrators",
    );
    await expect(shows.getByRole("region", { name: "Customer contacts" })).toContainText(
      "Dana Ortiz · VP, Operations Technology",
    );
    await page.getByLabel("Name the team uses").fill(`Contoso Energy ${RUN}`);
    await page.getByRole("button", { name: "Save customer draft" }).click();
    const start = page.getByRole("region", { name: "Start a new engagement" });
    await start.getByRole("radio", { name: /Azure Local for refinery sites/ }).check();
    await start.getByRole("button", { name: /Prepare discovery/ }).click();
    await page.waitForURL(/\/engagements\/[0-9a-f-]{36}/);
    await loaded(page);
    const id = page.url().match(/engagements\/([0-9a-f-]{36})/)![1]!;
    const tabs = page.getByRole("navigation", { name: "Engagement" });

    // B. Context: the opportunity leads; MSX facts need validation until the customer says so.
    const matters = page.getByRole("region", { name: "What matters for this conversation" });
    await expect(matters).toContainText("The opportunity: Azure Local for refinery sites.");
    await expect(
      page
        .getByRole("region", { name: "Microsoft relationship and opportunities" })
        .getByRole("listitem")
        .filter({ hasText: "Azure Local for refinery sites · 2 - Qualify" }),
    ).toContainText("Needs validation");
    await expect(
      page.getByRole("region", { name: "Risks, blockers and open questions" }),
    ).toContainText("“Refinery site pilot” (Infra: Azure Local) is marked Blocked.");
    await expect(page.getByRole("region", { name: "Technical environment" })).toContainText(
      "Already in production per MSX: Data: SQL",
    );

    // C. Point of view: the opportunity's own topic leads.
    await tabs.getByRole("button", { name: "Point of view" }).click();
    await page.getByRole("button", { name: "Draft from the evidence" }).click();
    await expect(page.getByRole("textbox", { name: "Opening" })).toHaveValue(
      /From what we've seen, you want to run control-room apps .*Azure Local/,
    );
    await expect(page.getByRole("group", { name: "Assumptions" })).toContainText("To test");

    // D. Call plan and the meeting.
    await page
      .getByRole("region", { name: "Opening statement" })
      .getByRole("button", { name: "Prepare the conversation" })
      .click();
    await page.getByRole("button", { name: "Prepare initial discovery" }).click();
    await page.getByRole("button", { name: "Open meeting view" }).click();
    await page
      .getByLabel("Answer to question 1")
      .fill("Mostly right; the real pain is reports that arrive days late.");
    await page
      .getByRole("radiogroup", { name: /Result: The goal as written still holds/ })
      .getByRole("radio", { name: "Confirmed" })
      .click();
    await page
      .getByLabel(/What they said about: The goal as written/)
      .fill("Yes, the sites must keep running offline.");
    await page.getByLabel("New action", { exact: true }).fill("Share the site connectivity map");
    await page.getByLabel("New action owner").fill("Site operations lead");
    await page.getByRole("button", { name: "Add action" }).click();
    await page
      .getByRole("textbox", { name: "Agreed next step" })
      .fill("Architecture session with the site operations lead");
    await page.getByRole("button", { name: /Meeting held/ }).click();

    // E. Findings: the customer's words update the point of view, keeping its history.
    await expect(page.getByText("What the customer actually said")).toBeVisible();
    await page
      .getByRole("textbox", { name: "What they actually need, in their terms" })
      .fill("Control-room apps that keep running when a site is offline.");
    await page.getByRole("button", { name: "Apply to the point of view" }).click();
    await expect(page.getByText(/Findings saved\. The point of view is updated/)).toBeVisible();

    // Review and create: nothing in MSX changes.
    await page.getByRole("button", { name: "Review engagement" }).first().click();
    await expect(page.getByRole("textbox", { name: "Business outcome" })).toHaveValue(
      "Control-room apps that keep running when a site is offline.",
    );
    await page.getByRole("textbox", { name: "Scope", exact: true }).fill("12 refinery sites");
    await page.getByRole("textbox", { name: "Explicit exclusions" }).fill("Corporate ERP");
    await page.getByRole("button", { name: "Add a criterion" }).click();
    await page.getByLabel("Success criterion 1").fill("Run a workshop");
    await expect(page.getByText("That reads like an activity.")).toBeVisible();
    await page
      .getByLabel("Success criterion 1")
      .fill("Control-room apps run through a 48-hour link outage");
    await page.getByLabel("Evidence for criterion 1").fill("Site lead's outage test report");
    await page.getByRole("button", { name: "Review engagement" }).click();
    await expect(page.getByText(/doesn't change MSX, commit a\s+milestone/)).toBeVisible();
    await page.getByRole("button", { name: "Create engagement" }).click();
    await expect(page.getByRole("list", { name: "Phases" })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`MSX ${opp}`) })).toBeVisible();

    const [row] = await sql<{ status: string; history: number; findings: number }>(
      `select status, jsonb_array_length(coalesce(workspace->'povHistory', '[]'::jsonb))::int as history,
         jsonb_array_length(findings)::int as findings from public.engagements where id = $1`,
      [id],
    );
    expect(row!.status).toBe("active");
    expect(row!.history).toBeGreaterThan(0);
    expect(row!.findings).toBe(1);

    // The customer view: the confirmed goal and the agreed action, nothing internal.
    await open(page, `/recap/${id}`);
    await expect(page.getByText(/control-room apps at 12 refinery sites/).first()).toBeVisible();
    await expect(page.getByText("Share the site connectivity map")).toBeVisible();
    await expect(page.getByText(/MSX opportunity reflects/)).toHaveCount(0);
  });

  test("a proactive engagement links an opportunity later", async ({ page }) => {
    await open(page, "/engagements");
    await page.getByRole("button", { name: "Start without a customer" }).click();
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
