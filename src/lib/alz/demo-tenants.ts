/*
 * Demo tenant snapshots for customers whose tenants can't be scanned in the demo. They use the real ALZ
 * Library assignment names so the assessment compares like with like. Live scans replace them.
 */
import type { TenantSnapshot } from "./assess";
import type { AlzLibrary } from "./engine";

export type DemoVariant = "partial-alz" | "legacy";

export function demoSnapshot(
  variant: DemoVariant,
  lib: AlzLibrary,
  customer: { name: string; code: string },
): TenantSnapshot {
  const code = customer.code.split("-")[0] ?? "contoso";
  const tenantId = `demo-${code}`;
  const sub = (n: string) => `${code}-${n}`;
  const base: TenantSnapshot = {
    source: "demo",
    scannedAt: new Date("2026-09-20T14:00:00Z").toISOString(),
    tenantId,
    label: `${customer.name} (demo snapshot)`,
    managementGroups: [{ id: tenantId, displayName: "Tenant Root Group", parentId: null }],
    subscriptions: [],
    policyAssignments: [],
    roleAssignments: [],
    resources: [],
    vnets: [],
    routeTables: [],
    publicIpsOnNics: 0,
  };
  const mgPath = (id: string) => `/providers/Microsoft.Management/managementGroups/${id}`;

  if (variant === "partial-alz") {
    const groups: [string, string, string][] = [
      [code, customer.name, tenantId],
      [`${code}-platform`, "Platform", code],
      [`${code}-management`, "Management", `${code}-platform`],
      [`${code}-connectivity`, "Connectivity", `${code}-platform`],
      [`${code}-identity`, "Identity", `${code}-platform`],
      [`${code}-landingzones`, "Landing Zones", code],
      [`${code}-corp`, "Corp", `${code}-landingzones`],
      [`${code}-online`, "Online", `${code}-landingzones`],
      [`${code}-sandbox`, "Sandbox", code],
    ];
    base.managementGroups.push(
      ...groups.map(([id, displayName, parentId]) => ({ id, displayName, parentId })),
    );
    base.subscriptions = [
      { id: sub("mgmt"), name: `${customer.name} Management`, parentId: `${code}-management` },
      { id: sub("conn"), name: `${customer.name} Connectivity`, parentId: `${code}-connectivity` },
      { id: sub("idty"), name: `${customer.name} Identity`, parentId: `${code}-identity` },
      { id: sub("scada"), name: "SCADA historian", parentId: `${code}-corp` },
      { id: sub("gis"), name: "GIS platform", parentId: `${code}-corp` },
      { id: sub("portal"), name: "Customer portal", parentId: `${code}-online` },
      { id: sub("legacy"), name: "Legacy EA subscription", parentId: tenantId },
    ];
    // ALZ assignments as deployed a couple of releases ago: newer ones missing, a few removed by hand.
    const drop = new Set([
      "Deploy-MDFC-Config-H224",
      "Deploy-MCSB2-Monitoring",
      "Enable-DDoS-VNET",
      "Deny-Priv-Esc-AKS",
      "Enforce-GR-KeyVault",
      "Deploy-vmArc-ChangeTrack",
      "Deploy-vmHybr-Monitoring",
      "Enable-AUM-CheckUpdates",
      "Deploy-VM-Backup",
      "Enforce-ASR",
    ]);
    for (const m of lib.managementGroups) {
      const target = groups.find(([id]) => id === (m.id === "alz" ? code : `${code}-${m.id}`));
      if (!target) continue;
      for (const name of lib.archetypes[m.archetypes[0] ?? ""]?.policyAssignments ?? []) {
        if (drop.has(name) || name.startsWith("Enforce-GR-")) continue;
        const a = lib.assignments[name];
        base.policyAssignments.push({
          name,
          displayName: a?.displayName ?? name,
          scope: mgPath(target[0]),
          definitionId: `/providers/Microsoft.Authorization/policySetDefinitions/${a?.definition ?? name}`,
          enforcementMode: "Default",
        });
      }
    }
    base.policyAssignments.push({
      name: "Deploy-MDFC-Config",
      displayName: "Deploy Microsoft Defender for Cloud configuration (2022)",
      scope: mgPath(code),
      definitionId:
        "/providers/Microsoft.Management/managementGroups/x/providers/Microsoft.Authorization/policySetDefinitions/Deploy-MDFC-Config",
      enforcementMode: "Default",
    });
    base.roleAssignments = [
      ...Array.from({ length: 4 }, () => ({
        roleName: "Owner",
        principalType: "User",
        scope: `/subscriptions/${sub("scada")}`,
      })),
      { roleName: "Owner", principalType: "Group", scope: mgPath(code) },
      {
        roleName: `Network-Management (${code})`,
        principalType: "Group",
        scope: mgPath(`${code}-connectivity`),
      },
    ];
    const r = (
      type: string,
      name: string,
      subscriptionId: string,
      extra: Partial<TenantSnapshot["resources"][number]> = {},
    ) => base.resources.push({ type, name, location: "eastus2", subscriptionId, ...extra });
    r("Microsoft.Network/azureFirewalls", "afw-hub-eastus2", sub("conn"), {
      sku: "AZFW_VNet Standard",
    });
    r("Microsoft.Network/virtualNetworkGateways", "vgw-hub-eastus2", sub("conn"), { kind: "Vpn" });
    for (const z of [
      "blob",
      "file",
      "vaultcore",
      "database",
      "postgres",
      "servicebus",
      "azurecr",
      "monitor",
      "oms",
      "agentsvc",
      "ods",
      "queue",
      "table",
      "web",
    ])
      r("Microsoft.Network/privateDnsZones", `privatelink.${z}.core.windows.net`, sub("conn"), {
        location: "global",
      });
    for (let i = 0; i < 9; i++)
      r("Microsoft.Network/privateEndpoints", `pe-${i}`, sub(i % 2 ? "scada" : "gis"));
    r("Microsoft.OperationalInsights/workspaces", "law-platform-eastus2", sub("mgmt"));
    r("Microsoft.OperationalInsights/workspaces", "law-scada", sub("scada"));
    r("Microsoft.OperationalInsights/workspaces", "law-portal", sub("portal"));
    r(
      "Microsoft.OperationsManagement/solutions",
      "SecurityInsights(law-platform-eastus2)",
      sub("mgmt"),
    );
    r("Microsoft.Automation/automationAccounts", "aa-platform", sub("mgmt"));
    r("Microsoft.Web/sites", "portal-app", sub("portal"));
    base.vnets = [
      {
        id: "hub",
        name: "vnet-hub-eastus2",
        subscriptionId: sub("conn"),
        location: "eastus2",
        subnets: ["AzureFirewallSubnet", "GatewaySubnet", "AzureFirewallManagementSubnet"],
        peerings: ["scada", "gis"],
        dnsServers: [],
      },
      {
        id: "scada",
        name: "vnet-scada",
        subscriptionId: sub("scada"),
        location: "eastus2",
        subnets: ["app", "data"],
        peerings: ["hub"],
        dnsServers: ["10.0.1.4"],
      },
      {
        id: "gis",
        name: "vnet-gis",
        subscriptionId: sub("gis"),
        location: "eastus2",
        subnets: ["app"],
        peerings: ["hub"],
        dnsServers: ["10.0.1.4"],
      },
      {
        id: "portal",
        name: "vnet-portal",
        subscriptionId: sub("portal"),
        location: "eastus2",
        subnets: ["web"],
        peerings: [],
        dnsServers: [],
      },
      {
        id: "legacy",
        name: "vnet-legacy-prod",
        subscriptionId: sub("legacy"),
        location: "eastus",
        subnets: ["default"],
        peerings: [],
        dnsServers: [],
      },
    ];
    base.routeTables = [
      { name: "rt-scada", subscriptionId: sub("scada"), defaultToAppliance: true, subnets: 2 },
      { name: "rt-gis", subscriptionId: sub("gis"), defaultToAppliance: true, subnets: 1 },
    ];
    base.publicIpsOnNics = 2;
    return base;
  }

  // Legacy: no hierarchy to speak of, peered VNets, no central controls.
  base.managementGroups.push({ id: `${code}-it`, displayName: "IT", parentId: tenantId });
  base.subscriptions = [
    { id: sub("prod"), name: `${customer.name} Production`, parentId: tenantId },
    { id: sub("dev"), name: `${customer.name} Dev/Test`, parentId: tenantId },
    { id: sub("shared"), name: `${customer.name} Shared Services`, parentId: `${code}-it` },
  ];
  base.policyAssignments = [
    {
      name: "SecurityCenterBuiltIn",
      displayName: "ASC Default",
      scope: `/subscriptions/${sub("prod")}`,
      definitionId:
        "/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8",
      enforcementMode: "Default",
    },
    {
      name: "allowed-locations",
      displayName: "Allowed locations",
      scope: `/subscriptions/${sub("prod")}`,
      definitionId:
        "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c",
      enforcementMode: "Default",
    },
  ];
  base.roleAssignments = Array.from({ length: 6 }, (_, i) => ({
    roleName: "Owner",
    principalType: "User",
    scope: `/subscriptions/${sub(i % 2 ? "prod" : "shared")}`,
  }));
  const r = (type: string, name: string, subscriptionId: string) =>
    base.resources.push({ type, name, location: "southcentralus", subscriptionId });
  for (const n of ["law-prod", "law-dev", "law-shared", "DefaultWorkspace-scus"])
    r("Microsoft.OperationalInsights/workspaces", n, sub(n.includes("dev") ? "dev" : "prod"));
  for (let i = 0; i < 3; i++) r("Microsoft.Network/privateEndpoints", `pe-${i}`, sub("prod"));
  r("Microsoft.Compute/virtualMachines", "vm-historian-01", sub("prod"));
  base.vnets = [
    {
      id: "a",
      name: "vnet-prod",
      subscriptionId: sub("prod"),
      location: "southcentralus",
      subnets: ["default"],
      peerings: ["b", "c"],
      dnsServers: [],
    },
    {
      id: "b",
      name: "vnet-shared",
      subscriptionId: sub("shared"),
      location: "southcentralus",
      subnets: ["default"],
      peerings: ["a"],
      dnsServers: [],
    },
    {
      id: "c",
      name: "vnet-dev",
      subscriptionId: sub("dev"),
      location: "southcentralus",
      subnets: ["default"],
      peerings: ["a"],
      dnsServers: [],
    },
  ];
  base.publicIpsOnNics = 7;
  return base;
}
