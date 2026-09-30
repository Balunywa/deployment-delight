/*
 * Every test fails on anything the user wouldn't see but would feel: uncaught page errors, console errors, or a
 * server function / page request that fails. Tests opt out of specific expected failures with allowErrors().
 */
import { type Page, expect, test as base } from "@playwright/test";
import pg from "pg";

/** The isolated end-to-end database (see playwright.config.ts). */
export const E2E_DATABASE_URL =
  process.env["E2E_DATABASE_URL"] ??
  "postgres://postgres@localhost:5433/cloud_delivery_e2e?host=/tmp";

/** Direct SQL for test setup and lookups, against the e2e database only. */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const u = new URL(E2E_DATABASE_URL);
  const c = new pg.Client({
    host: u.searchParams.get("host") ?? u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    database: decodeURIComponent(u.pathname.slice(1)),
  });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

type Problems = { list: string[]; allow: RegExp[] };

export const test = base.extend<{ problems: Problems }>({
  problems: [
    async ({ page }, use) => {
      const problems: Problems = { list: [], allow: [] };
      // Error toasts are how the console reports a failed action; record every one that appears.
      await page.addInitScript(() => {
        const seen = new WeakSet<Element>();
        const w = window as unknown as { __errorToasts: string[] };
        w.__errorToasts = [];
        new MutationObserver(() => {
          for (const t of document.querySelectorAll('[data-sonner-toast][data-type="error"]'))
            if (!seen.has(t)) {
              seen.add(t);
              w.__errorToasts.push(t.textContent ?? "");
            }
        }).observe(document, { childList: true, subtree: true });
      });
      page.on("pageerror", (e) => problems.list.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") problems.list.push(`console: ${m.text()}`);
      });
      page.on("response", (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/_serverFn") && r.status() >= 400)
          problems.list.push(`server function ${r.status()}: ${u.pathname.slice(0, 80)}`);
        else if (r.request().resourceType() === "document" && r.status() >= 400)
          problems.list.push(`document ${r.status()}: ${u.pathname}`);
      });
      await use(problems);
      const toasts = await page
        .evaluate(() => (window as unknown as { __errorToasts?: string[] }).__errorToasts ?? [])
        .catch(() => [] as string[]);
      problems.list.push(...toasts.map((t) => `error toast: ${t}`));
      const real = problems.list.filter((p) => !problems.allow.some((a) => a.test(p)));
      expect(real, "page errors, console errors or failed requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Waits until nothing on the page says it's still loading. */
export async function loaded(page: Page) {
  await expect(page.getByText(/^Loading\b.*…$/)).toHaveCount(0, { timeout: 30_000 });
}

/** Opens a route and waits for its data. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await loaded(page);
}

export function allowErrors(problems: Problems, ...patterns: RegExp[]) {
  problems.allow.push(...patterns);
}
