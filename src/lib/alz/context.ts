/*
 * The design, compacted into the JSON the advisor reasons over: every choice, every management group with the
 * exact assignments it carries, the platform resources, traffic paths, access, installs and (for brownfield) the
 * tenant assessment. The advisor is told to use nothing else.
 */
import type { Assessment } from "./assess";
import {
  type AlzLibrary,
  type Answers,
  changesFor,
  hierarchy,
  platformResources,
  platformSubscriptions,
  shortRef,
} from "./engine";
import { PERSONAS, POLICY_OPTIONS } from "./governance";
import type { Placement } from "./placement";
import { flowsFor, spokesFor } from "./scene";

export function designContext(
  lib: AlzLibrary,
  answers: Answers,
  placed: Placement[],
  opts: { name: string; owner?: string | undefined; assessment?: Assessment | null } = { name: "" },
) {
  const tree = hierarchy(lib, answers);
  const spokes = spokesFor(
    ["corp", "online", "local", "sandbox"].filter((g) => tree.some((t) => t.libraryId === g)),
    placed,
  );
  const flows = flowsFor({ spokes }, answers);
  const byGroup = (g: string) => placed.filter((p) => p.landingZone === g);
  return JSON.stringify({
    landingZone: opts.name,
    ownedBy: opts.owner ?? "the ISV platform team (editable)",
    alzLibrary: shortRef(lib.ref),
    design: answers,
    managementGroups: tree.map((n) => ({
      id: n.id,
      role: n.libraryId,
      name: n.displayName,
      parent: n.parentId,
      archetype: n.archetype,
      assignedHere: n.here.map((h) => ({
        name: h.name,
        title: h.assignment?.displayName,
        effect: h.assignment?.effect ?? "definition default",
        ...(h.change ? { state: h.change.action === "remove" ? "removed" : "audit only" } : {}),
      })),
      inheritedCount: n.inherited,
    })),
    changesFromMicrosoftReference: changesFor(lib, answers).map((c) => ({
      assignment: c.assignment,
      at: c.managementGroup,
      action: c.action,
      reason: c.reason,
    })),
    platformSubscriptions: platformSubscriptions(answers),
    platformResources: platformResources(answers).map((r) => ({
      name: r.name,
      detail: r.detail,
      subscription: r.subscription,
      terraform: r.terraform,
    })),
    trafficFlows: flows.map((f) => ({
      title: f.title,
      works: f.available,
      ...(f.available
        ? { hops: f.steps.map((s) => `${s.title}: ${s.body}${s.policy ? ` [${s.policy}]` : ""}`) }
        : { missing: f.reason }),
    })),
    customerInstalls: {
      total: placed.length,
      byLandingZone: Object.fromEntries(
        ["corp", "online", "local", "sandbox"].map((g) => [g, byGroup(g).length]),
      ),
      examples: placed
        .slice(0, 12)
        .map((p) => `${p.customerName} ${p.environment} → ${p.landingZone}`),
    },
    access: {
      assigned: answers.rbac,
      personas: PERSONAS.map((p) => ({
        id: p.id,
        who: p.label,
        recommended: `${p.role} at ${p.scope}`,
        why: p.why,
      })),
    },
    extraPolicyOptions: POLICY_OPTIONS.map((o) => ({
      id: o.id,
      name: o.name,
      recommendedScope: o.scope,
      selected: answers.policyAdds.filter((a) => a.id === o.id).map((a) => a.scope),
    })),
    ...(opts.assessment
      ? {
          tenantAssessment: {
            alignmentPercent: opts.assessment.overall,
            scores: opts.assessment.scores,
            gaps: opts.assessment.gaps.map(
              (g) => `${g.severity} · ${g.area} · ${g.title}: ${g.detail}`,
            ),
            trafficToday: opts.assessment.traffic.map(
              (t) => `${t.ok ? "OK" : "MISSING"} ${t.title}: ${t.detail}`,
            ),
            subscriptionPlacement: opts.assessment.placement,
            policyCoverage: opts.assessment.coverage.map((c) => ({
              group: c.label,
              foundAs: c.tenantGroup,
              expected: c.expected,
              matched: c.matched,
              missing: c.missing.slice(0, 15),
            })),
            inferredDesign: opts.assessment.inferred,
          },
        }
      : {}),
  });
}
