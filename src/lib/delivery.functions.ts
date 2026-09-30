/*
 * Delivery units read model and actions for the console. Specs are recomputed from the console's data on read,
 * so they always reflect the current landing zones, solutions and customers.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { UnitRow } from "./delivery/units.server";

async function deps() {
  const db = await import("./db.server");
  const units = await import("./delivery/units.server");
  return { db, units };
}

export type UnitSummary = Pick<
  UnitRow,
  | "id"
  | "kind"
  | "slug"
  | "name"
  | "repository"
  | "status"
  | "product_id"
  | "customer_id"
  | "foundation_id"
  | "request_url"
  | "requested_at"
  | "requested_by"
> & {
  environments: number;
  identities: number;
  state: number;
  findings: string[];
};

export const listDeliveryUnits = createServerFn({ method: "GET" }).handler(async () => {
  const { db, units } = await deps();
  await units.syncUnits(db);
  const { isolationFindings } = await import("./delivery/model");
  const rows = await db.query<UnitRow>("select * from public.delivery_units order by kind, name");
  return {
    org: units.platformFromEnv().org,
    vendingConfigured: units.vendingConfigured(),
    units: rows.map((r): UnitSummary => ({
      id: r.id,
      kind: r.kind,
      slug: r.slug,
      name: r.name,
      repository: r.repository,
      status: r.status,
      product_id: r.product_id,
      customer_id: r.customer_id,
      foundation_id: r.foundation_id,
      request_url: r.request_url,
      requested_at: r.requested_at,
      requested_by: r.requested_by,
      environments: r.spec.environments.length,
      identities: r.spec.identities.length,
      state: r.spec.state.length,
      findings: isolationFindings(r.spec),
    })),
  };
});

export const getDeliveryUnit = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({
        unitId: z.string().uuid().optional(),
        productId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        foundationId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { db, units } = await deps();
    let row: UnitRow | null = null;
    if (data.unitId)
      row = await db.maybeOne<UnitRow>("select * from public.delivery_units where id = $1", [
        data.unitId,
      ]);
    else
      row = await units.ensureUnit(db, {
        ...(data.productId ? { product_id: data.productId } : {}),
        ...(data.customerId ? { customer_id: data.customerId } : {}),
        ...(data.foundationId ? { foundation_id: data.foundationId } : {}),
      });
    if (!row) return null;
    // Refresh the spec from current data before showing it.
    if (row.product_id || row.customer_id || row.foundation_id)
      row =
        (await units.ensureUnit(db, {
          ...(row.product_id ? { product_id: row.product_id } : {}),
          ...(row.customer_id ? { customer_id: row.customer_id } : {}),
          ...(row.foundation_id ? { foundation_id: row.foundation_id } : {}),
        })) ?? row;
    const { isolationFindings } = await import("./delivery/model");
    const { requestFile } = await import("./delivery/vending");
    const files = await units.unitFiles(db, row);
    return {
      unit: row,
      findings: isolationFindings(row.spec),
      files,
      request: requestFile(row.spec, {
        requestedBy: row.requested_by ?? "(not requested yet)",
        reason: `${row.spec.name} (${row.kind}) needs its own repository, environments, identities and state.`,
        links: {},
      }),
      vendingConfigured: units.vendingConfigured(),
      org: units.platformFromEnv().org,
    };
  });

export const requestUnitVending = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ unitId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db, units } = await deps();
    const row = await db.maybeOne<UnitRow>("select * from public.delivery_units where id = $1", [
      data.unitId,
    ]);
    if (!row) throw new Error("Delivery unit not found.");
    const { isPlatformKind, isolationFindings } = await import("./delivery/model");
    if (isPlatformKind(row.kind))
      throw new Error("Platform repositories are bootstrapped once by an org admin, not vended.");
    const findings = isolationFindings(row.spec);
    if (findings.length)
      throw new Error(`Fix the isolation findings before vending: ${findings.join(" ")}`);
    const user = (await import("./identity.server")).currentUser();
    return units.requestVending(db, row, user.name);
  });
