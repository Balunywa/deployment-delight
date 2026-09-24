import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Metric, PageHeader, Panel, Pill } from "@/components/Primitives";
import { CATEGORY_TILE } from "@/components/architecture/ServiceIcon";
import { fromManifest } from "@/lib/architecture";
import { CATEGORIES, SERVICE_BY_ID } from "@/lib/catalog";
import { currency, titleize } from "@/lib/format";
import { estateQuery, offeringsQuery } from "@/lib/queries";

export const Route = createFileRoute("/costs")({
  head: () => ({
    meta: [
      { title: "Costs · Cloud Delivery" },
      {
        name: "description",
        content:
          "Estimated Azure consumption per offering and across the estate, broken down by service category, clearly labelled as estimate or actual.",
      },
      { property: "og:title", content: "Costs · Cloud Delivery" },
      { property: "og:description", content: "Per-offering and estate-wide Azure cost estimates." },
    ],
  }),
  component: Costs,
});

function Costs() {
  const estate = useQuery(estateQuery);
  const offerings = useQuery(offeringsQuery);

  const envs = estate.data ?? [];
  const monthly = envs.reduce((s, e) => s + Number(e.monthly_cost_estimate ?? 0), 0);

  const byOffering = envs.reduce<Record<string, { name: string; count: number; monthly: number }>>(
    (acc, e) => {
      const offering = e.offerings as { id: string; name: string } | null;
      if (!offering) return acc;
      const entry = acc[offering.id] ?? { name: offering.name, count: 0, monthly: 0 };
      entry.count += 1;
      entry.monthly += Number(e.monthly_cost_estimate ?? 0);
      acc[offering.id] = entry;
      return acc;
    },
    {},
  );

  // Modelled from each install's actual architecture: list price per service, non-production at ~30%.
  const manifests = new Map<
    string,
    { offering: (typeof offerings.data & object)[number]; manifest: unknown }
  >();
  for (const o of offerings.data ?? [])
    for (const v of (o.offering_versions ?? []) as { id: string; manifest_json: unknown }[])
      manifests.set(v.id, { offering: o, manifest: v.manifest_json });
  const byCategory = new Map<string, number>();
  for (const e of envs) {
    const m = manifests.get((e.desired as { id?: string } | null)?.id ?? "");
    if (!m) continue;
    const factor = e.environment_type === "production" ? 1 : 0.3;
    for (const s of fromManifest(m.offering, m.manifest).selected) {
      const def = SERVICE_BY_ID.get(s.id);
      if (def?.monthly)
        byCategory.set(def.category, (byCategory.get(def.category) ?? 0) + def.monthly * factor);
    }
  }
  const modelled = [...byCategory.values()].reduce((a, b) => a + b, 0);
  const breakdown = CATEGORIES.map((c) => ({ category: c, value: byCategory.get(c) ?? 0 })).filter(
    (b) => b.value > 0,
  );

  return (
    <>
      <PageHeader
        title="Costs"
        description="Every figure below is an ESTIMATE derived from offering cost models. Actual and forecast consumption appear once Azure Cost Management ingestion is connected."
        meta={
          <>
            <Pill tone="warning">ESTIMATED</Pill>
            <Pill tone="neutral">ACTUAL — not connected</Pill>
            <Pill tone="neutral">FORECAST — not connected</Pill>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Estate monthly (est.)" value={currency(monthly, { compact: true })} />
        <Metric label="Estate annual (est.)" value={currency(monthly * 12, { compact: true })} />
        <Metric label="Environments" value={envs.length} />
        <Metric
          label="Average per environment"
          value={currency(monthly / Math.max(envs.length, 1), { compact: true })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Per offering"
          description="Estimated monthly and annual consumption by product line"
          bodyClassName="p-0"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Offering</th>
                <th className="text-right">Environments</th>
                <th className="text-right">Monthly (est.)</th>
                <th className="text-right">Annual (est.)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byOffering)
                .sort((a, b) => b[1].monthly - a[1].monthly)
                .map(([id, o]) => (
                  <tr key={id}>
                    <td className="font-medium">{o.name}</td>
                    <td className="mono-num text-right">{o.count}</td>
                    <td className="mono-num text-right">{currency(o.monthly)}</td>
                    <td className="mono-num text-right">{currency(o.monthly * 12)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="By service category"
          description={`Modelled from each install's architecture at list price · ${currency(modelled, { compact: true })}/month`}
        >
          <ul className="space-y-2">
            {breakdown.map((b) => (
              <li key={b.category} className="flex items-center gap-3 text-xs">
                <span className="w-24 text-muted-foreground">{b.category}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={`block h-full rounded-full ${CATEGORY_TILE[b.category]}`}
                    style={{ width: `${(b.value / Math.max(modelled, 1)) * 100}%` }}
                  />
                </span>
                <span className="mono-num w-20 text-right">
                  {currency(b.value, { compact: true })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Offering cost models"
          description="Published price envelope per environment"
          bodyClassName="p-0"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Offering</th>
                <th>Type</th>
                <th className="text-right">Monthly low</th>
                <th className="text-right">Monthly high</th>
              </tr>
            </thead>
            <tbody>
              {(offerings.data ?? []).map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.name}</td>
                  <td className="text-muted-foreground">{titleize(o.offering_type)}</td>
                  <td className="mono-num text-right">{currency(o.estimated_monthly_cost_low)}</td>
                  <td className="mono-num text-right">{currency(o.estimated_monthly_cost_high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
