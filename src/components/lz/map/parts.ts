/* Shared pieces of the landing zone drawing: the governance toolset, part icons and colours, group edits. */
import {
  Activity,
  BellRing,
  BrickWall,
  Cable,
  CalendarCheck,
  DatabaseBackup,
  Filter,
  Fingerprint,
  KeyRound,
  Network,
  Radar,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Signpost,
  SquareTerminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import {
  type Answers,
  type OptionalGroup,
  REMOVABLE_GROUPS,
  type RemovableGroup,
} from "@/lib/alz/engine";

type Patch = (p: Partial<Answers>) => void;

/** Governance capabilities Microsoft draws in every subscription, and the ALZ assignment that provides each. */
export const TOOLS: {
  id: string;
  label: string;
  icon: LucideIcon;
  assignment: string;
  answer?: keyof Answers;
  offValue?: string;
  onValue?: string;
  body: string;
}[] = [
  {
    id: "defender",
    label: "Defender for Cloud",
    icon: ShieldCheck,
    assignment: "Deploy-MDFC-Config-H224",
    answer: "defender",
    body: "Defender for Cloud plans, security contact and export to the central workspace.",
  },
  {
    id: "ama",
    label: "Monitoring agent",
    icon: Activity,
    assignment: "Deploy-VM-Monitoring",
    answer: "monitoring",
    onValue: "azure_monitor",
    offValue: "third_party",
    body: "Azure Monitor Agent on every VM, sending to the central workspace.",
  },
  {
    id: "updates",
    label: "Update Manager",
    icon: CalendarCheck,
    assignment: "Enable-AUM-CheckUpdates",
    answer: "updateManager",
    body: "Periodic assessment of missing OS updates by Azure Update Manager.",
  },
  {
    id: "backup",
    label: "Backup",
    icon: DatabaseBackup,
    assignment: "Deploy-VM-Backup",
    answer: "vmBackup",
    body: "VMs are enrolled in a Recovery Services vault by policy.",
  },
  {
    id: "alerts",
    label: "Service Health alerts",
    icon: BellRing,
    assignment: "Deploy-SvcHealth-BuiltIn",
    answer: "serviceHealth",
    body: "Service Health alert rules and action groups in every subscription.",
  },
  {
    id: "activity",
    label: "Activity logs",
    icon: ScrollText,
    assignment: "Deploy-AzActivity-Log",
    body: "Subscription activity logs are sent to the central workspace.",
  },
];

export const toolOn = (t: (typeof TOOLS)[number], a: Answers) =>
  !t.answer ? true : t.onValue ? a[t.answer] === t.onValue : a[t.answer] === "yes";

export const toggleTool = (t: (typeof TOOLS)[number], a: Answers): Partial<Answers> =>
  !t.answer
    ? {}
    : ({
        [t.answer]: toolOn(t, a) ? (t.offValue ?? "no") : (t.onValue ?? "yes"),
      } as Partial<Answers>);

export const ICON: Record<string, LucideIcon> = {
  firewall: BrickWall,
  vpngw: KeyRound,
  ergw: Cable,
  bastion: SquareTerminal,
  dnsresolver: Signpost,
  dnszones: Network,
  ddos: ShieldAlert,
  law: ScrollText,
  dcr: Filter,
  ama: Fingerprint,
  sentinel: Radar,
  vwan: Waypoints,
};

export const TONE: Record<string, string> = {
  firewall: "#d13438",
  vpngw: "#8661c5",
  ergw: "#5c2e91",
  bastion: "#038387",
  dnsresolver: "#0078d4",
  dnszones: "#0078d4",
  ddos: "#ca5010",
  law: "#8661c5",
  dcr: "#8661c5",
  ama: "#5c2e91",
  sentinel: "#0078d4",
  vwan: "#0078d4",
};

export const toggleGroup = (set: Patch, a: Answers, g: OptionalGroup) =>
  set({
    landingZones: a.landingZones.includes(g)
      ? a.landingZones.filter((x) => x !== g)
      : [...a.landingZones, g],
  });

export const removeGroup = (set: Patch, a: Answers, id: string) => {
  if (a.customGroups.some((c) => c.id === id)) {
    // Removing a group removes the groups under it too.
    const gone = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of a.customGroups)
        if (gone.has(c.parent) && !gone.has(c.id)) {
          gone.add(c.id);
          grew = true;
        }
    }
    set({
      customGroups: a.customGroups.filter((c) => !gone.has(c.id)),
      workloads: a.workloads.filter((w) => !gone.has(w.group)),
      extraSubscriptions: a.extraSubscriptions.filter((x) => !gone.has(x.group)),
      rbac: a.rbac.filter((r) => !gone.has(r.scope)),
      policyAdds: a.policyAdds.filter((p) => !gone.has(p.scope)),
    });
  } else if ((REMOVABLE_GROUPS as readonly string[]).includes(id))
    set({ removedGroups: [...new Set([...a.removedGroups, id as RemovableGroup])] });
};
