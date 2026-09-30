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

const step = (page: Page, n: number, label: string) =>
  page.getByRole("button", { name: new RegExp(`^${n}\\s*${label}`) }).first();

test.describe("platform landing zones", () => {
  test("the list explains the three kinds of landing zone @readonly", async ({ page }) => {
    await open(page, "/foundations");
    await expect(page.getByRole("heading", { level: 1, name: "Landing zones" })).toBeVisible();
    for (const section of [
      "Your hosting tenant",
      "Customer tenants you build",
      "Customer landing zones you use",
    ])
      await expect(page.getByText(section, { exact: true })).toBeVisible();
    await expect(page.getByText(/ALZ 2026\.08\.1 available/)).toBeVisible();
  });

  test("design: edit, see the Azure impact, discard, then save and review", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await step(page, 2, "Design").click();
    await loaded(page);

    // One more environment: the change bar says what it means in Azure.
    const env = page.getByPlaceholder(/qa, uat/);
    await env.fill("qa");
    await env.press("Enter");
    await expect(page.getByText(/^1 unsaved change/).first()).toBeVisible();
    await expect(step(page, 2, "Design")).toContainText("1 unsaved change");
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
    await expect(step(page, 3, "Review changes")).toHaveClass(/ring-1/);
    await expect(page.getByText("What changes in Azure")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Next: Continue to deploy/ })).toBeVisible();
    await expect(page.getByText(/^13 management groups under Harbor/)).toBeVisible();

    await page.getByRole("button", { name: "See the Terraform" }).click();
    await expect(page.getByText("main.tf").first()).toBeVisible();
    await step(page, 3, "Review changes").click();
    await page.getByRole("button", { name: /^Next: Continue to deploy/ }).click();
    await expect(step(page, 4, "Deploy")).toHaveClass(/ring-1/);
  });

  test("deploy: readiness is checked and Plan says what it will do", async ({ page }) => {
    await openZone(page, /Harbor Municipal Utility tenant/);
    await step(page, 4, "Deploy").click();
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
    await step(page, 2, "Design").click();
    await page.getByRole("button", { name: "Traffic", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Traffic flows" })).toBeVisible();
    await expect(page.getByText("Users reach an Online install")).toBeVisible();
    await expect(page.getByText(/Step 1 of \d/).first()).toBeVisible();
    await page
      .getByRole("button", { name: /Arrives at / })
      .first()
      .click();
    await expect(page.getByText(/Step 2 of \d/).first()).toBeVisible();
    // A flow the design can't carry says what to add instead (e.g. no firewall in a live, edited design).
    const corp = page.getByRole("button", { name: /^A Corp workload calls the internet/ });
    if (/Add Azure Firewall/.test((await corp.textContent()) ?? "")) return;
    await corp.click();
    await expect(page.getByText(/Step 1 of \d/).first()).toBeVisible();
  });

  test("access: Microsoft's recommended roles apply as a design change", async ({ page }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await step(page, 2, "Design").click();
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
    await step(page, 2, "Design").click();
    await page.getByRole("button", { name: "✦ Advisor", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Design advisor/ })).toBeVisible();
    await expect(page.getByText(/AZURE_OPENAI_ENDPOINT/).first()).toBeVisible();
  });

  test("policies per group, filtered by effect and by your changes @readonly", async ({ page }) => {
    await openZone(page, /GridWorks hosting tenant/);
    await page.getByRole("button", { name: "Policies", exact: true }).click();
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
    await page.getByRole("button", { name: "ALZ version", exact: true }).click();
    await page
      .getByRole("button", { name: /2026\.08\.1/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Pin ALZ 2026.08.1" }).click();
    await expect(page.getByText(/Pinned to ALZ 2026\.08\.1/)).toBeVisible();
    await page.getByRole("button", { name: "Terraform", exact: true }).click();
    await expect(page.getByText(/pinned to 2026\.08\.1/).first()).toBeVisible();
  });

  test("a customer's own landing zone: assessment, placement and reference policies @readonly", async ({
    page,
  }) => {
    await openZone(page, /Cascade Utilities landing zone/);
    await expect(page.getByText("Customer-owned · read-only")).toBeVisible();
    await expect(page.getByText(/Aligned with the Azure landing zone standard/)).toBeVisible();
    await expect(page.getByText("What's missing compared with the standard")).toBeVisible();
    await page.getByRole("button", { name: "Where your product lands", exact: true }).click();
    await loaded(page);
    await page.getByRole("button", { name: "Reference policies", exact: true }).click();
    await loaded(page);
  });

  test("assess a live tenant (E2E_AZURE=1 only; read-only)", async ({ page }) => {
    test.skip(!process.env["E2E_AZURE"], "Needs an Azure sign-in; set E2E_AZURE=1 to run.");
    test.setTimeout(300_000);
    await openZone(page, /GridWorks hosting tenant/);
    await step(page, 1, "Assess").click();
    await page.getByRole("button", { name: "Scan a live tenant" }).click();
    await expect(page.getByText(/Aligned with the Azure landing zone standard/)).toBeVisible({
      timeout: 240_000,
    });
  });
});
