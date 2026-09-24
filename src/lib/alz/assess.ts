/*
 * Brownfield assessment: read what is in a tenant (management groups, subscriptions, policy and role
 * assignments, network and platform resources), map it onto the Azure landing zone standard and say what is
 * missing — per design area, per management group, and for the traffic paths that matter.
 */
import { type AlzLibrary, type Answers, DEFAULT_ANSWERS, type OptionalGroup } from "./engine";

export type TenantSnapshot = {
  source: "live" | "demo";
  scannedAt: string;
  tenantId: string;
  label?: string | undefined;
  managementGroups: { id: string; displayName: string; parentId: string | null }[];
  subscriptions: { id: string; name: string; parentId: string | null }[];
  policyAssignments: {
    name: string;
    displayName: string;
    scope: string;
    definitionId: string;
    enforcementMode: string;
  }[];
  roleAssignments: { roleName: string; principalType: string; scope: string }[];
  resources: {
    type: string;
    name: string;
    location: string;
    subscriptionId: string;
    sku?: string | undefined;
    kind?: string | undefined;
  }[];
  vnets: {
    id: string;
    name: string;
    subscriptionId: string;
    location: string;
    subnets: string[];
    peerings: string[];
    dnsServers: string[];
  }[];
  routeTables: {
    name: string;
    subscriptionId: string;
    defaultToAppliance: boolean;
    subnets: number;
  }[];
  publicIpsOnNics: number;
};

export type Severity = "high" | "medium" | "low";
export type Area =
  | "Resource organization"
  | "Policy"
  | "Network"
  | "Management"
  | "Security"
  | "Identity and access";

export type Gap = {
  area: Area;
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
  patch?: Partial<Answers>;
};

const ROLE_SYNONYMS: Record<string, string[]> = {
  platform: ["platform"],
  management: ["management", "mgmt", "operations"],
  connectivity: ["connectivity", "network", "networking", "hub"],
  identity: ["identity"],
  security: ["security", "secops"],
  landingzones: ["landingzones", "landingzone", "workloads", "applications"],
  corp: ["corp", "corporate", "internal", "private"],
  online: ["online", "public", "external", "internet"],
  local: ["local", "azurelocal", "hci", "edge"],
  sandbox: ["sandbox", "sandboxes", "experiment"],
  decommissioned: ["decommissioned", "decom", "retired"],
};
const LABEL: Record<string, string> = {
  alz: "Intermediate root",
  platform: "Platform",
  management: "Management",
  connectivity: "Connectivity",
  identity: "Identity",
  security: "Security",
  landingzones: "Landing zones",
  corp: "Corp",
  online: "Online",
  local: "Local",
  sandbox: "Sandbox",
  decommissioned: "Decommissioned",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const t = (s: string) => s.toLowerCase();
const has = (snap: TenantSnapshot, type: string) =>
  snap.resources.filter((r) => t(r.type) === type);

/** Map tenant management groups to ALZ roles by name, respecting the hierarchy where it helps. */
export function mapManagementGroups(snap: TenantSnapshot) {
  const root = snap.tenantId;
  const kids = (id: string) => snap.managementGroups.filter((m) => m.parentId === id);
  const top = kids(root).filter((m) => kids(m.id).length > 0);
  const intermediate =
    top.sort((a, b) => descendants(snap, b.id) - descendants(snap, a.id))[0] ?? null;
  const pool = intermediate
    ? snap.managementGroups.filter((m) => isUnder(snap, m.id, intermediate.id))
    : snap.managementGroups.filter((m) => m.id !== root);
  const map: Record<string, (typeof snap.managementGroups)[number] | null> = {
    alz: intermediate,
  };
  for (const [role, words] of Object.entries(ROLE_SYNONYMS)) {
    const hit = pool.find((m) =>
      words.some(
        (w) =>
          norm(m.id).endsWith(w) || norm(m.displayName) === w || norm(m.displayName).endsWith(w),
      ),
    );
    map[role] = hit ?? null;
  }
  return map;
}

function descendants(snap: TenantSnapshot, id: string): number {
  const k = snap.managementGroups.filter((m) => m.parentId === id);
  return k.length + k.reduce((a, m) => a + descendants(snap, m.id), 0);
}
function isUnder(snap: TenantSnapshot, id: string, ancestor: string): boolean {
  if (id === ancestor) return false;
  let cur = snap.managementGroups.find((m) => m.id === id);
  while (cur?.parentId) {
    if (cur.parentId === ancestor) return true;
    cur = snap.managementGroups.find((m) => m.id === cur!.parentId);
  }
  return false;
}

const mgScope = (id: string) => `/providers/microsoft.management/managementgroups/${t(id)}`;

/** Where the hub is, if any: the VNet with firewall/gateway subnets or the most peerings. */
function findHub(snap: TenantSnapshot) {
  const scored = snap.vnets
    .map((v) => ({
      v,
      score:
        (v.subnets.some((s) => ["azurefirewallsubnet", "gatewaysubnet"].includes(t(s))) ? 10 : 0) +
        v.peerings.length,
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && (best.score >= 10 || best.v.peerings.length >= 3) ? best.v : null;
}

/** The design the tenant effectively has today, in the designer's terms. */
export function inferDesign(snap: TenantSnapshot): Partial<Answers> {
  const map = mapManagementGroups(snap);
  const fw = has(snap, "microsoft.network/azurefirewalls")[0];
  const gws = has(snap, "microsoft.network/virtualnetworkgateways");
  const wan = has(snap, "microsoft.network/virtualhubs").length > 0;
  const hub = wan || !!findHub(snap);
  const tier = fw?.sku?.toLowerCase().includes("premium")
    ? "Premium"
    : fw?.sku?.toLowerCase().includes("basic")
      ? "Basic"
      : fw
        ? "Standard"
        : "none";
  return {
    intermediateRootId: map["alz"]
      ? t(map["alz"].id)
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 30) || "alz"
      : "alz",
    intermediateRootName: map["alz"]?.displayName ?? "Azure Landing Zones",
    primaryRegion: snap.vnets[0]?.location ?? snap.resources[0]?.location ?? "eastus2",
    connectivity: wan ? "virtual_wan" : hub ? "hub_and_spoke" : "none",
    firewall: tier as Answers["firewall"],
    bastion: has(snap, "microsoft.network/bastionhosts").length ? "yes" : "no",
    vpnGateway: gws.some((g) => t(g.kind ?? "") === "vpn") ? "yes" : "no",
    expressRoute: gws.some((g) => t(g.kind ?? "") === "expressroute") ? "yes" : "no",
    ddosPlan: has(snap, "microsoft.network/ddosprotectionplans").length ? "yes" : "no",
    privateDns: privatelinkZones(snap).length ? "platform" : "none",
    siem: sentinel(snap) ? "sentinel" : "other",
    identity: map["identity"] ? "yes" : "no",
    securitySubscription: map["security"] ? "yes" : "no",
    landingZones: (["corp", "online", "local", "sandbox"] as OptionalGroup[]).filter((g) => map[g]),
  };
}

const privatelinkZones = (snap: TenantSnapshot) =>
  has(snap, "microsoft.network/privatednszones").filter((z) =>
    t(z.name).startsWith("privatelink."),
  );
const sentinel = (snap: TenantSnapshot) =>
  snap.resources.some(
    (r) =>
      t(r.type) === "microsoft.operationsmanagement/solutions" &&
      t(r.name).startsWith("securityinsights"),
  ) || snap.resources.some((r) => t(r.type) === "microsoft.securityinsights/onboardingstates");

export type TrafficCheck = { id: string; title: string; ok: boolean; detail: string };

export function assess(snap: TenantSnapshot, lib: AlzLibrary) {
  const map = mapManagementGroups(snap);
  const gaps: Gap[] = [];
  const add = (g: Gap) => gaps.push(g);

  /* ---- resource organization */
  const underRoot = snap.subscriptions.filter((s) => !s.parentId || s.parentId === snap.tenantId);
  if (!map["alz"])
    add({
      area: "Resource organization",
      severity: "high",
      title: "No intermediate root management group",
      detail: `${snap.managementGroups.length <= 1 ? "The tenant has no management group hierarchy" : "No management group sits between the Tenant Root Group and the rest"}; policy and access can't be applied once for everything.`,
      fix: "Create the ALZ hierarchy under a single intermediate root and move subscriptions into it.",
    });
  const missingGroups = lib.managementGroups.filter((m) => m.id !== "alz" && !map[m.id]);
  if (missingGroups.length)
    add({
      area: "Resource organization",
      severity: missingGroups.some((m) =>
        ["platform", "landingzones", "connectivity", "management"].includes(m.id),
      )
        ? "high"
        : "medium",
      title: `${missingGroups.length} of ${lib.managementGroups.length - 1} ALZ management groups not found`,
      detail: `Missing: ${missingGroups.map((m) => LABEL[m.id] ?? m.id).join(", ")}.`,
      fix: "The designer builds the full hierarchy; untick groups you genuinely don't need.",
    });
  if (underRoot.length)
    add({
      area: "Resource organization",
      severity: "high",
      title: `${underRoot.length} subscription${underRoot.length === 1 ? "" : "s"} directly under the Tenant Root Group`,
      detail: underRoot.map((s) => s.name).join(", "),
      fix: "Move each into its ALZ management group (see suggested placement).",
    });

  /* ---- policy coverage per ALZ group */
  const coverage = lib.managementGroups.map((m) => {
    const archetype = m.archetypes[0] ?? "";
    const expected = lib.archetypes[archetype]?.policyAssignments ?? [];
    const found = map[m.id];
    const here = found
      ? snap.policyAssignments.filter((p) => t(p.scope) === mgScope(found.id))
      : [];
    const matched = expected.filter((name) => {
      const def = lib.assignments[name]?.definition ?? "";
      return here.some((p) => t(p.name) === t(name) || t(p.definitionId).endsWith(`/${t(def)}`));
    });
    return {
      group: m.id,
      label: LABEL[m.id] ?? m.id,
      tenantGroup: found?.displayName ?? null,
      expected: expected.length,
      matched: matched.length,
      missing: expected.filter((e) => !matched.includes(e)),
      extra: here.filter(
        (p) =>
          !expected.some(
            (e) =>
              t(e) === t(p.name) ||
              t(p.definitionId).endsWith(`/${t(lib.assignments[e]?.definition ?? "")}`),
          ),
      ).length,
    };
  });
  const expectedTotal = coverage.reduce((a, c) => a + c.expected, 0);
  const matchedTotal = coverage.reduce((a, c) => a + c.matched, 0);
  if (matchedTotal < expectedTotal)
    add({
      area: "Policy",
      severity: matchedTotal < expectedTotal / 2 ? "high" : "medium",
      title: `${expectedTotal - matchedTotal} of ${expectedTotal} ALZ policy assignments missing`,
      detail: coverage
        .filter((c) => c.missing.length)
        .map((c) => `${c.label}: ${c.missing.length}`)
        .join(" · "),
      fix: "Deploying the design assigns Microsoft's ALZ policy set at every level.",
    });
  const denyPublic = snap.policyAssignments.some(
    (p) =>
      t(p.name).includes("deny-public") || t(p.definitionId).includes("deny-publicpaasendpoints"),
  );
  if (!denyPublic)
    add({
      area: "Policy",
      severity: "medium",
      title: "Nothing stops public PaaS endpoints",
      detail:
        "Without the Corp guardrail, storage accounts, databases and key vaults can be created with public network access.",
      fix: "Corp landing zones get Deny-Public-Endpoints from ALZ.",
    });

  /* ---- network */
  const hub = findHub(snap);
  const wan = has(snap, "microsoft.network/virtualhubs").length > 0;
  const fw = has(snap, "microsoft.network/azurefirewalls");
  const gws = has(snap, "microsoft.network/virtualnetworkgateways");
  const zones = privatelinkZones(snap);
  const pes = has(snap, "microsoft.network/privateendpoints");
  const spokes = hub
    ? snap.vnets.filter((v) => v.id !== hub.id && v.peerings.some((p) => t(p) === t(hub.id)))
    : [];
  const isolated = snap.vnets.filter((v) => (!hub || v.id !== hub.id) && !spokes.includes(v));
  const routed = snap.routeTables.filter((r) => r.defaultToAppliance && r.subnets > 0);
  if (!hub && !wan)
    add({
      area: "Network",
      severity: snap.vnets.length > 1 ? "high" : "medium",
      title: "No hub network",
      detail: `${snap.vnets.length} virtual network${snap.vnets.length === 1 ? "" : "s"}, none acting as a hub. Each workload manages its own connectivity and egress.${(() => {
        const named = snap.vnets.filter((v) => /hub/i.test(v.name));
        return named.length
          ? ` (${named.map((v) => v.name).join(", ")} is named like a hub but has no peerings or gateway/firewall subnets.)`
          : "";
      })()}`,
      fix: "Add a hub (hub and spoke or Virtual WAN) in a Connectivity subscription.",
      patch: { connectivity: "hub_and_spoke" },
    });
  if (!fw.length)
    add({
      area: "Network",
      severity: "high",
      title: "No central firewall",
      detail: "Outbound and east-west traffic isn't inspected anywhere central.",
      fix: "Add Azure Firewall (Standard or Premium) to the hub.",
      patch: { firewall: "Standard" },
    });
  else if (!routed.length)
    add({
      area: "Network",
      severity: "high",
      title: "Firewall exists, but nothing routes through it",
      detail:
        "No route table sends 0.0.0.0/0 to a virtual appliance, so spokes bypass the firewall.",
      fix: "Associate the hub's user-subnet route table (0.0.0.0/0 → firewall) with every spoke subnet.",
    });
  if (isolated.length && (hub || wan))
    add({
      area: "Network",
      severity: "medium",
      title: `${isolated.length} virtual network${isolated.length === 1 ? "" : "s"} not connected to the hub`,
      detail: isolated.map((v) => v.name).join(", "),
      fix: "Peer them to the hub (Corp) or place them under Online if they're meant to be internet-facing.",
    });
  if (!has(snap, "microsoft.network/ddosprotectionplans").length)
    add({
      area: "Network",
      severity: "low",
      title: "No DDoS Network Protection plan",
      detail: "Public endpoints rely on the free infrastructure-level protection only.",
      fix: "Optional: add a DDoS Network Protection plan in Connectivity.",
      patch: { ddosPlan: "yes" },
    });
  if (pes.length && !zones.length)
    add({
      area: "Network",
      severity: "high",
      title: `${pes.length} private endpoint${pes.length === 1 ? "" : "s"} without central private DNS`,
      detail:
        "No privatelink.* zones found, so names won't resolve to the private endpoints consistently.",
      fix: "Turn on central private DNS zones and the DNS Private Resolver in the hub.",
      patch: { privateDns: "platform" },
    });
  else if (!zones.length)
    add({
      area: "Network",
      severity: "medium",
      title: "No central private DNS for private endpoints",
      detail: "Workloads can't adopt private endpoints without each managing its own DNS.",
      fix: "Turn on central private DNS zones and the DNS Private Resolver.",
      patch: { privateDns: "platform" },
    });
  if (!has(snap, "microsoft.network/bastionhosts").length && snap.publicIpsOnNics > 0)
    add({
      area: "Security",
      severity: "high",
      title: `${snap.publicIpsOnNics} VM network interface${snap.publicIpsOnNics === 1 ? "" : "s"} with public IPs, no Bastion`,
      detail: "Admin access is likely over the internet (RDP/SSH).",
      fix: "Add Azure Bastion; ALZ denies management ports from the internet and public IPs on NICs in Corp.",
      patch: { bastion: "yes" },
    });

  /* ---- management */
  const laws = has(snap, "microsoft.operationalinsights/workspaces");
  if (laws.length !== 1)
    add({
      area: "Management",
      severity: laws.length ? "medium" : "high",
      title: laws.length ? `${laws.length} Log Analytics workspaces` : "No Log Analytics workspace",
      detail: laws.length
        ? "Logs are split across workspaces, so there's no single place to query, alert and hunt."
        : "Nothing collects platform logs.",
      fix: "Use one central workspace in the Management subscription; ALZ policy sends activity and diagnostic logs to it.",
    });
  if (!sentinel(snap))
    add({
      area: "Security",
      severity: "medium",
      title: "Microsoft Sentinel not enabled",
      detail: "No SIEM on the central workspace.",
      fix: "Turn on Sentinel in the Management subscription.",
      patch: { siem: "sentinel" },
    });
  const defender = snap.policyAssignments.some(
    (p) => t(p.name).includes("mdfc") || t(p.displayName).includes("defender"),
  );
  if (!defender)
    add({
      area: "Security",
      severity: "medium",
      title: "Defender for Cloud isn't configured by policy",
      detail:
        "Plans and the security contact are set by hand (or not at all), so new subscriptions aren't covered.",
      fix: "ALZ's Deploy-MDFC-Config assigns it at the intermediate root.",
      patch: { defender: "yes" },
    });

  /* ---- identity and access */
  const owners = snap.roleAssignments.filter((r) => t(r.roleName) === "owner");
  const userOwners = owners.filter((r) => t(r.principalType) === "user");
  if (userOwners.length)
    add({
      area: "Identity and access",
      severity: userOwners.length > 2 ? "high" : "medium",
      title: `${userOwners.length} Owner assignment${userOwners.length === 1 ? "" : "s"} made directly to users`,
      detail: "Standing, per-user Owner access is hard to review and revoke.",
      fix: "Assign roles to Microsoft Entra groups and make Owner eligible through PIM (see the Access tab).",
    });
  const alzRoles = snap.roleAssignments.filter((r) =>
    ["network-management", "security-operations", "application-owners", "subscription-owner"].some(
      (n) => t(r.roleName).startsWith(n),
    ),
  );
  if (!alzRoles.length)
    add({
      area: "Identity and access",
      severity: "low",
      title: "No separation of duties roles",
      detail:
        "None of the ALZ roles (Network-Management, Security-Operations, Application-Owners, Subscription-Owner) are in use.",
      fix: "Use Microsoft's recommended roles per team (Access tab).",
    });

  /* ---- traffic today */
  const traffic: TrafficCheck[] = [
    {
      id: "egress",
      title: "Outbound traffic is inspected",
      ok: fw.length > 0 && routed.length > 0,
      detail: fw.length
        ? routed.length
          ? `${routed.length} route table${routed.length === 1 ? "" : "s"} send 0.0.0.0/0 to the firewall.`
          : "A firewall exists but no route table points to it."
        : "No firewall — VMs use Azure's default outbound access or their own NAT/public IPs.",
    },
    {
      id: "eastwest",
      title: "Workloads can only reach each other through a control point",
      ok: fw.length > 0 && spokes.length > 0 && routed.length > 0,
      detail: hub
        ? `${spokes.length} spoke${spokes.length === 1 ? "" : "s"} peered to ${hub.name}.`
        : snap.vnets.some((v) => v.peerings.length)
          ? "VNets are peered directly to each other — no central inspection."
          : "VNets are isolated from each other.",
    },
    {
      id: "hybrid",
      title: "On-premises connects through the platform",
      ok: gws.length > 0,
      detail: gws.length
        ? `${gws.map((g) => `${g.name} (${g.kind ?? "gateway"})`).join(", ")}.`
        : "No VPN or ExpressRoute gateway.",
    },
    {
      id: "private-endpoint",
      title: "Private endpoints resolve centrally",
      ok: zones.length > 0,
      detail: zones.length
        ? `${zones.length} privatelink zone${zones.length === 1 ? "" : "s"}; ${pes.length} private endpoint${pes.length === 1 ? "" : "s"}.`
        : pes.length
          ? `${pes.length} private endpoints but no privatelink zones.`
          : "No privatelink zones.",
    },
    {
      id: "bastion",
      title: "Admin access without public IPs",
      ok: has(snap, "microsoft.network/bastionhosts").length > 0 && snap.publicIpsOnNics === 0,
      detail: `${has(snap, "microsoft.network/bastionhosts").length ? "Bastion present" : "No Bastion"}; ${snap.publicIpsOnNics} NIC${snap.publicIpsOnNics === 1 ? "" : "s"} with public IPs.`,
    },
    {
      id: "telemetry",
      title: "Logs land in one place",
      ok: laws.length === 1,
      detail: `${laws.length} Log Analytics workspace${laws.length === 1 ? "" : "s"}${sentinel(snap) ? ", Sentinel on" : ""}.`,
    },
  ];

  /* ---- where each subscription should go */
  const placement = snap.subscriptions.map((s) => {
    const inSub = (type: string) =>
      snap.resources.filter((r) => r.subscriptionId === s.id && t(r.type) === type);
    const target =
      (hub && hub.subscriptionId === s.id) ||
      inSub("microsoft.network/azurefirewalls").length ||
      inSub("microsoft.network/virtualnetworkgateways").length
        ? "connectivity"
        : sentinel({
              ...snap,
              resources: snap.resources.filter((r) => r.subscriptionId === s.id),
            }) || inSub("microsoft.automation/automationaccounts").length
          ? inSub("microsoft.web/sites").length || inSub("microsoft.compute/virtualmachines").length
            ? "online"
            : "management"
          : /sandbox|dev|test|poc/i.test(s.name)
            ? "sandbox"
            : spokes.some((v) => v.subscriptionId === s.id)
              ? "corp"
              : "online";
    const mixed =
      target === "online" &&
      (inSub("microsoft.operationalinsights/workspaces").length > 0 ||
        inSub("microsoft.automation/automationaccounts").length > 0);
    const where = snap.managementGroups.find((m) => m.id === s.parentId);
    return {
      id: s.id,
      name: s.name,
      where: !where || where.id === snap.tenantId ? "Tenant Root Group" : where.displayName,
      target,
      note: mixed
        ? "Platform services (monitoring, automation) are mixed in with workloads — split them out into Management."
        : undefined,
    };
  });

  const areas: Area[] = [
    "Resource organization",
    "Policy",
    "Network",
    "Management",
    "Security",
    "Identity and access",
  ];
  const weight = { high: 30, medium: 15, low: 5 } as const;
  const scores = areas.map((a) => ({
    area: a,
    score: Math.max(
      0,
      100 - gaps.filter((g) => g.area === a).reduce((x, g) => x + weight[g.severity], 0),
    ),
  }));
  scores.find((s) => s.area === "Policy")!.score = Math.round(
    (matchedTotal / Math.max(1, expectedTotal)) * 100,
  );
  const overall = Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length);
  const order = { high: 0, medium: 1, low: 2 } as const;
  const found = (type: string) => has(snap, type).length > 0;
  const parts = new Set(
    (
      [
        ["firewall", found("microsoft.network/azurefirewalls")],
        ["vpngw", gws.some((g) => t(g.kind ?? "") === "vpn")],
        ["ergw", gws.some((g) => t(g.kind ?? "") === "expressroute")],
        ["bastion", found("microsoft.network/bastionhosts")],
        ["dnsresolver", found("microsoft.network/dnsresolvers")],
        ["dnszones", zones.length > 0],
        ["ddos", found("microsoft.network/ddosprotectionplans")],
        ["law", laws.length > 0],
        ["sentinel", sentinel(snap)],
        ["vwan", found("microsoft.network/virtualwans")],
      ] as [string, boolean][]
    )
      .filter(([, v]) => v)
      .map(([k]) => k),
  );
  const counts = Object.fromEntries(
    coverage.map((c) => [c.group, `${c.matched} of ${c.expected} ALZ`]),
  );
  return {
    asIs: { parts, counts },
    map,
    coverage,
    gaps: gaps.sort((a, b) => order[a.severity] - order[b.severity]),
    traffic,
    placement,
    scores,
    overall,
    inferred: inferDesign(snap),
    hub: hub?.name ?? null,
  };
}

export type Assessment = ReturnType<typeof assess>;

/** Start a design from what the tenant has, with Microsoft's standard filling everything else in. */
export const startingDesign = (a: Assessment, current: Answers): Answers => ({
  ...DEFAULT_ANSWERS,
  ...current,
  ...a.inferred,
  landingZones: DEFAULT_ANSWERS.landingZones,
  connectivity:
    a.inferred.connectivity === "none"
      ? "hub_and_spoke"
      : (a.inferred.connectivity ?? "hub_and_spoke"),
  firewall: a.inferred.firewall === "none" ? "Standard" : (a.inferred.firewall ?? "Standard"),
  privateDns: "platform",
  siem: "sentinel",
  bastion: "yes",
});
