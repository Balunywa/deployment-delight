/*
 * Workload (application) landing zones: Microsoft's active landing zone accelerators on GitHub, what each deploys
 * into a landing zone subscription, and what it needs from the platform. Archived accelerators (Spring Apps,
 * az-hop, the data landing zone) are intentionally not offered.
 */
import type { Answers } from "./engine";

type Need = { ok: boolean; text: string; patch?: Partial<Answers> };

const firewall = (a: Answers, why: string): Need => ({
  ok: a.connectivity !== "none" && a.firewall !== "none",
  text: `Azure Firewall in the hub — ${why}`,
  patch: {
    ...(a.connectivity === "none" ? { connectivity: "hub_and_spoke" as const } : {}),
    firewall: a.firewall === "none" ? "Standard" : a.firewall,
  },
});
const privateDns = (a: Answers, why: string): Need => ({
  ok: a.connectivity !== "none" && a.privateDns === "platform",
  text: `Central private DNS — ${why}`,
  patch: {
    ...(a.connectivity === "none" ? { connectivity: "hub_and_spoke" as const } : {}),
    privateDns: "platform",
  },
});
const hub = (a: Answers, why: string): Need => ({
  ok: a.connectivity !== "none",
  text: `A hub network — ${why}`,
  patch: { connectivity: "hub_and_spoke" },
});

export const WORKLOADS: {
  id: string;
  name: string;
  short: string;
  repo: string;
  module?: { source: string; version: string };
  archetype: "corp" | "online";
  deploys: string[];
  platformNeeds: string;
  policies: string[];
  needs: (a: Answers) => Need[];
}[] = [
  {
    id: "aks",
    name: "Azure Kubernetes Service (AKS)",
    short: "AKS",
    repo: "Azure/AKS-Landing-Zone-Accelerator",
    module: { source: "Azure/avm-ptn-aks-production/azurerm", version: "0.5.0" },
    archetype: "corp",
    deploys: [
      "Private AKS cluster",
      "Azure Container Registry",
      "Key Vault",
      "Application Gateway (WAF)",
      "Private endpoints",
    ],
    platformNeeds:
      "egress through Azure Firewall (AKS required FQDNs), private DNS for privatelink.<region>.azmk8s.io",
    policies: ["Deny-Priv-Esc-AKS", "Deny-Privileged-AKS", "Enforce-AKS-HTTPS"],
    needs: (a) => [
      firewall(a, "cluster egress is routed and allowed by FQDN (AKS outbound rules)"),
      privateDns(a, "private clusters resolve privatelink.<region>.azmk8s.io"),
    ],
  },
  {
    id: "appservice",
    name: "Azure App Service",
    short: "App Service",
    repo: "Azure/appservice-landing-zone-accelerator",
    archetype: "online",
    deploys: [
      "App Service (Environment v3 or multitenant with private endpoints)",
      "Application Gateway / Front Door (WAF)",
      "Key Vault",
    ],
    platformNeeds: "private DNS for privatelink.azurewebsites.net when private",
    policies: ["Audit-AppGW-WAF", "Enforce-GR-AppServices0"],
    needs: (a) => [privateDns(a, "private endpoints resolve privatelink.azurewebsites.net")],
  },
  {
    id: "aca",
    name: "Azure Container Apps",
    short: "Container Apps",
    repo: "Azure/ACA-Landing-Zone-Accelerator",
    module: { source: "Azure/avm-ptn-aca-lza-hosting-environment/azurerm", version: "0.1.0" },
    archetype: "corp",
    deploys: [
      "Container Apps environment (workload profiles, internal)",
      "Container Registry",
      "Application Gateway (WAF)",
      "Key Vault",
    ],
    platformNeeds: "egress through Azure Firewall with UDRs, private DNS",
    policies: ["Enforce-GR-ContApps0"],
    needs: (a) => [
      firewall(a, "workload-profile environments send egress through the firewall with UDRs"),
      privateDns(a, "registry, Key Vault and the environment resolve privately"),
    ],
  },
  {
    id: "apim",
    name: "Azure API Management",
    short: "API Management",
    repo: "Azure/apim-landing-zone-accelerator",
    archetype: "online",
    deploys: [
      "API Management (internal VNet mode)",
      "Application Gateway (WAF) in front",
      "Key Vault",
    ],
    platformNeeds: "private DNS for the internal gateway, hub peering for backends",
    policies: ["Enforce-GR-APIM0", "Audit-AppGW-WAF"],
    needs: (a) => [privateDns(a, "the internal gateway and backends resolve privately")],
  },
  {
    id: "avd",
    name: "Azure Virtual Desktop",
    short: "Virtual Desktop",
    repo: "Azure/avdaccelerator",
    module: { source: "Azure/avm-ptn-avd-lza-managementplane/azurerm", version: "0.3.2" },
    archetype: "corp",
    deploys: [
      "Host pool, workspace, application groups",
      "Session hosts",
      "FSLogix storage",
      "AVD Insights",
    ],
    platformNeeds:
      "hub connectivity, egress to the AVD required URLs, AD DS (Identity subscription) unless session hosts are Microsoft Entra joined",
    policies: ["Deny-MgmtPorts-Internet", "Deploy-VM-Monitoring"],
    needs: (a) => [
      hub(a, "session hosts reach identity and on-premises resources through it"),
      firewall(a, "session hosts need the AVD required URLs allowed"),
      {
        ok: a.identity === "yes",
        text: "Identity subscription with AD DS — needed unless session hosts are Microsoft Entra joined",
        patch: { identity: "yes" },
      },
    ],
  },
  {
    id: "aro",
    name: "Azure Red Hat OpenShift",
    short: "OpenShift",
    repo: "Azure/ARO-Landing-Zone-Accelerator",
    archetype: "corp",
    deploys: [
      "Private ARO cluster",
      "Front Door (WAF) for ingress",
      "Container Registry",
      "Key Vault",
    ],
    platformNeeds: "egress through Azure Firewall, private DNS, hub peering",
    policies: ["Deny-IP-forwarding"],
    needs: (a) => [
      firewall(a, "cluster egress is inspected and restricted"),
      privateDns(a, "private cluster and registry resolve privately"),
    ],
  },
  {
    id: "avs",
    name: "Azure VMware Solution",
    short: "VMware Solution",
    repo: "Azure/Enterprise-Scale-for-AVS",
    archetype: "corp",
    deploys: [
      "AVS private cloud",
      "ExpressRoute authorization to the hub",
      "HCX / Global Reach to on-premises",
    ],
    platformNeeds: "an ExpressRoute gateway in the hub (AVS connects to Azure over ExpressRoute)",
    policies: [],
    needs: (a) => [
      {
        ok: a.connectivity !== "none" && a.expressRoute === "yes",
        text: "ExpressRoute gateway in the hub — AVS private clouds connect to the hub over ExpressRoute",
        patch: {
          connectivity: a.connectivity === "none" ? "hub_and_spoke" : a.connectivity,
          expressRoute: "yes",
        },
      },
    ],
  },
  {
    id: "ai",
    name: "AI Landing Zone (Azure AI Foundry)",
    short: "AI Landing Zone",
    repo: "Azure/AI-Landing-Zones",
    module: { source: "Azure/avm-ptn-aiml-landing-zone/azurerm", version: "0.5.2" },
    archetype: "corp",
    deploys: [
      "Azure AI Foundry (private)",
      "Azure OpenAI / model deployments",
      "AI Search",
      "Key Vault, Storage, Cosmos DB with private endpoints",
    ],
    platformNeeds: "central private DNS for many privatelink zones, egress through Azure Firewall",
    policies: ["Enforce-GR-CogServ0", "Deny-Public-Endpoints"],
    needs: (a) => [
      privateDns(a, "AI Foundry, OpenAI, AI Search and storage all use private endpoints"),
      firewall(a, "model and agent egress is controlled"),
    ],
  },
  {
    id: "sap",
    name: "SAP on Azure (deployment automation framework)",
    short: "SAP",
    repo: "Azure/sap-automation",
    archetype: "corp",
    deploys: [
      "SAP workload zone (VNet, key vault)",
      "SAP system (HANA / application servers)",
      "Deployer and library",
    ],
    platformNeeds:
      "hybrid connectivity (ExpressRoute recommended), AD DS or DNS integration, egress control",
    policies: ["Deploy-VM-Backup"],
    needs: (a) => [
      {
        ok: a.connectivity !== "none" && (a.expressRoute === "yes" || a.vpnGateway === "yes"),
        text: "Hybrid connectivity — SAP users and interfaces are usually on-premises (ExpressRoute recommended)",
        patch: {
          connectivity: a.connectivity === "none" ? "hub_and_spoke" : a.connectivity,
          expressRoute: "yes",
        },
      },
      firewall(a, "outbound from SAP systems is inspected"),
    ],
  },
];

export const workloadById = (id: string) => WORKLOADS.find((w) => w.id === id);
