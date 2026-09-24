/*
 * Access (Azure RBAC) and extra policy choices for a landing zone, from Microsoft's guidance:
 * - Roles and where to assign them: CAF identity and access management design area and the ALZ custom roles
 *   shipped in the ALZ Library (Application-Owners, Network-Management, Network-Subnet-Contributor,
 *   Security-Operations, Subscription-Owner).
 * - Policies beyond the ALZ defaults: official built-in policy definitions and regulatory compliance initiatives
 *   (IDs are the built-in definition names in every Azure tenant).
 */

/** Built-in Azure roles offered, by exact role name (the ALZ module looks roles up by name). */
export const BUILTIN_ROLES: { name: string; body: string }[] = [
  { name: "Owner", body: "Full access, including granting access to others." },
  { name: "Contributor", body: "Full access to resources, but can't grant access." },
  { name: "Reader", body: "View everything, change nothing." },
  { name: "Network Contributor", body: "Manage networks, not access to them." },
  { name: "Security Admin", body: "Defender for Cloud: policies, alerts, recommendations." },
  { name: "Security Reader", body: "View security posture and alerts." },
  { name: "Microsoft Sentinel Contributor", body: "Run the SIEM: rules, incidents, workbooks." },
  { name: "Log Analytics Reader", body: "Read monitoring data and logs." },
  { name: "Monitoring Contributor", body: "Manage alerts, diagnostics and monitoring settings." },
  { name: "Resource Policy Contributor", body: "Create and assign Azure Policy." },
  { name: "Cost Management Reader", body: "View costs and budgets." },
];

/** ALZ Library custom roles (created at the intermediate root as "<name> (<root id>)"). */
export const ALZ_ROLES: Record<string, string> = {
  "Subscription-Owner":
    "Owner of a subscription, minus managing its own role assignments, networking to the hub and policy.",
  "Application-Owners":
    "Contributor for application teams, minus role assignments, networking and policy changes.",
  "Network-Management": "Platform-wide networking: hubs, peering, routing, gateways, firewalls.",
  "Network-Subnet-Contributor": "Join subnets of existing virtual networks — for workload teams.",
  "Security-Operations":
    "Security operations across the estate: Defender, policy compliance, Key Vault recovery.",
};

export type RbacAssignment = { persona: string; role: string; scope: string };

/** The people and identities that need access, with Microsoft's recommended role and scope. */
export const PERSONAS: {
  id: string;
  label: string;
  body: string;
  role: string;
  scope: string;
  why: string;
  condition?: boolean;
}[] = [
  {
    id: "platform",
    label: "Platform team",
    body: "Runs the landing zone: management groups, policy, platform subscriptions.",
    role: "Owner",
    scope: "alz",
    why: "CAF: the Azure platform owner manages the management group hierarchy and subscription lifecycle. Use Privileged Identity Management so Owner is activated just in time, not standing.",
  },
  {
    id: "netops",
    label: "Network team",
    body: "Hub networking, firewall rules, gateways, peering.",
    role: "Network-Management",
    scope: "connectivity",
    why: "CAF: network management (NetOps) gets the ALZ Network-Management role at the Connectivity management group, so it can't touch workloads.",
  },
  {
    id: "secops",
    label: "Security team",
    body: "Defender for Cloud, Sentinel, policy compliance.",
    role: "Security-Operations",
    scope: "alz",
    why: "CAF: security operations (SecOps) needs a horizontal view across the whole estate, so the role is assigned at the intermediate root.",
  },
  {
    id: "delivery",
    label: "Delivery pipeline",
    body: "The identity Cloud Delivery uses to vend a subscription per customer install and deploy your product.",
    role: "Owner",
    scope: "landingzones",
    condition: true,
    why: "Subscription vending places new subscriptions under Landing zones and assigns access in them. Scope it to Landing zones only, and add Microsoft's recommended condition so it can never grant Owner, User Access Administrator or RBAC Administrator. It also needs Subscription Creator on the billing account.",
  },
  {
    id: "appops",
    label: "Product operations team",
    body: "Operates the product in each customer install.",
    role: "Application-Owners",
    scope: "landingzones",
    why: "CAF: application owners (DevOps/AppOps) get the ALZ Application-Owners role in their landing zones — contributor rights without networking, policy or access control.",
  },
  {
    id: "support",
    label: "Support engineers",
    body: "Investigate customer issues without changing anything.",
    role: "Reader",
    scope: "landingzones",
    why: "Least privilege: read-only in customer landing zones. Pair with Log Analytics Reader on the Management subscription for logs.",
  },
  {
    id: "auditors",
    label: "Auditors",
    body: "Review configuration and compliance.",
    role: "Reader",
    scope: "alz",
    why: "Read-only across the estate from the intermediate root.",
  },
];

/** Microsoft's recommended condition for privileged assignments (from the Azure/avm-ptn-alz module docs). */
export const RESTRICT_PRIVILEGED_CONDITION =
  "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'}))OR(@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId]ForAnyOfAllValues:GuidNotEquals{8e3af657-a8ff-443c-a75c-2fe8c4bcb635, 18d7d88d-d35e-4fb5-a5c3-7773c20a72d9, f58310d9-a9f6-439a-9e8d-f62e7b41a168}))AND((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'}))OR(@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId]ForAnyOfAllValues:GuidNotEquals{8e3af657-a8ff-443c-a75c-2fe8c4bcb635, 18d7d88d-d35e-4fb5-a5c3-7773c20a72d9, f58310d9-a9f6-439a-9e8d-f62e7b41a168}))";

export const recommendedRbac = (hasGroup: (id: string) => boolean): RbacAssignment[] =>
  PERSONAS.filter((p) => hasGroup(p.scope)).map((p) => ({
    persona: p.id,
    role: p.role,
    scope: p.scope,
  }));

/* ------------------------------------------------------------------ policies */

export type PolicyAdd = { id: string; scope: string };

export const POLICY_OPTIONS: {
  id: string;
  name: string;
  assignmentName: string;
  kind: "policy" | "initiative";
  definition: string;
  category: "Regions" | "Tagging" | "Compliance framework";
  body: string;
  scope: string;
  why: string;
  parameters?: "locations" | "tag";
}[] = [
  {
    id: "allowed-locations",
    name: "Allowed locations",
    assignmentName: "Allowed-Locations",
    kind: "policy",
    definition: "e56962a6-4747-49cd-b67b-bf8b01975c4c",
    category: "Regions",
    body: "Resources can only be created in your chosen regions.",
    scope: "alz",
    why: "CAF resource organization: restrict regions once at the intermediate root so every subscription inherits it. Your design's regions are filled in.",
    parameters: "locations",
  },
  {
    id: "allowed-rg-locations",
    name: "Allowed locations for resource groups",
    assignmentName: "Allowed-RG-Locations",
    kind: "policy",
    definition: "e765b5de-1225-4ba3-bd56-1ac6695af988",
    category: "Regions",
    body: "Resource groups (and their metadata) stay in your regions.",
    scope: "alz",
    why: "Pairs with Allowed locations; assign at the same scope.",
    parameters: "locations",
  },
  {
    id: "require-rg-tag",
    name: "Require a tag on resource groups",
    assignmentName: "Require-RG-Tag",
    kind: "policy",
    definition: "96670d01-0a4d-4649-9c89-2d3abc0a5025",
    category: "Tagging",
    body: "Every resource group must carry a customer tag, so costs map to customers.",
    scope: "landingzones",
    why: "For an ISV, a customer tag on every resource group makes per-customer cost and ownership reporting reliable. Assign at Landing zones so platform resources are unaffected.",
    parameters: "tag",
  },
  {
    id: "nist-800-53-r5",
    name: "NIST SP 800-53 Rev. 5",
    assignmentName: "NIST-800-53-R5",
    kind: "initiative",
    definition: "179d1daa-458f-4e47-8086-2a68d0d6c38f",
    category: "Compliance framework",
    body: "Audit against NIST SP 800-53 Rev. 5 controls — common for US utilities and government.",
    scope: "alz",
    why: "Regulatory initiatives are audit-only. Assign at the intermediate root so Defender for Cloud's regulatory compliance dashboard covers every subscription.",
  },
  {
    id: "iso-27001",
    name: "ISO 27001:2013",
    assignmentName: "ISO-27001-2013",
    kind: "initiative",
    definition: "89c6cddc-1c73-4ac1-b19c-54d1a15a42f2",
    category: "Compliance framework",
    body: "Audit against ISO/IEC 27001:2013.",
    scope: "alz",
    why: "Audit-only; assign at the intermediate root for estate-wide compliance reporting.",
  },
  {
    id: "cis-2",
    name: "CIS Microsoft Azure Foundations Benchmark v2.0.0",
    assignmentName: "CIS-Azure-2.0",
    kind: "initiative",
    definition: "06f19060-9e68-4070-92ca-f15cc126059e",
    category: "Compliance framework",
    body: "Audit against the CIS Azure Foundations Benchmark.",
    scope: "alz",
    why: "Audit-only; assign at the intermediate root.",
  },
  {
    id: "pci-dss-4",
    name: "PCI DSS v4",
    assignmentName: "PCI-DSS-v4",
    kind: "initiative",
    definition: "c676748e-3af9-4e22-bc28-50feed564afb",
    category: "Compliance framework",
    body: "Audit against PCI DSS v4 — if the product handles card payments.",
    scope: "landingzones",
    why: "Only workloads that handle card data need it; assign at Landing zones (or only Corp) rather than the whole estate.",
  },
  {
    id: "fedramp-high",
    name: "FedRAMP High",
    assignmentName: "FedRAMP-High",
    kind: "initiative",
    definition: "d5264498-16f4-418a-b659-fa7ef418175f",
    category: "Compliance framework",
    body: "Audit against FedRAMP High — for US federal customers.",
    scope: "alz",
    why: "Audit-only; assign at the intermediate root.",
  },
];
