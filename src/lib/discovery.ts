/*
 * Demo discovery of a customer's Azure platform. In real mode this is an Azure Resource Graph
 * query run with the customer-granted identity; here it returns deterministic, clearly
 * demo-labelled candidates derived from the customer code.
 */
const short = (code: string) => code.replace(/-\d+$/, "").split("-")[0] ?? code;

export function discoverPlatform(code: string, subscriptionId: string) {
  const c = short(code);
  const sub = subscriptionId.slice(0, 8) || "00000000";
  return {
    vnetId: [
      `/subscriptions/${sub}/resourceGroups/rg-${c}-connectivity/providers/Microsoft.Network/virtualNetworks/vnet-${c}-hub-eastus2`,
      `/subscriptions/${sub}/resourceGroups/rg-${c}-connectivity/providers/Microsoft.Network/virtualNetworks/vnet-${c}-hub-centralus`,
    ],
    firewallPrivateIp: ["10.0.0.4", "10.1.0.4"],
    privateDnsZoneRg: [`/subscriptions/${sub}/resourceGroups/rg-${c}-dns`],
    logAnalyticsWorkspaceId: [
      `/subscriptions/${sub}/resourceGroups/rg-${c}-mgmt/providers/Microsoft.OperationalInsights/workspaces/law-${c}-soc`,
      `/subscriptions/${sub}/resourceGroups/rg-${c}-mgmt/providers/Microsoft.OperationalInsights/workspaces/law-${c}-platform`,
    ],
  } as Record<string, string[]>;
}

export const demoSubscriptions = (code: string) => {
  const c = short(code);
  return [
    { id: "2f8a7d11-4c39-4f85-b1de-93c7f6a52e10", name: `sub-${c}-grid-analytics-prod` },
    { id: "7b21c0de-1f44-4d0b-9a8e-3cf0e4b7a912", name: `sub-${c}-grid-analytics-nonprod` },
  ];
};
