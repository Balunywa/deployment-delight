/*
 * Server-only Azure calls, authenticated with DefaultAzureCredential: the web app's managed identity on Azure,
 * your Azure CLI sign-in locally. No keys.
 *   - Tenant scan: Azure Resource Graph (management groups, subscriptions, policy and role assignments, network
 *     and platform resources). Needs Reader at the tenant root (or the scope you want assessed).
 *   - Design advisor: Azure OpenAI chat completions. Needs "Cognitive Services OpenAI User".
 */
import type { TenantSnapshot } from "./alz/assess";

type Credential = { getToken: (scope: string) => Promise<{ token: string } | null> };
let credential: Credential | undefined;
async function token(scope: string) {
  if (!credential) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    credential = new DefaultAzureCredential();
  }
  const t = await credential.getToken(scope);
  if (!t) throw new Error("Couldn't get an Azure token for this app's identity.");
  return t.token;
}

const tenantOf = (jwt: string) => {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")).tid as string;
  } catch {
    return "";
  }
};

/* ------------------------------------------------------------------ tenant */

async function graph(query: string, tenantId: string, bearer: string) {
  const rows: Record<string, unknown>[] = [];
  let skipToken: string | undefined;
  do {
    const res = await fetch(
      "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01",
      {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          query,
          managementGroups: [tenantId],
          options: {
            resultFormat: "objectArray",
            $top: 1000,
            ...(skipToken ? { $skipToken: skipToken } : {}),
          },
        }),
      },
    );
    const body = (await res.json()) as {
      data?: Record<string, unknown>[];
      $skipToken?: string;
      error?: { message?: string; details?: { message?: string }[] };
    };
    if (!res.ok)
      throw new Error(
        `Resource Graph: ${body.error?.details?.[0]?.message ?? body.error?.message ?? res.statusText} (${query.slice(0, 60)}…)`,
      );
    rows.push(...(body.data ?? []));
    skipToken = body.$skipToken;
  } while (skipToken && rows.length < 20000);
  return rows;
}

/** Built-in role definition IDs are the same in every tenant. */
const BUILTIN_ROLE_IDS: Record<string, string> = {
  "8e3af657-a8ff-443c-a75c-2fe8c4bcb635": "Owner",
  "b24988ac-6180-42a0-ab88-20f7382dd24c": "Contributor",
  "acdd72a7-3385-48ef-bd42-f606fba81ae7": "Reader",
  "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9": "User Access Administrator",
  "f58310d9-a9f6-439a-9e8d-f62e7b41a168": "Role Based Access Control Administrator",
  "4d97b98b-1d4f-4787-a291-c67834d212e7": "Network Contributor",
  "fb1c8493-542b-48eb-b624-b4c8fea62acd": "Security Admin",
  "39bc4728-0917-49c7-9d2c-d95423bc2eb4": "Security Reader",
  "ab8e14d6-4a74-4a29-9ba8-549422addade": "Microsoft Sentinel Contributor",
  "92aaf0da-9dab-42b6-94a3-d43ce8d16293": "Log Analytics Contributor",
  "73c42c96-874c-492b-b04d-ab87d138a893": "Log Analytics Reader",
  "749f88d5-cbae-40b8-bcfc-e573ddc772fa": "Monitoring Contributor",
  "36243c78-bf99-498c-9df9-86d9f8d28608": "Resource Policy Contributor",
  "5e0bd9bd-7b93-4f28-af87-19fc36ad61bd": "Cognitive Services OpenAI User",
};

const PLATFORM_TYPES = [
  "microsoft.network/azurefirewalls",
  "microsoft.network/virtualnetworkgateways",
  "microsoft.network/bastionhosts",
  "microsoft.network/ddosprotectionplans",
  "microsoft.network/privatednszones",
  "microsoft.network/dnsresolvers",
  "microsoft.network/virtualwans",
  "microsoft.network/virtualhubs",
  "microsoft.network/privateendpoints",
  "microsoft.network/natgateways",
  "microsoft.network/applicationgateways",
  "microsoft.operationalinsights/workspaces",
  "microsoft.operationsmanagement/solutions",
  "microsoft.automation/automationaccounts",
  "microsoft.recoveryservices/vaults",
  "microsoft.compute/virtualmachines",
  "microsoft.web/sites",
];

export async function scanTenant(): Promise<TenantSnapshot> {
  const bearer = await token("https://management.azure.com/.default");
  const tenantId = tenantOf(bearer);
  const q = (query: string) => graph(query, tenantId, bearer);
  const [mgs, subs, policies, roles, resources, vnets, routeTables, nics] = await Promise.all([
    q(
      "resourcecontainers | where type =~ 'microsoft.management/managementgroups' | project id=name, displayName=tostring(properties.displayName), parentId=tostring(properties.details.parent.name)",
    ),
    q(
      "resourcecontainers | where type =~ 'microsoft.resources/subscriptions' | project id=subscriptionId, name, parentId=tostring(properties.managementGroupAncestorsChain[0].name)",
    ),
    q(
      "policyresources | where type =~ 'microsoft.authorization/policyassignments' | project name, displayName=tostring(properties.displayName), scope=tostring(properties.scope), definitionId=tostring(properties.policyDefinitionId), enforcementMode=tostring(properties.enforcementMode)",
    ),
    q(
      "authorizationresources | where type =~ 'microsoft.authorization/roleassignments' | project rd=tolower(tostring(split(tostring(properties.roleDefinitionId), '/')[-1])), principalType=tostring(properties.principalType), scope=tostring(properties.scope)",
    ),
    q(
      `resources | where type in~ (${PLATFORM_TYPES.map((x) => `'${x}'`).join(",")}) | project type, name, location, subscriptionId, skuTier=tostring(properties.sku.tier), skuName=tostring(sku.name), gatewayType=tostring(properties.gatewayType)`,
    ),
    q(
      "resources | where type =~ 'microsoft.network/virtualnetworks' | project id=tolower(id), name, subscriptionId, location, subnets=properties.subnets, peerings=properties.virtualNetworkPeerings, dnsServers=properties.dhcpOptions.dnsServers",
    ),
    q(
      "resources | where type =~ 'microsoft.network/routetables' | project name, subscriptionId, routes=properties.routes, subnets=array_length(properties.subnets)",
    ),
    q(
      "resources | where type =~ 'microsoft.network/networkinterfaces' | where isnotempty(properties.virtualMachine.id) | mv-expand ipc=properties.ipConfigurations | where isnotempty(ipc.properties.publicIPAddress.id) | summarize n=count()",
    ),
  ]);
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const managementGroups = mgs.map((m) => ({
    id: s(m["id"]),
    displayName: s(m["displayName"]) || s(m["id"]),
    parentId: s(m["parentId"]) || null,
  }));
  if (!managementGroups.some((m) => m.id === tenantId))
    managementGroups.push({ id: tenantId, displayName: "Tenant Root Group", parentId: null });
  for (const m of managementGroups) if (m.id === tenantId) m.parentId = null;
  return {
    source: "live",
    scannedAt: new Date().toISOString(),
    tenantId,
    managementGroups,
    subscriptions: subs.map((x) => ({
      id: s(x["id"]),
      name: s(x["name"]),
      parentId: s(x["parentId"]) || tenantId,
    })),
    policyAssignments: policies.map((p) => ({
      name: s(p["name"]),
      displayName: s(p["displayName"]),
      scope: s(p["scope"]),
      definitionId: s(p["definitionId"]),
      enforcementMode: s(p["enforcementMode"]),
    })),
    roleAssignments: roles.map((r) => ({
      roleName: BUILTIN_ROLE_IDS[s(r["rd"])] ?? "Custom role",
      principalType: s(r["principalType"]),
      scope: s(r["scope"]),
    })),
    resources: resources.map((r) => ({
      type: s(r["type"]),
      name: s(r["name"]),
      location: s(r["location"]),
      subscriptionId: s(r["subscriptionId"]),
      sku: [s(r["skuName"]), s(r["skuTier"])].filter(Boolean).join(" ") || undefined,
      kind: s(r["gatewayType"]) || undefined,
    })),
    vnets: vnets.map((v) => ({
      id: s(v["id"]),
      name: s(v["name"]),
      subscriptionId: s(v["subscriptionId"]),
      location: s(v["location"]),
      subnets: arr(v["subnets"]).map((x) => s(x["name"])),
      peerings: arr(v["peerings"]).map((p) =>
        s(
          (p["properties"] as Record<string, Record<string, unknown>> | undefined)?.[
            "remoteVirtualNetwork"
          ]?.["id"],
        ).toLowerCase(),
      ),
      dnsServers: Array.isArray(v["dnsServers"]) ? (v["dnsServers"] as string[]) : [],
    })),
    routeTables: routeTables.map((r) => ({
      name: s(r["name"]),
      subscriptionId: s(r["subscriptionId"]),
      subnets: Number(r["subnets"] ?? 0),
      defaultToAppliance: arr(r["routes"]).some((x) => {
        const p = (x["properties"] ?? {}) as Record<string, unknown>;
        return p["addressPrefix"] === "0.0.0.0/0" && p["nextHopType"] === "VirtualAppliance";
      }),
    })),
    publicIpsOnNics: Number(nics[0]?.["n"] ?? 0),
  };
}

/* ----------------------------------------------------------------- advisor */

export const advisorConfigured = () => !!process.env["AZURE_OPENAI_ENDPOINT"];

export async function chat(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  const endpoint = process.env["AZURE_OPENAI_ENDPOINT"];
  if (!endpoint)
    throw new Error(
      "The design advisor isn't connected. Set AZURE_OPENAI_ENDPOINT (and AZURE_OPENAI_DEPLOYMENT) and give the app's identity the Cognitive Services OpenAI User role.",
    );
  const deployment = process.env["AZURE_OPENAI_DEPLOYMENT"] || "gpt-4.1";
  const bearer = await token("https://cognitiveservices.azure.com/.default");
  const res = await fetch(
    `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2024-10-21`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ messages, temperature: 0.2, max_tokens: 1400 }),
    },
  );
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Azure OpenAI: ${body.error?.message ?? res.statusText}`);
  return body.choices?.[0]?.message?.content ?? "";
}
