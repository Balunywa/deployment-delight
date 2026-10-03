/*
 * Every page in the console renders its real data without errors. Read-only, so it also runs against a deployed
 * console (--grep @readonly).
 */
import { type Page } from "@playwright/test";

import { expect, loaded, open, test } from "./fixtures";

const heading = (page: Page, name: string | RegExp) =>
  expect(page.getByRole("heading", { name }).first()).toBeVisible();

test.describe("every page loads @readonly", () => {
  test("home", async ({ page }) => {
    await open(page, "/");
    await heading(page, "Offerings");
    await heading(page, "Installed base");
    await heading(page, "Needs you");
  });

  test("solution catalog lists solutions", async ({ page }) => {
    await open(page, "/products");
    await heading(page, "Find it, deploy it, or share yours");
    await expect(page.locator("article").first()).toBeVisible();
    expect(await page.locator("article").count()).toBeGreaterThanOrEqual(6);
  });

  test("solution detail", async ({ page }) => {
    await open(page, "/products");
    await page.locator("article a").first().click();
    await loaded(page);
    await heading(page, "Delivery models");
    await expect(page.getByText("Delivered from")).toBeVisible();
    await heading(page, "What it's built from");
  });

  test("offerings designer and every tab", async ({ page }) => {
    await open(page, "/offerings");
    for (const tab of [
      /^Architecture review/,
      /^Test deploy$/,
      /^Pipeline$/,
      /^Infrastructure as code$/,
      /^Customer inputs/,
      /^Releases/,
      /^SRE Agent$/,
      /^Flows$/,
      /^Architecture$/,
    ]) {
      await page.getByRole("button", { name: tab }).first().click();
      await loaded(page);
    }
    await page.getByRole("button", { name: /^Pipeline$/ }).click();
    await expect(
      page.getByText(/sol-.*\/\.github\/workflows\/solution\.yml/).first(),
    ).toBeVisible();
  });

  test("releases", async ({ page }) => {
    await open(page, "/upgrades");
    await heading(page, "Where the installed base is");
    await heading(page, /^Releases · \d+/);
  });

  test("landing zones and a landing zone", async ({ page }) => {
    await open(page, "/foundations");
    await heading(page, "Landing zones");
    await page.locator('a[href^="/foundations/"]').first().click();
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("delivery units list and a unit", async ({ page }) => {
    await open(page, "/delivery");
    await heading(page, "Delivery units");
    await expect(page.getByRole("button", { name: /^All\s*\d+/ })).toBeVisible();
    const rows = page.locator('a[href^="/delivery/"]');
    await expect(rows.first()).toBeVisible();
    await rows.first().click();
    await loaded(page);
    for (const s of ["Environments", "Cloud identities", "Terraform state", "Repository content"])
      await heading(page, s);
  });

  test("customers and a customer's tabs", async ({ page }) => {
    await open(page, "/customers");
    await heading(page, "Customers");
    // A new deployment has no customers; open one when there is one.
    const customer = page.locator('a[href^="/customers/"]').first();
    if (!(await customer.count())) return;
    await customer.click();
    await loaded(page);
    for (const t of await page.getByRole("tab").all()) {
      await t.click();
      await loaded(page);
    }
  });

  test("installed base", async ({ page }) => {
    await open(page, "/estate");
    await heading(page, "Installed base");
  });

  test("deployments and a run", async ({ page }) => {
    await open(page, "/deployments");
    await heading(page, "Deployments");
    // Customers start with no installs; open a run when there is one.
    const run = page.locator('a[href^="/deployments/"]').first();
    if (await run.count()) {
      await run.click();
      await loaded(page);
    }
  });

  test("compliance, costs, audit, settings", async ({ page }) => {
    for (const [path, h] of [
      ["/compliance", "Compliance"],
      ["/costs", "Costs"],
      ["/audit", "Audit"],
      ["/settings", "Settings"],
    ] as const) {
      await open(page, path);
      await heading(page, h);
    }
  });

  test("deployment onboarding wizard opens", async ({ page }) => {
    await open(page, "/onboard");
    await heading(page, "Deployment onboarding");
  });

  test("customer onboarding opens: TPID, MSX, context, prep", async ({ page }) => {
    await open(page, "/customers/onboard");
    await heading(page, "Onboard a customer");
    await expect(page.getByRole("list", { name: "Steps" })).toContainText("What MSX says");
    await expect(page.getByLabel("TPID")).toBeVisible();
  });

  test("unknown route shows 404", async ({ page, problems }) => {
    problems.allow.push(/document 404/, /status of 404/);
    await page.goto("/definitely-not-a-page");
    await expect(page.getByText("404").first()).toBeVisible();
  });
});
