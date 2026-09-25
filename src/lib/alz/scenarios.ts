/*
 * Starting points for a new platform landing zone, matching the scenarios Microsoft ships with the Azure Landing
 * Zones IaC accelerator (https://azure.github.io/Azure-Landing-Zones/accelerator/). Each one is a set of design
 * answers; everything can still be changed on the design canvas before deploying.
 */
import type { Answers } from "./engine";

export type Scenario = {
  id: string;
  name: string;
  body: string;
  multiRegion: boolean;
  supported: boolean;
  answers: Partial<Answers>;
};

const full: Partial<Answers> = {
  firewall: "Standard",
  bastion: "yes",
  vpnGateway: "yes",
  expressRoute: "yes",
  ddosPlan: "yes",
  privateDns: "platform",
};
const smb: Partial<Answers> = {
  firewall: "Basic",
  bastion: "no",
  vpnGateway: "no",
  expressRoute: "no",
  ddosPlan: "no",
  privateDns: "platform",
  identity: "no",
  securitySubscription: "no",
  logRetentionDays: 30,
};

export const SCENARIOS: Scenario[] = [
  {
    id: "single-hub-azfw",
    name: "Single-region hub and spoke + Azure Firewall",
    body: "Hub network with Azure Firewall, Bastion, VPN and ExpressRoute gateways, DNS Private Resolver and DDoS.",
    multiRegion: false,
    supported: true,
    answers: { connectivity: "hub_and_spoke", ...full },
  },
  {
    id: "single-vwan-azfw",
    name: "Single-region Virtual WAN + Azure Firewall",
    body: "A secured virtual hub with routing intent, gateways, DNS and DDoS.",
    multiRegion: false,
    supported: true,
    answers: { connectivity: "virtual_wan", ...full },
  },
  {
    id: "multi-hub-azfw",
    name: "Multi-region hub and spoke + Azure Firewall",
    body: "A hub in each region with Azure Firewall, gateways and DNS.",
    multiRegion: true,
    supported: true,
    answers: { connectivity: "hub_and_spoke", ...full },
  },
  {
    id: "multi-vwan-azfw",
    name: "Multi-region Virtual WAN + Azure Firewall",
    body: "A secured virtual hub in each region with routing intent.",
    multiRegion: true,
    supported: true,
    answers: { connectivity: "virtual_wan", ...full },
  },
  {
    id: "smb-single-hub",
    name: "Cost-optimized hub and spoke (Firewall Basic)",
    body: "Single region, Azure Firewall Basic, no gateways, Bastion or DDoS. Management and Connectivity subscriptions only.",
    multiRegion: false,
    supported: true,
    answers: { connectivity: "hub_and_spoke", ...smb },
  },
  {
    id: "smb-single-vwan",
    name: "Cost-optimized Virtual WAN (Firewall Basic)",
    body: "Single region secured virtual hub with Firewall Basic, no gateways or DDoS.",
    multiRegion: false,
    supported: true,
    answers: { connectivity: "virtual_wan", ...smb },
  },
  {
    id: "management-only",
    name: "Management groups, policy and management only",
    body: "The hierarchy, ALZ policies and the Management subscription. No central network.",
    multiRegion: false,
    supported: true,
    answers: { connectivity: "none", siem: "other" },
  },
  {
    id: "hub-nva",
    name: "Hub and spoke + third-party firewall (NVA)",
    body: "Not supported yet — use an Azure Firewall scenario.",
    multiRegion: false,
    supported: false,
    answers: {},
  },
];
