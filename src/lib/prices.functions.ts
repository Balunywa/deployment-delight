/* Live Azure retail prices for a region (prices.azure.com, public, no sign-in), cached for 12 hours. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { FALLBACK_PRICES, PRICE_QUERIES, type PriceKey, type Prices, REGIONAL } from "./alz/cost";

const cache = new Map<string, { at: number; prices: Prices }>();
const TTL = 12 * 60 * 60 * 1000;

async function price(filter: string): Promise<number | undefined> {
  const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(`priceType eq 'Consumption' and ${filter}`)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return undefined;
  const items =
    (
      (await res.json()) as {
        Items?: { retailPrice: number; type: string; tierMinimumUnits?: number }[];
      }
    ).Items ?? [];
  // The first paid tier (tiered meters list a free tier first, e.g. the first 5 GB of logs).
  const paid = items
    .filter((i) => i.type === "Consumption" && i.retailPrice > 0)
    .sort((x, y) => (x.tierMinimumUnits ?? 0) - (y.tierMinimumUnits ?? 0));
  return paid[0]?.retailPrice;
}

export const getPlatformPrices = createServerFn({ method: "GET" })
  .inputValidator(z.object({ region: z.string().regex(/^[a-z0-9]+$/) }))
  .handler(async ({ data }): Promise<Prices> => {
    const hit = cache.get(data.region);
    if (hit && Date.now() - hit.at < TTL) return hit.prices;
    try {
      const keys = Object.keys(PRICE_QUERIES) as PriceKey[];
      const values = await Promise.all(
        keys.map((k) =>
          price(
            REGIONAL.includes(k)
              ? `armRegionName eq '${data.region}' and ${PRICE_QUERIES[k]}`
              : `${PRICE_QUERIES[k]} and armRegionName eq 'Zone 1'`,
          ).catch(() => undefined),
        ),
      );
      const hourly: Prices["hourly"] = {};
      keys.forEach((k, i) => {
        if (values[i] !== undefined) hourly[k] = values[i];
      });
      const found = Object.keys(hourly).length;
      const prices: Prices = {
        region: data.region,
        live: found > 0,
        asOf: new Date().toISOString().slice(0, 10),
        hourly: { ...FALLBACK_PRICES.hourly, ...hourly },
      };
      cache.set(data.region, { at: Date.now(), prices });
      return prices;
    } catch {
      return FALLBACK_PRICES;
    }
  });
