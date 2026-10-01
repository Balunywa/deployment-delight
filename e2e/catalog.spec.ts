/*
 * Solution catalog, end to end: browse and filter, submit a real GitHub repository through the wizard, manage its
 * owners, feature someone else's solution, adopt an orphaned one, and publish an offering so the solution is
 * promoted to Validated.
 */
import { expect, loaded, open, sql, test } from "./fixtures";

// A public, MIT-licensed azd template (Bicep) outside SAML-enforced organizations, so the GitHub token can read it.
const REPO = process.env["E2E_SOURCE_REPO"] ?? "https://github.com/takyyon/todonodejsmongo8668";
// A subfolder that deploys only services the platform catalog maps, so it can pass review and be published.
const CLEAN = `${REPO}/tree/main/infra/core/database`;
const RUN = Date.now().toString(36);
const NAME = `E2E todo app ${RUN}`;
const CLEAN_NAME = `E2E data tier ${RUN}`;

test.describe.serial("solution catalog", () => {
  test("search, filters, tabs and sort narrow the catalog", async ({ page }) => {
    await open(page, "/products");
    const cards = page.locator("article");
    const total = await cards.count();
    expect(total).toBeGreaterThanOrEqual(16);

    await page.getByPlaceholder(/Search by name/).fill("pipeline");
    await expect(cards).not.toHaveCount(total);
    await expect(cards.first()).toContainText(/pipeline/i);
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(cards).toHaveCount(total);

    // A facet narrows the list and shows as a removable chip.
    await page
      .locator("aside")
      .getByRole("button", { name: /^Hosted\b/ })
      .click();
    const hosted = await cards.count();
    expect(hosted).toBeGreaterThan(0);
    expect(hosted).toBeLessThan(total);
    await expect(page.getByText(`${hosted} of ${total} solutions`)).toBeVisible();
    await page
      .locator("aside")
      .getByRole("button", { name: /^Hosted\b/ })
      .click();
    await expect(cards).toHaveCount(total);

    await page.getByRole("button", { name: /^My solutions/ }).click();
    await expect(page.getByText("You don't own any solutions yet")).toBeVisible();
    await page.getByRole("button", { name: /^Review queue/ }).click();
    await expect(page.getByText("Nothing waiting for review")).toBeVisible();
    await page.getByRole("button", { name: /^All solutions/ }).click();

    await page.getByRole("combobox").filter({ hasText: "Most deployed" }).click();
    await page.getByRole("option", { name: "Name" }).click();
    const names = await cards.locator("a").first().allInnerTexts();
    expect(names.length).toBe(1);
  });

  test("the header shows the signed-in user, not a demo persona", async ({ page }) => {
    await open(page, "/products");
    await expect(page.getByText("E2E Tester · CSA")).toBeVisible();
  });

  test("a solution explains itself: benefits, how it works on the architecture, how to deploy @readonly", async ({
    page,
  }) => {
    await open(page, "/products/22222222-2222-2222-2222-222222222221");
    await loaded(page);
    await expect(page.locator("#benefits article")).toHaveCount(3);
    const how = page.locator("#how-it-works");
    // Steps are numbered on the diagram and follow the selected delivery model's real architecture.
    await expect(how.locator("ol > li").first()).toContainText("1");
    await expect(how.locator('[data-node="aks"]')).toBeVisible();
    await how.getByRole("tab", { name: "Enterprise Private" }).click();
    await expect(how.getByText("Traffic arrives through the customer's hub")).toBeVisible();
    await expect(how.locator('[data-node="hub"]')).toContainText("1");
    await how.getByRole("tab", { name: "Hosted by GridWorks" }).click();
    await expect(how.getByText("Users sign in", { exact: true })).toBeVisible();
    const deploy = page.locator("#deploy");
    await expect(deploy.getByRole("link", { name: /^Deploy .+ v\d/ }).first()).toBeVisible();
    await expect(deploy.getByText("What the customer provides")).toBeVisible();
  });

  test("submit a solution from GitHub through the wizard", async ({ page }) => {
    await open(page, "/products");
    await page.getByRole("button", { name: "Submit a solution" }).click();
    const dialog = page.getByRole("dialog", { name: "Submit a solution" });
    await dialog.locator("#submit-repo").fill(REPO);
    await dialog.getByRole("button", { name: "Inspect" }).click();

    // Checks: pinned commit, Bicep detected, services mapped.
    await expect(dialog.getByText("Pinned source")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText("Bicep", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Repository and revision resolved")).toBeVisible();
    await dialog.getByRole("button", { name: "Next" }).click();

    // Details: industry must be picked, description must be long enough.
    await dialog.locator("#s-name").fill(NAME);
    await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled();
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Power & Renewables" }).click();
    await dialog
      .locator("#s-desc")
      .fill("A React web app with a Node.js API and MongoDB, deployed with Bicep.");
    await dialog.locator("#s-aud").fill("Field engineers");
    await dialog.locator("#s-out").fill("A working web app in minutes");
    await dialog.locator("#s-tags").fill("e2e, sample, nodejs");
    await dialog.locator("#s-support").fill(`${REPO}/issues`);
    await dialog.getByRole("button", { name: "Next" }).click();

    // Owners & rights: the submitter is an owner; add a backup; attest.
    await expect(dialog.getByText("E2E Tester")).toBeVisible();
    await expect(dialog.getByText(/Single owner/)).toBeVisible();
    await dialog.getByRole("button", { name: "Add co-owner" }).click();
    await dialog.getByPlaceholder("Name").fill("Backup Owner");
    await dialog.getByPlaceholder("Email").fill("backup.owner@example.com");
    await expect(dialog.getByText(/Single owner/)).toHaveCount(0);
    await dialog.getByRole("checkbox").click();
    // The whole template uses Container Registry and Static Web Apps, which the platform doesn't offer yet.
    await expect(dialog.getByText(/Submitted as Community · 1 check to resolve/)).toBeVisible();
    await expect(
      dialog.getByText(/Azure resource types are not in the platform catalog/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Submit solution" }).click();

    await page.waitForURL(/\/products\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
    await expect(page.getByText("Community").first()).toBeVisible();
    await expect(page.getByText("For Field engineers")).toBeVisible();
    await expect(page.getByText("#nodejs")).toBeVisible();
    // Its own delivery unit, with a vending request filed on submission.
    await expect(page.getByText("Delivered from")).toBeVisible();
    await expect(page.getByText(/gridworks\/sol-e2e-todo-app/)).toBeVisible();
    await expect(page.getByText("Request ready")).toBeVisible();
    await expect(page.getByText("Rights attested by E2E Tester")).toBeVisible();
    await expect(page.getByText("Backup Owner")).toBeVisible();
    // Blocked from publication, so nobody can deploy it yet.
    await expect(page.getByRole("heading", { name: "What's blocking publication" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Not deployable yet" })).toBeDisabled();
    await page.getByRole("link", { name: "Review" }).first().click();
    await loaded(page);
    await expect(page.getByRole("button", { name: /^Publish v0\.1\.0$/ })).toBeDisabled();
  });

  test("the submission is mine, in the catalog and in the review queue for others", async ({
    page,
  }) => {
    await open(page, "/products?tab=mine");
    await expect(page.locator("article")).toHaveCount(1);
    // Others see it in their review queue; its owner doesn't.
    await expect(page.getByRole("button", { name: /^Review queue\s*0/ })).toBeVisible();
    await expect(page.locator("article")).toContainText(NAME);
    await expect(page.locator("article")).toContainText("Yours");
    // Not deployable until an offering is published.
    await expect(page.locator("article").getByRole("link", { name: "View checks" })).toBeVisible();
  });

  test("owners confirm and edit ownership; owners can't feature their own", async ({ page }) => {
    await open(page, "/products?tab=mine");
    await page.locator("article a").first().click();
    await loaded(page);
    await page.getByRole("button", { name: "I still own this" }).click();
    await expect(page.getByText(/Ownership confirmed for another 90 days/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Feature this solution/ })).toHaveCount(0);

    await page.locator("aside").getByRole("button", { name: "Edit" }).click();
    await page.locator("aside").getByRole("button", { name: "Add owner" }).click();
    const names = page.locator("aside").getByPlaceholder("Name");
    await names.last().fill("Third Owner");
    await page.locator("aside").getByPlaceholder("Email").last().fill("third@example.com");
    await page.locator("aside").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Owners updated.")).toBeVisible();
    await expect(page.getByText("Third Owner")).toBeVisible();
    await expect(page.getByText("changed the owners")).toBeVisible();
  });

  test("a clean source passes review, publishes and becomes Validated and deployable", async ({
    page,
  }) => {
    await open(page, "/products");
    await page.getByRole("button", { name: "Submit a solution" }).click();
    const dialog = page.getByRole("dialog", { name: "Submit a solution" });
    await dialog.locator("#submit-repo").fill(CLEAN);
    await dialog.getByRole("button", { name: "Inspect" }).click();
    await expect(dialog.getByText("Every detected Azure resource type is mapped")).toBeVisible({
      timeout: 60_000,
    });
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.locator("#s-name").fill(CLEAN_NAME);
    await dialog
      .locator("#s-desc")
      .fill("Cosmos DB, PostgreSQL and SQL data tier with Key Vault secrets.");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Other…" }).click();
    await dialog.getByPlaceholder("e.g. Healthcare").fill("Data platforms");
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("checkbox").click();
    await expect(
      dialog.getByText(/Submitted as Community · ready for architecture review/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Submit solution" }).click();
    await page.waitForURL(/\/products\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1, name: CLEAN_NAME })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What's blocking publication" })).toHaveCount(0);

    await page.getByRole("link", { name: "Review" }).first().click();
    await loaded(page);
    const publish = page.getByRole("button", { name: /^Publish v0\.1\.0$/ });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByText(/v0\.1\.0 published/).first()).toBeVisible();

    // A custom industry becomes a filter, and the solution is now Validated and deployable.
    await open(page, "/products");
    await page
      .locator("aside")
      .getByRole("button", { name: /^Data platforms\b/ })
      .click();
    const card = page.locator("article").filter({ hasText: CLEAN_NAME });
    await expect(card).toContainText("Validated");
    await card.getByRole("link", { name: "Deploy" }).click();
    await expect(page).toHaveURL(/\/onboard\?product=/);
    await loaded(page);
    await expect(page.getByRole("heading", { name: "Onboard a customer" })).toBeVisible();
    await expect(page.getByText(CLEAN_NAME).first()).toBeVisible();
  });

  test("a reviewer features someone else's solution, and takes it back", async ({ page }) => {
    await open(page, "/products");
    await page.getByPlaceholder(/Search by name/).fill("Pipeline integrity agent");
    await page.locator("article a").first().click();
    await loaded(page);
    await page.getByRole("button", { name: "Feature this solution" }).click();
    await expect(page.getByText("Solution featured.")).toBeVisible();
    await expect(page.getByText("Featured").first()).toBeVisible();
    await page.getByRole("button", { name: "Remove from featured" }).click();
    await expect(page.getByText("No longer featured.")).toBeVisible();
  });

  test("anyone can adopt an orphaned solution", async ({ page }) => {
    const [row] = await sql<{ id: string }>(
      "update public.products set owners = '[]'::jsonb where name = 'Retirement and restoration planner' returning id",
    );
    await open(page, `/products/${row!.id}`);
    await expect(page.getByText(/No owner on record/)).toBeVisible();
    await page.getByRole("button", { name: "Adopt this solution" }).click();
    await page.locator("aside").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Owners updated.")).toBeVisible();
    await expect(page.locator("aside").getByText("E2E Tester")).toBeVisible();
    await expect(page.getByRole("button", { name: "I still own this" })).toBeVisible();
  });

  test("a repository already in the catalog is rejected", async ({ page, problems }) => {
    problems.allow.push(
      /server function 500/,
      /status of 500/,
      /error toast: This repository is already/,
    );
    await open(page, "/products?submit=true");
    const dialog = page.getByRole("dialog", { name: "Submit a solution" });
    await dialog.locator("#submit-repo").fill(REPO);
    await dialog.getByRole("button", { name: "Inspect" }).click();
    await expect(dialog.getByText("Pinned source")).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.locator("#s-name").fill(`${NAME} again`);
    await dialog.locator("#s-desc").fill("The same repository submitted a second time.");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Power & Renewables" }).click();
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Submit solution" }).click();
    await expect(page.getByText(/This repository is already in the catalog/)).toBeVisible();
  });
});
