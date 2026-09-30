import { execSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

/*
 * End-to-end tests run the production build against an isolated database (cloud_delivery_e2e) that is recreated
 * and seeded on every run. Set E2E_BASE_URL to run the read-only smoke tests against a deployed console instead:
 *   E2E_BASE_URL=https://<app>.azurewebsites.net npx playwright test --grep @readonly
 */
const remote = process.env["E2E_BASE_URL"];
const port = Number(process.env["E2E_PORT"] ?? 3100);
const githubToken = (() => {
  if (process.env["GITHUB_TOKEN"]) return process.env["GITHUB_TOKEN"];
  try {
    return execSync("gh auth token", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
})();

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: remote ?? `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(remote
    ? {}
    : {
        webServer: {
          command: "node e2e/reset-db.mjs && node .output/server/index.mjs",
          url: `http://127.0.0.1:${port}/`,
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            HOST: "127.0.0.1",
            PORT: String(port),
            DATABASE_URL:
              process.env["E2E_DATABASE_URL"] ??
              "postgres://postgres@localhost:5433/cloud_delivery_e2e?host=/tmp",
            PGSSLMODE: "disable",
            // The e2e database is recreated on every run; never point this at real data.
            CATALOG_USER_NAME: "E2E Tester",
            CATALOG_USER_EMAIL: "e2e.tester@example.com",
            CATALOG_USER_ROLE: "CSA",
            CATALOG_USER_TEAM: "Quality",
            ...(githubToken ? { GITHUB_TOKEN: githubToken } : {}),
          },
        },
      }),
});
