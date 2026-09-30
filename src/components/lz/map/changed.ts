import type { Answers } from "@/lib/alz/engine";

import { TOOLS } from "./parts";

/** Ids of the parts of the drawing that differ from the saved design; they glow until saved. */
export function changedIds(baseline: Answers | undefined, answers: Answers): Set<string> {
  const changed = new Set<string>();
  if (!baseline) return changed;
  const b = baseline;
  const mark = (cond: boolean, ...ids: string[]) => cond && ids.forEach((i) => changed.add(i));
  mark(b.firewall !== answers.firewall, "firewall", "firewall2");
  mark(b.vpnGateway !== answers.vpnGateway, "vpngw", "vpngw2");
  mark(b.expressRoute !== answers.expressRoute, "ergw", "ergw2");
  mark(b.bastion !== answers.bastion, "bastion", "bastion2");
  mark(b.privateDns !== answers.privateDns, "dnsresolver", "dnsresolver2", "dnszones");
  mark(b.ddosPlan !== answers.ddosPlan, "ddos");
  mark(b.secondaryRegion !== answers.secondaryRegion, "hub2", "sub:connectivity");
  mark(b.connectivity !== answers.connectivity, "sub:connectivity", "hub1");
  mark(b.primaryRegion !== answers.primaryRegion, "hub1");
  mark(b.identity !== answers.identity, "sub:identity", "mg:identity");
  mark(b.securitySubscription !== answers.securitySubscription, "sub:security", "mg:security");
  mark(b.siem !== answers.siem, "sentinel", "seclaw");
  mark(b.monitoring !== answers.monitoring, "ama");
  mark(b.logRetentionDays !== answers.logRetentionDays, "law");
  mark(
    b.intermediateRootName !== answers.intermediateRootName ||
      b.intermediateRootId !== answers.intermediateRootId,
    "mg-root",
  );
  for (const g of ["corp", "online", "sandbox", "local"] as const)
    mark(b.landingZones.includes(g) !== answers.landingZones.includes(g), `sub:${g}`, `mg:${g}`);
  for (const g of answers.customGroups)
    mark(
      !b.customGroups.some((x) => JSON.stringify(x) === JSON.stringify(g)),
      `mg:${g.id}`,
      `sub:${g.id}`,
    );
  for (const [k, v] of Object.entries(answers.groupNames))
    mark(b.groupNames[k] !== v, `mg:${k}`, `sub:${k}`);
  for (const g of answers.removedGroups) mark(!b.removedGroups.includes(g), `mg:${g}`);
  for (const x of answers.extraSubscriptions)
    mark(
      !b.extraSubscriptions.some((y) => JSON.stringify(y) === JSON.stringify(x)),
      `extra:${x.id}`,
      `mg:${x.group}`,
    );
  for (const t of TOOLS) if (t.answer) mark(b[t.answer] !== answers[t.answer], `tool:${t.id}`);
  return changed;
}
