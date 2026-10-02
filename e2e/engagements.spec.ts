/*
 * Engagements, end to end: a conversation navigator for listening before solutioning. One question at a time,
 * answers that route to the next question with a reason, a working summary labelled confirmed / hypothesis /
 * unknown, examples chosen by what the customer said, owned next steps, and a customer recap that never contains
 * hypotheses or internal notes.
 */
import { OSDU, expect, loaded, open, seedInstalledBase, sql, test } from "./fixtures";

const DEMO = "44444444-4444-4444-8444-000000000001";
const NAME = `E2E engagement ${Date.now().toString(36)}`;

test.describe.serial("engagements", () => {
  test("the demo engagement: working summary, handoff and a customer-safe recap (demo data)", async ({
    page,
  }) => {
    await open(page, "/");
    await expect(page.getByRole("heading", { name: "Engagements" })).toBeVisible();

    await open(page, `/engagements/${DEMO}`);
    await loaded(page);
    await expect(
      page.getByRole("heading", { level: 1, name: /Maintenance work packages/ }),
    ).toBeVisible();
    const summary = page.getByRole("region", { name: "Working summary" });
    await expect(
      summary.getByText("Safety and regulatory approvals stay with a person, always."),
    ).toBeVisible();
    await expect(summary.getByText("AI suggestion")).toBeVisible();
    // Validate puts a hypothesis to the customer as a question, not a conclusion.
    await expect(page.getByRole("article", { name: "Hypothesis to test" })).toContainText(
      "Most of the time goes into gathering information, not deciding.",
    );

    await open(page, `/engagements/${DEMO}?tab=fit`);
    await expect(page.getByText("Is an agent the right answer yet?")).toBeVisible();
    await expect(page.getByText(/Where the agent comes in: /).first()).toBeVisible();

    await open(page, `/engagements/${DEMO}?tab=handoff`);
    await expect(page.getByText(/Internal\. For the CSA and delivery team/)).toBeVisible();
    await expect(page.getByLabel("Internal notes")).toHaveValue(/Dana has budget/);

    // The customer view gets only what the customer confirmed: no hypotheses, no internal notes.
    await open(page, `/recap/${DEMO}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Maintenance work packages/ }),
    ).toBeVisible();
    await expect(
      page.getByText("Safety and regulatory approvals stay with a person, always."),
    ).toBeVisible();
    await expect(
      page.getByText("Confirm read access to the maintenance system replica."),
    ).toBeVisible();
    await expect(
      page.getByText("How accurately the handwritten permits can be read."),
    ).toBeVisible();
    await expect(page.getByText(/Most of the time goes into gathering/)).toHaveCount(0);
    await expect(page.getByText(/Nightly data is enough to draft/)).toHaveCount(0);
    await expect(page.getByText(/Dana has budget/)).toHaveCount(0);
    // No app chrome: safe on a shared screen.
    await expect(page.getByText("Onboard customer")).toHaveCount(0);
  });

  test("from the customer's words to a proof, with a recap that leaves hypotheses out", async ({
    page,
  }) => {
    await open(page, "/engagements");
    await page.getByRole("button", { name: "Start an engagement" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Engagement").fill(NAME);
    await dialog.getByRole("button", { name: "Start listening" }).click();
    await page.waitForURL(/\/engagements\/[0-9a-f-]{36}/);
    await loaded(page);
    const id = page.url().match(/engagements\/([0-9a-f-]{36})/)![1]!;

    // Opening: what they said, in customer language, not Microsoft conversation names.
    await page.getByRole("button", { name: /Our AI answers aren't reliable/ }).click();
    await page
      .getByLabel("In their words")
      .fill("The agent gives different answers to the same question.");
    await page.getByRole("button", { name: "Start the conversation" }).click();

    // Always starts from the outcome, before any technology.
    const card = page.getByRole("article", { name: "Current question" });
    await expect(card).toContainText("If this goes well, what's different a year from now");
    await expect(card).toContainText("Start with the outcome, before any technology.");
    await card.getByLabel("Customer's words").fill("Field engineers trust the answers they get.");
    await card.getByRole("button", { name: "Record answer" }).click();
    await expect(page.getByText("Recorded.", { exact: true })).toBeVisible();

    // Then the opener for what they said, with the reason.
    await expect(card).toContainText("When the answer is wrong, what's usually missing?");
    await expect(card).toContainText("Because they opened with");
    await card.getByRole("button", { name: /It doesn't know what our terms mean/ }).click();
    await expect(card).toContainText("A context problem, not a model problem.");
    await card.getByRole("button", { name: "Record answer" }).click();
    await expect(page.getByText("Recorded. 1 new finding in the summary.")).toBeVisible();

    // The answer routes to the follow-up, and says why.
    await expect(card).toContainText("Does a key term mean the same thing everywhere?");
    await expect(card).toContainText("Because they said “It doesn't know what our terms mean”.");
    await card.getByRole("button", { name: /No, teams define it differently/ }).click();
    await card
      .getByLabel("Customer's words")
      .fill("Operations and finance count downtime differently.");
    await card.getByRole("button", { name: "Record answer" }).click();
    const summary = page.getByRole("region", { name: "Working summary" });
    await expect(
      summary.getByText("Key terms are defined differently across teams."),
    ).toBeVisible();
    await expect(
      summary.getByText("“Operations and finance count downtime differently.”"),
    ).toBeVisible();

    // A presenter hypothesis that must never reach the customer.
    await summary.getByLabel("New finding").fill("They may be about to buy a competing tool.");
    await summary.getByLabel("New finding").press("Enter");
    await expect(page.getByText("Added to the summary.")).toBeVisible();

    // Validate: test a hypothesis with the customer.
    const map = page.getByRole("navigation", { name: "Conversation map" });
    await map.getByRole("button", { name: /Validate/ }).click();
    const hyp = page.getByRole("article", { name: "Hypothesis to test" });
    await expect(hyp).toContainText("Business meaning isn't shared or written down");
    await hyp.getByRole("button", { name: "Yes, that's right" }).click();
    await expect(page.getByText("Confirmed by the customer.")).toBeVisible();

    // Fit & gap: examples follow from the answers; the meaning gate is blocked, so not an agent yet.
    await page
      .getByRole("navigation", { name: "Engagement" })
      .getByRole("button", { name: "Fit & gap" })
      .click();
    await expect(
      page.getByText(/Not an agent yet\. First: it knows what the data means/),
    ).toBeVisible();
    await page
      .locator("li", {
        has: page.getByRole("link", { name: "Agentic Apps on a Unified Data Foundation" }),
      })
      .getByRole("button", { name: "Use for the proof" })
      .click();
    await expect(page.getByText("Added to the proof.")).toBeVisible();

    // Agree: a next step from the conversation, with an owner.
    await page
      .getByRole("navigation", { name: "Engagement" })
      .getByRole("button", { name: "Conversation" })
      .click();
    await map.getByRole("button", { name: /Agree/ }).click();
    const step = "Architecture design session with the enterprise architect.";
    await page.locator("li", { hasText: step }).getByRole("button", { name: "Agree" }).click();
    await expect(page.getByText("Added. Give it an owner and a date.")).toBeVisible();
    await page.getByLabel(`Owner: ${step}`).fill("Data platform lead");
    await page.getByLabel(`Owner: ${step}`).blur();
    await expect(page.getByText("1 action needs an owner or a date.")).toBeVisible();

    // Internal notes stay internal.
    await page
      .getByRole("navigation", { name: "Engagement" })
      .getByRole("button", { name: "Handoff" })
      .click();
    await page.getByLabel("Internal notes").fill("Competitive pressure from another vendor.");
    await page.getByRole("button", { name: "Save notes" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

    // The customer view: confirmed findings and agreed steps only.
    await open(page, `/recap/${id}`);
    await expect(page.getByText("Key terms are defined differently across teams.")).toBeVisible();
    await expect(page.getByText(step)).toBeVisible();
    await expect(page.getByText("Data platform lead")).toBeVisible();
    await expect(page.getByText(/competing tool/)).toHaveCount(0);
    await expect(page.getByText(/Competitive pressure/)).toHaveCount(0);

    // Prove: with no customer linked, there's nowhere to deploy it yet; the decision is still audited.
    await open(page, `/engagements/${id}?tab=prove`);
    await expect(page.getByText(/Link this engagement to a customer in Prep/)).toBeVisible();
    await page.getByLabel("Decision note").fill("Agree definitions first, then a proof.");
    await page.getByRole("button", { name: "Iterate on the PoC" }).click();
    await expect(page.getByText("Decision recorded.")).toBeVisible();
    await expect(page.getByText("Decided: iterate")).toBeVisible();
    const [row] = await sql<{ stage: string; trail: number; findings: number }>(
      "select stage, jsonb_array_length(trail)::int as trail, jsonb_array_length(findings)::int as findings from public.engagements where id = $1",
      [id],
    );
    expect(row).toEqual({ stage: "decided", trail: 3, findings: 3 });
    const [audit] = await sql<{ n: number }>(
      "select count(*)::int as n from public.audit_events where event_type = 'engagement.decided' and resource_id = $1",
      [id],
    );
    expect(audit!.n).toBe(1);
  });

  test("realize value: scaled, in production, measured, confirmed by the owner; commercial stays internal", async ({
    page,
  }) => {
    await seedInstalledBase();
    const [row] = await sql<{ id: string }>(
      `insert into public.engagements (organization_id, customer_id, name, stage, owner_name, brief, solution_map, results)
       select c.organization_id, c.id, $1, 'prove', 'E2E Tester',
         '{"owner": "Head of Subsurface Data", "outcome": "Well data loaded in hours, not weeks."}'::jsonb,
         jsonb_build_array(jsonb_build_object('concept', 'data', 'products', jsonb_build_array($2::text), 'note', '')),
         '[{"metric": "Days to load a new well", "unit": "days", "baseline": "10", "target": "2", "measured": "3"}]'::jsonb
       from public.customers c where c.customer_code = 'coastal-power' returning id`,
      [`E2E realize ${Date.now().toString(36)}`, OSDU.product],
    );
    const id = row!.id;

    await open(page, `/engagements/${id}?tab=prove`);
    await page.getByRole("button", { name: "Scale it to production" }).click();
    await expect(page.getByText("Decision recorded. Next: realize the value.")).toBeVisible();

    await open(page, `/engagements/${id}?tab=realize`);
    await expect(page.getByText("In production", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/PROD · v0\.46\.0 · healthy/)).toBeVisible();
    // The owner can't confirm value that nobody has measured in production.
    await expect(
      page.getByRole("button", { name: "Record the owner's confirmation" }),
    ).toBeDisabled();
    await page.getByLabel("Days to load a new well at 30 days").fill("2.5");
    await page.getByLabel("Adoption").fill("All four data loaders use it for every new well.");
    await page.getByRole("button", { name: "Save measures" }).click();
    await expect(page.getByText("Measures saved.")).toBeVisible();

    // Internal: MSX links and the milestone update to paste.
    const msx = page.getByRole("region", { name: "Microsoft commercial" });
    await msx.getByLabel("MSX opportunity link").fill("https://msx.example.com/opportunity/123");
    await msx.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Opportunity linked.")).toBeVisible();
    await msx.getByLabel("Milestone name").fill("Coastal Power: OSDU in production");
    await msx.getByLabel("Milestone link").fill("https://msx.example.com/milestone/456");
    await msx.getByRole("button", { name: "Link" }).click();
    await expect(page.getByText("Milestone linked.")).toBeVisible();
    await expect(msx.getByLabel("Milestone update")).toContainText(
      "Status: In production; measuring value",
    );
    await expect(msx.getByLabel("Milestone update")).toContainText(
      "Days to load a new well (days): 10 → 2.5, at 30 days; target 2",
    );
    await expect(msx.getByText("$9,800/month")).toBeVisible();

    await expect(page.getByLabel("Confirmed by")).toHaveValue("Head of Subsurface Data");
    await page.getByLabel("What the owner said").fill("We load wells the same day now.");
    await page.getByRole("button", { name: "Record the owner's confirmation" }).click();
    await expect(page.getByText("Value confirmed and recorded in the audit log.")).toBeVisible();
    await expect(page.getByText("Value realized")).toBeVisible();

    const [state] = await sql<{ stage: string; by: string }>(
      "select stage, realization->'confirmed'->>'by' as by from public.engagements where id = $1",
      [id],
    );
    expect(state).toEqual({ stage: "decided", by: "Head of Subsurface Data" });
    const [audit] = await sql<{ n: number }>(
      "select count(*)::int as n from public.audit_events where event_type = 'engagement.value_confirmed' and resource_id = $1",
      [id],
    );
    expect(audit!.n).toBe(1);

    // The customer sees what it's delivering and who confirmed it; never MSX or cost.
    await open(page, `/recap/${id}`);
    await expect(page.getByText("In production: OSDU Developer Platform")).toBeVisible();
    await expect(page.getByRole("cell", { name: /2\.5/ })).toBeVisible();
    await expect(page.getByText(/Confirmed by Head of Subsurface Data/)).toBeVisible();
    await expect(page.getByText(/msx\.example\.com|MSX|\$9,800/)).toHaveCount(0);
  });
});
