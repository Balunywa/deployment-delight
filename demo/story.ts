/*
 * The demo, scene by scene: what the narrator says, and what happens on screen while they say it. Value first
 * (slides), then the most effective parts of the product, then the close. Each scene's recording lasts at least as
 * long as its narration.
 */
import { type Locator, type Page, expect } from "@playwright/test";

import { SLIDES, type SlideId } from "./slides";

export type Scene = {
  id: string;
  /** Chapter shown in the subtitles file and the guide. */
  chapter: string;
  narration: string;
  run: (page: Page) => Promise<void>;
};

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

async function loaded(page: Page) {
  await expect(page.getByText(/^Loading\b.*…$/)).toHaveCount(0, { timeout: 30_000 });
  await pause(page, 400);
}

async function go(page: Page, path: string) {
  await page.goto(path);
  await loaded(page);
}

async function slide(page: Page, id: SlideId) {
  await page.setContent(SLIDES[id], { waitUntil: "load" });
}

/** Moves the visible cursor to an element, then clicks it, so viewers can follow. */
async function click(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
    await pause(page, 250);
  }
  await target.click();
  await pause(page, 500);
}

async function type(page: Page, target: Locator, text: string) {
  await click(page, target);
  await target.pressSequentially(text, { delay: 40 });
  await pause(page, 400);
}

async function scroll(page: Page, pixels: number, steps = 8) {
  await page.mouse.move(1100, 620, { steps: 10 });
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, pixels / steps);
    await pause(page, 90);
  }
  await pause(page, 500);
}

export const ONEGRID = "https://github.com/paulshaheen/OneGrid";
export const CUSTOMER = "Northwind Utilities";

export const SCENES: Scene[] = [
  {
    id: "title",
    chapter: "Introduction",
    narration:
      "This is Cloud Delivery. In the next few minutes, I'll show you the problem it solves, the value it creates, and then how it works, end to end.",
    run: (page) => slide(page, "title"),
  },
  {
    id: "problem",
    chapter: "The problem",
    narration:
      "Here's the problem. For a software company delivering on Azure, every customer install tends to become its own project. Someone negotiates the landing zone, hand-builds a pipeline, and repeats the same security review. Upgrades feel risky, so customers drift onto different versions. Often a single pipeline and identity can reach every customer. And solutions built by field teams are hard to find, hard to trust, and rarely reused.",
    run: (page) => slide(page, "problem"),
  },
  {
    id: "approach",
    chapter: "The approach",
    narration:
      "Cloud Delivery productizes the deployment itself. Solutions live in one catalog, owned by named people and reviewed before anyone can deploy them. Onboarding a customer becomes configuration, not a project. Every landing zone, solution and customer is isolated, with its own repository, pipeline, cloud identities and state. And upgrades roll out in rings.",
    run: (page) => slide(page, "approach"),
  },
  {
    id: "value",
    chapter: "The value",
    narration:
      "The value comes in four forms. Faster time to value, because onboarding is one guided session. Lower risk, because architectures are reviewed, production changes are approved, and a problem stays inside one customer. Safe upgrades at scale. And reuse: solutions built in the field become products others can deploy. Let's see it.",
    run: (page) => slide(page, "value"),
  },
  {
    id: "home",
    chapter: "The console",
    narration:
      "This is the console. The home page shows the whole estate at a glance: the offerings you deliver, pipeline runs, what needs your attention, and the installed base across every customer.",
    run: async (page) => {
      await go(page, "/");
      await pause(page, 1500);
      await scroll(page, 700);
      await pause(page, 1200);
      await scroll(page, -700);
    },
  },
  {
    id: "catalog",
    chapter: "Solution catalog",
    narration:
      "Everything starts in the solution catalog. Each solution shows who owns it, how far it's been validated, the Azure services it's built from, and where it can run. Search and filters find the right one by industry, service, deployment model or owner.",
    run: async (page) => {
      await go(page, "/products");
      await pause(page, 1200);
      await scroll(page, 500);
      await type(page, page.getByPlaceholder(/Search by name/), "pipeline");
      await pause(page, 1500);
      await click(page, page.getByRole("button", { name: "Clear all" }));
      await click(page, page.locator("aside").getByRole("button", { name: /^Hosted\b/ }));
      await pause(page, 1500);
      await click(page, page.locator("aside").getByRole("button", { name: /^Hosted\b/ }));
    },
  },
  {
    id: "solution",
    chapter: "Solution catalog",
    narration:
      "Opening a solution shows its delivery models and versions, its architecture, and its owners. Its trust level is Community, Validated or Featured. Validated means an offering passed architecture review and was published. And it shows where it's delivered from: its own repository, environments, identities and state.",
    run: async (page) => {
      await go(page, "/products");
      await type(page, page.getByPlaceholder(/Search by name/), "Pipeline integrity agent");
      await click(page, page.locator("article a").first());
      await loaded(page);
      await pause(page, 1500);
      await scroll(page, 450);
      await pause(page, 1500);
      await scroll(page, 450);
    },
  },
  {
    id: "submit",
    chapter: "Share a solution",
    narration:
      "Field teams can share their own work. Here, a solution architect submits a real project from GitHub. The platform pins the exact commit, recognizes the Bicep, and maps its Azure resources onto the platform's services. It's honest about gaps: this one uses resources the platform doesn't offer yet, has no license, and depends on a build artifact that can change. It can be listed right away, but no one can deploy it to a customer until those are fixed.",
    run: async (page) => {
      await go(page, "/products");
      await click(page, page.getByRole("button", { name: "Submit a solution" }));
      const dialog = page.getByRole("dialog", { name: "Submit a solution" });
      await type(page, dialog.locator("#submit-repo"), ONEGRID);
      await click(page, dialog.getByRole("button", { name: "Inspect" }));
      await expect(dialog.getByText("Pinned source")).toBeVisible({ timeout: 90_000 });
      await pause(page, 2500);
      await dialog
        .getByText(/resource types are not in the platform catalog/)
        .first()
        .scrollIntoViewIfNeeded();
      await pause(page, 3500);
      await page.keyboard.press("Escape");
    },
  },
  {
    id: "designer",
    chapter: "Offering designer",
    narration:
      "Each delivery model is designed once, on a visual canvas. Architecture review runs on every change: regions, landing zone policy, private networking and guardrails. From the same design, the platform generates the Terraform and the release pipeline. Differences between customers become variables, never forks.",
    run: async (page) => {
      await go(page, "/offerings");
      await pause(page, 2500);
      await click(page, page.getByRole("button", { name: /^Review/ }).first());
      await pause(page, 2500);
      await click(page, page.getByRole("button", { name: /^Infrastructure as code$/ }));
      await pause(page, 2500);
      await click(page, page.getByRole("button", { name: /^Pipeline$/ }));
      await pause(page, 1500);
    },
  },
  {
    id: "onboard",
    chapter: "Onboard a customer",
    narration:
      "Now let's onboard a customer. Pick the solution, and where it runs: in our Azure, or in the customer's own tenant. Choose the environments and where they land in the landing zone. Every customer gets its own repository, and onboarding only adds a few configuration files, pinning the version for each environment.",
    run: async (page) => {
      await go(page, "/onboard");
      const name = page.getByLabel("Name", { exact: true });
      await name.fill("");
      await type(page, name, CUSTOMER);
      await click(
        page,
        page.getByRole("button", { name: /Your tenant · your hosting landing zone/ }).first(),
      );
      for (let i = 0; i < 4; i++) {
        await click(page, page.getByRole("button", { name: /^Continue/ }));
        await pause(page, 1500);
      }
      await click(page, page.getByRole("button", { name: "environments/*" }));
      await pause(page, 2000);
    },
  },
  {
    id: "launch",
    chapter: "Onboard a customer",
    narration:
      "Launching opens the first pull request on the customer's repository. The pipeline plans every environment with read-only identities. Merging deploys development and test, and production waits for an approver. One approval later, the customer is live in every environment.",
    run: async (page) => {
      await click(page, page.getByRole("button", { name: /Open pull request & start the run/ }));
      await expect(page.getByText(/is onboarded — the pull request is ready to merge/)).toBeVisible(
        {
          timeout: 60_000,
        },
      );
      await pause(page, 1500);
      await click(page, page.getByRole("button", { name: "Merge pull request" }));
      const approve = page.getByRole("button", { name: "Approve & deploy production" });
      await expect(approve).toBeVisible({ timeout: 90_000 });
      await pause(page, 1500);
      await click(page, approve);
      await expect(page.getByText(`${CUSTOMER} is live in every environment`)).toBeVisible({
        timeout: 90_000,
      });
      await pause(page, 1500);
    },
  },
  {
    id: "isolation",
    chapter: "Isolation by design",
    narration:
      "Behind every customer, solution and landing zone is a delivery unit. This is the isolation model. Each has its own repository and environments with required reviewers. Each environment has its own cloud identities, trusted only for that environment, and only when running the approved pipeline template. Terraform state is separate too. A mistake, or a compromise, stays inside one customer.",
    run: async (page) => {
      await go(page, "/delivery");
      await pause(page, 1200);
      await type(page, page.getByPlaceholder("Filter by name or repository"), "northwind");
      await click(page, page.locator('a[href^="/delivery/"]').first());
      await loaded(page);
      await pause(page, 1500);
      await page.getByRole("heading", { name: "Environments" }).scrollIntoViewIfNeeded();
      await pause(page, 2500);
      await page.getByRole("heading", { name: "Cloud identities" }).scrollIntoViewIfNeeded();
      await pause(page, 3000);
      await page.getByRole("heading", { name: "Terraform state" }).scrollIntoViewIfNeeded();
      await pause(page, 2000);
    },
  },
  {
    id: "rollout",
    chapter: "Upgrades at scale",
    narration:
      "When a new version ships, you roll it out in rings, not everywhere at once. The platform checks which installs can upgrade and groups them into waves. Each ring starts only after the one before it succeeds.",
    run: async (page) => {
      await go(page, "/upgrades");
      await pause(page, 1500);
      await click(page, page.getByRole("button", { name: /^Roll out v/ }));
      await pause(page, 2000);
      await click(page, page.getByRole("button", { name: "Create rollout" }));
      await expect(page.getByRole("heading", { name: "Rollouts" })).toBeVisible();
      await pause(page, 1000);
      await click(page, page.getByTitle("Create plans for this ring").first());
      await pause(page, 1500);
    },
  },
  {
    id: "operate",
    chapter: "Day two",
    narration:
      "Day two is built in. Drift is detected every night, and every decision is recorded. Compliance, costs, and an audit trail that can't be edited cover the whole estate.",
    run: async (page) => {
      await go(page, "/compliance");
      await pause(page, 2000);
      await go(page, "/audit");
      await pause(page, 2000);
    },
  },
  {
    id: "close",
    chapter: "Recap",
    narration:
      "To recap: one catalog of reviewed, owned solutions, including your field teams' work. Customer onboarding as configuration. Isolation for every landing zone, solution and customer. And safe upgrades at scale. A good next step is a pilot: one of your solutions, and one customer, end to end.",
    run: (page) => slide(page, "close"),
  },
];
