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
        // The MSX connector runs only on an SE's PC; the app checks for it and copes when it isn't there.
        const connector = /127\.0\.0\.1:47615/;
        if (m.type() === "error" && !connector.test(m.text()) && !connector.test(m.location().url))
          problems.list.push(`console: ${m.text()}`);
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
  // A click before React hydrates the page is lost.
  await page.waitForFunction(() => document.documentElement.dataset["hydrated"] === "true", null, {
    timeout: 30_000,
  });
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

/** OSDU Developer Platform · Customer Hosted, at its real v0.46.0 and v0.47.0 releases (db/seed/0005). */
export const OSDU = {
  product: "33333333-3333-4333-8333-100000000001",
  offering: "33333333-3333-4333-8333-200000000010",
  previous: "33333333-3333-4333-8333-300000000100",
  latest: "33333333-3333-4333-8333-300000000101",
};

/**
 * The bundled catalog is real and customers start with no installs. Operations tests need some: three customers
 * running the previous release (so a rollout to the latest is real), a production upgrade awaiting approval,
 * and an open drift finding. Idempotent.
 */
export async function seedInstalledBase() {
  await sql(
    `insert into public.environments (customer_id, offering_id, desired_offering_version_id, actual_offering_version_id,
       name, environment_type, region, status, compliance_score, monthly_cost_estimate, configuration_json)
     select c.id, $1, $2, $2, 'PROD', 'production', 'eastus2', 'healthy', 100, 9800,
       '{"network":{"mode":"dedicated-spoke","privateEndpoints":true,"publicAccess":false}}'::jsonb
     from public.customers c
     where c.customer_code in ('north-grid', 'metro-energy', 'coastal-power')
       and not exists (select 1 from public.environments e where e.customer_id = c.id and e.offering_id = $1)`,
    [OSDU.offering, OSDU.previous],
  );
  await sql(
    `with env as (
       select e.id from public.environments e join public.customers c on c.id = e.customer_id
       where c.customer_code = 'north-grid' and e.offering_id = $1
         and not exists (select 1 from public.deployments d where d.environment_id = e.id and d.status = 'AWAITING_APPROVAL')
     ), dep as (
       insert into public.deployments (environment_id, deployment_type, desired_version, previous_version, status, mode,
         requested_by, requested_at, plan_json, preflight_json)
       select env.id, 'upgrade', '0.47.0', '0.46.0', 'AWAITING_APPROVAL', 'demo', 'E2E Tester', now() - interval '1 hour',
         '{"create":[],"useExisting":["Virtual Network"],"policyAssignments":12,"roleAssignments":4,"warnings":0,"blockers":0}'::jsonb,
         '{"pass":17,"warning":0,"blocking":0}'::jsonb
       from env returning id
     )
     insert into public.approvals (deployment_id, approval_type, requested_from, status, requested_at)
     select dep.id, 'production_deployment', 'Security Approver', 'pending', now() - interval '1 hour' from dep`,
    [OSDU.offering],
  );
  await sql(
    `insert into public.drift_findings (environment_id, resource_id, category, expected_json, actual_json, severity,
       recommended_remediation, detected_at)
     select e.id, '/subscriptions/sub-coastal-power/resourceGroups/rg-osdu-prod/providers/Microsoft.Storage/storageAccounts/stosduprod',
       'network', '{"publicNetworkAccess":"Disabled"}'::jsonb, '{"publicNetworkAccess":"Enabled"}'::jsonb, 'high',
       'Re-apply the storage account settings from the pinned release to disable public network access.', now() - interval '2 days'
     from public.environments e join public.customers c on c.id = e.customer_id
     where c.customer_code = 'coastal-power' and e.offering_id = $1
       and not exists (select 1 from public.drift_findings d where d.environment_id = e.id and d.status = 'open')`,
    [OSDU.offering],
  );
}
