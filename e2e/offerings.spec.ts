/*
 * Offering designer, end to end: create an offering from a template, change its architecture, save the draft,
 * pass review and publish, then start the next release from the published one.
 */
import { type Page } from "@playwright/test";

import { expect, loaded, open, test } from "./fixtures";

/** Adds the first candidate service the architecture doesn't have yet; returns its name. */
async function addService(page: Page) {
  const search = page.getByPlaceholder("Search Azure services");
  for (const name of [
    "Azure Managed Redis",
    "Cosmos DB",
    "Event Hubs",
    "Front Door",
    "Service Bus",
  ]) {
    await search.fill(name);
    const tile = page
      .getByRole("button")
      .filter({ has: page.getByText(name, { exact: true }) })
      .first();
    if (!(await tile.count())) continue;
    const on = await tile.locator("span.font-medium").count();
    if (on) continue;
    await tile.click();
    return name;
  }
  throw new Error("Every candidate service is already in the architecture");
}

const RUN = Date.now().toString(36).slice(-5);
const NAME = `E2E Offering ${RUN}`;
let offeringId = "";
let added = "";

test.describe.serial("offering designer", () => {
  test("create an offering; it opens as a v1.0.0 draft under review", async ({ page }) => {
    await open(page, "/offerings");
    await page.getByRole("button", { name: "New offering" }).click();
    const dialog = page.getByRole("dialog", { name: "New offering" });
    await dialog.getByPlaceholder("e.g. Regulated EU").fill(NAME);
    await dialog.getByRole("button", { name: "Create draft & review" }).click();
    await expect(page.getByText(`${NAME} created as a v1.0.0 draft`)).toBeVisible();
    await expect(page).toHaveURL(/view=review/);
    offeringId = new URL(page.url()).searchParams.get("offering") ?? "";
    expect(offeringId).toMatch(/^[0-9a-f-]{36}$/);
    await loaded(page);
    await expect(
      page.getByRole("heading", { name: /Architecture review · v1\.0\.0/ }),
    ).toBeVisible();
    await expect(page.getByText("v1.0.0 · draft").first()).toBeVisible();
  });

  test("change the architecture, discard, change again and save the draft", async ({ page }) => {
    await open(page, `/offerings?offering=${offeringId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(NAME);
    await page.getByRole("button", { name: /^Architecture$/ }).click();

    await addService(page);
    await expect(page.getByText("Unsaved changes").first()).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);

    added = await addService(page);
    await expect(page.getByText("Unsaved changes").first()).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Save draft v1.0.0" });
    await dialog.getByPlaceholder("What changed and why").fill(`Adds ${added}.`);
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Draft v1\.0\.0 saved/)).toBeVisible();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  });

  test("every tab reflects the saved architecture", async ({ page }) => {
    await open(page, `/offerings?offering=${offeringId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(NAME);
    await page.getByRole("button", { name: /^Infrastructure as code$/ }).click();
    const file = {
      "Azure Managed Redis": "redis.tf",
      "Cosmos DB": "cosmos.tf",
      "Event Hubs": "event-hubs.tf",
      "Front Door": "front-door.tf",
      "Service Bus": "service-bus.tf",
    }[added]!;
    await expect(page.getByText(file).first()).toBeVisible();
    await page.getByRole("button", { name: /^Customer inputs/ }).click();
    await expect(
      page.getByRole("heading", { name: "What onboarding asks each customer" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Releases/ }).click();
    await expect(page.getByText("v1.0.0").first()).toBeVisible();
  });

  test("publish, then changes become the next draft release", async ({ page }) => {
    await open(page, `/offerings?offering=${offeringId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(NAME);
    await page.getByRole("button", { name: /^Review/ }).click();
    const publish = page.getByRole("button", { name: "Publish v1.0.0", exact: true });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByText(/v1\.0\.0 published/).first()).toBeVisible();
    await expect(page.getByText("Published · immutable")).toBeVisible();

    await page.getByRole("button", { name: /^Architecture$/ }).click();
    await addService(page);
    await page.getByRole("button", { name: "Save as v1.1.0 draft" }).click();
    const dialog = page.getByRole("dialog", { name: "Create draft v1.1.0" });
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Draft v1\.1\.0 saved/)).toBeVisible();
  });
});
