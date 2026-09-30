/*
 * Operating the installed base, end to end: releases and rollouts, a pipeline run through approval, customer
 * actions (preflight, drift, deploy, connection), a new landing zone with its delivery unit, and branding.
 */
import { expect, loaded, open, sql, test } from "./fixtures";

async function one<T>(text: string): Promise<T | undefined> {
  return (await sql<T>(text))[0];
}

test.describe.serial("operations", () => {
  test("releases: plan a rollout and start its first ring", async ({ page }) => {
    await open(page, "/upgrades");
    const rollOut = page.getByRole("button", { name: /^Roll out v/ });
    await expect(rollOut).toBeVisible();
    await rollOut.click();
    await page.getByRole("button", { name: "Create rollout" }).click();
    await expect(page.getByText("Rollout created. Start Ring 0 when you're ready.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rollouts" })).toBeVisible();
    await page.getByTitle("Create plans for this ring").first().click();
    await expect(page.getByText(/pipeline run\(s\)/)).toBeVisible();
  });

  test("a production run waits for approval, then runs", async ({ page }) => {
    const run = await one<{ id: string }>(
      "select id from public.deployments where status = 'AWAITING_APPROVAL' order by requested_at desc limit 1",
    );
    expect(run, "the seed has a run awaiting approval").toBeTruthy();
    await open(page, `/deployments/${run!.id}`);
    await page.getByRole("button", { name: "Approve & queue" }).click();
    const runIt = page.getByRole("button", { name: "Run pipeline" });
    await expect(runIt).toBeVisible();
    await runIt.click();
    await expect(page.getByText(/Run succeeded — install is live/)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("customer actions: preflight, drift, deploy, drift decision, connection test", async ({
    page,
  }) => {
    const c = await one<{ id: string }>(
      `select e.customer_id as id from public.drift_findings d join public.environments e on e.id = d.environment_id
       where d.status = 'open' limit 1`,
    );
    expect(c, "the seed has an open drift finding").toBeTruthy();
    await open(page, `/customers/${c!.id}`);
    await page.getByRole("button", { name: "Check landing zone" }).first().click();
    await page.getByRole("button", { name: "Detect drift" }).first().click();
    await page
      .getByRole("button", { name: /^(Plan upgrade to v|Plan initial deploy|Re-run pipeline)/ })
      .first()
      .click();
    await expect(page.getByText(/Pipeline run created/)).toBeVisible();

    await page.getByRole("tab", { name: /^Drift/ }).click();
    await page.getByRole("button", { name: "Accept as customization" }).first().click();
    await expect(page.getByText("Drift decision recorded and audited.")).toBeVisible();

    await page.getByRole("tab", { name: "Access" }).click();
    const test_ = page.getByRole("button", { name: "Test connection" });
    if (await test_.count()) {
      await test_.first().click();
      await expect(page.getByText("Azure connection validated.")).toBeVisible();
    }
  });

  test("a new landing zone gets its own lz- delivery unit", async ({ page }) => {
    await open(page, "/foundations");
    await page.getByRole("button", { name: "New landing zone" }).click();
    const dialog = page.getByRole("dialog", { name: "New landing zone" });
    await dialog.getByRole("combobox").first().click();
    const option = page.getByRole("option").first();
    const customer = (await option.innerText()).trim();
    await option.click();
    await dialog.getByPlaceholder("e.g. contoso").fill("e2elz");
    await dialog.getByPlaceholder("secops@example.com").fill("secops@example.com");
    await dialog.getByRole("button", { name: /^Create/ }).click();
    await expect(
      page.getByText("Landing zone created. Review the design, then deploy it."),
    ).toBeVisible();
    await page.waitForURL(/\/foundations\/[0-9a-f-]{36}$/);
    await loaded(page);
    await expect(
      page.getByRole("heading", { level: 1, name: `${customer} landing zone` }),
    ).toBeVisible();
    const unit = page.getByRole("link", { name: /^gridworks\/lz-/ });
    await expect(unit).toBeVisible();
    await unit.click();
    await loaded(page);
    await expect(page.getByText("Request ready").first()).toBeVisible();
    await expect(page.getByText(/managementGroups\/e2elz/).first()).toBeVisible();
  });

  test("branding changes save", async ({ page }) => {
    await open(page, "/settings");
    await page.getByRole("button", { name: "Save branding" }).click();
    await expect(page.getByText("Branding updated.")).toBeVisible();
  });

  test("installed base, compliance, costs and audit reflect the activity", async ({ page }) => {
    await open(page, "/estate");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    await open(page, "/audit");
    await expect(page.getByText(/drift/i).first()).toBeVisible();
    await open(page, "/costs");
    await expect(page.getByText(/\$/).first()).toBeVisible();
  });
});
