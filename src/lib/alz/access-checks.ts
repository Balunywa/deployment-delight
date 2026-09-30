/*
 * Access, identity and policy checked against Microsoft's published guidance, live, from the design itself.
 * Each check says where it applies, why (with the Microsoft Learn page), and — when the design can express the
 * fix — the exact change that fixes it. Things only the customer's tenant can prove (emergency access accounts,
 * PIM activation settings) are "confirm" items: listed, linked, never counted as passed.
 *
 * Sources:
 * - Azure RBAC best practices: least privilege, at most 3 subscription owners, limit privileged administrator
 *   roles, PIM, assign to groups — learn.microsoft.com/azure/role-based-access-control/best-practices
 * - CAF identity and access for landing zones — .../ready/landing-zone/design-area/identity-access-landing-zones
 * - Emergency access accounts — learn.microsoft.com/entra/identity/role-based-access-control/security-emergency-access
 * - Protect the resource hierarchy (default management group, authorization to create groups) —
 *   learn.microsoft.com/azure/governance/management-groups/how-to/protect-resource-hierarchy
 * - Delegating role assignments with conditions — .../role-based-access-control/delegate-role-assignments-overview
 */
import { type Answers, type MgNode, hasHub, on } from "./engine";
import { PERSONAS, POLICY_OPTIONS, type RbacAssignment } from "./governance";

export type CheckStatus = "pass" | "warn" | "fail" | "confirm";
export type CheckArea = "Tenant root" | "Identity" | "Access" | "Policy";
export type Check = {
  id: string;
  area: CheckArea;
  status: CheckStatus;
  title: string;
  detail: string;
  /** Where it applies: a management group id, "tenant-root" or "entra". */
  scope: string;
  fix?: { label: string; patch: Partial<Answers> } | undefined;
  source: { label: string; url: string };
};

const LEARN = "https://learn.microsoft.com/en-us";
const SRC = {
  rbac: {
    label: "Best practices for Azure RBAC",
    url: `${LEARN}/azure/role-based-access-control/best-practices`,
  },
  caf: {
    label: "CAF: landing zone identity and access",
    url: `${LEARN}/azure/cloud-adoption-framework/ready/landing-zone/design-area/identity-access-landing-zones`,
  },
  breakglass: {
    label: "Manage emergency access accounts",
    url: `${LEARN}/entra/identity/role-based-access-control/security-emergency-access`,
  },
  pim: {
    label: "What is Privileged Identity Management?",
    url: `${LEARN}/entra/id-governance/privileged-identity-management/pim-configure`,
  },
  hierarchy: {
    label: "Protect your resource hierarchy",
    url: `${LEARN}/azure/governance/management-groups/how-to/protect-resource-hierarchy`,
  },
  mgs: {
    label: "CAF: management groups",
    url: `${LEARN}/azure/cloud-adoption-framework/ready/landing-zone/design-area/resource-org-management-groups`,
  },
  condition: {
    label: "Delegate role assignments with conditions",
    url: `${LEARN}/azure/role-based-access-control/delegate-role-assignments-overview`,
  },
  wif: {
    label: "Workload identity federation",
    url: `${LEARN}/entra/workload-id/workload-identity-federation`,
  },
  hybrid: {
    label: "CAF: Active Directory and hybrid identity",
    url: `${LEARN}/azure/cloud-adoption-framework/ready/landing-zone/design-area/identity-access-active-directory-hybrid-identity`,
  },
  governance: {
    label: "CAF: governance design area",
    url: `${LEARN}/azure/cloud-adoption-framework/ready/landing-zone/design-area/governance`,
  },
};

/** Roles that can change who has access (privileged administrator roles, plus the ALZ subscription owner). */
export const PRIVILEGED = new Set([
  "Owner",
  "User Access Administrator",
  "Role Based Access Control Administrator",
  "Subscription-Owner",
]);
/** Rough breadth of a role, to tell "broader than recommended" from a different job function. */
const RANK: Record<string, number> = {
  Owner: 4,
  "User Access Administrator": 4,
  "Subscription-Owner": 3,
  Contributor: 3,
  "Application-Owners": 2,
  "Network-Management": 2,
  "Security-Operations": 2,
  "Security Admin": 2,
  "Resource Policy Contributor": 2,
  "Network Contributor": 2,
  "Monitoring Contributor": 1,
  "Microsoft Sentinel Contributor": 1,
  "Network-Subnet-Contributor": 1,
  Reader: 0,
  "Security Reader": 0,
  "Log Analytics Reader": 0,
  "Cost Management Reader": 0,
};
const rank = (role: string) => RANK[role] ?? 1;

/** Guardrails that keep management ports and public IPs away from identity and workloads. */
const KEY_GUARDRAILS: [string, string][] = [
  ["identity/Deny-MgmtPorts-Internet", "RDP/SSH open to the internet on the Identity subscription"],
  ["identity/Deny-Public-IP", "public IPs on domain controllers"],
  ["landingzones/Deny-MgmtPorts-Internet", "RDP/SSH open to the internet in customer installs"],
  ["corp/Deny-Public-IP-On-NIC", "public IPs on VMs in Corp installs"],
];

export function accessChecks(answers: Answers, tree: MgNode[]): Check[] {
  const has = (id: string) => tree.some((n) => n.libraryId === id);
  const name = (id: string) => tree.find((n) => n.libraryId === id)?.displayName ?? id;
  const root = tree.find((n) => !n.parentId)?.libraryId ?? "alz";
  const parentOf = (id: string) => {
    const n = tree.find((t) => t.libraryId === id);
    return tree.find((t) => t.id === n?.parentId)?.libraryId;
  };
  const isAncestor = (a: string, b: string) => {
    for (let x = parentOf(b); x; x = parentOf(x)) if (x === a) return true;
    return false;
  };
  const persona = (id: string) => PERSONAS.find((p) => p.id === id);
  const rec = (id: string): RbacAssignment | null => {
    const p = persona(id);
    return p ? { persona: p.id, role: p.role, scope: has(p.scope) ? p.scope : root } : null;
  };
  const withRbac = (next: RbacAssignment) => ({
    rbac: [...answers.rbac.filter((r) => r.persona !== next.persona), next],
  });
  const out: Check[] = [];

  /* Tenant root */
  out.push({
    id: "root-untouched",
    area: "Tenant root",
    status: "pass",
    scope: "tenant-root",
    title: "Nothing is assigned at the tenant root group",
    detail: `Every role and policy in this design starts at ${name(root)}, one level down. The tenant root stays clean, and the whole landing zone can be moved or removed without touching tenant-wide settings.`,
    source: SRC.mgs,
  });
  out.push(
    answers.defaultGroup && has(answers.defaultGroup)
      ? {
          id: "default-group",
          area: "Tenant root",
          status: "pass",
          scope: "tenant-root",
          title: `New subscriptions land in ${name(answers.defaultGroup)}, not at the root`,
          detail:
            "Hierarchy settings send any new subscription to a governed group, and only people with write access to the root can create management groups (applied at deploy).",
          source: SRC.hierarchy,
        }
      : {
          id: "default-group",
          area: "Tenant root",
          status: "warn",
          scope: "tenant-root",
          title: "New subscriptions land at the tenant root, outside every guardrail",
          detail:
            "Microsoft recommends a default management group so a subscription created by anyone is governed from its first minute. Sandbox is the usual choice.",
          fix: has("sandbox")
            ? { label: "Send them to Sandbox", patch: { defaultGroup: "sandbox" } }
            : undefined,
          source: SRC.hierarchy,
        },
  );

  /* Identity (Microsoft Entra ID) */
  out.push({
    id: "breakglass",
    area: "Identity",
    status: "confirm",
    scope: "entra",
    title: "Two emergency access (break-glass) accounts",
    detail:
      "Cloud-only accounts with Global Administrator, phishing-resistant sign-in, excluded from normal Conditional Access, monitored for any use. Confirm they exist in the customer's tenant; a design can't create them.",
    source: SRC.breakglass,
  });
  const privileged = answers.rbac.filter(
    (r) => PRIVILEGED.has(r.role) && !persona(r.persona)?.condition,
  );
  out.push(
    privileged.length
      ? {
          id: "pim",
          area: "Identity",
          status: "confirm",
          scope: "entra",
          title: `Make ${privileged.map((r) => `${persona(r.persona)?.label} (${r.role})`).join(", ")} just in time`,
          detail:
            "Privileged roles should be eligible through Privileged Identity Management, activated with approval and MFA for a few hours, not standing. Set this on the Entra group in PIM after deploying.",
          source: SRC.pim,
        }
      : {
          id: "pim",
          area: "Identity",
          status: "pass",
          scope: "entra",
          title: "No standing privileged roles for people",
          detail:
            "No team holds Owner or User Access Administrator, so there's nothing to put behind PIM.",
          source: SRC.pim,
        },
  );
  out.push({
    id: "groups",
    area: "Identity",
    status: "pass",
    scope: "entra",
    title: "Roles go to Entra groups, not individual people",
    detail:
      "Each team in this design is one Microsoft Entra group; at deploy you give the group's object ID. Joining or leaving a team is a group change, not a role change.",
    source: SRC.rbac,
  });
  const delivery = answers.rbac.find((r) => r.persona === "delivery");
  out.push(
    delivery
      ? {
          id: "pipeline-identity",
          area: "Identity",
          status: "pass",
          scope: "entra",
          title: "The delivery pipeline signs in with a federated workload identity",
          detail:
            "No client secrets: the pipeline exchanges a short-lived GitHub token for an Entra token, only from the approved workflow.",
          source: SRC.wif,
        }
      : {
          id: "pipeline-identity",
          area: "Identity",
          status: "warn",
          scope: "entra",
          title: "No identity can vend a subscription per customer install",
          detail:
            "Onboarding a customer creates their subscriptions under Landing zones. Give the delivery pipeline's workload identity that right, scoped to Landing zones only.",
          fix: rec("delivery")
            ? { label: "Add the delivery pipeline", patch: withRbac(rec("delivery")!) }
            : undefined,
          source: SRC.caf,
        },
  );
  const onPrem = hasHub(answers) && (on(answers.vpnGateway) || on(answers.expressRoute));
  if (onPrem)
    out.push(
      on(answers.identity)
        ? {
            id: "hybrid",
            area: "Identity",
            status: "pass",
            scope: "identity",
            title: "Domain controllers have their own Identity subscription",
            detail:
              "On-premises is connected, and AD DS runs in the Identity subscription, peered to the hub.",
            source: SRC.hybrid,
          }
        : {
            id: "hybrid",
            area: "Identity",
            status: "warn",
            scope: "platform",
            title: "On-premises is connected, but there's nowhere for domain controllers",
            detail:
              "If any workload needs Active Directory Domain Services, Microsoft puts the domain controllers in a dedicated Identity subscription, peered to the hub. Skip this if everything uses Entra ID.",
            fix: { label: "Add the Identity subscription", patch: { identity: "yes" } },
            source: SRC.hybrid,
          },
    );

  /* Access (Azure RBAC) */
  const platform = answers.rbac.find((r) => r.persona === "platform");
  if (!platform)
    out.push({
      id: "platform-owner",
      area: "Access",
      status: "fail",
      scope: root,
      title: "Nobody runs the platform",
      detail:
        "Someone has to own the management groups, policy and platform subscriptions. Microsoft assigns the platform team at the intermediate root.",
      fix: { label: "Add the platform team", patch: withRbac(rec("platform")!) },
      source: SRC.caf,
    });
  const owners = answers.rbac.filter((r) => r.role === "Owner");
  out.push(
    owners.length > 3
      ? {
          id: "owner-count",
          area: "Access",
          status: "warn",
          scope: root,
          title: `${owners.length} groups hold Owner — Microsoft recommends at most 3`,
          detail: `${owners.map((r) => persona(r.persona)?.label).join(", ")}. Every Owner can grant access to anyone, so each one is a way in if compromised.`,
          source: SRC.rbac,
        }
      : {
          id: "owner-count",
          area: "Access",
          status: "pass",
          scope: root,
          title: `${owners.length || "No"} group${owners.length === 1 ? "" : "s"} hold${owners.length === 1 ? "s" : ""} Owner (at most 3)`,
          detail: "Few Owners means few people who can change who has access.",
          source: SRC.rbac,
        },
  );
  let leastIssues = 0;
  for (const r of answers.rbac) {
    const p = persona(r.persona);
    const want = rec(r.persona);
    if (!p || !want) continue;
    const broaderRole = rank(r.role) > rank(want.role);
    const broaderScope = r.scope !== want.scope && isAncestor(r.scope, want.scope);
    const elsewhere = r.scope !== want.scope && !broaderScope && !isAncestor(want.scope, r.scope);
    if (!broaderRole && !broaderScope && !elsewhere) continue;
    leastIssues++;
    const why = [
      broaderRole && `${r.role} is broader than ${want.role}`,
      broaderScope && `${name(r.scope)} covers more than ${name(want.scope)}`,
      elsewhere && `${name(r.scope)} is outside this team's area (${name(want.scope)})`,
    ]
      .filter(Boolean)
      .join("; ");
    out.push({
      id: `least:${r.persona}`,
      area: "Access",
      status: PRIVILEGED.has(r.role) && (broaderRole || broaderScope) ? "fail" : "warn",
      scope: r.scope,
      title: `${p.label}: ${r.role} at ${name(r.scope)} is more than they need`,
      detail: `${why}. ${p.why}`,
      fix: { label: `Use ${want.role} at ${name(want.scope)}`, patch: withRbac(want) },
      source: SRC.rbac,
    });
  }
  if (!leastIssues && answers.rbac.length)
    out.push({
      id: "least",
      area: "Access",
      status: "pass",
      scope: root,
      title: "Every team has just enough access, at the right level",
      detail:
        "Each role and scope matches Microsoft's recommendation for that team, or is narrower.",
      source: SRC.rbac,
    });
  if (delivery && PRIVILEGED.has(delivery.role))
    out.push({
      id: "delivery-condition",
      area: "Access",
      status: "pass",
      scope: delivery.scope,
      title: "The delivery pipeline can't hand out Owner",
      detail:
        "Its role assignment carries Microsoft's condition: it can assign roles in the subscriptions it creates, but never Owner, User Access Administrator or RBAC Administrator.",
      source: SRC.condition,
    });
  if (!answers.rbac.some((r) => r.persona === "secops"))
    out.push({
      id: "secops",
      area: "Access",
      status: "warn",
      scope: root,
      title: "The security team can't see the estate",
      detail:
        "Security operations needs a horizontal view across every subscription; Microsoft assigns it at the intermediate root.",
      fix: { label: "Add the security team", patch: withRbac(rec("secops")!) },
      source: SRC.caf,
    });

  /* Policy */
  const weakened = KEY_GUARDRAILS.filter(([k]) => answers.policyOverrides[k]);
  out.push(
    weakened.length
      ? {
          id: "guardrails",
          area: "Policy",
          status: "fail",
          scope: weakened[0]![0].split("/")[0]!,
          title: `${weakened.length} access guardrail${weakened.length === 1 ? " is" : "s are"} weakened`,
          detail: `Now allowed: ${weakened.map(([, w]) => w).join("; ")}. These ALZ policies are what keep admin ports and public IPs off identity and workloads.`,
          fix: {
            label: "Put them back to Deny",
            patch: {
              policyOverrides: Object.fromEntries(
                Object.entries(answers.policyOverrides).filter(
                  ([k]) => !KEY_GUARDRAILS.some(([g]) => g === k),
                ),
              ),
            },
          },
          source: SRC.governance,
        }
      : {
          id: "guardrails",
          area: "Policy",
          status: "pass",
          scope: "identity",
          title: "Admin ports and public IPs stay blocked where Microsoft blocks them",
          detail:
            "Deny-MgmtPorts-Internet and Deny-Public-IP are in force on Identity and the landing zones.",
          source: SRC.governance,
        },
  );
  const added = (id: string) => answers.policyAdds.find((a) => a.id === id);
  const addPolicy = (id: string) => {
    const o = POLICY_OPTIONS.find((x) => x.id === id)!;
    return {
      policyAdds: [
        ...answers.policyAdds.filter((a) => a.id !== id),
        { id, scope: has(o.scope) ? o.scope : root },
      ],
    };
  };
  out.push(
    added("allowed-locations")
      ? {
          id: "regions",
          area: "Policy",
          status: added("allowed-locations")!.scope === root ? "pass" : "warn",
          scope: added("allowed-locations")!.scope,
          title:
            added("allowed-locations")!.scope === root
              ? "Resources can only be created in your regions"
              : `Regions are only restricted under ${name(added("allowed-locations")!.scope)}`,
          detail:
            "Allowed locations is assigned once at the intermediate root so every subscription inherits it.",
          fix:
            added("allowed-locations")!.scope === root
              ? undefined
              : { label: `Move it to ${name(root)}`, patch: addPolicy("allowed-locations") },
          source: SRC.governance,
        }
      : {
          id: "regions",
          area: "Policy",
          status: "warn",
          scope: root,
          title: "Resources can be created in any region",
          detail:
            "Data residency and cost both depend on region. Microsoft recommends Allowed locations at the intermediate root.",
          fix: {
            label: "Restrict to this design's regions",
            patch: addPolicy("allowed-locations"),
          },
          source: SRC.governance,
        },
  );
  out.push(
    added("require-rg-tag")
      ? {
          id: "customer-tag",
          area: "Policy",
          status: "pass",
          scope: added("require-rg-tag")!.scope,
          title: "Every resource group carries a customer tag",
          detail: "Costs and ownership map to customers reliably.",
          source: SRC.governance,
        }
      : {
          id: "customer-tag",
          area: "Policy",
          status: "warn",
          scope: "landingzones",
          title: "Costs can't be traced to customers reliably",
          detail:
            "For a product hosted per customer, a required customer tag on resource groups under Landing zones makes cost and ownership reports trustworthy.",
          fix: has("landingzones")
            ? { label: "Require a customer tag", patch: addPolicy("require-rg-tag") }
            : undefined,
          source: SRC.governance,
        },
  );
  const framework = answers.policyAdds.find(
    (a) => POLICY_OPTIONS.find((o) => o.id === a.id)?.category === "Compliance framework",
  );
  out.push(
    framework
      ? {
          id: "framework",
          area: "Policy",
          status: "pass",
          scope: framework.scope,
          title: `Compliance is reported against ${POLICY_OPTIONS.find((o) => o.id === framework.id)?.name}`,
          detail:
            "Audit-only; Defender for Cloud's regulatory compliance dashboard covers every subscription below it.",
          source: SRC.governance,
        }
      : {
          id: "framework",
          area: "Policy",
          status: "confirm",
          scope: root,
          title: "Which framework do your customers audit you against?",
          detail:
            "Pick one so compliance is reported continuously. US utilities usually ask for NIST SP 800-53.",
          fix: { label: "Report against NIST SP 800-53", patch: addPolicy("nist-800-53-r5") },
          source: SRC.governance,
        },
  );
  if (answers.defender !== "yes")
    out.push({
      id: "defender",
      area: "Policy",
      status: "warn",
      scope: root,
      title: "Defender for Cloud isn't configured by policy",
      detail:
        "Without it, identity and access recommendations (like the 3-owner limit) aren't monitored.",
      fix: { label: "Turn it on", patch: { defender: "yes" } },
      source: SRC.rbac,
    });

  return out;
}

export function checkSummary(checks: Check[]) {
  const scored = checks.filter((c) => c.status !== "confirm");
  return {
    passed: scored.filter((c) => c.status === "pass").length,
    scored: scored.length,
    fix: checks.filter((c) => c.status === "warn" || c.status === "fail").length,
    confirm: checks.filter((c) => c.status === "confirm").length,
  };
}

/** Issues per scope, for badges on the map. */
export function issuesAt(checks: Check[], scope: string) {
  return checks.filter((c) => c.scope === scope && (c.status === "warn" || c.status === "fail"));
}
