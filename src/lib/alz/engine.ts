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
import {
  ALZ_ROLES,
  PERSONAS,
  POLICY_OPTIONS,
  type PolicyAdd,
  RESTRICT_PRIVILEGED_CONDITION,
  type RbacAssignment,
} from "./governance";
import { WORKLOADS } from "./workloads";

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

/** Landing zone management groups a design can include. Decommissioned is always kept. */
export const OPTIONAL_GROUPS = ["corp", "online", "local", "sandbox"] as const;
export type OptionalGroup = (typeof OPTIONAL_GROUPS)[number];

export type YesNo = "yes" | "no";

export const REMOVABLE_GROUPS = [
  "management",
  "connectivity",
  "identity",
  "security",
  "decommissioned",
] as const;
export type RemovableGroup = (typeof REMOVABLE_GROUPS)[number];
/** ALZ policy sets a new group can be built on; "inherit" adds nothing beyond what its parents assign. */
export type CustomArchetype = "corp" | "online" | "local" | "sandbox" | "inherit";
export type CustomGroup = { id: string; name: string; parent: string; archetype: CustomArchetype };
export type ExtraSubscription = { id: string; name: string; group: string; environment: string };

export type Answers = {
  intermediateRootId: string;
  intermediateRootName: string;
  primaryRegion: string;
  connectivity: "hub_and_spoke" | "virtual_wan" | "none";
  firewall: "Premium" | "Standard" | "Basic" | "none";
  bastion: YesNo;
  vpnGateway: YesNo;
  expressRoute: YesNo;
  ddosPlan: YesNo;
  privateDns: "platform" | "none";
  monitoring: "azure_monitor" | "third_party";
  logRetentionDays: number;
  siem: "sentinel" | "other";
  identity: YesNo;
  securitySubscription: YesNo;
  /** Who gets which role where (Azure RBAC at management groups). */
  rbac: RbacAssignment[];
  /** Built-in policies and compliance initiatives added on top of the ALZ defaults. */
  policyAdds: PolicyAdd[];
  /** Tag name required on resource groups when that policy is added. */
  customerTag: string;
  /** Management groups the customer added: an ALZ policy set to build on, or inherit only. */
  customGroups: CustomGroup[];
  /** Platform or other groups the customer removed (their subscriptions move up to the parent). */
  removedGroups: RemovableGroup[];
  /** Display names the customer chose for any group. */
  groupNames: Record<string, string>;
  /** One subscription per environment for each customer install (CAF: environments are subscriptions). */
  environments: string[];
  /** Subscriptions the platform team adds by hand (shared services, tooling), per management group. */
  extraSubscriptions: ExtraSubscription[];
  /** Where new subscriptions land by default (Microsoft recommends Sandbox), or "" to leave Azure's default. */
  defaultGroup: string;
  /** Workload landing zone accelerators used in a landing zone group. */
  workloads: { group: string; id: string }[];
  /** Second hub region ("" for none). Hubs peer to each other automatically. */
  secondaryRegion: string;
  defender: YesNo;
  updateManager: YesNo;
  serviceHealth: YesNo;
  vmBackup: YesNo;
  landingZones: OptionalGroup[];
  /** Per-assignment decisions, keyed `<library management group id>/<assignment name>`. */
  policyOverrides: Record<string, "audit" | "remove">;
  securityContactEmail: string;
};

export const DEFAULT_ANSWERS: Answers = {
  intermediateRootId: "alz",
  intermediateRootName: "Azure Landing Zones",
  primaryRegion: "eastus2",
  connectivity: "hub_and_spoke",
  firewall: "Standard",
  bastion: "yes",
  vpnGateway: "no",
  expressRoute: "no",
  ddosPlan: "no",
  privateDns: "platform",
  monitoring: "azure_monitor",
  logRetentionDays: 30,
  siem: "sentinel",
  identity: "no",
  securitySubscription: "yes",
  rbac: [],
  policyAdds: [],
  customerTag: "customer",
  customGroups: [],
  removedGroups: [],
  groupNames: {},
  environments: ["dev", "test", "prod"],
  extraSubscriptions: [],
  defaultGroup: "sandbox",
  workloads: [],
  secondaryRegion: "",
  defender: "yes",
  updateManager: "yes",
  serviceHealth: "yes",
  vmBackup: "yes",
  landingZones: ["corp", "online", "local", "sandbox"],
  policyOverrides: {},
  securityContactEmail: "",
};

/** Saved answers from older versions lack newer keys; fill them from the defaults. */
export const withDefaults = (a: unknown): Answers => ({
  ...DEFAULT_ANSWERS,
  ...((a ?? {}) as Partial<Answers>),
});

export const hasHub = (a: Answers) => a.connectivity !== "none";
export const hasFirewall = (a: Answers) => hasHub(a) && a.firewall !== "none";
export const on = (v: YesNo) => v === "yes";

/* ------------------------------------------------------------ customization */

export type Change = {
  managementGroup: string;
  archetype: string;
  assignment: string;
  action: "remove" | "audit";
  reason: string;
  /** "design" when implied by a design choice, "override" when chosen on the policy itself. */
  origin: "design" | "override";
};

const AMA_ASSIGNMENTS = [
  "Deploy-VM-Monitoring",
  "Deploy-VMSS-Monitoring",
  "Deploy-VM-ChangeTrack",
  "Deploy-VMSS-ChangeTrack",
  "Deploy-MDFC-DefSQL-AMA",
];

/** Management groups in the design: the library's, minus landing zone groups that were switched off. */
export function includedGroups(library: AlzLibrary, answers: Answers) {
  const off = new Set<string>([
    ...OPTIONAL_GROUPS.filter((g) => !answers.landingZones.includes(g)),
    ...answers.removedGroups,
  ]);
  const base = library.managementGroups.filter((m) => !off.has(m.id));
  const known = new Set(base.map((m) => m.id));
  const custom: AlzLibrary["managementGroups"] = [];
  // Add in dependency order, dropping groups whose parent no longer exists.
  let pending = answers.customGroups.filter((c) => !known.has(c.id));
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next: CustomGroup[] = [];
    for (const c of pending) {
      if (known.has(c.parent)) {
        custom.push({
          id: c.id,
          displayName: c.name,
          parentId: c.parent,
          archetypes: [c.archetype],
        });
        known.add(c.id);
      } else next.push(c);
    }
    pending = next;
  }
  return [...base, ...custom];
}

/** Where a platform subscription is placed: its own group, or the Platform group if that was removed. */
export const placementGroup = (answers: Answers, group: string) =>
  (answers.removedGroups as string[]).includes(group) ? "platform" : group;

export const isCustomGroup = (answers: Answers, id: string) =>
  answers.customGroups.some((c) => c.id === id);

/** The documented customizations implied by the answers, resolved against the pinned library. */
export function changesFor(library: AlzLibrary, answers: Answers): Change[] {
  const out: Change[] = [];
  const groups = includedGroups(library, answers);
  const removeWherever = (assignment: string, reason: string) => {
    for (const mg of groups)
      for (const archetype of mg.archetypes)
        if (library.archetypes[archetype]?.policyAssignments.includes(assignment))
          out.push({
            managementGroup: mg.id,
            archetype,
            assignment,
            action: "remove",
            reason,
            origin: "design",
          });
  };
  if (answers.ddosPlan === "no" || !hasHub(answers))
    removeWherever(
      "Enable-DDoS-VNET",
      "No DDoS Network Protection plan. Microsoft advises removing this assignment, otherwise virtual network deployments can fail.",
    );
  if (answers.privateDns === "none" || !hasHub(answers))
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
  if (answers.defender === "no")
    for (const a of [
      "Deploy-MDFC-Config-H224",
      "Deploy-MDEndpoints",
      "Deploy-MDEndpointsAMA",
      "Deploy-MDFC-OssDb",
      "Deploy-MDFC-SqlAtp",
      "Deploy-MDFC-DefSQL-AMA",
    ])
      removeWherever(
        a,
        "Microsoft Defender for Cloud plans aren't used (another security tool covers this), so the assignments that enable them are removed.",
      );
  if (answers.updateManager === "no")
    removeWherever(
      "Enable-AUM-CheckUpdates",
      "Patching is handled outside Azure Update Manager, so periodic update assessment is not configured by policy.",
    );
  if (answers.serviceHealth === "no")
    removeWherever(
      "Deploy-SvcHealth-BuiltIn",
      "Service Health alerts are handled elsewhere, so the built-in alert rules and action groups are not deployed.",
    );
  if (answers.vmBackup === "no")
    removeWherever(
      "Deploy-VM-Backup",
      "VM backup is handled outside Azure Backup, so VMs are not enrolled in a Recovery Services vault by policy.",
    );
  for (const [key, action] of Object.entries(answers.policyOverrides)) {
    const [mgId, assignment] = key.split("/");
    const mg = groups.find((m) => m.id === mgId);
    if (!mg || !assignment) continue;
    const archetype = mg.archetypes.find((a) =>
      library.archetypes[a]?.policyAssignments.includes(assignment),
    );
    if (!archetype || out.some((c) => c.managementGroup === mgId && c.assignment === assignment))
      continue;
    out.push({
      managementGroup: mg.id,
      archetype,
      assignment,
      action,
      reason:
        action === "remove"
          ? "Removed by your platform team in the designer."
          : "Set to audit only (enforcement mode DoNotEnforce): compliance is reported, nothing is denied or remediated.",
      origin: "override",
    });
  }
  return out;
}

/* ---------------------------------------------------------------- hierarchy */

export type MgNode = {
  id: string;
  libraryId: string;
  displayName: string;
  parentId: string | null;
  archetype: string;
  depth: number;
  here: { name: string; assignment: Assignment | undefined; change: Change | undefined }[];
  inherited: number;
  /** Assignments that exist here after removals (audit-only ones still count — they are assigned). */
  enforced: number;
  auditOnly: number;
};

const MG_ORDER = [
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

export const mgIdFor = (answers: Answers, libraryId: string) => {
  const rootId = answers.intermediateRootId || "alz";
  return libraryId === "alz" ? rootId : `${rootId === "alz" ? "" : `${rootId}-`}${libraryId}`;
};

/** Management group tree with the controls assigned at each level and how many are inherited. */
export function hierarchy(library: AlzLibrary, answers: Answers): MgNode[] {
  const changes = changesFor(library, answers);
  const groups = includedGroups(library, answers);
  const byId = new Map(groups.map((m) => [m.id, m]));
  const depthOf = (id: string): number => {
    const p = byId.get(id)?.parentId;
    return p ? depthOf(p) + 1 : 0;
  };
  const nodes: MgNode[] = groups.map((m) => {
    const archetype = m.archetypes[0] ?? "";
    const here = (library.archetypes[archetype]?.policyAssignments ?? []).map((name) => ({
      name,
      assignment: library.assignments[name],
      change: changes.find((c) => c.managementGroup === m.id && c.assignment === name),
    }));
    return {
      id: mgIdFor(answers, m.id),
      libraryId: m.id,
      displayName:
        m.id === "alz"
          ? answers.intermediateRootName || m.displayName
          : answers.groupNames[m.id] || m.displayName,
      parentId: m.parentId ? mgIdFor(answers, m.parentId) : null,
      archetype,
      depth: depthOf(m.id),
      here,
      inherited: 0,
      enforced: here.filter((h) => h.change?.action !== "remove").length,
      auditOnly: here.filter((h) => h.change?.action === "audit").length,
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
  // Depth-first from the root, library groups in Microsoft's order, added groups after their siblings.
  const rank = (n: MgNode) =>
    MG_ORDER.includes(n.libraryId) ? MG_ORDER.indexOf(n.libraryId) : 100;
  const out: MgNode[] = [];
  const visit = (n: MgNode) => {
    out.push(n);
    nodes
      .filter((k) => k.parentId === n.id)
      .sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName))
      .forEach(visit);
  };
  nodes.filter((n) => !n.parentId).forEach(visit);
  return out;
}

/** Every assignment that applies at a management group, nearest first, with the group it comes from. */
export function effectivePolicies(tree: MgNode[], libraryId: string) {
  const out: { from: MgNode; item: MgNode["here"][number] }[] = [];
  let n = tree.find((t) => t.libraryId === libraryId);
  while (n) {
    for (const item of n.here) out.push({ from: n, item });
    n = tree.find((t) => t.id === n?.parentId);
  }
  return out;
}

/** Library default values still needed after customization, and where each value comes from. */
export function requiredDefaults(library: AlzLibrary, answers: Answers) {
  const present = new Set(
    hierarchy(library, answers).flatMap((n) =>
      n.here.filter((h) => h.change?.action !== "remove").map((h) => h.name),
    ),
  );
  return library.defaults
    .map((d) => ({ ...d, assignments: d.assignments.filter((a) => present.has(a.assignment)) }))
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

export type PlatformResource = {
  id: string;
  name: string;
  detail: string;
  subscription: "management" | "connectivity" | "identity" | "security";
  /** Where it is defined in the generated Terraform. */
  terraform: string;
};

/** Every platform resource the design builds, per subscription — the same list the Terraform creates. */
export function platformResources(answers: Answers): PlatformResource[] {
  const r: PlatformResource[] = [];
  const hub = answers.connectivity === "hub_and_spoke";
  const wan = answers.connectivity === "virtual_wan";
  const conn = (id: string, name: string, detail: string, terraform: string) =>
    r.push({ id, name, detail, subscription: "connectivity", terraform });
  const ccfg = hub ? "hub_virtual_networks.primary" : "virtual_hubs.primary";
  r.push({
    id: "law",
    name: "Log Analytics workspace",
    detail: `Central logs, ${answers.logRetentionDays}-day retention`,
    subscription: "management",
    terraform: "module.management",
  });
  if (answers.monitoring === "azure_monitor") {
    r.push({
      id: "dcr",
      name: "Data collection rules",
      detail: "VM insights, change tracking, Defender for SQL",
      subscription: "management",
      terraform: "module.management.data_collection_rules",
    });
    r.push({
      id: "ama",
      name: "AMA managed identity",
      detail: "Used by policy to install the Azure Monitor Agent",
      subscription: "management",
      terraform: "module.management.user_assigned_managed_identities",
    });
  }
  if (answers.siem === "sentinel")
    r.push({
      id: "sentinel",
      name: "Microsoft Sentinel",
      detail: "Onboarded to the central workspace",
      subscription: "management",
      terraform: "module.management.sentinel_onboarding",
    });
  const second =
    hasHub(answers) &&
    !!answers.secondaryRegion &&
    answers.secondaryRegion !== answers.primaryRegion;
  if (hub) conn("hubvnet", "Hub virtual network", `${answers.primaryRegion} · 10.0.0.0/16`, ccfg);
  if (hub && second)
    conn(
      "hubvnet2",
      "Hub virtual network (second region)",
      `${answers.secondaryRegion} · 10.1.0.0/16, peered to the primary hub`,
      "hub_virtual_networks.secondary",
    );
  if (wan) {
    conn("vwan", "Virtual WAN", "Standard", "virtual_wan_settings.virtual_wan");
    conn("vhub", "Virtual hub", `${answers.primaryRegion} · Microsoft-managed routing`, ccfg);
    if (second)
      conn(
        "vhub2",
        "Virtual hub (second region)",
        `${answers.secondaryRegion} · hubs mesh automatically`,
        "virtual_hubs.secondary",
      );
  }
  if (hasFirewall(answers))
    conn(
      "firewall",
      `Azure Firewall ${answers.firewall}`,
      wan ? "Secured virtual hub, routing intent" : "Inspects spoke egress and east-west traffic",
      `${ccfg}.firewall`,
    );
  if (hasHub(answers) && on(answers.vpnGateway))
    conn(
      "vpngw",
      "VPN gateway",
      "Site-to-site to offices and data centers",
      `${ccfg}.enabled_resources.virtual_network_gateway_vpn`,
    );
  if (hasHub(answers) && on(answers.expressRoute))
    conn(
      "ergw",
      "ExpressRoute gateway",
      "Private circuit to on-premises",
      `${ccfg}.enabled_resources.virtual_network_gateway_express_route`,
    );
  if (hasHub(answers) && on(answers.bastion))
    conn(
      "bastion",
      "Azure Bastion",
      wan ? "In the hub's sidecar network" : "Browser-based RDP and SSH, no public IPs on VMs",
      `${ccfg}.bastion`,
    );
  if (hasHub(answers) && answers.privateDns === "platform") {
    conn(
      "dnszones",
      "Private DNS zones",
      "privatelink.* zones for private endpoints",
      `${ccfg}.private_dns_zones`,
    );
    conn(
      "dnsresolver",
      "DNS Private Resolver",
      "Lets on-premises resolve private endpoints",
      `${ccfg}.private_dns_resolver`,
    );
  }
  if (hasHub(answers) && on(answers.ddosPlan))
    conn(
      "ddos",
      "DDoS Network Protection",
      "Plan every virtual network is enrolled in by policy",
      wan ? "azurerm_network_ddos_protection_plan.this" : "hub_and_spoke_networks_settings",
    );
  return r;
}

export function platformSubscriptions(answers: Answers) {
  const res = platformResources(answers);
  const list = (s: PlatformResource["subscription"]) =>
    res
      .filter((x) => x.subscription === s)
      .map((x) => x.name)
      .join(", ");
  return [
    {
      managementGroup: "management",
      name: "Management",
      purpose: list("management"),
      created: true,
    },
    {
      managementGroup: "connectivity",
      name: "Connectivity",
      purpose: hasHub(answers) ? list("connectivity") : "Not needed — no central network",
      created: hasHub(answers),
    },
    {
      managementGroup: "identity",
      name: "Identity",
      purpose: on(answers.identity)
        ? "Domain controllers or Entra Domain Services, peered to the hub"
        : "Not needed — workloads use Microsoft Entra ID only",
      created: on(answers.identity),
    },
    {
      managementGroup: "security",
      name: "Security",
      purpose: "Security team tooling",
      created: on(answers.securitySubscription),
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
  const groups = includedGroups(library, answers);
  // One archetype override per management group that has removals. Library groups keep "<archetype>_custom";
  // added groups sharing an archetype get their own, so a change in one group never leaks into another.
  const canonical = new Set(library.managementGroups.map((m) => m.id));
  const overrideFor = (mgId: string, archetype: string) =>
    canonical.has(mgId)
      ? `${archetype}_custom`
      : `${archetype}_${mgId.replace(/[^a-z0-9]+/gi, "_")}`;
  const byArchetype = new Map<string, { base: string; removed: string[] }>();
  for (const c of changes.filter((x) => x.action === "remove")) {
    const name = overrideFor(c.managementGroup, c.archetype);
    const cur = byArchetype.get(name) ?? { base: c.archetype, removed: [] };
    byArchetype.set(name, {
      base: c.archetype,
      removed: [...new Set([...cur.removed, c.assignment])],
    });
  }
  const usesInherit = groups.some((g) => g.archetypes.includes("inherit"));
  const audits = changes.filter((c) => c.action === "audit");
  const custom =
    byArchetype.size > 0 ||
    answers.intermediateRootId !== "alz" ||
    groups.length !== library.managementGroups.length ||
    groups.some((g) => !canonical.has(g.id)) ||
    Object.keys(answers.groupNames).length > 0;
  const overrideName = (mgId: string, a: string) =>
    byArchetype.has(overrideFor(mgId, a)) ? overrideFor(mgId, a) : a;
  const mg = (id: string) => mgIdFor(answers, id);
  const defaults = requiredDefaults(library, answers);
  const region = answers.primaryRegion;
  const hub = answers.connectivity === "hub_and_spoke";
  const wan = answers.connectivity === "virtual_wan";
  const fw = hasFirewall(answers);
  const ddos = hasHub(answers) && on(answers.ddosPlan);
  const dns = hasHub(answers) && answers.privateDns === "platform";
  const ama = answers.monitoring === "azure_monitor";
  const b = (v: boolean) => String(v);

  const second = hasHub(answers) && !!answers.secondaryRegion && answers.secondaryRegion !== region;
  const enabledResources = (extra: string[], zones = dns) => [
    `      enabled_resources = {`,
    `        firewall                              = ${b(fw)}`,
    `        firewall_policy                       = ${b(fw)}`,
    `        bastion                               = ${b(on(answers.bastion))}`,
    `        virtual_network_gateway_express_route = ${b(on(answers.expressRoute))}`,
    `        virtual_network_gateway_vpn           = ${b(on(answers.vpnGateway))}`,
    `        private_dns_zones                     = ${b(zones)}`,
    `        private_dns_resolver                  = ${b(dns)}`,
    ...extra,
    `      }`,
  ];
  const firewallSku = fw
    ? [
        `      firewall = {`,
        `        sku_tier = ${q(answers.firewall)}`,
        `      }`,
        `      firewall_policy = {`,
        `        sku = ${q(answers.firewall)}`,
        `      }`,
      ]
    : [];

  // A secured virtual hub only inspects traffic when routing intent sends it to the firewall.
  const routingIntent = (hubKey: string) =>
    fw
      ? [
          `      routing_intents = {`,
          `        default = {`,
          `          name = "routing-intent"`,
          `          routing_policies = [`,
          `            { name = "internet", destinations = ["Internet"], next_hop_firewall_key = ${q(hubKey)} },`,
          `            { name = "private", destinations = ["PrivateTraffic"], next_hop_firewall_key = ${q(hubKey)} },`,
          `          ]`,
          `        }`,
          `      }`,
        ]
      : [];
  const defaultValue = (name: string) => {
    switch (name) {
      case "log_analytics_workspace_id":
        return "module.management.resource_id";
      case "ama_user_assigned_managed_identity_id":
        return "module.management.user_assigned_identity_ids.ama.id";
      case "ama_user_assigned_managed_identity_name":
        return q("uami-ama");
      case "ama_vm_insights_data_collection_rule_id":
        return "module.management.data_collection_rule_ids.vm_insights.id";
      case "ama_change_tracking_data_collection_rule_id":
        return "module.management.data_collection_rule_ids.change_tracking.id";
      case "ama_mdfc_sql_data_collection_rule_id":
        return "module.management.data_collection_rule_ids.defender_sql.id";
      case "ddos_protection_plan_id":
        return wan
          ? "azurerm_network_ddos_protection_plan.this.id"
          : "module.connectivity.ddos_protection_plan_resource_id";
      case "private_dns_zone_subscription_id":
        return "var.connectivity_subscription_id";
      case "private_dns_zone_resource_group_name":
        return "azurerm_resource_group.connectivity.name";
      case "private_dns_zone_region":
      case "resource_group_location":
        return q(region);
      case "email_security_contact":
        return q(answers.securityContactEmail || "security@example.com");
      case "resource_group_name_service_health_alerts":
        return q(`rg-service-health-alerts-${region}`);
      case "resource_group_name_mdfc":
        return q(`rg-mdfc-${region}`);
      default:
        return q(name.replace(/_/g, "-"));
    }
  };

  const placements: [string, string, string][] = [
    ["management", "var.management_subscription_id", "management"],
    ...(hasHub(answers)
      ? ([["connectivity", "var.connectivity_subscription_id", "connectivity"]] as [
          string,
          string,
          string,
        ][])
      : []),
    ...(on(answers.identity)
      ? ([["identity", "var.identity_subscription_id", "identity"]] as [string, string, string][])
      : []),
    ...(on(answers.securitySubscription)
      ? ([["security", "var.security_subscription_id", "security"]] as [string, string, string][])
      : []),
  ];

  const connectivity = hub
    ? [
        `module "connectivity" {`,
        `  source  = "Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm"`,
        `  version = "0.17.5"`,
        `  providers = {`,
        `    azurerm = azurerm.connectivity`,
        `    azapi   = azapi.connectivity`,
        `  }`,
        ``,
        `  hub_and_spoke_networks_settings = {`,
        `    enabled_resources = {`,
        `      ddos_protection_plan = ${b(ddos)}`,
        `    }`,
        ...(ddos
          ? [
              `    ddos_protection_plan = {`,
              `      resource_group_name = azurerm_resource_group.connectivity.name`,
              `      location            = ${q(region)}`,
              `    }`,
            ]
          : []),
        `  }`,
        ``,
        `  hub_virtual_networks = {`,
        `    primary = {`,
        `      location                  = ${q(region)}`,
        `      default_parent_id         = azurerm_resource_group.connectivity.id`,
        `      default_hub_address_space = "10.0.0.0/16"`,
        ...enabledResources([`        dns_resolver_policy                   = ${b(dns)}`]),
        ...firewallSku,
        `    }`,
        ...(second
          ? [
              `    secondary = {`,
              `      location                  = ${q(answers.secondaryRegion)}`,
              `      default_parent_id         = azurerm_resource_group.connectivity.id`,
              `      default_hub_address_space = "10.1.0.0/16"`,
              `      # Private DNS zones are global and live with the primary hub.`,
              ...enabledResources(
                [`        dns_resolver_policy                   = ${b(dns)}`],
                false,
              ),
              ...firewallSku,
              `    }`,
            ]
          : []),
        `  }`,
        `}`,
        ``,
      ]
    : wan
      ? [
          ...(ddos
            ? [
                `resource "azurerm_network_ddos_protection_plan" "this" {`,
                `  provider            = azurerm.connectivity`,
                `  name                = "ddos-connectivity-${region}"`,
                `  location            = ${q(region)}`,
                `  resource_group_name = azurerm_resource_group.connectivity.name`,
                `}`,
                ``,
              ]
            : []),
          `module "connectivity" {`,
          `  source  = "Azure/avm-ptn-alz-connectivity-virtual-wan/azurerm"`,
          `  version = "0.17.2"`,
          `  providers = {`,
          `    azurerm = azurerm.connectivity`,
          `    azapi   = azapi.connectivity`,
          `  }`,
          ``,
          `  virtual_wan_settings = {`,
          `    enabled_resources = {`,
          `      ddos_protection_plan = false`,
          `    }`,
          `    virtual_wan = {`,
          `      name                = "vwan-connectivity-${region}"`,
          `      resource_group_name = azurerm_resource_group.connectivity.name`,
          `      location            = ${q(region)}`,
          `    }`,
          `  }`,
          ``,
          `  virtual_hubs = {`,
          `    primary = {`,
          `      location                  = ${q(region)}`,
          `      default_parent_id         = azurerm_resource_group.connectivity.id`,
          `      default_hub_address_space = "10.0.0.0/16"`,
          ...enabledResources([
            `        sidecar_virtual_network               = ${b(on(answers.bastion) || dns)}`,
          ]),
          ...firewallSku,
          ...routingIntent("primary"),
          `    }`,
          ...(second
            ? [
                `    secondary = {`,
                `      location                  = ${q(answers.secondaryRegion)}`,
                `      default_parent_id         = azurerm_resource_group.connectivity.id`,
                `      default_hub_address_space = "10.1.0.0/16"`,
                `      # Private DNS zones are global and live with the primary hub.`,
                ...enabledResources(
                  [
                    `        sidecar_virtual_network               = ${b(on(answers.bastion) || dns)}`,
                  ],
                  false,
                ),
                ...firewallSku,
                ...routingIntent("secondary"),
                `    }`,
              ]
            : []),
          `  }`,
          `}`,
          ``,
        ]
      : [];

  const included = new Set(groups.map((g) => g.id));
  const rbac = answers.rbac
    .filter((r) => included.has(r.scope) && PERSONAS.some((p) => p.id === r.persona))
    .map((r) => ({
      ...r,
      key: `${r.persona}_${r.role.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${r.scope}`,
      roleName: r.role in ALZ_ROLES ? `${r.role} (${answers.intermediateRootId || "alz"})` : r.role,
      condition: r.role === "Owner" && PERSONAS.find((p) => p.id === r.persona)?.condition,
    }));
  const locations = [...new Set([region, ...(second ? [answers.secondaryRegion] : [])])];
  const adds = answers.policyAdds
    .map((a) => ({ ...a, option: POLICY_OPTIONS.find((o) => o.id === a.id)! }))
    .filter((a) => a.option && included.has(a.scope))
    .map((a) => ({ ...a, key: `${a.id.replace(/-/g, "_")}_${a.scope}` }));

  const main = [
    `# Platform landing zone for ${answers.intermediateRootName}, generated by Cloud Delivery.`,
    `# Uses Microsoft's Azure Verified Modules for Azure Landing Zones and the ALZ Library, pinned to ${shortRef(ref)}.`,
    ``,
    `data "azapi_client_config" "current" {}`,
    ``,
    `module "management" {`,
    `  source  = "Azure/avm-ptn-alz-management/azurerm"`,
    `  version = "0.9.0"`,
    `  providers = {`,
    `    azurerm = azurerm.management`,
    `    azapi   = azapi.management`,
    `  }`,
    ``,
    `  location                                  = ${q(region)}`,
    `  resource_group_name                       = "rg-management-${region}"`,
    `  log_analytics_workspace_name              = "law-management-${region}"`,
    `  log_analytics_workspace_retention_in_days = ${answers.logRetentionDays}`,
    `  automation_account_name                   = "aa-management-${region}"`,
    ...(answers.siem === "sentinel" ? [`  sentinel_onboarding                       = {}`] : []),
    ...(ama
      ? []
      : [
          ``,
          `  # A third-party monitoring tool is used, so the Azure Monitor Agent resources are not created.`,
          `  data_collection_rules = {`,
          `    change_tracking = { enabled = false, name = "dcr-change-tracking" }`,
          `    vm_insights     = { enabled = false, name = "dcr-vm-insights" }`,
          `    defender_sql    = { enabled = false, name = "dcr-defender-sql" }`,
          `  }`,
          `  user_assigned_managed_identities = {`,
          `    ama = { enabled = false, name = "uami-ama" }`,
          `  }`,
        ]),
    `}`,
    ``,
    ...(hasHub(answers)
      ? [
          `resource "azurerm_resource_group" "connectivity" {`,
          `  provider = azurerm.connectivity`,
          `  name     = "rg-connectivity-${region}"`,
          `  location = ${q(region)}`,
          `}`,
          ``,
        ]
      : [
          `# No central network was selected, so nothing is deployed in a Connectivity subscription.`,
          ``,
        ]),
    ...connectivity,
    `module "alz" {`,
    `  source  = "Azure/avm-ptn-alz/azurerm"`,
    `  version = "0.21.0"`,
    ``,
    `  architecture_name  = ${q(custom ? "custom" : "alz")}`,
    `  parent_resource_id = data.azapi_client_config.current.tenant_id`,
    `  location           = ${q(region)}`,
    ``,
    `  # Library default values, wired to the resources above.`,
    `  policy_default_values = {`,
    ...defaults.map((d) => `    ${d.name} = jsonencode({ value = ${defaultValue(d.name)} })`),
    `  }`,
    ...(audits.length
      ? [
          ``,
          `  # Assigned, but set to audit only: compliance is reported, nothing is denied or remediated.`,
          `  policy_assignments_to_modify = {`,
          ...[...new Set(audits.map((a) => a.managementGroup))].flatMap((g) => [
            `    ${q(mg(g))} = {`,
            `      policy_assignments = {`,
            ...audits
              .filter((a) => a.managementGroup === g)
              .map((a) => `        ${q(a.assignment)} = { enforcement_mode = "DoNotEnforce" }`),
            `      }`,
            `    }`,
          ]),
          `  }`,
        ]
      : []),
    ``,
    `  # Platform subscriptions are moved into their management groups.`,
    `  subscription_placement = {`,
    ...placements.map(
      ([key, sub, group]) =>
        `    ${key} = { subscription_id = ${sub}, management_group_name = ${q(mg(placementGroup(answers, group)))} }`,
    ),
    `  }`,
    ...(answers.defaultGroup && included.has(answers.defaultGroup)
      ? [
          ``,
          `  # New subscriptions land here instead of the tenant root, and only authorized principals can create groups.`,
          `  management_group_hierarchy_settings = {`,
          `    default_management_group_name            = ${q(mg(answers.defaultGroup))}`,
          `    require_authorization_for_group_creation = true`,
          `  }`,
        ]
      : []),
    ...(rbac.length
      ? [
          ``,
          `  # Access: Microsoft Entra groups (or the delivery pipeline's identity) get roles at management groups.`,
          `  management_group_role_assignments = {`,
          ...rbac.flatMap((r) => [
            `    ${r.key} = {`,
            `      management_group_name      = ${q(mg(r.scope))}`,
            `      role_definition_id_or_name = ${q(r.roleName)}`,
            `      principal_id               = var.${r.persona}_principal_id`,
            ...(r.condition
              ? [
                  `      # Can never grant Owner, User Access Administrator or RBAC Administrator.`,
                  `      condition         = ${q(RESTRICT_PRIVILEGED_CONDITION)}`,
                  `      condition_version = "2.0"`,
                ]
              : []),
            `    }`,
          ]),
          `  }`,
        ]
      : []),
    ``,
    `  depends_on = [module.management${hasHub(answers) ? ", module.connectivity" : ""}]`,
    `}`,
    ...adds.flatMap((a) => [
      ``,
      `resource "azurerm_management_group_policy_assignment" ${q(a.key)} {`,
      `  name                 = ${q(a.option.assignmentName)}`,
      `  display_name         = ${q(a.option.name)}`,
      `  management_group_id  = "/providers/Microsoft.Management/managementGroups/${mg(a.scope)}"`,
      `  policy_definition_id = "/providers/Microsoft.Authorization/${a.option.kind === "initiative" ? "policySetDefinitions" : "policyDefinitions"}/${a.option.definition}"`,
      ...(a.option.parameters === "locations"
        ? [
            `  parameters = jsonencode({`,
            `    listOfAllowedLocations = { value = [${locations.map(q).join(", ")}] }`,
            `  })`,
          ]
        : a.option.parameters === "tag"
          ? [
              `  parameters = jsonencode({`,
              `    tagName = { value = ${q(answers.customerTag || "customer")} }`,
              `  })`,
            ]
          : []),
      ...(a.option.kind === "initiative"
        ? [``, `  location = ${q(region)}`, `  identity {`, `    type = "SystemAssigned"`, `  }`]
        : []),
      ``,
      `  depends_on = [module.alz]`,
      `}`,
    ]),
  ].join("\n");

  const subscriptionVars: [string, string][] = [
    ["management_subscription_id", "Management subscription: Log Analytics and monitoring."],
    ...(hasHub(answers)
      ? ([
          [
            "connectivity_subscription_id",
            "Connectivity subscription: the hub network and shared networking.",
          ],
        ] as [string, string][])
      : []),
    ...(on(answers.identity)
      ? ([["identity_subscription_id", "Identity subscription: domain controllers."]] as [
          string,
          string,
        ][])
      : []),
    ...(on(answers.securitySubscription)
      ? ([["security_subscription_id", "Security subscription: security team tooling."]] as [
          string,
          string,
        ][])
      : []),
  ];
  for (const persona of [...new Set(rbac.map((r) => r.persona))]) {
    const p = PERSONAS.find((x) => x.id === persona)!;
    subscriptionVars.push([
      `${persona}_principal_id`,
      `Object ID of the Microsoft Entra ${persona === "delivery" ? "workload identity" : "group"} for: ${p.label}.`,
    ]);
  }
  const variables = subscriptionVars
    .map(([name, description]) =>
      [
        `variable "${name}" {`,
        `  type        = string`,
        `  description = ${q(description)}`,
        `}`,
      ].join("\n"),
    )
    .join("\n\n");

  const providers = [
    `provider "alz" {`,
    `  library_references = [`,
    `    { path = "platform/alz", ref = ${q(shortRef(ref))} },`,
    ...(custom ? [`    { custom_url = "\${path.root}/lib" },`] : []),
    `  ]`,
    `}`,
    ``,
    `provider "azapi" {}`,
    ``,
    `provider "azurerm" {`,
    `  features {}`,
    `  subscription_id = var.management_subscription_id`,
    `}`,
    ...["management", ...(hasHub(answers) ? ["connectivity"] : [])].flatMap((s) => [
      ``,
      `provider "azurerm" {`,
      `  alias           = "${s}"`,
      `  subscription_id = var.${s}_subscription_id`,
      `  features {}`,
      `}`,
      ``,
      `provider "azapi" {`,
      `  alias           = "${s}"`,
      `  subscription_id = var.${s}_subscription_id`,
      `}`,
    ]),
  ].join("\n");

  const extraSubs = answers.extraSubscriptions.filter((x) => included.has(x.group));
  const subscriptionsTf = extraSubs
    .map((x) => {
      const alias = `${answers.intermediateRootId || "alz"}-${x.name}`
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-");
      return [
        `module "sub_${x.id.replace(/[^a-z0-9]+/gi, "_")}" {`,
        `  source  = "Azure/avm-ptn-alz-sub-vending/azure"`,
        `  version = "0.3.2"`,
        ``,
        `  location                   = ${q(region)}`,
        `  subscription_alias_enabled = true`,
        `  subscription_alias_name    = ${q(alias)}`,
        `  subscription_display_name  = ${q(x.name)}`,
        `  subscription_workload      = ${q(x.environment === "prod" ? "Production" : "DevTest")}`,
        `  subscription_billing_scope = var.billing_scope`,
        `  subscription_tags          = { environment = ${q(x.environment)} }`,
        ``,
        `  subscription_management_group_association_enabled = true`,
        `  subscription_management_group_id                  = ${q(mg(x.group))}`,
        ``,
        `  depends_on = [module.alz]`,
        `}`,
      ].join("\n");
    })
    .join("\n\n");
  const workloadRows = answers.workloads
    .filter((w) => included.has(w.group))
    .map((w) => ({ ...w, def: WORKLOADS.find((x) => x.id === w.id) }))
    .filter((w) => w.def);
  const workloadsTf = workloadRows.length
    ? [
        `# Workload landing zones. Each customer install's subscriptions in these groups are deployed from the`,
        `# workload accelerator below by the delivery pipeline, on top of the platform built in main.tf.`,
        ...workloadRows.flatMap((w) => [
          ``,
          `# ${w.def!.name} in ${mg(w.group)}`,
          `#   Accelerator: https://github.com/${w.def!.repo}`,
          ...(w.def!.module
            ? [`#   Terraform:   ${w.def!.module.source} ${w.def!.module.version}`]
            : []),
          `#   Needs from the platform: ${w.def!.platformNeeds}`,
        ]),
      ].join("\n")
    : "";
  const files = [
    { path: "main.tf", content: alignHcl(main) + "\n" },
    { path: "providers.tf", content: alignHcl(providers) + "\n" },
    {
      path: "variables.tf",
      content:
        variables +
        (extraSubs.length
          ? `\n\nvariable "billing_scope" {\n  type        = string\n  description = "Billing scope for new subscriptions: an EA enrollment account or MCA invoice section ID."\n}`
          : "") +
        "\n",
    },
    ...(extraSubs.length
      ? [{ path: "subscriptions.tf", content: alignHcl(subscriptionsTf) + "\n" }]
      : []),
    ...(workloadsTf ? [{ path: "workloads.tf", content: workloadsTf + "\n" }] : []),
  ];
  if (custom) {
    if (usesInherit)
      files.push({
        path: "lib/inherit.alz_archetype_definition.json",
        content: JSON.stringify(
          {
            $schema:
              "https://raw.githubusercontent.com/Azure/Azure-Landing-Zones-Library/main/schemas/archetype_definition.json",
            name: "inherit",
            policy_assignments: [],
            policy_definitions: [],
            policy_set_definitions: [],
            role_definitions: [],
          },
          null,
          2,
        ),
      });
    for (const [name, { base, removed }] of byArchetype)
      files.push({
        path: `lib/${name}.alz_archetype_override.json`,
        content: JSON.stringify(
          {
            $schema:
              "https://raw.githubusercontent.com/Azure/Azure-Landing-Zones-Library/main/schemas/archetype_override.json",
            name,
            base_archetype: base,
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
          management_groups: groups.map((m) => ({
            id: mg(m.id),
            display_name:
              m.id === "alz"
                ? answers.intermediateRootName
                : answers.groupNames[m.id] || m.displayName,
            parent_id: m.parentId ? mg(m.parentId) : null,
            archetypes: m.archetypes.map((a) => overrideName(m.id, a)),
            exists: false,
          })),
        },
        null,
        2,
      ),
    });
  }
  return files;
}

/** Subscription vending for one customer install, placed in the right landing zone management group. */
export function vendingFor(
  answers: Answers,
  install: { name: string; archetype: string; region: string },
) {
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
    `  subscription_management_group_id                  = ${q(mgIdFor(answers, install.archetype))}`,
    `}`,
  ].join("\n");
}

/* ------------------------------------------------------------ landing zones */

/** What each management group is for, from Microsoft's Cloud Adoption Framework. */
export const MG_PURPOSE: Record<string, string> = {
  alz: "Intermediate root under the tenant root group. Parent of everything below; only truly universal policy lives here.",
  platform:
    "Parent of the shared platform subscriptions. Common platform policy and platform-team access.",
  management: "Central monitoring and operations — the Log Analytics workspace and its solutions.",
  connectivity:
    "Networking the platform owns: hub or Virtual WAN, Azure Firewall, private DNS zones, gateways.",
  identity:
    "Identity infrastructure such as domain controllers or Entra Domain Services, when workloads need it.",
  security: "Security and SIEM tooling for the security team.",
  landingzones:
    "Parent of all workload subscriptions. Workload-agnostic guardrails every landing zone inherits.",
  corp: "Workloads that connect to the corporate network through the hub. Public endpoints are denied.",
  online: "Workloads that serve the internet directly or don't need a virtual network.",
  local: "Workloads on Azure Local clusters, and the clusters themselves. Different policy needs.",
  sandbox: "Isolated experimentation with a lighter set of policies. Not connected to the hub.",
  decommissioned: "Cancelled subscriptions waiting to be deleted after 30–60 days.",
};

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
