/*
 * Platform landing zones, end to end: the three kinds, the Assess → Design → Review → Deploy flow (edit, see the
 * impact, discard, add a management group, save, review), traffic flows, access, the advisor, policies, pinning
 * a newer ALZ library, the generated Terraform, and deploy readiness.
 *
 * Never presses Plan, Apply or Destroy: in this app Plan already creates management groups and can vend
 * subscriptions in a real tenant. The live tenant scan runs only with E2E_AZURE=1 (read-only, your az login).
 */
import { type Page } from "@playwright/test";

import { expect, loaded, open, sql, test } from "./fixtures";

async function openZone(page: Page, name: RegExp) {
  await open(page, "/foundations");
  await page.locator('a[href^="/foundations/"]').filter({ hasText: name }).first().click();
  await loaded(page);
}

/** The landing zone's tabs: Overview, Design, Traffic, Governance, Deploy, Code. */
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name: new RegExp(`^${name}`) }).first();

test.describe("platform landing zones", () => {
  test("traffic simulator: high availability and disaster recovery what-ifs", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Design").click();
    const map = page.locator(".react-flow");
    // ExpressRoute alongside the VPN, and a hub in a second region.
    await map
      .locator(".react-flow__node")
      .filter({ hasText: "ExpressRoute gateway" })
      .first()
      .getByTitle("Add to the design")
      .click();
    await map.getByText("Add a hub in a second region").click();
    await tab(page, "Traffic").click();
    const scenarios = page.getByRole("complementary", { name: "Traffic scenarios" });
    const drawing = page.getByRole("img", { name: /Network topology/ });

    // Everything at once, colour-coded like the legend.
    await expect(drawing).toContainText("Hub VNet · eastus");
    await expect(drawing).toContainText("MSEE · peering location 2");
    await expect(drawing).toContainText("HTTPS egress");
    await expect(drawing.locator('img[src="/azure-icons/firewall.svg"]').first()).toBeVisible();

    // The same drawing as a draw.io file, with draw.io's own Azure icons and animated flows.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "draw.io" }).click(),
    ]);
    const xml = await (
      await download.createReadStream()
    )
      .toArray()
      .then((c) => Buffer.concat(c).toString());
    expect(xml).toMatch(/^<mxfile /);
    expect(xml).toContain("img/lib/azure2/networking/Firewalls.svg");
    expect(xml).toContain("flowAnimation=1");

    // The circuit fails: BGP over it is withdrawn and the VPN carries on-premises traffic.
    await page.getByRole("radio", { name: /ExpressRoute circuit fails/ }).click();
    await scenarios.getByRole("button", { name: /The office reaches a Corp workload/ }).click();
    await expect(page.getByText(/site-to-site VPN carries the traffic/)).toBeVisible();

    // A zone fails: zone-redundant firewall and gateways keep routing.
    await page.getByRole("radio", { name: /An availability zone fails/ }).click();
    await scenarios.getByRole("button", { name: /A Corp workload calls an internet API/ }).click();
    await page.getByRole("button", { name: "Pause" }).click();
    await page.getByRole("button", { name: "Next hop" }).click();
    await expect(page.getByRole("region", { name: "Current hop" })).toContainText(
      "spans the region's availability zones",
    );

    // The primary region fails: connectivity fails over, the workloads have nothing to fail over to.
    await page.getByRole("radio", { name: /The primary region fails/ }).click();
    await scenarios.getByRole("button", { name: /Fail over to eastus/ }).click();
    await page.getByRole("button", { name: "Pause" }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next hop" }).click();
    await expect(page.getByTestId("drop")).toContainText("No installs are deployed in eastus");
  });

  test("overview: cost, best practices, traffic and fixes in one place", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await expect(tab(page, "Overview")).toHaveAttribute("aria-selected", "true");
    for (const k of [
      "Platform cost",
      "First deployment",
      "Microsoft best practices",
      "Traffic",
      "Resilience",
    ])
      await expect(page.getByText(k, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Monthly cost" })).toContainText(
      "Azure Firewall",
    );
    const attention = page.getByRole("region", { name: "Needs your attention" });
    await expect(attention.locator('[data-severity="fail"]').first()).toBeVisible();
    // A fix changes the design (not Azure) and the page says so.
    await attention.getByRole("button", { name: "Add the platform team" }).click();
    await expect(tab(page, "Design")).toContainText("1 unsaved");
    await expect(attention.getByRole("button", { name: "Save & review" })).toBeVisible();
  });

  test("new landing zone: each scenario says what it costs and how long it takes @readonly", async ({
    page,
  }) => {
    await open(page, "/foundations");
    await expect(page.getByLabel("Fleet")).toContainText("Platform cost");
    await page.getByRole("button", { name: "New landing zone" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Most common")).toBeVisible();
    await expect(dialog.getByText("Lowest cost")).toBeVisible();
    await expect(dialog.getByText(/\$[\d,]+\/mo/).first()).toBeVisible();
    await expect(dialog.getByText(/about \d+ min to deploy/).first()).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("traffic simulator opens from the design's Traffic tab @readonly", async ({ page }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await tab(page, "Design").click();
    await page.getByRole("button", { name: "Traffic", exact: true }).click();
    await page.getByRole("link", { name: /Simulate it end to end/ }).click();
    await loaded(page);
    await expect(page.getByRole("heading", { name: "Traffic, end to end" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Network topology/ })).toBeVisible();
    await expect(page.locator("[data-verdict]")).toBeVisible();
  });

  test("the list explains the three kinds of landing zone @readonly", async ({ page }) => {
    await open(page, "/foundations");
    await expect(page.getByRole("heading", { level: 1, name: "Landing zones" })).toBeVisible();
    for (const section of [
      "Your hosting tenant",
      "Customer tenants you build",
      "Customer landing zones you use",
    ])
      await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
    await expect(page.getByText(/ALZ 2026\.08\.1 available/)).toBeVisible();
  });

  test("design: edit, see the Azure impact, discard, then save and review", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Design").click();
    await loaded(page);

    // One more environment: the change bar says what it means in Azure.
    const env = page.getByPlaceholder(/qa, uat/);
    await env.fill("qa");
    await env.press("Enter");
    await expect(page.getByText(/^1 unsaved change/).first()).toBeVisible();
    await expect(tab(page, "Design")).toContainText("1 unsaved");
    await expect(page.getByRole("button", { name: /^Next: Save your changes/ })).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText(/unsaved change/)).toHaveCount(0);

    // Add a management group from the drawing.
    await page.getByRole("button", { name: "Add a management group" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add a management group" });
    await dialog.getByPlaceholder(/Confidential, AKS platform/).fill("Regulated");
    await dialog.getByRole("button", { name: "Add group" }).click();
    await expect(page.getByText(/unsaved change/).first()).toBeVisible();
    await expect(page.getByText(/\+1 management group/).first()).toBeVisible();

    await page.getByRole("button", { name: /Save & review/ }).click();
    await expect(page.getByText("Design saved. Here's what it changes.")).toBeVisible();
    await expect(tab(page, "Deploy")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("What changes in Azure")).toBeVisible();
    await expect(page.getByRole("region", { name: "Before you deploy" })).toContainText(
      "Monthly platform cost",
    );
    await expect(page.getByText(/^13 management groups under Harbor/)).toBeVisible();

    await page.getByRole("button", { name: "See the Terraform" }).click();
    await expect(page.getByText("main.tf").first()).toBeVisible();
    await tab(page, "Deploy").click();
    await page.getByRole("button", { name: /^Continue to deploy/ }).click();
    await expect(
      page.getByText(/Checking your Azure access|^Deploys as|^No Azure identity/).first(),
    ).toBeVisible();
  });

  test("deploy: readiness is checked and Plan says what it will do", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Deploy").click();
    await expect(page.getByText(/Checking your Azure access/)).toHaveCount(0, { timeout: 60_000 });
    // Either a signed-in identity (local az login) or a clear reason there isn't one (CI).
    await expect(page.getByText(/^(Deploys as|No Azure identity)/).first()).toBeVisible();
    const plan = page.getByRole("button", { name: /^(Plan|Create \d+ subscriptions? & plan)$/ });
    await expect(plan).toBeVisible();
    // When Plan would vend subscriptions it says so and asks first; cancel leaves Azure untouched.
    if (/Create/.test((await plan.textContent()) ?? "") && (await plan.isEnabled())) {
      await plan.click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("This plan creates things in Azure first");
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(confirm).toHaveCount(0);
      const [runs] = await sql<{ n: number }>("select count(*)::int as n from foundation_runs");
      expect(runs.n).toBe(0);
    }
  });

  test("traffic flows step through the design, hop by hop @readonly", async ({ page }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await tab(page, "Design").click();
    await page.getByRole("button", { name: "Traffic", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Traffic flows" })).toBeVisible();
    await expect(page.getByText("Users reach an Online install")).toBeVisible();
    await expect(page.getByText(/Step 1 of \d/).first()).toBeVisible();
    await page
      .getByRole("button", { name: /Application Gateway WAF v2/ })
      .first()
      .click();
    await expect(page.getByText(/Step 2 of \d/).first()).toBeVisible();
    // The path is drawn on the map, hop to hop, with what routes each hop.
    await expect(page.locator('.react-flow__edge[data-id^="flow:"]').first()).toBeAttached();
    await expect(page.locator(".react-flow").getByText("HTTPS 443 · public IP")).toBeVisible();
    // Every flow ends in a verdict, like a reachability analysis.
    await page.getByText("A Corp workload calls the internet").click();
    await expect(page.locator("[data-outcome]").first()).toBeVisible();
  });

  test("traffic follows real Azure routing: firewall, isolation, asymmetric on-premises path", async ({
    page,
  }) => {
    // Harbor: hub and spoke, Azure Firewall, a site-to-site VPN gateway.
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Design").click();
    await page.getByRole("button", { name: "Traffic", exact: true }).click();
    const outcome = page.locator("[data-outcome]");

    await page.getByText("A Corp workload calls the internet").click();
    await expect(outcome).toHaveAttribute("data-outcome", "needs-rules");
    await expect(page.getByText(/0\.0\.0\.0\/0 → VirtualAppliance/).first()).toBeVisible();

    await page.getByText("One Corp install talks to another").click();
    await expect(outcome).toHaveAttribute("data-outcome", "isolated");
    await expect(page.getByTitle("Traffic stops here")).toBeVisible();

    // A customer install has no GatewaySubnet route: the reply is dropped by the firewall.
    await page.getByText("The office reaches a Corp workload").click();
    await expect(outcome).toHaveAttribute("data-outcome", "broken");
    await expect(page.getByText(/Asymmetric/).first()).toBeVisible();

    // A subscription added in the design gets its gateway route, so the same path is inspected both ways.
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page
      .locator(".react-flow__node")
      .filter({ hasText: "Add a subscription" })
      .nth(1)
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/Shared services/).fill("acme");
    await dialog.getByRole("button", { name: "Add subscription" }).click();
    await page.getByRole("button", { name: "Traffic", exact: true }).click();
    await page.getByText("The office reaches a Corp workload").click();
    await expect(outcome).toHaveAttribute("data-outcome", "needs-rules");
    await expect(page.getByText(/rt-hub-gateway \(GatewaySubnet\)/).first()).toBeVisible();
    await tab(page, "Code").click();
    await expect(page.getByText(/route_table_custom_routes/).first()).toBeVisible();
  });

  test("traffic simulator: a packet through the real routes, both ways", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Traffic").click();
    const scenarios = page.getByRole("complementary", { name: "Traffic scenarios" });
    const verdict = page.locator("[data-verdict]");
    const hop = page.getByRole("region", { name: "Current hop" });
    const next = page.getByRole("button", { name: "Next hop" });

    // Egress: the spoke's UDR wins, the firewall source-NATs it.
    await scenarios.getByRole("button", { name: /A Corp workload calls an internet API/ }).click();
    await expect(verdict).toHaveAttribute("data-verdict", "reaches");
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(hop.locator("tr[data-active]")).toContainText("VirtualAppliance");
    await next.click();
    await expect(hop).toContainText("Source NAT");
    await page.getByRole("radio", { name: "As deployed" }).click();
    await expect(verdict).toHaveAttribute("data-verdict", "needs-rules");

    // Installs are isolated by default…
    await scenarios.getByRole("button", { name: /One customer install talks to another/ }).click();
    await expect(verdict).toHaveAttribute("data-verdict", "isolated");

    // …and a customer install without a GatewaySubnet route is asymmetric: the reply dies at the firewall.
    await page.getByRole("radio", { name: "Assume allowed" }).click();
    await scenarios.getByRole("button", { name: /The office reaches a Corp workload/ }).click();
    await expect(verdict).toHaveAttribute("data-verdict", "broken");
    await page.getByRole("button", { name: "Pause" }).click();
    for (let i = 0; i < 6; i++) if (await next.isEnabled()) await next.click();
    await expect(page.getByTestId("drop")).toContainText("asymmetric");
    await expect(page.getByTitle("Traffic stops here").first()).toBeVisible();
  });

  test("the map: two views, click a box to zoom in, breadcrumb, Esc back @readonly", async ({
    page,
  }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await tab(page, "Design").click();
    const map = page.locator(".react-flow");
    const where = page.getByRole("navigation", { name: "Where you are" });
    await expect(page.getByRole("tab", { name: "Architecture" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const column of ["Outside Azure", "Connectivity & identity", "Platform services"])
      await expect(map.getByText(column, { exact: true })).toBeVisible();
    // Laid out by code: nothing can be dragged.
    await expect(map.locator(".react-flow__node.draggable")).toHaveCount(0);

    await map.getByText("Connectivity subscription", { exact: true }).click();
    await expect(where).toContainText("Connectivity subscription");
    await map.getByText("Azure Firewall", { exact: true }).first().click();
    await expect(where).toContainText(/Hub virtual network|Virtual hub/);
    await expect(where).toContainText("Azure Firewall");
    await page.keyboard.press("Escape");
    await expect(where).toContainText("click a box to zoom in");

    await page.getByRole("button", { name: "Landing zones", exact: true }).first().click();
    await page.getByRole("button", { name: "Whole picture" }).click();

    await page.getByRole("tab", { name: "Management groups" }).click();
    await expect(map.getByText("Tenant root group")).toBeVisible();
    await map.getByText("Corp", { exact: true }).click();
    await expect(where).toContainText("Corp");
  });

  test("the map: tick a part out and back, and the change bar says so", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Design").click();
    const bastion = page.locator(".react-flow__node").filter({ hasText: "Azure Bastion" }).first();
    await bastion.getByTitle("Leave out of the design").click();
    await expect(page.getByText(/^1 unsaved change/).first()).toBeVisible();
    await expect(bastion.locator(".cd-glow")).toHaveCount(1);
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText(/unsaved change/)).toHaveCount(0);
  });

  test("the map: a workload landing zone shows up in its group once chosen", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Design").click();
    const map = page.locator(".react-flow");
    await expect(map.getByText("AKS landing zone")).toHaveCount(0);
    await map.getByText("Corp landing zones", { exact: true }).click();
    await page
      .getByRole("switch", { name: /Use the Azure Kubernetes Service \(AKS\) landing zone/ })
      .click();
    const aks = map.locator(".react-flow__node").filter({ hasText: "AKS landing zone" });
    await expect(aks).toBeVisible();
    await expect(aks).toContainText("Private AKS cluster");
    await page.getByRole("tab", { name: "Management groups" }).click();
    const corpGroup = map
      .locator(".react-flow__node-mg")
      .filter({ has: page.getByText("Corp", { exact: true }) });
    await expect(corpGroup).toContainText("AKS");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText(/unsaved change/)).toHaveCount(0);
  });

  test("access & policy: who has what where, validated against Microsoft's guidance", async ({
    page,
  }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await tab(page, "Design").click();
    await page.getByRole("tab", { name: "Access & policy" }).click();
    const map = page.locator(".react-flow");
    const checks = page.getByRole("region", { name: "Best-practice checks" });
    await expect(checks).toContainText("Checked against Microsoft's guidance");
    for (const t of ["Microsoft Entra ID", "Tenant root group"])
      await expect(map.getByText(t, { exact: true })).toBeVisible();
    await expect(map.getByText("Two emergency access (break-glass) accounts")).toBeVisible();

    // Give the product team Owner: flagged as more than they need, with Microsoft's fix one click away.
    const card = (title: string) =>
      map.locator(".react-flow__node-gov").filter({ has: page.getByText(title, { exact: true }) });
    await card("Landing zones").getByRole("button", { name: "+ access" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Team", { exact: true }).selectOption("appops");
    await dialog.getByLabel("Role", { exact: true }).selectOption("Owner");
    await expect(dialog).toContainText("is more than they need");
    await expect(
      dialog.getByRole("link", { name: /Best practices for Azure RBAC/ }),
    ).toHaveAttribute("href", /learn\.microsoft\.com/);
    await dialog.getByRole("button", { name: /Use Microsoft's recommendation/ }).click();
    await expect(dialog).toContainText("Matches Microsoft's recommendation");
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(card("Landing zones")).toContainText(
      "Product operations team · Application-Owners",
    );
    await expect(page.getByText(/unsaved change/).first()).toBeVisible();

    // Assign a policy where it belongs, and the check turns green.
    await card("Harbor Municipal Utility").getByRole("button", { name: "+ policy" }).click();
    await page.getByRole("switch", { name: "Assign Allowed locations here" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(card("Harbor Municipal Utility")).toContainText("+ Allowed locations");
    await expect(checks).toContainText("Resources can only be created in your regions");

    // Everything the design can fix, fixed in one go; what only the tenant can prove stays to confirm.
    await checks.getByRole("button", { name: /^Fix/ }).click();
    await expect(checks.getByRole("button", { name: /^Fix/ })).toHaveCount(0);
    await expect(checks.locator('[data-status="warn"], [data-status="fail"]')).toHaveCount(0);
    await expect(checks.locator('[data-status="confirm"]').first()).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText(/unsaved change/)).toHaveCount(0);
  });

  test("access: Microsoft's recommended roles apply as a design change", async ({ page }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await tab(page, "Design").click();
    await page.getByRole("button", { name: "Access", exact: true }).click();
    const recommend = page.getByRole("button", { name: "Use Microsoft's recommendation" });
    await expect(recommend).toBeVisible();
    await recommend.click();
    await expect(page.getByText(/unsaved change/).first()).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText(/unsaved change/)).toHaveCount(0);
  });

  test("advisor explains how to connect it when Azure OpenAI isn't configured", async ({
    page,
  }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await tab(page, "Design").click();
    await page.getByRole("button", { name: "✦ Advisor", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Design advisor/ })).toBeVisible();
    await expect(page.getByText(/AZURE_OPENAI_ENDPOINT/).first()).toBeVisible();
  });

  test("policies per group, filtered by effect and by your changes @readonly", async ({ page }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await tab(page, "Governance").click();
    for (const f of ["Deny effects", "Changed in your design", "All"])
      await page.getByRole("button", { name: f, exact: true }).click();
    await expect(
      page
        .locator("table")
        .getByText(/Deny|Audit|DeployIfNotExists/)
        .first(),
    ).toBeVisible();
  });

  test("pin the newer ALZ library after seeing the diff", async ({ page }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await tab(page, "Code").click();
    await page
      .getByRole("button", { name: /2026\.08\.1/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Pin ALZ 2026.08.1" }).click();
    await expect(page.getByText(/Pinned to ALZ 2026\.08\.1/)).toBeVisible();
    await tab(page, "Code").click();
    await expect(page.getByText(/pinned to 2026\.08\.1/).first()).toBeVisible();
  });

  test("a customer's own landing zone: assessment, placement and reference policies @readonly", async ({
    page,
  }) => {
    await openZone(page, /Cascade Utilities landing zone/);
    await expect(page.getByText("Customer-owned · read-only")).toBeVisible();
    await expect(page.getByText(/Aligned with the Azure landing zone standard/)).toBeVisible();
    await expect(page.getByText("What's missing compared with the standard")).toBeVisible();
    // Today's tenant, drawn on the standard: found parts solid, missing ones dashed.
    const asIs = page.locator(".react-flow");
    await asIs.scrollIntoViewIfNeeded();
    await expect(asIs.getByText("Connectivity subscription", { exact: true })).toBeVisible();
    expect((await asIs.boundingBox())?.height ?? 0).toBeGreaterThan(400);
    await page.getByRole("button", { name: "Where your product lands", exact: true }).click();
    await loaded(page);
    await page.getByRole("button", { name: "Reference policies", exact: true }).click();
    await loaded(page);
  });

  test("assess a live tenant (E2E_AZURE=1 only; read-only)", async ({ page }) => {
    test.skip(!process.env["E2E_AZURE"], "Needs an Azure sign-in; set E2E_AZURE=1 to run.");
    test.setTimeout(300_000);
    await openZone(page, /GridWorks hosting tenant/);
    await page.getByRole("button", { name: /Assess an existing tenant/ }).click();
    await page.getByRole("button", { name: "Scan a live tenant" }).click();
    await expect(page.getByText(/Aligned with the Azure landing zone standard/)).toBeVisible({
      timeout: 240_000,
    });
  });
});
