/*
 * The whole journey, the way an SE and a CSA live it: start from the customer, listen, choose a solution because of
 * what they said, deploy the proof into the customer's own Azure through the real plan → approve → run path, decide,
 * hand off to the CSA, deploy production, measure value and close it with the owner's confirmation. Every step is
 * reached from the one before it, without typing a URL.
 */
import { expect, loaded, open, sql, test } from "./fixtures";

const NAME = `Permit packs in a day ${Date.now().toString(36)}`;

test("an SE and a CSA take a customer from first conversation to realized value", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // The account: start from the customer, not from a product.
  await open(page, "/customers");
  await page
    .getByRole("link", { name: /Coastal Power/ })
    .first()
    .click();
  await loaded(page);
  const account = page.getByRole("region", { name: "Engagements with this customer" });
  await account.getByRole("link", { name: /Start one with this customer/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Customer" })).toContainText("Coastal Power");
  await dialog.getByLabel("Engagement").fill(NAME);
  await dialog.getByRole("button", { name: "Start listening" }).click();
  await page.waitForURL(/\/engagements\/[0-9a-f-]{36}/);
  await loaded(page);
  const id = page.url().match(/engagements\/([0-9a-f-]{36})/)![1]!;
  const tabs = page.getByRole("navigation", { name: "Engagement" });
  const card = page.getByRole("article", { name: "Current question" });
  const record = () => card.getByRole("button", { name: "Record answer" }).click();

  // Listen: their words, the outcome, then what's actually wrong.
  await page.getByRole("button", { name: /Our AI answers aren't reliable/ }).click();
  await page.getByLabel("In their words").fill("The copilot misreads our permit packs.");
  await page.getByRole("button", { name: "Start the conversation" }).click();
  await card.getByLabel("Customer's words").fill("Permit packs checked in a day, not a week.");
  await record();
  await expect(card).toContainText("When the answer is wrong, what's usually missing?");
  await card
    .getByRole("button", { name: /finds the right document but gets the detail wrong/ })
    .click();
  await record();
  await expect(card).toContainText("Where does the knowledge this work needs actually live?");
  await card
    .getByRole("button", { name: /Documents: manuals, procedures, permits, forms/ })
    .click();
  await card.getByLabel("Customer's words").fill("Scanned permit packs, about 40 pages each.");
  await record();
  await expect(page.getByRole("region", { name: "Working summary" })).toContainText(
    "The knowledge lives mostly in documents.",
  );

  // How they measure it today, and what a proof must respect.
  const map = page.getByRole("navigation", { name: "Conversation map" });
  await map.getByRole("button", { name: /Understand/ }).click();
  await page
    .getByRole("button", { name: /Ask something else: all \d+ understand questions/ })
    .click();
  await page
    .getByRole("button", { name: /How do you measure this work today\?/ })
    .last()
    .click();
  await card.getByRole("button", { name: /We measure it/ }).click();
  await card.getByLabel("Customer's words").fill("Days to check a permit pack");
  await record();
  await map.getByRole("button", { name: /Validate/ }).click();
  await page.getByRole("button", { name: /What must a proof respect\?/ }).click();
  await card.getByRole("button", { name: /Data stays in our tenant/ }).click();
  await record();

  // Our team, so the handoff has a name on it.
  await tabs.getByRole("button", { name: "Prep" }).click();
  await page.getByLabel("Cloud solution architect").fill("Jordan Lee");
  await page.getByRole("button", { name: "Save team" }).click();
  await expect(page.getByText("Team saved.")).toBeVisible();

  // Fit & gap: the answers point to Content Processing.
  await tabs.getByRole("button", { name: "Fit & gap" }).click();
  await page
    .locator("li", { has: page.getByRole("link", { name: "Content Processing", exact: true }) })
    .getByRole("button", { name: "Use for the proof" })
    .click();
  await expect(page.getByText("Added to the proof.")).toBeVisible();

  // Prove: deploy into the existing customer, in their tenant, because they said so.
  await tabs.getByRole("button", { name: "Prove", exact: true }).click();
  await page.getByRole("button", { name: "Deploy the proof" }).click();
  const deploy = page.getByRole("dialog");
  await expect(deploy.getByRole("button", { name: /In their Azure tenant/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(deploy).toContainText(
    "Suggested because they confirmed: “Data must stay in the company's own Azure tenant.”",
  );
  await deploy.getByRole("button", { name: "Plan the deployment" }).click();
  await page.waitForURL(/\/deployments\/[0-9a-f-]{36}/);
  await loaded(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Coastal Power PROOF");

  // The queue knows the plan is waiting, and takes you straight to it.
  await open(page, "/engagements");
  const queue = page.getByRole("region", { name: "Needs you" });
  await queue
    .getByRole("link", { name: /Plan waiting for review: PROOF for Coastal Power/ })
    .click();
  await loaded(page);
  await page.getByRole("button", { name: "Approve & queue" }).click();
  await page.getByRole("button", { name: "Run pipeline" }).click();
  await expect(page.getByText(/Run succeeded — install is live/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: `Proof for “${NAME}”` }).click();
  await loaded(page);
  await expect(page.getByText("Proof running")).toBeVisible();

  // Measure the proof and decide to scale it.
  await page.getByLabel("Days to check a permit pack baseline").fill("5");
  await page.getByLabel("Days to check a permit pack target").fill("1");
  await page.getByLabel("Days to check a permit pack measured").fill("1.5");
  await page.getByRole("button", { name: "Save measures" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.getByLabel("Decision note").fill("Scale it for both regions.");
  await page.getByRole("button", { name: "Scale it to production" }).click();
  await expect(page.getByText("Decision recorded. Next: realize the value.")).toBeVisible();

  // The SE hands it to the CSA named in Prep.
  await tabs.getByRole("button", { name: "Handoff" }).click();
  await expect(page.getByLabel("CSA")).toHaveValue("Jordan Lee");
  await page.getByLabel("Handoff note").fill("Security wants the audit trail in the proof report.");
  await page.getByRole("button", { name: "Hand off" }).click();
  await expect(
    page.getByText("Handed off to Jordan Lee. Recorded in the audit log."),
  ).toBeVisible();

  // The CSA takes it to production: security approves, then it runs.
  await tabs.getByRole("button", { name: "Realize value" }).click();
  await page.getByRole("button", { name: "Deploy to production" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Plan the deployment" }).click();
  await page.waitForURL(/\/deployments\/[0-9a-f-]{36}/);
  await loaded(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Coastal Power PROD");
  await page.getByRole("button", { name: "Approve & queue" }).click();
  await page.getByRole("button", { name: "Run pipeline" }).click();
  await expect(page.getByText(/Run succeeded — install is live/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: `Production for “${NAME}”` }).click();
  await loaded(page);
  await expect(page.getByText("In production", { exact: true }).first()).toBeVisible();

  // Realize: the owner's numbers in production, and their confirmation.
  await page.getByLabel("Days to check a permit pack at 30 days").fill("1.2");
  await page.getByRole("button", { name: "Save measures" }).click();
  await expect(page.getByText("Measures saved.")).toBeVisible();
  await page.getByLabel("Confirmed by").fill("Head of Operations, Coastal Power");
  await page.getByLabel("What the owner said").fill("Permit packs are checked the same day.");
  await page.getByRole("button", { name: "Record the owner's confirmation" }).click();
  await expect(page.getByText("Value confirmed and recorded in the audit log.")).toBeVisible();

  // Back on the account, the engagement reads as done.
  await open(page, "/customers");
  await page
    .getByRole("link", { name: /Coastal Power/ })
    .first()
    .click();
  await loaded(page);
  await expect(
    page
      .getByRole("region", { name: "Engagements with this customer" })
      .getByRole("link", { name: new RegExp(NAME) }),
  ).toContainText("Value realized");

  const events = await sql<{ event_type: string }>(
    `select event_type from public.audit_events where resource_type = 'engagement' and resource_id = $1 order by "timestamp"`,
    [id],
  );
  expect(events.map((x) => x.event_type)).toEqual(
    expect.arrayContaining([
      "engagement.started",
      "engagement.proof_requested",
      "engagement.decided",
      "engagement.handed_off",
      "engagement.production_requested",
      "engagement.value_confirmed",
    ]),
  );
  const [customers] = await sql<{ n: number }>(
    "select count(*)::int as n from public.customers where customer_code like 'coastal-power%'",
  );
  expect(customers!.n).toBe(1);
});
