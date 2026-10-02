/* The app's side of the MSX link: find or add customers by TPID, their context, and opportunity links. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const by = async () => (await import("./identity.server")).currentUser().name;
const msx = () => import("./msx.server");

export const findCustomersByTpid = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ q: z.string().trim().max(120) }).parse(d))
  .handler(async ({ data }) => {
    const m = await msx();
    return /^\d{3,12}$/.test(data.q)
      ? m.findCustomers({ tpid: data.q })
      : m.findCustomers({ query: data.q });
  });

export const upsertCustomerByTpid = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        tpid: z.string().trim(),
        name: z.string().trim().min(2).max(120),
        accountName: z.string().trim().max(160).optional(),
        industry: z.string().trim().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => (await msx()).upsertCustomer({ ...data, by: await by() }));

export const getCustomerProfile = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => (await msx()).getCustomer(data.id));

export const setCustomerTpid = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), tpid: z.string().trim().nullable() }).parse(d),
  )
  .handler(async ({ data }) => (await msx()).setTpid(data.id, data.tpid || null, await by()));

export const addCustomerContext = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        customerId: z.string().uuid(),
        source: z.enum(["msx", "notes", "email", "transcript", "prompt", "other"]),
        title: z.string().trim().min(2).max(160),
        text: z.string().trim().min(2).max(20000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => (await msx()).addContext({ ...data, by: await by() }));

export const removeCustomerContext = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ customerId: z.string().uuid(), entryId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    await (await msx()).removeContext(data.customerId, data.entryId);
    return { ok: true };
  });

export const linkEngagementOpportunity = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        engagementId: z.string().uuid(),
        opportunityId: z.string().trim().max(64).nullable(),
        opportunityName: z.string().trim().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    (await msx()).linkOpportunity({
      engagementId: data.engagementId,
      opportunityId: data.opportunityId || null,
      opportunityName: data.opportunityName,
      by: await by(),
    }),
  );

/** Whether Copilot can connect (the token itself is never sent to the browser). */
export const getMcpStatus = createServerFn({ method: "GET" }).handler(async () => ({
  on: !!process.env["MCP_TOKEN"]?.trim(),
}));
