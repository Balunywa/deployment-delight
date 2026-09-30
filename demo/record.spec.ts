/*
 * Records the demo: plays every scene for at least as long as its narration and writes when each started, so the
 * narration can be laid over the video. Run through demo/build.ts, not directly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, test } from "@playwright/test";

import { ONEGRID, SCENES } from "./story";

const OUT = process.env["DEMO_OUT"] ?? "demo/out";
const durations = JSON.parse(readFileSync(path.join(OUT, "durations.json"), "utf8")) as Record<
  string,
  number
>;
const GAP_MS = 700;

/**
 * Inspecting a large repository takes a while. Do it once off camera (a context without video) while the intro
 * slides play; the server caches the result, so the on-screen inspection returns as the narrator describes it.
 */
async function warmInspection(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/products");
    await expect(page.getByText(/^Loading\b.*…$/)).toHaveCount(0, { timeout: 30_000 });
    await page.getByRole("button", { name: "Submit a solution" }).click();
    const dialog = page.getByRole("dialog", { name: "Submit a solution" });
    await dialog.locator("#submit-repo").fill(ONEGRID);
    await dialog.getByRole("button", { name: "Inspect" }).click();
    await expect(dialog.getByText("Pinned source")).toBeVisible({ timeout: 180_000 });
  } finally {
    await context.close();
  }
}

test("record the demo", async ({ page, browser }) => {
  test.setTimeout(30 * 60_000);
  const t0 = Date.now();
  const warm = warmInspection(browser, test.info().project.use.baseURL!).catch((e: Error) =>
    console.warn(
      `[demo] inspection warm-up failed, the on-screen inspection will be slower: ${e.message}`,
    ),
  );

  // A visible cursor and click ripple: Playwright's video doesn't draw the mouse.
  await page.addInitScript(() => {
    const install = () => {
      if (document.getElementById("__demo-cursor")) return;
      const c = document.createElement("div");
      c.id = "__demo-cursor";
      c.style.cssText =
        "position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;" +
        "background:rgba(59,130,246,.35);border:2px solid #2563eb;z-index:2147483647;pointer-events:none;" +
        "transition:transform .12s ease;box-shadow:0 0 0 4px rgba(255,255,255,.6)";
      document.documentElement.appendChild(c);
      const w = window as unknown as { __cursor?: { x: number; y: number } };
      const at = w.__cursor ?? { x: -100, y: -100 };
      c.style.transform = `translate(${at.x}px, ${at.y}px)`;
      window.addEventListener(
        "mousemove",
        (e) => {
          w.__cursor = { x: e.clientX, y: e.clientY };
          c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        },
        true,
      );
      window.addEventListener(
        "mousedown",
        (e) => {
          const r = document.createElement("div");
          r.style.cssText =
            `position:fixed;left:${e.clientX - 24}px;top:${e.clientY - 24}px;width:48px;height:48px;border-radius:50%;` +
            "border:3px solid #2563eb;z-index:2147483646;pointer-events:none;transition:all .45s ease-out;opacity:1";
          document.documentElement.appendChild(r);
          requestAnimationFrame(() => {
            r.style.transform = "scale(1.8)";
            r.style.opacity = "0";
          });
          setTimeout(() => r.remove(), 600);
        },
        true,
      );
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
    else install();
  });

  const timings: { id: string; startMs: number; endMs: number }[] = [];
  for (const scene of SCENES) {
    if (scene.id === "submit") await warm;
    const start = Date.now();
    await scene.run(page);
    const minimum = (durations[scene.id] ?? 3) * 1000 + GAP_MS;
    const spent = Date.now() - start;
    if (spent < minimum) await page.waitForTimeout(minimum - spent);
    timings.push({ id: scene.id, startMs: start - t0, endMs: Date.now() - t0 });
    console.log(`[demo] ${scene.id}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  }
  writeFileSync(path.join(OUT, "timings.json"), JSON.stringify(timings, null, 2));
});
