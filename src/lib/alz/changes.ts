/*
 * What a design change means, in plain words and in Azure terms. Used by the change bar on the design canvas
 * (unsaved changes) and the Review step (saved design compared with what's deployed).
 */
import {
  type AlzLibrary,
  type Answers,
  hierarchy,
  includedGroups,
  platformResources,
  platformSubscriptions,
} from "./engine";

export type DesignChange = {
  id: string;
  area:
    | "Tenant"
    | "Hierarchy"
    | "Network"
    | "Management"
    | "Security"
    | "Policy"
    | "Access"
    | "Subscriptions";
  kind: "add" | "remove" | "change";
  text: string;
  /** Canvas section it belongs to, for "show me". */
  section: "mg" | "management" | "connectivity" | "landing" | "security" | "none";
};

const yes = (v: string) => v === "yes";
const label: Record<string, string> = {
  hub_and_spoke: "hub and spoke",
  virtual_wan: "Virtual WAN",
  none: "none",
  azure_monitor: "Azure Monitor",
  third_party: "a third-party tool",
  sentinel: "Microsoft Sentinel",
  other: "another SIEM",
  platform: "platform-owned",
};
const L = (v: string) => label[v] ?? v;

export function describeChanges(a: Answers, b: Answers): DesignChange[] {
  const out: DesignChange[] = [];
  const push = (c: DesignChange) => out.push(c);
  const scalar = (
    key: keyof Answers,
    area: DesignChange["area"],
    section: DesignChange["section"],
    name: string,
  ) => {
    if (a[key] === b[key]) return;
    push({
      id: String(key),
      area,
      section,
      kind: "change",
      text: `${name}: ${L(String(a[key]) || "none")} → ${L(String(b[key]) || "none")}`,
    });
  };
  const toggle = (
    key: keyof Answers,
    area: DesignChange["area"],
    section: DesignChange["section"],
    name: string,
  ) => {
    if (a[key] === b[key]) return;
    push({
      id: String(key),
      area,
      section,
      kind: yes(String(b[key])) ? "add" : "remove",
      text: `${yes(String(b[key])) ? "Add" : "Remove"} ${name}`,
    });
  };

  scalar("intermediateRootId", "Tenant", "mg", "Management group prefix");
  scalar("intermediateRootName", "Tenant", "mg", "Display name");
  scalar("primaryRegion", "Tenant", "connectivity", "Primary region");
  scalar("connectivity", "Network", "connectivity", "Network topology");
  if (a.firewall !== b.firewall)
    push({
      id: "firewall",
      area: "Network",
      section: "connectivity",
      kind: b.firewall === "none" ? "remove" : a.firewall === "none" ? "add" : "change",
      text:
        b.firewall === "none"
          ? "Remove Azure Firewall"
          : a.firewall === "none"
            ? `Add Azure Firewall ${b.firewall}`
            : `Azure Firewall: ${a.firewall} → ${b.firewall}`,
    });
  toggle("bastion", "Network", "connectivity", "Azure Bastion");
  toggle("vpnGateway", "Network", "connectivity", "VPN gateway");
  toggle("expressRoute", "Network", "connectivity", "ExpressRoute gateway");
  toggle("ddosPlan", "Network", "connectivity", "DDoS Network Protection");
  if (a.privateDns !== b.privateDns)
    push({
      id: "privateDns",
      area: "Network",
      section: "connectivity",
      kind: b.privateDns === "platform" ? "add" : "remove",
      text:
        b.privateDns === "platform"
          ? "Add private DNS zones and DNS Private Resolver"
          : "Remove private DNS zones and DNS Private Resolver",
    });
  if (a.secondaryRegion !== b.secondaryRegion)
    push({
      id: "secondaryRegion",
      area: "Network",
      section: "connectivity",
      kind: !b.secondaryRegion ? "remove" : !a.secondaryRegion ? "add" : "change",
      text: !b.secondaryRegion
        ? `Remove the second hub (${a.secondaryRegion})`
        : !a.secondaryRegion
          ? `Add a second hub in ${b.secondaryRegion}`
          : `Second hub: ${a.secondaryRegion} → ${b.secondaryRegion}`,
    });
  scalar("monitoring", "Management", "management", "Monitoring");
  scalar("siem", "Security", "management", "SIEM");
  if (a.logRetentionDays !== b.logRetentionDays)
    push({
      id: "logRetentionDays",
      area: "Management",
      section: "management",
      kind: "change",
      text: `Log retention: ${a.logRetentionDays} → ${b.logRetentionDays} days`,
    });
  toggle("defender", "Security", "security", "Microsoft Defender for Cloud plans");
  toggle("updateManager", "Management", "management", "Update Manager policies");
  toggle("serviceHealth", "Management", "management", "Service Health alerts");
  toggle("vmBackup", "Management", "management", "VM backup policy");
  toggle("identity", "Subscriptions", "mg", "Identity subscription");
  toggle("securitySubscription", "Subscriptions", "security", "Security subscription");

  for (const g of b.landingZones.filter((x) => !a.landingZones.includes(x)))
    push({
      id: `lz-${g}`,
      area: "Hierarchy",
      section: "mg",
      kind: "add",
      text: `Add the ${g} management group`,
    });
  for (const g of a.landingZones.filter((x) => !b.landingZones.includes(x)))
    push({
      id: `lz-${g}`,
      area: "Hierarchy",
      section: "mg",
      kind: "remove",
      text: `Remove the ${g} management group`,
    });
  for (const g of b.customGroups.filter((x) => !a.customGroups.some((y) => y.id === x.id)))
    push({
      id: `cg-${g.id}`,
      area: "Hierarchy",
      section: "mg",
      kind: "add",
      text: `Add management group "${g.name}" under ${g.parent}`,
    });
  for (const g of a.customGroups.filter((x) => !b.customGroups.some((y) => y.id === x.id)))
    push({
      id: `cg-${g.id}`,
      area: "Hierarchy",
      section: "mg",
      kind: "remove",
      text: `Remove management group "${g.name}"`,
    });
  for (const g of b.removedGroups.filter((x) => !a.removedGroups.includes(x)))
    push({
      id: `rg-${g}`,
      area: "Hierarchy",
      section: "mg",
      kind: "remove",
      text: `Leave out the ${g} management group`,
    });
  for (const g of a.removedGroups.filter((x) => !b.removedGroups.includes(x)))
    push({
      id: `rg-${g}`,
      area: "Hierarchy",
      section: "mg",
      kind: "add",
      text: `Add back the ${g} management group`,
    });
  for (const [k, v] of Object.entries(b.groupNames))
    if (a.groupNames[k] !== v)
      push({
        id: `gn-${k}`,
        area: "Hierarchy",
        section: "mg",
        kind: "change",
        text: `Rename ${k} to "${v}"`,
      });

  for (const s of b.extraSubscriptions.filter(
    (x) => !a.extraSubscriptions.some((y) => y.id === x.id),
  ))
    push({
      id: `sub-${s.id}`,
      area: "Subscriptions",
      section: "landing",
      kind: "add",
      text: `Add subscription "${s.name}" in ${s.group}, with its own network`,
    });
  for (const s of a.extraSubscriptions.filter(
    (x) => !b.extraSubscriptions.some((y) => y.id === x.id),
  ))
    push({
      id: `sub-${s.id}`,
      area: "Subscriptions",
      section: "landing",
      kind: "remove",
      text: `Remove subscription "${s.name}"`,
    });
  if (a.defaultGroup !== b.defaultGroup)
    push({
      id: "defaultGroup",
      area: "Hierarchy",
      section: "mg",
      kind: "change",
      text: `New subscriptions go to: ${a.defaultGroup || "tenant root"} → ${b.defaultGroup || "tenant root"}`,
    });
  if (a.environments.join() !== b.environments.join())
    push({
      id: "environments",
      area: "Subscriptions",
      section: "landing",
      kind: "change",
      text: `Environments: ${a.environments.join(", ")} → ${b.environments.join(", ")}`,
    });
  for (const w of b.workloads.filter(
    (x) => !a.workloads.some((y) => y.id === x.id && y.group === x.group),
  ))
    push({
      id: `wl-${w.group}-${w.id}`,
      area: "Subscriptions",
      section: "landing",
      kind: "add",
      text: `Add the ${w.id} workload landing zone to ${w.group}`,
    });
  for (const w of a.workloads.filter(
    (x) => !b.workloads.some((y) => y.id === x.id && y.group === x.group),
  ))
    push({
      id: `wl-${w.group}-${w.id}`,
      area: "Subscriptions",
      section: "landing",
      kind: "remove",
      text: `Remove the ${w.id} workload landing zone from ${w.group}`,
    });

  const keys = new Set([...Object.keys(a.policyOverrides), ...Object.keys(b.policyOverrides)]);
  for (const k of keys) {
    const [from, to] = [a.policyOverrides[k], b.policyOverrides[k]];
    if (from === to) continue;
    const [g, name] = k.split("/");
    push({
      id: `po-${k}`,
      area: "Policy",
      section: "mg",
      kind: to === "remove" ? "remove" : "change",
      text: !to
        ? `${name} at ${g}: back to Microsoft's default`
        : to === "remove"
          ? `Remove ${name} at ${g}`
          : `${name} at ${g}: audit only`,
    });
  }
  for (const p of b.policyAdds.filter(
    (x) => !a.policyAdds.some((y) => y.id === x.id && y.scope === x.scope),
  ))
    push({
      id: `pa-${p.id}-${p.scope}`,
      area: "Policy",
      section: "mg",
      kind: "add",
      text: `Assign ${p.id} at ${p.scope}`,
    });
  for (const p of a.policyAdds.filter(
    (x) => !b.policyAdds.some((y) => y.id === x.id && y.scope === x.scope),
  ))
    push({
      id: `pa-${p.id}-${p.scope}`,
      area: "Policy",
      section: "mg",
      kind: "remove",
      text: `Remove ${p.id} at ${p.scope}`,
    });
  const rk = (r: Answers["rbac"][number]) => JSON.stringify(r);
  const ra = new Set(a.rbac.map(rk));
  const rb = new Set(b.rbac.map(rk));
  const addedRoles = b.rbac.filter((r) => !ra.has(rk(r))).length;
  const removedRoles = a.rbac.filter((r) => !rb.has(rk(r))).length;
  if (addedRoles)
    push({
      id: "rbac-add",
      area: "Access",
      section: "mg",
      kind: "add",
      text: `${addedRoles} role assignment${addedRoles === 1 ? "" : "s"} added`,
    });
  if (removedRoles)
    push({
      id: "rbac-remove",
      area: "Access",
      section: "mg",
      kind: "remove",
      text: `${removedRoles} role assignment${removedRoles === 1 ? "" : "s"} removed`,
    });
  return out;
}

export type Impact = {
  groups: { added: string[]; removed: string[] };
  resources: { added: string[]; removed: string[]; changed: string[] };
  subscriptions: { added: string[]; removed: string[] };
  assignments: { before: number; after: number };
  total: { groups: number; resources: number; assignments: number };
};

/** What changes in Azure between two designs (before = null when nothing is deployed yet). */
export function impactOf(lib: AlzLibrary, before: Answers | null, after: Answers): Impact {
  const groups = (x: Answers | null) => new Set(x ? includedGroups(lib, x).map((g) => g.id) : []);
  const res = (x: Answers | null) =>
    new Map(
      (x ? platformResources(x) : []).map((r) => [
        `${r.subscription}/${r.id}`,
        `${r.name} (${r.subscription})`,
      ]),
    );
  const subs = (x: Answers | null) =>
    new Map([
      ...(x
        ? platformSubscriptions(x)
            .filter((s) => s.created)
            .map((s) => [s.managementGroup, s.name] as const)
        : []),
      ...(x?.extraSubscriptions ?? []).map((s) => [`extra-${s.id}`, s.name] as const),
    ]);
  const count = (x: Answers | null) =>
    x ? hierarchy(lib, x).reduce((n, g) => n + g.enforced, 0) : 0;
  const [ga, gb] = [groups(before), groups(after)];
  const [ra, rb] = [res(before), res(after)];
  const [sa, sb] = [subs(before), subs(after)];
  return {
    groups: {
      added: [...gb].filter((g) => !ga.has(g)),
      removed: [...ga].filter((g) => !gb.has(g)),
    },
    resources: {
      added: [...rb].filter(([k]) => !ra.has(k)).map(([, v]) => v),
      removed: [...ra].filter(([k]) => !rb.has(k)).map(([, v]) => v),
      changed: [...rb]
        .filter(([k, v]) => ra.has(k) && ra.get(k) !== v)
        .map(([k, v]) => `${ra.get(k)} → ${v}`),
    },
    subscriptions: {
      added: [...sb].filter(([k]) => !sa.has(k)).map(([, v]) => v),
      removed: [...sa].filter(([k]) => !sb.has(k)).map(([, v]) => v),
    },
    assignments: { before: count(before), after: count(after) },
    total: { groups: gb.size, resources: rb.size, assignments: count(after) },
  };
}
