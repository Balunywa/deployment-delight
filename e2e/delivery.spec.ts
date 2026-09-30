/*
 * Delivery units, end to end: the list and its filters, a unit's spec (environments, identities, state) and
 * repository content, and filing a vending request.
 */
import { expect, loaded, open, test } from "./fixtures";

test.describe.serial("delivery units", () => {
  test("filters by kind and searches by repository", async ({ page }) => {
    await open(page, "/delivery");
    const rows = page.locator("tbody tr").filter({ has: page.locator('a[href^="/delivery/"]') });
    const all = await rows.count();
    expect(all).toBeGreaterThan(40);
    for (const [tab, prefix] of [
      ["Landing zones", "gridworks/lz-"],
      ["Solutions", "gridworks/sol-"],
      ["Customers", "gridworks/cust-"],
      ["Platform", "gridworks/cd-"],
    ] as const) {
      await page.getByRole("button", { name: new RegExp(`^${tab}\\s*\\d+`) }).click();
      const n = await rows.count();
      expect(n).toBeGreaterThan(0);
      for (const text of await rows.locator('a[href^="/delivery/"]').allInnerTexts())
        expect(text).toContain(prefix);
    }
    await page.getByRole("button", { name: /^All\s*\d+/ }).click();
    await page.getByPlaceholder("Filter by name or repository").fill("cd-vending");
    await expect(rows).toHaveCount(1);
    await expect(page.getByText("Pass").first()).toBeVisible();
  });

  test("a customer unit shows per-environment identities, reviewers and state", async ({
    page,
  }) => {
    await open(page, "/delivery");
    await page.getByRole("button", { name: /^Customers\s*\d+/ }).click();
    await page.locator('a[href^="/delivery/"]').first().click();
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1, name: /gridworks\/cust-/ })).toBeVisible();
    // Plan and apply environments, production gated with no self-review.
    await expect(page.getByText("prod-plan").first()).toBeVisible();
    await expect(page.getByText(/@delivery-approvers/).first()).toBeVisible();
    await expect(page.getByText("no self-review").first()).toBeVisible();
    // Identities trust one environment and the pinned template.
    await expect(
      page
        .getByText(
          /job_workflow_ref:gridworks\/cd-delivery-templates\/\.github\/workflows\/install\.yml@refs\/tags\/v1/,
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByText("read-only").first()).toBeVisible();
    await expect(page.getByText("write").first()).toBeVisible();
    // Repository content: the vending request, workflows and an environment file.
    await expect(
      page.getByRole("button", { name: /cd-vending\/requests\/customer\// }),
    ).toBeVisible();
    await page.getByRole("button", { name: ".github/workflows/install.yml" }).click();
    await expect(
      page
        .getByText("uses: gridworks/cd-delivery-templates/.github/workflows/install.yml@v1")
        .first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^environments\/prod\// })
      .first()
      .click();
    await expect(page.getByText(/digest:/).first()).toBeVisible();
  });

  test("request vending for a landing zone; platform repositories can't be vended", async ({
    page,
  }) => {
    await open(page, "/delivery");
    await page.getByRole("button", { name: /^Landing zones\s*\d+/ }).click();
    await page.locator('a[href^="/delivery/"]').first().click();
    await loaded(page);
    await expect(page.getByText("Not vended").first()).toBeVisible();
    await page.getByRole("button", { name: "Request vending" }).click();
    await expect(page.getByText(/Vending request recorded/)).toBeVisible();
    await expect(page.getByText("Request ready").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Update vending request" })).toBeVisible();
    await expect(page.getByText(/Last requested .* by E2E Tester/)).toBeVisible();

    await open(page, "/audit");
    await expect(page.getByText(/vending_requested|vending requested/i).first()).toBeVisible();

    await open(page, "/delivery");
    await page.getByPlaceholder("Filter by name or repository").fill("cd-delivery-templates");
    await page.locator('a[href^="/delivery/"]').first().click();
    await loaded(page);
    await expect(page.getByRole("button", { name: /Request vending/ })).toHaveCount(0);
    await expect(page.getByText(/bootstrapped once by an org admin/)).toBeVisible();
    await page.getByRole("button", { name: ".github/workflows/lz.yml" }).click();
    await expect(page.getByText("name: landing-zone").first()).toBeVisible();
  });
});
