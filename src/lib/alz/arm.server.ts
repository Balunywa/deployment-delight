/*
 * Azure Resource Manager calls for real landing zone deployments, authenticated without keys:
 *   - Locally: your Azure CLI sign-in (DefaultAzureCredential).
 *   - On App Service: the web app's managed identity, exchanged for an app registration that trusts it
 *     (DEPLOY_CLIENT_ID). Terraform can't use App Service managed identity directly, but it can use the same
 *     exchange through OIDC, so the app and Terraform deploy as the same identity.
 */
type Credential = { getToken: (scope: string) => Promise<{ token: string } | null> };

let cached: Credential | undefined;
let miCached: Credential | undefined;

const onAppService = () => !!process.env["IDENTITY_ENDPOINT"];
export const deployClientId = () => process.env["DEPLOY_CLIENT_ID"] ?? "";

async function managedIdentity() {
  if (!miCached) {
    const { ManagedIdentityCredential } = await import("@azure/identity");
    miCached = new ManagedIdentityCredential();
  }
  return miCached;
}

/** A managed identity token the app registration accepts as a federated client assertion. */
export async function federatedAssertion() {
  const t = await (await managedIdentity()).getToken("api://AzureADTokenExchange/.default");
  if (!t) throw new Error("The web app's managed identity didn't return a token.");
  return t.token;
}

export function claims(jwt: string): Record<string, string> {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function credential(): Promise<Credential> {
  if (cached) return cached;
  const identity = await import("@azure/identity");
  if (onAppService() && deployClientId()) {
    const assertion = await federatedAssertion();
    const tenant = claims(assertion)["tid"] ?? "";
    cached = new identity.ClientAssertionCredential(tenant, deployClientId(), () =>
      federatedAssertion(),
    );
  } else {
    cached = new identity.DefaultAzureCredential();
  }
  return cached;
}

export async function armToken() {
  const t = await (await credential()).getToken("https://management.azure.com/.default");
  if (!t) throw new Error("Couldn't get an Azure Resource Manager token.");
  return t.token;
}

export type Identity = {
  objectId: string;
  tenantId: string;
  name: string;
  kind: "user" | "workload";
  mode: "cli" | "app-registration" | "managed-identity";
};

export async function whoAmI(): Promise<Identity> {
  const c = claims(await armToken());
  const kind = c["idtyp"] === "app" || !c["upn"] ? "workload" : "user";
  return {
    objectId: c["oid"] ?? "",
    tenantId: c["tid"] ?? "",
    name: c["upn"] ?? c["unique_name"] ?? c["app_displayname"] ?? c["appid"] ?? "",
    kind,
    mode: onAppService() ? (deployClientId() ? "app-registration" : "managed-identity") : "cli",
  };
}

export async function arm<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T; headers: Headers }> {
  const res = await fetch(`https://management.azure.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await armToken()}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data: data as T, headers: res.headers };
}

export type SubscriptionInfo = {
  id: string;
  name: string;
  state: string;
  resourceGroups: number;
  managementGroup: string | null;
};

export async function listSubscriptions(): Promise<SubscriptionInfo[]> {
  const r = await arm<{ value?: { subscriptionId: string; displayName: string; state: string }[] }>(
    "GET",
    "/subscriptions?api-version=2022-12-01",
  );
  const subs = r.data.value ?? [];
  return Promise.all(
    subs.map(async (s) => {
      const rgs = await arm<{ value?: unknown[] }>(
        "GET",
        `/subscriptions/${s.subscriptionId}/resourcegroups?api-version=2021-04-01`,
      );
      return {
        id: s.subscriptionId,
        name: s.displayName,
        state: s.state,
        resourceGroups: rgs.data.value?.length ?? 0,
        managementGroup: null,
      };
    }),
  );
}

export type BillingScope = { id: string; name: string; kind: "mca" | "ea" };

/** Where new subscriptions can be billed: MCA invoice sections and EA enrollment accounts the identity can see. */
export async function listBillingScopes(): Promise<BillingScope[]> {
  const accounts = await arm<{
    value?: { name: string; properties?: { agreementType?: string; displayName?: string } }[];
  }>("GET", "/providers/Microsoft.Billing/billingAccounts?api-version=2020-05-01");
  const out: BillingScope[] = [];
  for (const a of accounts.data.value ?? []) {
    const type = a.properties?.agreementType;
    if (type === "MicrosoftCustomerAgreement") {
      const profiles = await arm<{
        value?: { name: string; properties?: { displayName?: string } }[];
      }>(
        "GET",
        `/providers/Microsoft.Billing/billingAccounts/${a.name}/billingProfiles?api-version=2020-05-01`,
      );
      for (const p of profiles.data.value ?? []) {
        const sections = await arm<{
          value?: { id: string; name: string; properties?: { displayName?: string } }[];
        }>(
          "GET",
          `/providers/Microsoft.Billing/billingAccounts/${a.name}/billingProfiles/${p.name}/invoiceSections?api-version=2020-05-01`,
        );
        for (const s of sections.data.value ?? [])
          out.push({
            id: s.id,
            name: `${a.properties?.displayName ?? a.name} · ${p.properties?.displayName ?? p.name} · ${s.properties?.displayName ?? s.name}`,
            kind: "mca",
          });
      }
    } else if (type === "EnterpriseAgreement") {
      const enrollments = await arm<{
        value?: { id: string; name: string; properties?: { accountName?: string } }[];
      }>(
        "GET",
        `/providers/Microsoft.Billing/billingAccounts/${a.name}/enrollmentAccounts?api-version=2019-10-01-preview`,
      );
      for (const e of enrollments.data.value ?? [])
        out.push({
          id: e.id,
          name: `${a.properties?.displayName ?? a.name} · ${e.properties?.accountName ?? e.name}`,
          kind: "ea",
        });
    }
  }
  return out;
}

const ROLE = {
  owner: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
  contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
  uaa: "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9",
  rbacAdmin: "f58310d9-a9f6-439a-9e8d-f62e7b41a168",
};

/** Roles the identity holds (directly) at the tenant root management group, including inherited from "/". */
export async function rootRoles(identity: Identity) {
  const r = await arm<{
    value?: { properties: { roleDefinitionId: string; scope: string } }[];
  }>(
    "GET",
    `/providers/Microsoft.Management/managementGroups/${identity.tenantId}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=${encodeURIComponent(`principalId eq '${identity.objectId}'`)}`,
  );
  const ids = (r.data.value ?? []).map(
    (a) => a.properties.roleDefinitionId.split("/").at(-1) ?? "",
  );
  return {
    owner: ids.includes(ROLE.owner),
    contributor: ids.includes(ROLE.contributor),
    accessAdmin: ids.includes(ROLE.uaa) || ids.includes(ROLE.rbacAdmin),
    status: r.status,
  };
}

export async function managementGroupExists(id: string) {
  const r = await arm(
    "GET",
    `/providers/Microsoft.Management/managementGroups/${id}?api-version=2021-04-01`,
  );
  return r.status === 200;
}

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

/** Creates a management group under its parent if it isn't there yet. Returns whether it was created. */
export async function ensureManagementGroup(opts: {
  id: string;
  displayName: string;
  parentId: string;
  log: (line: string) => void;
}): Promise<boolean> {
  const path = `/providers/Microsoft.Management/managementGroups/${opts.id}?api-version=2021-04-01`;
  if ((await arm("GET", path)).status === 200) return false;
  opts.log(`Creating management group "${opts.displayName}" (${opts.id}) under ${opts.parentId}…`);
  const body = {
    properties: {
      displayName: opts.displayName,
      details: {
        parent: { id: `/providers/Microsoft.Management/managementGroups/${opts.parentId}` },
      },
    },
  };
  let put = await arm<{ error?: { message?: string } }>("PUT", path, body);
  for (let attempt = 1; put.status === 429 && attempt <= 5; attempt++) {
    await sleep(Math.max(15, Number(put.headers.get("retry-after") ?? 0) || 15 * attempt));
    put = await arm("PUT", path, body);
  }
  if (put.status >= 400)
    throw new Error(
      `Creating management group ${opts.id} failed (${put.status}): ${put.data.error?.message ?? JSON.stringify(put.data).slice(0, 300)}`,
    );
  // Creation is asynchronous; children and subscriptions can only go in once the group reads back.
  for (let i = 0; i < 60; i++) {
    if ((await arm("GET", path)).status === 200) return true;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for management group ${opts.id}.`);
}

/** Whether a subscription sits directly in a management group. */
export async function subscriptionInGroup(subscriptionId: string, groupId: string) {
  const r = await arm(
    "GET",
    `/providers/Microsoft.Management/managementGroups/${groupId}/subscriptions/${subscriptionId}?api-version=2021-04-01`,
  );
  return r.status === 200;
}

/** Moves a subscription into a management group (no-op when it's already there). */
export async function moveSubscription(subscriptionId: string, groupId: string) {
  const r = await arm<{ error?: { message?: string } }>(
    "PUT",
    `/providers/Microsoft.Management/managementGroups/${groupId}/subscriptions/${subscriptionId}?api-version=2021-04-01`,
  );
  if (r.status >= 400)
    throw new Error(
      `Moving subscription ${subscriptionId} into ${groupId} failed (${r.status}): ${r.data.error?.message ?? JSON.stringify(r.data).slice(0, 300)}`,
    );
}

/** Deletes an empty management group this app created; subscriptions still in it go back to the tenant root. */
export async function removeManagementGroup(
  id: string,
  tenantId: string,
  log: (l: string) => void,
) {
  const path = `/providers/Microsoft.Management/managementGroups/${id}?api-version=2021-04-01`;
  const g = await arm<{ properties?: { children?: { type: string; name: string }[] } }>(
    "GET",
    `/providers/Microsoft.Management/managementGroups/${id}?api-version=2021-04-01&$expand=children`,
  );
  if (g.status === 404) return;
  for (const c of g.data.properties?.children ?? [])
    if (c.type.toLowerCase() === "/subscriptions") {
      log(`Moving subscription ${c.name} out of ${id} to the tenant root group.`);
      await moveSubscription(c.name, tenantId);
    }
  log(`Deleting management group ${id}.`);
  const d = await arm<{ error?: { message?: string } }>("DELETE", path);
  if (d.status >= 400 && d.status !== 404) {
    log(`Couldn't delete management group ${id} (${d.status}): ${d.data.error?.message ?? ""}`);
    return;
  }
  for (let i = 0; i < 60 && (await arm("GET", path)).status !== 404; i++) await sleep(5);
}

/** Creates (or finds) a subscription through the Subscription alias API. Idempotent by alias name. */
export async function vendSubscription(opts: {
  alias: string;
  displayName: string;
  billingScope: string;
  workload: "Production" | "DevTest";
  /** Management group to create the subscription in (it must exist); otherwise the tenant's default group. */
  managementGroupId?: string | undefined;
  log: (line: string) => void;
}): Promise<string> {
  const path = `/providers/Microsoft.Subscription/aliases/${opts.alias}?api-version=2021-10-01`;
  const existing = await arm<{
    properties?: { subscriptionId?: string; provisioningState?: string };
  }>("GET", path);
  if (existing.status === 200 && existing.data.properties?.subscriptionId) {
    opts.log(
      `Subscription alias ${opts.alias} already exists: ${existing.data.properties.subscriptionId}`,
    );
    return existing.data.properties.subscriptionId;
  }
  opts.log(`Creating subscription "${opts.displayName}" (alias ${opts.alias})…`);
  const body = {
    properties: {
      displayName: opts.displayName,
      billingScope: opts.billingScope,
      workload: opts.workload,
      ...(opts.managementGroupId
        ? {
            additionalProperties: {
              managementGroupId: `/providers/Microsoft.Management/managementGroups/${opts.managementGroupId}`,
            },
          }
        : {}),
    },
  };
  // Azure limits how fast a billing account can create subscriptions (429). Say exactly what Azure said, wait
  // out short-term throttling, and stop at once when it's a quota that waiting won't fix.
  type AliasPut = {
    properties?: { subscriptionId?: string; provisioningState?: string };
    error?: { code?: string; message?: string };
  };
  const reason = (r: { data: AliasPut }) =>
    [r.data.error?.code, r.data.error?.message].filter(Boolean).join(": ") ||
    JSON.stringify(r.data).slice(0, 300);
  const isQuota = (r: { data: AliasPut }) =>
    /quota|limit(ed)? (has been )?reached|exceed/i.test(
      `${r.data.error?.code ?? ""} ${r.data.error?.message ?? ""}`,
    );
  let put = await arm<AliasPut>("PUT", path, body);
  if (put.status === 429) opts.log(`Azure said (429): ${reason(put)}`);
  for (let attempt = 1; put.status === 429 && !isQuota(put) && attempt <= 8; attempt++) {
    const wait = Math.min(
      300,
      Math.max(30, Number(put.headers.get("retry-after") ?? 0) || 30 * attempt),
    );
    opts.log(
      `Azure is throttling subscription creation for this billing account — retrying in ${wait}s (attempt ${attempt} of 8).`,
    );
    await new Promise((r) => setTimeout(r, wait * 1000));
    put = await arm<AliasPut>("PUT", path, body);
  }
  if (put.status >= 400)
    throw new Error(
      put.status === 429
        ? `Azure won't create more subscriptions on this billing account right now (${reason(put)}). ` +
            `Subscriptions already created are kept and reused when you plan again. To carry on now: pick an ` +
            `existing subscription for "${opts.displayName}" in Platform subscriptions, or turn that subscription ` +
            `off in the design (its services move into Management), or ask Microsoft support to raise the ` +
            `billing account's subscription creation limit.`
        : `Creating subscription ${opts.displayName} failed (${put.status}): ${reason(put)}`,
    );
  for (let i = 0; i < 60; i++) {
    const g = await arm<{ properties?: { subscriptionId?: string; provisioningState?: string } }>(
      "GET",
      path,
    );
    const state = g.data.properties?.provisioningState;
    if (state === "Succeeded" && g.data.properties?.subscriptionId) {
      opts.log(`Subscription "${opts.displayName}" created: ${g.data.properties.subscriptionId}`);
      return g.data.properties.subscriptionId;
    }
    if (state === "Failed") throw new Error(`Creating subscription ${opts.displayName} failed.`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Timed out waiting for subscription ${opts.displayName}.`);
}

/** Cancels a subscription this app created (billing stops; Azure deletes it after the retention period). */
export async function cancelSubscription(subscriptionId: string, alias: string) {
  const c = await arm(
    "POST",
    `/subscriptions/${subscriptionId}/providers/Microsoft.Subscription/cancel?api-version=2021-10-01&IgnoreResourceCheck=true`,
  );
  await arm("DELETE", `/providers/Microsoft.Subscription/aliases/${alias}?api-version=2021-10-01`);
  return c.status;
}

/** Makes sure the resource providers the landing zone uses are registered in a subscription. */
export async function registerProviders(subscriptionId: string, log: (l: string) => void) {
  const needed = [
    "Microsoft.Network",
    "Microsoft.OperationalInsights",
    "Microsoft.OperationsManagement",
    "Microsoft.Automation",
    "Microsoft.Insights",
    "Microsoft.ManagedIdentity",
    "Microsoft.PolicyInsights",
    "Microsoft.Security",
    "Microsoft.Management",
    "Microsoft.Resources",
  ];
  for (const ns of needed) {
    const g = await arm<{ registrationState?: string }>(
      "GET",
      `/subscriptions/${subscriptionId}/providers/${ns}?api-version=2021-04-01`,
    );
    if (g.data.registrationState !== "Registered") {
      log(`Registering ${ns} in ${subscriptionId}`);
      await arm(
        "POST",
        `/subscriptions/${subscriptionId}/providers/${ns}/register?api-version=2021-04-01`,
      );
    }
  }
}
