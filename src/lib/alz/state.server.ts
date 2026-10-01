/*
 * Where landing zone Terraform state lives, whichever runs it (this app or GitHub Actions): one Entra ID-only,
 * versioned storage account per landing zone in CD_STATE_SUBSCRIPTION_ID / CD_STATE_RESOURCE_GROUP, container
 * "tfstate", key lz/<slug>.tfstate. Both runners use the same key, so switching between them moves no state.
 */
import { createHash } from "node:crypto";

import { arm } from "./arm.server";

type Log = (line: string) => void;

export type StateLocation = {
  account: string;
  container: string;
  key: string;
  resourceGroup: string;
  subscriptionId: string;
};

export const ROLE = {
  reader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  owner: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
  blobContributor: "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
};

export const stateConfigured = () =>
  !!process.env["CD_STATE_SUBSCRIPTION_ID"]?.trim() &&
  !!process.env["CD_STATE_RESOURCE_GROUP"]?.trim();

export const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

export function guid(...parts: string[]) {
  const h = createHash("sha1").update(parts.join("|").toLowerCase()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const armError = (r: { status: number; data: unknown }) => {
  const e = (r.data as { error?: { code?: string; message?: string } }).error;
  return `${r.status} ${e?.code ?? ""} ${e?.message ?? JSON.stringify(r.data).slice(0, 300)}`.trim();
};

export async function armOk<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await arm<T>(method, path, body);
  if (r.status >= 400)
    throw new Error(`Azure ${method} ${path.split("?")[0]} failed: ${armError(r)}`);
  return r;
}

export async function ensureStateStorage(
  sub: string,
  rg: string,
  preferred: string,
  location: string,
  tags: Record<string, string>,
  log: Log,
) {
  const base = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Storage/storageAccounts`;
  let name = preferred;
  const existing = await arm("GET", `${base}/${name}?api-version=2023-05-01`);
  if (existing.status === 404) {
    const avail = await armOk<{ nameAvailable: boolean }>(
      "POST",
      `/subscriptions/${sub}/providers/Microsoft.Storage/checkNameAvailability?api-version=2023-05-01`,
      { name, type: "Microsoft.Storage/storageAccounts" },
    );
    if (!avail.data.nameAvailable) name = `${preferred.slice(0, 18)}${guid(sub, rg).slice(0, 6)}`;
    if ((await arm("GET", `${base}/${name}?api-version=2023-05-01`)).status === 404) {
      log(`Creating state storage account ${name} in ${rg} (Entra ID only, versioned)…`);
      const body = (sku: string) => ({
        sku: { name: sku },
        kind: "StorageV2",
        location,
        tags,
        properties: {
          allowSharedKeyAccess: false,
          allowBlobPublicAccess: false,
          minimumTlsVersion: "TLS1_2",
          supportsHttpsTrafficOnly: true,
          defaultToOAuthAuthentication: true,
        },
      });
      let put = await arm("PUT", `${base}/${name}?api-version=2023-05-01`, body("Standard_ZRS"));
      if (put.status >= 400)
        put = await arm("PUT", `${base}/${name}?api-version=2023-05-01`, body("Standard_LRS"));
      if (put.status >= 400) throw new Error(`Creating storage account ${name}: ${armError(put)}`);
      for (let i = 0; i < 60; i++) {
        const g = await arm<{ properties?: { provisioningState?: string } }>(
          "GET",
          `${base}/${name}?api-version=2023-05-01`,
        );
        if (g.data.properties?.provisioningState === "Succeeded") break;
        await sleep(5);
      }
    }
  }
  await armOk("PUT", `${base}/${name}/blobServices/default?api-version=2023-05-01`, {
    properties: {
      isVersioningEnabled: true,
      deleteRetentionPolicy: { enabled: true, days: 30 },
      containerDeleteRetentionPolicy: { enabled: true, days: 30 },
    },
  });
  await armOk(
    "PUT",
    `${base}/${name}/blobServices/default/containers/tfstate?api-version=2023-05-01`,
    { properties: { publicAccess: "None" } },
  );
  return { name, containerScope: `${base}/${name}/blobServices/default/containers/tfstate` };
}

export async function assignRole(
  scope: string,
  role: string,
  principalId: string,
  log: Log,
  principalType: "User" | "ServicePrincipal" = "ServicePrincipal",
) {
  const sub = scope.match(/^\/subscriptions\/[^/]+/)?.[0] ?? "";
  const path = `${scope}/providers/Microsoft.Authorization/roleAssignments/${guid(scope, role, principalId)}?api-version=2022-04-01`;
  const body = {
    properties: {
      roleDefinitionId: `${sub}/providers/Microsoft.Authorization/roleDefinitions/${role}`,
      principalId,
      principalType,
      description: "Cloud Delivery landing zone pipeline",
    },
  };
  // A new identity takes a little while to replicate to Microsoft Entra ID.
  for (let attempt = 1; ; attempt++) {
    const r = await arm<{ error?: { code?: string } }>("PUT", path, body);
    if (r.status < 400 || r.data.error?.code === "RoleAssignmentExists") return;
    if (r.data.error?.code === "PrincipalNotFound" && attempt < 18) {
      if (attempt === 1) log("Waiting for the new identity to reach Microsoft Entra ID…");
      await sleep(10);
      continue;
    }
    throw new Error(`Assigning role ${role} at ${scope}: ${armError(r)}`);
  }
}

/**
 * Creates (or finds) the landing zone's state storage and lets `principal` read and write its container.
 * `stateKey` and `preferredAccount` come from the landing zone's delivery unit spec.
 */
export async function ensureState(opts: {
  unitRepo: string;
  preferredAccount: string;
  stateKey: string;
  principal?: { id: string; type: "User" | "ServicePrincipal" };
  log: Log;
}): Promise<StateLocation & { containerScope: string; location: string }> {
  const sub = process.env["CD_STATE_SUBSCRIPTION_ID"]?.trim();
  const rg = process.env["CD_STATE_RESOURCE_GROUP"]?.trim();
  if (!sub || !rg)
    throw new Error(
      "Set CD_STATE_SUBSCRIPTION_ID and CD_STATE_RESOURCE_GROUP: where landing zone Terraform state lives.",
    );
  for (const ns of ["Microsoft.Storage", "Microsoft.ManagedIdentity"])
    await arm("POST", `/subscriptions/${sub}/providers/${ns}/register?api-version=2021-04-01`);
  const group = await armOk<{ location: string }>(
    "GET",
    `/subscriptions/${sub}/resourceGroups/${rg}?api-version=2021-04-01`,
  );
  const tags = { "cd-unit": opts.unitRepo, "managed-by": "cloud-delivery" };
  const storage = await ensureStateStorage(
    sub,
    rg,
    opts.preferredAccount,
    group.data.location,
    tags,
    opts.log,
  );
  if (opts.principal)
    await assignRole(
      storage.containerScope,
      ROLE.blobContributor,
      opts.principal.id,
      opts.log,
      opts.principal.type,
    );
  return {
    account: storage.name,
    container: "tfstate",
    key: opts.stateKey,
    resourceGroup: rg,
    subscriptionId: sub,
    containerScope: storage.containerScope,
    location: group.data.location,
  };
}
