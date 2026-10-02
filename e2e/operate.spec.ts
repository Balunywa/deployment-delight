/*
 * The offering lifecycle navigation (design → build → validate → release → operate) with its next step, and the
 * Operate stage: Azure SRE Agent added to the design, what it can do on each install, and what it's briefed with.
 * Nothing is saved, so these run against any environment.
 */
import { expect, open, test } from "./fixtures";

test("lifecycle navigation: five stages, and the next step @readonly", async ({ page }) => {
  await open(page, "/offerings");
  const nav = page.getByRole("navigation", { name: "Offering lifecycle" });
  for (const stage of ["Design", "Build", "Validate", "Release", "Operate"])
    await expect(nav.getByRole("region", { name: stage, exact: true })).toBeVisible();
  const next = page.getByRole("region", { name: "Next step" });
  await expect(next).toBeVisible();
  // Every next step comes with the button that does it.
  await expect(next.getByRole("button").first()).toBeVisible();
});

test("operate: Azure SRE Agent in the design, its access and its briefing @readonly", async ({
  page,
}) => {
  await open(page, "/offerings?view=operate");
  const add = page.getByRole("button", { name: "Add Azure SRE Agent" });
  if (await add.isVisible()) await add.click();

  await expect(page.getByRole("region", { name: "SRE Agent settings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What it can do on each install" })).toContainText(
    "Log Analytics Reader",
  );
  await expect(page.getByRole("img", { name: /Operate flows of this workload/ })).toBeVisible();

  const knows = page.getByRole("region", { name: "What it knows" });
  await knows.getByRole("button", { name: /overview\.md/ }).click();
  await expect(knows).toContainText("How to work on this install");
  await knows.getByRole("button", { name: /brief\.sh/ }).click();
  await expect(knows).toContainText("AgentMemory/upload");

  // Autonomous with read-only access is flagged, with the fix.
  const settings = page.getByRole("region", { name: "SRE Agent settings" });
  await settings.getByRole("button", { name: "Read only", exact: true }).click();
  await settings.getByRole("button", { name: "Autonomous", exact: true }).click();
  await expect(page.getByText(/Autonomous with read-only access/).first()).toBeVisible();

  // The change is unsaved, so that's the next step; and the release now carries the agent.
  await expect(page.getByRole("region", { name: "Next step" })).toContainText(/Save/);
  await page.getByRole("button", { name: /^Infrastructure as code$/ }).click();
  await expect(page.getByText("sre-agent.tf").first()).toBeVisible();
});
