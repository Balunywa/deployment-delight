import { chromium } from "playwright";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1700 } });
const url = "https://clouddelivery-nzdefv.azurewebsites.net/foundations/d9fb9c93-de11-4b6b-94ab-79bc57c5f054?view=deploy";
await p.goto(url, { waitUntil: "networkidle" });
const btn = p.getByRole("button", { name: /Merge #3 & apply/ });
await btn.waitFor({ timeout: 90000 });
console.log("enabled", await btn.isEnabled());
await btn.click();
let last = "";
const t0 = Date.now();
for (let i = 0; i < 1000; i++) {
  await p.waitForTimeout(15000);
  if (i % 40 === 39) await p.reload({ waitUntil: "networkidle" });
  const t = await p.locator("main").innerText().catch(() => "");
  const status = t.match(/Apply\s*·\s*(running|succeeded|failed)/)?.[1];
  const marker = (t.match(/(Merged #\d+|▶ [^\n]+|GitHub Actions run \w+|Error:[^\n]*)/g) ?? []).slice(-1).join("");
  if (marker !== last) { console.log(Math.round((Date.now() - t0) / 1000) + "s", status, marker); last = marker; }
  if (status && status !== "running") { console.log("FINAL", status); break; }
}
await p.screenshot({ path: "/tmp/lzwf/apply-final.png", fullPage: true });
console.log((await p.locator("main").innerText()).split("\n").filter((l) => /Error|run success|run failure|Merged|transient/.test(l)).slice(-10).join("\n"));
await b.close();
