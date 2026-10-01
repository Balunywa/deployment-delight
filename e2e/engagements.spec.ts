/*
 * Engagements, end to end: listen before solutioning. A new engagement goes Listen → Assess → Map → Propose →
 * Prove and ends in a recorded decision; the story is generated for each audience from what was captured.
 */
import { expect, loaded, open, sql, test } from "./fixtures";

const NAME = `E2E engagement ${Date.now().toString(36)}`;

test.describe.serial("engagements", () => {
  test("the demo engagement tells its story to each audience @readonly", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByRole("heading", { name: "Engagements" })).toBeVisible();
    await open(page, "/engagements/44444444-4444-4444-8444-000000000001?view=propose");
    await loaded(page);
    await expect(
      page.getByRole("heading", { level: 1, name: /Maintenance work packages/ }),
    ).toBeVisible();
    // Customer executives: the workflow, the barriers in plain words, the ask. Baselines never guessed.
    await expect(page.getByText(/It's no path for AI into the live workflow/)).toBeVisible();
    await expect(page.getByText("The ask")).toBeVisible();
    await expect(page.getByText(/baseline to measure/).first()).toBeVisible();
    await page.getByRole("tab", { name: "Technical & field" }).click();
    await expect(page.getByRole("heading", { name: "Dependencies", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Internal" }).click();
    await expect(page.getByText(/Never in customer material/)).toBeVisible();
    await expect(page.getByText(/Commercial measures \(internal only/)).toBeVisible();
  });

  test("listen, assess, map, propose and prove a new engagement", async ({ page }) => {
    await open(page, "/engagements");
    await page.getByRole("button", { name: "Start an engagement" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Engagement").fill(NAME);
    await dialog.getByLabel(/The workflow that should change/).fill("Permit-to-work review");
    await dialog.getByRole("button", { name: "Start listening" }).click();
    await page.waitForURL(/\/engagements\/[0-9a-f-]{36}/);
    await loaded(page);

    // Listen: the business problem, the owner and a baseline, in the customer's words.
    await page
      .getByPlaceholder(/Who does it, how long/)
      .fill("Permits are checked by hand against procedures.");
    await page
      .getByPlaceholder("What's different when it works")
      .fill("Permits are pre-checked and flagged in minutes.");
    await page.getByPlaceholder(/VP Maintenance/).fill("HSE Director");
    await page.getByLabel("Metric").first().fill("Time to review a permit");
    await page.getByLabel("Unit").first().fill("hours");
    await page.getByRole("button", { name: /Continue to Assess/ }).click();
    await expect(page.getByText("Saved. On to Assess.")).toBeVisible();

    // Assess: every concept rated.
    for (const group of await page.getByRole("radiogroup").all())
      await group.getByRole("radio", { name: "Partly there" }).click();
    await page
      .locator('[data-concept="workflows"]')
      .getByRole("radio", { name: "Blocks value" })
      .click();
    await page.getByRole("button", { name: /Continue to Map/ }).click();
    await expect(page.getByText("Saved. On to Map.")).toBeVisible();

    // Map: the blocking priority first, with a catalog accelerator chosen.
    await expect(page.locator("[data-concept]").first()).toHaveAttribute(
      "data-concept",
      "workflows",
    );
    await page
      .locator('[data-concept="workflows"]')
      .getByRole("button", { name: /Multi-Agent Custom Automation Engine/ })
      .click();
    await page.getByRole("button", { name: /Continue to Propose/ }).click();
    await expect(page.getByText("Saved. On to Propose.")).toBeVisible();

    // Propose: the generated story names the workflow, the accelerator and the unmeasured baseline.
    await expect(
      page.getByText(/the work that matters most right now is permit-to-work review/),
    ).toBeVisible();
    await expect(
      page.getByText(/We'd start from Multi-Agent Custom Automation Engine/),
    ).toBeVisible();
    await expect(page.getByText("Time to review a permit: baseline to measure")).toBeVisible();
    await page.getByRole("button", { name: /Continue to Prove/ }).click();

    // Prove: a PoC from the catalog, then a recorded decision.
    await expect(page.getByRole("link", { name: /Deploy a PoC/ })).toHaveAttribute(
      "href",
      /\/onboard\?product=33333333-3333-4333-8333-100000000007/,
    );
    await page.getByLabel("Decision note").fill("Run the PoC on two sites first.");
    await page.getByRole("button", { name: "Iterate on the PoC" }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible();
    await expect(page.getByText("Decided: iterate")).toBeVisible();
    const [audit] = await sql<{ n: number }>(
      "select count(*)::int as n from public.audit_events where event_type = 'engagement.decided'",
    );
    expect(audit!.n).toBeGreaterThan(0);
  });
});
