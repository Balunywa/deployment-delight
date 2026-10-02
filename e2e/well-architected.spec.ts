/*
 * Well-Architected design of an offering: the guided session (requirements, services, live impact and score),
 * the computed flows per lens, the scorecard with one-click fixes and the design document, the guide pages, and a
 * new offering started from an Azure Architecture Center reference design.
 */
import { expect, loaded, open, test } from "./fixtures";

test("guided design session: steps, live impact, score and flows @readonly", async ({ page }) => {
  await open(page, "/offerings?view=architecture&mode=guided");
  const steps = page.getByRole("navigation", { name: "Design steps" });
  await expect(steps).toBeVisible();
  await expect(page.getByRole("region", { name: "Well-Architected score" })).toBeVisible();

  // Adding a compute service shows what it changes before anything is saved.
  await steps.getByRole("button", { name: /Compute/ }).click();
  await expect(page.getByRole("heading", { name: "Where does the code run?" })).toBeVisible();
  const add = page.getByRole("button", { name: /^Add / }).first();
  const name = ((await add.getAttribute("aria-label")) ?? "").replace(/^Add /, "");
  await add.click();
  const changed = page.getByRole("region", { name: "What changed" });
  await expect(changed).toContainText(`What changed: Added ${name}`);
  await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible();

  // The live picture is the workload's own traffic, computed from the design.
  await expect(page.getByRole("img", { name: /Traffic flows of this workload/ })).toBeVisible();

  // Review ends the session with the findings and the design document.
  await steps.getByRole("button", { name: /Review/ }).click();
  await expect(page.getByRole("heading", { name: /Is it well-architected/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download design document" }).first().click();
  expect((await download).suggestedFilename()).toMatch(/-design\.md$/);
});

test("flows: traffic, identity, logging and deployment are drawn per lens @readonly", async ({
  page,
}) => {
  await open(page, "/offerings?view=flows");
  await expect(
    page.getByRole("heading", { name: "How this workload works, end to end" }),
  ).toBeVisible();
  const lenses = page.getByRole("tablist", { name: "Flows" });
  for (const [lens, picture] of [
    ["Identity", /Identity flows of this workload/],
    ["Logging", /Logging flows of this workload/],
    ["Deploy", /Deploy flows of this workload/],
    ["Traffic", /Traffic flows of this workload/],
  ] as const) {
    await lenses.getByRole("tab", { name: new RegExp(`^${lens}`) }).click();
    await expect(page.getByRole("img", { name: picture })).toBeVisible();
  }
  // Each role grant is its own identity flow, named by its role.
  await lenses.getByRole("tab", { name: /^Identity/ }).click();
  await expect(page.getByRole("button", { name: /runs as the workload identity/ })).toBeVisible();
});

test("Well-Architected tab: scorecard, findings by pillar or service, downloads @readonly", async ({
  page,
}) => {
  await open(page, "/offerings?view=waf");
  const score = page.getByRole("region", { name: "Well-Architected score" });
  await expect(score).toContainText(/\d+\/100/);
  for (const pillar of ["Reliability", "Security", "Cost Optimization", "Operational Excellence"])
    await expect(score).toContainText(pillar);
  const findings = page.getByRole("region", { name: "Well-Architected findings" });
  await expect(findings).toBeVisible();
  await findings.getByRole("button", { name: "By service" }).click();
  await findings.getByRole("button", { name: "By pillar" }).click();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Findings as CSV" }).click();
  expect((await csv).suggestedFilename()).toMatch(/-well-architected\.csv$/);
});

test("the guide: pillars and a page per service @readonly", async ({ page }) => {
  await open(page, "/well-architected");
  await expect(page.getByRole("heading", { name: "Well-Architected guide" })).toBeVisible();
  await page
    .getByRole("link", { name: /Azure Kubernetes Service/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Azure Kubernetes Service" })).toBeVisible();
  for (const pillar of ["Reliability", "Security", "Cost Optimization"])
    await expect(page.getByRole("heading", { name: pillar }).first()).toBeVisible();
  await page.goto("/well-architected/reliability");
  await loaded(page);
  await expect(page.getByRole("heading", { name: "Reliability" }).first()).toBeVisible();
});

test("a new offering can start from an Azure Architecture Center reference design", async ({
  page,
}) => {
  const name = `E2E Reference ${Date.now().toString(36).slice(-5)}`;
  await open(page, "/offerings");
  await page.getByRole("button", { name: "New offering" }).click();
  const dialog = page.getByRole("dialog", { name: "New offering" });
  await dialog.getByPlaceholder("e.g. Regulated EU").fill(name);
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Baseline AKS cluster" }).click();
  await dialog.getByRole("button", { name: "Create draft & review" }).click();
  await expect(page.getByText(`${name} created as a v1.0.0 draft`)).toBeVisible();
  await loaded(page);

  // The reference design brings its services and its requirements.
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await expect(page.locator('[data-node="aks"]').first()).toBeVisible();
  await page.getByRole("button", { name: /^Well-Architected · \d+/ }).click();
  await expect(page.getByRole("region", { name: "Well-Architected score" })).toContainText(
    /\d+\/100/,
  );
});
