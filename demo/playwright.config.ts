import { execSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

/*
 * Demo recording: the production build against its own freshly seeded database (cloud_delivery_demo), recorded
 * at 1920×1080. Run with `bun demo/build.ts`, which narrates and assembles the video.
 */
const port = Number(process.env["DEMO_PORT"] ?? 3200);
const out = process.env["DEMO_OUT"] ?? "demo/out";
const git = (k: string) => {
  try {
    return execSync(`git config ${k}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
};
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
  testDir: ".",
  testMatch: "record.spec.ts",
  outputDir: `${out}/playwright`,
  workers: 1,
  reporter: [["list"]],
  expect: { timeout: 30_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    video: { mode: "on", size: { width: 1920, height: 1080 } },
    actionTimeout: 45_000,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/reset-db.mjs && node .output/server/index.mjs",
    cwd: new URL("..", import.meta.url).pathname,
    url: `http://127.0.0.1:${port}/`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL:
        process.env["DEMO_DATABASE_URL"] ??
        "postgres://postgres@localhost:5433/cloud_delivery_demo?host=/tmp",
      PGSSLMODE: "disable",
      CATALOG_USER_NAME:
        process.env["DEMO_USER_NAME"] ?? (git("user.name") || "Solution architect"),
      CATALOG_USER_EMAIL: process.env["DEMO_USER_EMAIL"] ?? "",
      CATALOG_USER_ROLE: process.env["DEMO_USER_ROLE"] ?? "Solution architect",
      ...(githubToken ? { GITHUB_TOKEN: githubToken } : {}),
    },
  },
});
