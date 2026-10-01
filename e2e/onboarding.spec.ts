/*
 * Customer onboarding, end to end, on the demo engine: a customer hosted in the ISV's tenant (launch, merge the
 * first pull request on its own repository, approve production) and a customer in their own tenant (install
 * link, admin approval). Each gets its own delivery unit and vending request.
 */
import { type Page } from "@playwright/test";

import { expect, loaded, open, test } from "./fixtures";

const RUN = Date.now().toString(36).slice(-5);
const HOSTED = `E2E Hosted ${RUN}`;
const LINKED = `E2E Linked ${RUN}`;
const code = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function continueTo(page: Page, launchLabel: RegExp) {
  for (let i = 0; i < 6; i++) {
    const launch = page.getByRole("button", { name: launchLabel });
    if (await launch.isVisible()) return launch;
    const next = page.getByRole("button", { name: /^Continue/ });
    await expect(next).toBeEnabled();
    await next.click();
  }
  throw new Error("Never reached the launch step");
}

test.describe.serial("customer onboarding", () => {
  test("hosted customer: launch, merge the first pull request, approve production", async ({
    page,
  }) => {
    await open(page, "/onboard");
    await page.getByLabel("Name", { exact: true }).fill(HOSTED);
    await expect(page.getByLabel("Customer code")).toHaveValue(code(HOSTED));
    await page
      .getByRole("button", { name: /Your tenant · your hosting landing zone/ })
      .first()
      .click();

    const launch = await continueTo(page, /Open pull request & start the run/);
    // Review: the customer's own repository, environment files and pinned template.
    await expect(page.getByText(`gridworks/cust-${code(HOSTED)}`).first()).toBeVisible();
    await page.getByRole("button", { name: "environments/*" }).click();
    await expect(page.getByText(/environments\/prod\/.*\.yaml/).first()).toBeVisible();
    await page.getByRole("button", { name: ".github/workflows/install.yml" }).click();
    await expect(
      page.getByText("gridworks/cd-delivery-templates/.github/workflows/install.yml@v1").first(),
    ).toBeVisible();

    await launch.click();
    await expect(page.getByText(/is onboarded — the pull request is ready to merge/)).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Merge pull request" }).click();
    const approve = page.getByRole("button", { name: "Approve & deploy production" });
    await expect(approve).toBeVisible({ timeout: 90_000 });
    await approve.click();
    await expect(page.getByText(`${HOSTED} is live in every environment`)).toBeVisible({
      timeout: 90_000,
    });
  });

  test("the hosted customer has its own repository and vending request", async ({ page }) => {
    await open(page, "/customers");
    await page.getByRole("link", { name: HOSTED }).first().click();
    await loaded(page);
    await page.getByRole("tab", { name: "Delivery" }).click();
    await expect(page.getByText("Delivered from")).toBeVisible();
    await expect(page.getByText(`gridworks/cust-${code(HOSTED)}`).first()).toBeVisible();
    await expect(page.getByText("Request ready")).toBeVisible();

    await open(page, "/delivery");
    await page.getByPlaceholder("Filter by name or repository").fill(code(HOSTED));
    await expect(page.getByRole("link", { name: `gridworks/cust-${code(HOSTED)}` })).toBeVisible();
  });

  test("customer in their own tenant: install link, admin approves, run continues", async ({
    page,
  }) => {
    await open(page, "/onboard");
    await page.getByLabel("Name", { exact: true }).fill(LINKED);
    await page
      .getByRole("button", { name: /Customer's tenant · (their existing|new) landing zone/ })
      .first()
      .click();
    const launch = await continueTo(page, /Open pull request & send install link/);
    await launch.click();
    await expect(page.getByText(`${LINKED} is ready — waiting for their admin`)).toBeVisible({
      timeout: 60_000,
    });

    // The install link the customer's admin receives works on its own.
    const link = page.getByRole("link", { name: "Open as customer" });
    const href = await link.getAttribute("href");
    expect(href).toMatch(/\/connect\//);

    await page.getByRole("button", { name: "Simulate admin approval" }).click();
    await expect(
      page.getByText(/is onboarded — the pull request is ready to merge|is live in/),
    ).toBeVisible({
      timeout: 90_000,
    });
  });

  test("the install link page renders for the customer's admin", async ({ page }) => {
    await open(page, "/customers");
    await page.getByRole("link", { name: LINKED }).first().click();
    await loaded(page);
    const id = page.url().split("/").pop()!;
    await open(page, `/connect/${id}`);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});
