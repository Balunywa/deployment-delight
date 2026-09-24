/*
 * Tenant scan and design advisor server functions. Both run with the app's own Azure identity (managed identity
 * on App Service, your Azure CLI sign-in locally).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Tables } from "./db-types";

/** Scan the tenant this app's identity can read and keep the snapshot with the landing zone. */
export const scanFoundationTenant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ foundationId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const [{ scanTenant }, db] = await Promise.all([
      import("./azure.server"),
      import("./db.server"),
    ]);
    const snapshot = await scanTenant();
    const f = await db.one<Tables<"foundations">>(
      "select * from public.foundations where id = $1",
      [data.foundationId],
    );
    const discovered = { ...((f.discovered as Record<string, unknown>) ?? {}), snapshot };
    await db.update(
      "foundations",
      { discovered, updated_at: new Date().toISOString() },
      { id: f.id },
    );
    await db.insert("audit_events", {
      organization_id: f.organization_id,
      actor_name: "Sarah Chen",
      event_type: "foundation.tenant_scanned",
      customer_id: f.customer_id,
      resource_type: "foundation",
      resource_id: f.name,
      new_value: {
        tenantId: snapshot.tenantId,
        managementGroups: snapshot.managementGroups.length,
        subscriptions: snapshot.subscriptions.length,
        policyAssignments: snapshot.policyAssignments.length,
      },
      result: "succeeded",
    });
    return snapshot;
  });

const SYSTEM = `You are the Cloud Delivery landing zone advisor, an Azure architect who knows Microsoft's Cloud Adoption Framework, the Azure Landing Zones (ALZ) Library and Azure Verified Modules deeply.

You help an ISV platform team design, change and onboard customers onto an Azure landing zone. The ISV hosts customer installs of its product; each install is its own subscription (a spoke) in a landing zone management group.

Ground every answer in the DESIGN CONTEXT JSON you are given (the live design, its management groups and policy counts, resources, traffic flows, access, customer installs, and a tenant assessment if present). Never invent policy assignment names, roles or resources; use the names in the context or well-known Microsoft names. If something isn't in the context, say so.

Accuracy rules: use current Microsoft product names (e.g. "Azure DDoS Network Protection", not "DDoS Protection Standard"). Never claim a regulation or standard requires something unless it does; say "commonly recommended" otherwise. For frameworks with no Azure built-in initiative (for example NERC CIP), say so and map to the closest built-in options in extraPolicyOptions.

Style: plain, direct, short. Lead with the answer. Use short bullets. Explain trade-offs (cost, risk, operations) when recommending. Mention the Microsoft guidance you rely on by name (e.g. "CAF network topology", "ALZ Corp archetype").

When the user asks for changes or a recommendation that maps to the design, end with exactly one fenced block:
\`\`\`design-patch
{ ...only the design fields to change... }
\`\`\`
Allowed fields and values: connectivity ("hub_and_spoke"|"virtual_wan"|"none"), firewall ("Basic"|"Standard"|"Premium"|"none"), bastion, vpnGateway, expressRoute, ddosPlan, identity, securitySubscription, defender, updateManager, serviceHealth, vmBackup ("yes"|"no"), privateDns ("platform"|"none"), monitoring ("azure_monitor"|"third_party"), siem ("sentinel"|"other"), logRetentionDays (number), secondaryRegion (Azure region name or ""), primaryRegion, landingZones (array of "corp","online","local","sandbox"), rbac (array of {persona, role, scope}), policyAdds (array of {id, scope}). Only include a patch when a change is actually proposed.`;

export const askAdvisor = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        context: z.string().max(60000),
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
          .min(1)
          .max(30),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { chat } = await import("./azure.server");
    const reply = await chat([
      { role: "system", content: SYSTEM },
      { role: "system", content: `DESIGN CONTEXT\n${data.context}` },
      ...data.messages,
    ]);
    return { reply };
  });
