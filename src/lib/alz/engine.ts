/*
 * Platform landing zone engine, built on Microsoft's Azure Landing Zones (ALZ) Library.
 *
 * The library (https://github.com/Azure/Azure-Landing-Zones-Library, platform/alz) defines the management
 * group architecture, the archetype assigned to each management group, and the policy assignments in each
 * archetype. Snapshots of pinned releases are bundled in this folder; nothing here is invented.
 *
 * The engine turns a few plain-language answers into exactly the customizations Microsoft documents —
 * removing specific assignments from archetypes and supplying policy default values — and renders them as
 * configuration for the official AVM modules (Azure/avm-ptn-alz/azurerm with the Azure/alz provider).
 */
import lib202509 from "./alz-2025.09.3.json";
import lib202608 from "./alz-2026.08.1.json";

export type Assignment = {
  displayName: string;
  description: string;
  kind: "policy" | "initiative";
  source: "builtin" | "alz";
  definition: string;
  enforcementMode: string;
  effect: string | null;
  parameters: string[];
};

export type AlzLibrary = {
  ref: string;
  source: string;
  managementGroups: {
    id: string;
    displayName: string;
    parentId: string | null;
    archetypes: string[];
  }[];
  archetypes: Record<
    string,
    {
      policyAssignments: string[];
      policyDefinitions: number;
      policySetDefinitions: number;
      roleDefinitions: string[];
    }
  >;
  assignments: Record<string, Assignment>;
  defaults: {
    name: string;
    description: string;
    assignments: { assignment: string; parameters: string[] }[];
  }[];
};

export const LIBRARIES: AlzLibrary[] = [lib202608 as AlzLibrary, lib202509 as AlzLibrary];
export const LATEST_REF = LIBRARIES[0]!.ref;
export const libraryFor = (ref: string) => LIBRARIES.find((l) => l.ref === ref) ?? LIBRARIES[0]!;
export const shortRef = (ref: string) => ref.replace("platform/alz/", "");

/* ------------------------------------------------------------------ answers */

export type Answers = {
  intermediateRootId: string;
  intermediateRootName: string;
  primaryRegion: string;
  connectivity: "hub_and_spoke" | "virtual_wan" | "none";
  ddosPlan: "yes" | "no";
  privateDns: "platform" | "none";
  monitoring: "azure_monitor" | "third_party";
  siem: "sentinel" | "other";
  securityContactEmail: string;
};

export const DEFAULT_ANSWERS: Answers = {
  intermediateRootId: "alz",
  intermediateRootName: "Azure Landing Zones",
  primaryRegion: "eastus2",
  connectivity: "hub_and_spoke",
  ddosPlan: "no",
  privateDns: "platform",
  monitoring: "azure_monitor",
  siem: "sentinel",
  securityContactEmail: "",
};

export const QUESTIONS: {
  key: keyof Answers;
  question: string;
  help: string;
  options: { value: string; label: string; body: string }[];
}[] = [
  {
    key: "connectivity",
    question: "How should workloads connect to each other and to on-premises networks?",
    help: "Decides what is built in the Connectivity subscription.",
    options: [
      {
        value: "hub_and_spoke",
        label: "Hub-and-spoke network",
        body: "A central hub virtual network with Azure Firewall; landing zones peer to it.",
      },
      {
        value: "virtual_wan",
        label: "Azure Virtual WAN",
        body: "Microsoft-managed global transit — better for many regions and branches.",
      },
      {
        value: "none",
        label: "No central network",
        body: "Cloud-only, internet-facing workloads. No hub is built.",
      },
    ],
  },
  {
    key: "ddosPlan",
    question: "Is there an Azure DDoS Network Protection plan?",
    help: "Without a plan, the DDoS policy must be removed or virtual network deployments can fail.",
    options: [
      {
        value: "yes",
        label: "Yes",
        body: "Virtual networks are enrolled in the plan automatically.",
      },
      {
        value: "no",
        label: "No",
        body: "The DDoS assignment is removed from Connectivity and Landing Zones.",
      },
    ],
  },
  {
    key: "privateDns",
    question: "Should the platform own private DNS for private endpoints?",
    help: "Corp workloads use private endpoints; their DNS records need a home.",
    options: [
      {
        value: "platform",
        label: "Yes — central private DNS zones",
        body: "Private endpoints register in zones in the Connectivity subscription.",
      },
      {
        value: "none",
        label: "No — managed elsewhere",
        body: "The automatic DNS registration assignment is removed from Corp.",
      },
    ],
  },
  {
    key: "monitoring",
    question: "Which monitoring platform will the platform team use?",
    help: "Azure Monitor Agent policies need a Log Analytics workspace and data collection rules.",
    options: [
      {
        value: "azure_monitor",
        label: "Azure Monitor",
        body: "The Management subscription hosts the Log Analytics workspace and data collection rules.",
      },
      {
        value: "third_party",
        label: "A third-party tool",
        body: "Azure Monitor Agent deployment assignments are removed.",
      },
    ],
  },
  {
    key: "siem",
    question: "Where does the security team run its SIEM?",
    help: "The Security management group always exists; this decides whether it gets a subscription.",
    options: [
      {
        value: "sentinel",
        label: "Microsoft Sentinel",
        body: "A dedicated Security subscription hosts Sentinel.",
      },
      { value: "other", label: "Another SIEM", body: "No Security subscription is created now." },
    ],
  },
];

/* ------------------------------------------------------------ customization */

export type Change = {
  managementGroup: string;
  archetype: string;
  assignment: string;
  action: "remove";
  reason: string;
};

const AMA_ASSIGNMENTS = [
  "Deploy-VM-Monitoring",
  "Deploy-VMSS-Monitoring",
  "Deploy-VM-ChangeTrack",
  "Deploy-VMSS-ChangeTrack",
  "Deploy-MDFC-DefSQL-AMA",
];

/** The documented customizations implied by the answers, resolved against the pinned library. */
export function changesFor(library: AlzLibrary, answers: Answers): Change[] {
  const out: Change[] = [];
  const removeWherever = (assignment: string, reason: string) => {
    for (const mg of library.managementGroups)
      for (const archetype of mg.archetypes)
        if (library.archetypes[archetype]?.policyAssignments.includes(assignment))
          out.push({ managementGroup: mg.id, archetype, assignment, action: "remove", reason });
  };
  if (answers.ddosPlan === "no")
    removeWherever(
      "Enable-DDoS-VNET",
      "No DDoS Network Protection plan. Microsoft advises removing this assignment, otherwise virtual network deployments can fail.",
    );
  if (answers.privateDns === "none" || answers.connectivity === "none")
    removeWherever(
      "Deploy-Private-DNS-Zones",
      "Private DNS for private endpoints isn't owned by the platform, so automatic zone registration is removed (Microsoft guidance).",
    );
  if (answers.monitoring === "third_party")
    for (const a of AMA_ASSIGNMENTS)
      removeWherever(
        a,
        "A third-party monitoring tool is used. Microsoft advises removing the Azure Monitor Agent deployment assignments.",
      );
  return out;
}

/** Library default values still needed after customization, and where each value comes from. */
export function requiredDefaults(library: AlzLibrary, answers: Answers) {
  const removed = new Set(changesFor(library, answers).map((c) => c.assignment));
  return library.defaults
    .map((d) => ({ ...d, assignments: d.assignments.filter((a) => !removed.has(a.assignment)) }))
    .filter((d) => d.assignments.length)
    .map((d) => ({
      ...d,
      from: d.name.startsWith("private_dns_zone")
        ? "Connectivity subscription"
        : d.name.startsWith("ama_") || d.name === "log_analytics_workspace_id"
          ? "Management subscription"
          : d.name === "ddos_protection_plan_id"
            ? "Connectivity subscription"
            : d.name === "email_security_contact"
              ? "Your answer"
              : "Generated",
    }));
}

/* ------------------------------------------------------------ effective view */

export type MgNode = {
  id: string;
  libraryId: string;
  displayName: string;
  parentId: string | null;
  archetype: string;
  depth: number;
  here: { name: string; assignment: Assignment | undefined; removed: Change | undefined }[];
  inherited: number;
  enforced: number;
};

/** Management group tree with the controls assigned at each level and how many are inherited. */
export function hierarchy(library: AlzLibrary, answers: Answers): MgNode[] {
  const changes = changesFor(library, answers);
  const rootId = answers.intermediateRootId || "alz";
  const idOf = (libraryId: string) =>
    libraryId === "alz" ? rootId : `${rootId === "alz" ? "" : `${rootId}-`}${libraryId}`;
  const byId = new Map(library.managementGroups.map((m) => [m.id, m]));
  const depthOf = (id: string): number => {
    const p = byId.get(id)?.parentId;
    return p ? depthOf(p) + 1 : 0;
  };
  const nodes = library.managementGroups.map((m) => {
    const archetype = m.archetypes[0] ?? "";
    const here = (library.archetypes[archetype]?.policyAssignments ?? []).map((name) => ({
      name,
      assignment: library.assignments[name],
      removed: changes.find((c) => c.managementGroup === m.id && c.assignment === name),
    }));
    return {
      id: idOf(m.id),
      libraryId: m.id,
      displayName: m.id === "alz" ? answers.intermediateRootName || m.displayName : m.displayName,
      parentId: m.parentId ? idOf(m.parentId) : null,
      archetype,
      depth: depthOf(m.id),
      here,
      inherited: 0,
      enforced: here.filter((h) => !h.removed).length,
    };
  });
  const find = (id: string | null) => nodes.find((n) => n.id === id);
  for (const n of nodes) {
    let p = find(n.parentId);
    while (p) {
      n.inherited += p.enforced;
      p = find(p.parentId);
    }
  }
  const order = [
    "alz",
    "platform",
    "management",
    "connectivity",
    "identity",
    "security",
    "landingzones",
    "corp",
    "online",
    "local",
    "sandbox",
    "decommissioned",
  ];
  return nodes.sort((a, b) => order.indexOf(a.libraryId) - order.indexOf(b.libraryId));
}

/* ---------------------------------------------------------------- upgrades */

export function diffLibraries(from: AlzLibrary, to: AlzLibrary) {
  const fromMgs = new Set(from.managementGroups.map((m) => m.id));
  const toMgs = new Set(to.managementGroups.map((m) => m.id));
  const assignmentChanges: { archetype: string; added: string[]; removed: string[] }[] = [];
  for (const archetype of new Set([
    ...Object.keys(from.archetypes),
    ...Object.keys(to.archetypes),
  ])) {
    const a = new Set(from.archetypes[archetype]?.policyAssignments ?? []);
    const b = new Set(to.archetypes[archetype]?.policyAssignments ?? []);
    const added = [...b].filter((x) => !a.has(x));
    const removed = [...a].filter((x) => !b.has(x));
    if (added.length || removed.length) assignmentChanges.push({ archetype, added, removed });
  }
  const changed = Object.keys(to.assignments).filter((n) => {
    const x = from.assignments[n];
    const y = to.assignments[n];
    return (
      x &&
      y &&
      (x.definition !== y.definition ||
        x.parameters.join() !== y.parameters.join() ||
        x.displayName !== y.displayName)
    );
  });
  return {
    managementGroupsAdded: to.managementGroups.filter((m) => !fromMgs.has(m.id)),
    managementGroupsRemoved: from.managementGroups.filter((m) => !toMgs.has(m.id)),
    assignmentChanges,
    changed,
  };
}

/* ------------------------------------------------------- platform resources */

export function platformSubscriptions(answers: Answers) {
  return [
    {
      managementGroup: "management",
      name: "Management",
      purpose:
        answers.monitoring === "azure_monitor"
          ? "Log Analytics workspace, data collection rules, AMA identity"
          : "Automation and operations tooling",
      created: true,
    },
    {
      managementGroup: "connectivity",
      name: "Connectivity",
      purpose:
        answers.connectivity === "virtual_wan"
          ? "Virtual WAN hub, Azure Firewall, private DNS"
          : answers.connectivity === "hub_and_spoke"
            ? "Hub virtual network, Azure Firewall, private DNS"
            : "Not needed — no central network",
      created: answers.connectivity !== "none",
    },
    {
      managementGroup: "identity",
      name: "Identity",
      purpose: "Domain controllers or Entra Domain Services, if the workloads need them",
      created: true,
    },
    {
      managementGroup: "security",
      name: "Security",
      purpose: answers.siem === "sentinel" ? "Microsoft Sentinel" : "Reserved for security tooling",
      created: answers.siem === "sentinel",
    },
  ];
}

/* ---------------------------------------------------------- infrastructure */

const q = (s: string) => JSON.stringify(s);

/** Aligns "=" in consecutive single-line attributes of the same block, the way `terraform fmt` does. */
function alignHcl(src: string) {
  const lines = src.split("\n");
  const attr = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const m = attr.exec(lines[i]!);
    if (!m) {
      i += 1;
      continue;
    }
    const indent = m[1]!;
    let j = i;
    const group: number[] = [];
    while (j < lines.length) {
      const n = attr.exec(lines[j]!);
      if (!n || n[1] !== indent || /[{[(]\s*$/.test(n[3]!)) break;
      group.push(j);
      j += 1;
    }
    if (group.length > 1) {
      const width = Math.max(...group.map((k) => attr.exec(lines[k]!)![2]!.length));
      for (const k of group) {
        const n = attr.exec(lines[k]!)!;
        lines[k] = `${indent}${n[2]!.padEnd(width)} = ${n[3]}`;
      }
    }
    i = Math.max(j, i + 1);
  }
  return lines.join("\n");
}

/** Files for the official AVM ALZ modules: pinned library, archetype overrides, defaults and platform modules. */
export function terraformFor(ref: string, answers: Answers): { path: string; content: string }[] {
  const library = libraryFor(ref);
  const changes = changesFor(library, answers);
  const byArchetype = new Map<string, string[]>();
  for (const c of changes)
    byArchetype.set(c.archetype, [
      ...new Set([...(byArchetype.get(c.archetype) ?? []), c.assignment]),
    ]);
  const custom = byArchetype.size > 0 || answers.intermediateRootId !== "alz";
  const overrideName = (a: string) => (byArchetype.has(a) ? `${a}_custom` : a);
  const prefix = answers.intermediateRootId === "alz" ? "" : `${answers.intermediateRootId}-`;
  const defaults = requiredDefaults(library, answers);
  const hub = answers.connectivity !== "none";

  const main = [
    `# Platform landing zone for ${answers.intermediateRootName}, generated by Cloud Delivery.`,
    `# Uses Microsoft's Azure Verified Modules for Azure Landing Zones and the ALZ Library, pinned to ${shortRef(ref)}.`,
    ``,
    `data "azapi_client_config" "current" {}`,
    ``,
    `provider "alz" {`,
    `  library_references = [`,
    `    { path = "platform/alz", ref = ${q(shortRef(ref))} },`,
    ...(custom ? [`    { custom_url = "\${path.root}/lib" },`] : []),
    `  ]`,
    `}`,
    ``,
    `module "management" {`,
    `  source  = "Azure/avm-ptn-alz-management/azurerm"`,
    `  version = "0.9.0"`,
    `  location                     = ${q(answers.primaryRegion)}`,
    `  resource_group_name          = "rg-management-${answers.primaryRegion}"`,
    `  log_analytics_workspace_name = "law-management-${answers.primaryRegion}"`,
    `  automation_account_name      = "aa-management-${answers.primaryRegion}"`,
    `}`,
    ``,
    ...(answers.connectivity === "hub_and_spoke"
      ? [
          `module "connectivity" {`,
          `  source  = "Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm"`,
          `  version = "0.17.5"`,
          ``,
          `  hub_and_spoke_networks_settings = {`,
          `    enabled_resources = {`,
          `      ddos_protection_plan = ${answers.ddosPlan === "yes"}`,
          `    }`,
          `  }`,
          ``,
          `  hub_virtual_networks = {`,
          `    primary = {`,
          `      location                  = ${q(answers.primaryRegion)}`,
          `      default_hub_address_space = "10.0.0.0/16"`,
          `      enabled_resources = {`,
          `        private_dns_zones    = ${answers.privateDns === "platform"}`,
          `        private_dns_resolver = ${answers.privateDns === "platform"}`,
          `      }`,
          `    }`,
          `  }`,
          `}`,
          ``,
        ]
      : answers.connectivity === "virtual_wan"
        ? [
            `module "connectivity" {`,
            `  source  = "Azure/avm-ptn-virtualwan/azurerm"`,
            `  version = "0.14.1"`,
            ``,
            `  virtual_wan_name    = "vwan-connectivity-${answers.primaryRegion}"`,
            `  resource_group_name = "rg-connectivity-${answers.primaryRegion}"`,
            `  location            = ${q(answers.primaryRegion)}`,
            `}`,
            ``,
          ]
        : []),
    `module "alz" {`,
    `  source  = "Azure/avm-ptn-alz/azurerm"`,
    `  version = "0.21.0"`,
    ``,
    `  architecture_name  = ${q(custom ? "custom" : "alz")}`,
    `  parent_resource_id = data.azapi_client_config.current.tenant_id`,
    `  location           = ${q(answers.primaryRegion)}`,
    ``,
    `  # Library default values. "<from …>" values are outputs of the management and connectivity modules`,
    `  # (for example module.management.data_collection_rule_ids); the rest come from your answers.`,
    `  policy_default_values = {`,
    ...defaults.map((d) => {
      const v =
        d.name === "log_analytics_workspace_id"
          ? "module.management.resource_id"
          : d.name === "email_security_contact"
            ? q(answers.securityContactEmail || "security@example.com")
            : d.name === "resource_group_location" || d.name === "private_dns_zone_region"
              ? q(answers.primaryRegion)
              : d.name.startsWith("ama_") ||
                  d.name.startsWith("private_dns_zone") ||
                  d.name === "ddos_protection_plan_id"
                ? q(`<from ${d.from.toLowerCase()}>`)
                : q(d.name.replace(/_/g, "-"));
      return `    ${d.name} = jsonencode({ value = ${v} })`;
    }),
    `  }`,
    `}`,
  ].join("\n");

  const files = [{ path: "main.tf", content: alignHcl(main) }];
  if (custom) {
    for (const [archetype, removed] of byArchetype)
      files.push({
        path: `lib/${archetype}_custom.alz_archetype_override.json`,
        content: JSON.stringify(
          {
            $schema:
              "https://raw.githubusercontent.com/Azure/Azure-Landing-Zones-Library/main/schemas/archetype_override.json",
            name: `${archetype}_custom`,
            base_archetype: archetype,
            policy_assignments_to_remove: removed,
          },
          null,
          2,
        ),
      });
    files.push({
      path: "lib/custom.alz_architecture_definition.json",
      content: JSON.stringify(
        {
          $schema:
            "https://raw.githubusercontent.com/Azure/Azure-Landing-Zones-Library/main/schemas/architecture_definition.json",
          name: "custom",
          management_groups: library.managementGroups.map((m) => ({
            id: m.id === "alz" ? answers.intermediateRootId : `${prefix}${m.id}`,
            display_name: m.id === "alz" ? answers.intermediateRootName : m.displayName,
            parent_id: m.parentId
              ? m.parentId === "alz"
                ? answers.intermediateRootId
                : `${prefix}${m.parentId}`
              : null,
            archetypes: m.archetypes.map(overrideName),
            exists: false,
          })),
        },
        null,
        2,
      ),
    });
  }
  if (!hub)
    files[0]!.content +=
      "\n\n# No central network was selected, so no connectivity module is deployed.";
  return files;
}

/** Subscription vending for one customer install, placed in the right landing zone management group. */
export function vendingFor(
  answers: Answers,
  install: { name: string; archetype: string; region: string },
) {
  const prefix = answers.intermediateRootId === "alz" ? "" : `${answers.intermediateRootId}-`;
  return [
    `module "sub_${install.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}" {`,
    `  source  = "Azure/avm-ptn-alz-sub-vending/azure"`,
    `  version = "0.3.2"`,
    `  location                       = ${q(install.region)}`,
    `  subscription_alias_enabled     = true`,
    `  subscription_alias_name        = ${q(install.name)}`,
    `  subscription_display_name      = ${q(install.name)}`,
    `  subscription_workload          = "Production"`,
    `  subscription_billing_scope     = var.billing_scope # EA enrollment account or MCA invoice section`,
    `  subscription_management_group_association_enabled = true`,
    `  subscription_management_group_id                  = ${q(`${prefix}${install.archetype}`)}`,
    `}`,
  ].join("\n");
}

/* ------------------------------------------------------------ landing zones */

export const LANDING_ZONE_LABEL: Record<string, { title: string; body: string }> = {
  corp: {
    title: "Corp",
    body: "Workloads connected to the corporate network through the hub. Public endpoints are denied.",
  },
  online: {
    title: "Online",
    body: "Workloads that serve the internet directly or don't need a virtual network.",
  },
  local: {
    title: "Local",
    body: "Workloads running on Azure Local clusters, and the clusters themselves.",
  },
  sandbox: {
    title: "Sandbox",
    body: "Experimentation, isolated from production, with lighter guardrails.",
  },
};
