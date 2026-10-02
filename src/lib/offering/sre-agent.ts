/*
 * Azure SRE Agent for an install: the agent (Microsoft.App/agents through azapi, since azurerm has no resource and
 * the AVM module is a placeholder), its identity and RBAC on the install, and the pack that briefs it with the
 * design, so it investigates incidents against the architecture the team intended, not just what it finds.
 *
 * Grounded in Microsoft's docs and templates (microsoft/sre-agent, sreagent-templates):
 * - The agent manages the resource groups in knowledgeGraphConfiguration.managedResources; its identity gets Reader,
 *   Log Analytics Reader and Monitoring Reader on them, Monitoring Contributor on the subscription (acknowledge and
 *   close alerts), and Contributor only for the High access level.
 * - Synthesized knowledge (overview.md is always loaded; architecture.md, deployment.md…) is uploaded as a tar.gz to
 *   WorkspaceMemory; documents go to AgentMemory (indexed for search); scheduled tasks are PUT to the extendedAgent
 *   API. These are data-plane calls ARM can't make yet, so the pipeline runs brief.sh after apply.
 */
import type { Architecture } from "@/lib/architecture";
import { SERVICE_BY_ID, type Selected } from "@/lib/catalog";
import { type Review, review as reviewWaf } from "@/lib/waf";

import { designDocument } from "./design-doc";
import { type WorkloadFlow, workloadFlows } from "./flows";
import type { ServiceTf } from "./hcl";
import { SRE_AGENT_REGIONS } from "./sre-regions";

export { SRE_AGENT_REGIONS };

const API = "2025-05-01-preview";
const ADMIN_ROLE = "e79298df-d852-4c6d-84f9-5d13249d1e55";
const CAP: Record<string, number> = { "1,000 AAU": 1000, "5,000 AAU": 5000, "20,000 AAU": 20000 };

export type SreSettings = {
  existing: boolean;
  mode: "Review" | "Autonomous";
  high: boolean;
  cap: number;
  devAgent: boolean;
};

export function sreSettings(s: Record<string, string> | undefined): SreSettings {
  return {
    existing: s?.["agent"] === "Customer's existing agent",
    mode: s?.["mode"] === "Autonomous" ? "Autonomous" : "Review",
    high: s?.["access"] === "Contributor on the install",
    cap: CAP[s?.["usageCap"] ?? ""] ?? 1000,
    devAgent: s?.["devInstalls"] === "Same as production",
  };
}

/** The Terraform for the agent, or, for a customer's existing agent, only its access to this install. */
export function sreAgent(s: Record<string, string>): ServiceTf {
  const o = sreSettings(s);
  const on = o.devAgent ? "true" : "local.prod";

  const readers = (who: string, principal: string, count: string) =>
    ["Reader", "Log Analytics Reader", "Monitoring Reader"]
      .map(
        (
          role,
        ) => `resource "azurerm_role_assignment" "${who}_${role.toLowerCase().replace(/ /g, "_")}" {
  count                = ${count}
  scope                = local.rg_id
  role_definition_name = "${role}"
  principal_id         = ${principal}
  principal_type       = "ServicePrincipal"
}`,
      )
      .join("\n\n");
  if (o.existing)
    return {
      body: `
# The customer's existing SRE Agent watches this install too: one agent can cover many workloads, so there is no
# new always-on charge. It reads the install; the pipeline adds the resource group to its managed resources
# (sre-agent/brief.sh) and briefs it with this design.
${readers("sre_agent", "var.sre_agent_principal_id", 'var.sre_agent_principal_id != "" ? 1 : 0')}
${
  o.high
    ? `
resource "azurerm_role_assignment" "sre_agent_contributor" {
  count                = var.sre_agent_principal_id != "" ? 1 : 0
  scope                = local.rg_id
  role_definition_name = "Contributor"
  principal_id         = var.sre_agent_principal_id
  principal_type       = "ServicePrincipal"
}
`
    : ""
}`,
      outputs: { sre_agent_id: "var.sre_agent_id" },
    };
  return {
    providers: ["Microsoft.App"],
    outputs: {
      sre_agent_id: 'try(azapi_resource.sre_agent[0].id, "")',
      sre_agent_endpoint: 'try(azapi_resource.sre_agent[0].output.properties.agentEndpoint, "")',
    },
    body: `
locals {
  sre_agent_on = ${on}
  # One region per agent, fixed at creation. Where the install's region can't host one, the agent runs in the
  # fallback region and still manages this install (its data is processed there).
  sre_agent_location = contains(${JSON.stringify(SRE_AGENT_REGIONS)}, var.location) ? var.location : var.sre_agent_fallback_location
}

resource "azurerm_user_assigned_identity" "sre_agent" {
  count               = local.sre_agent_on ? 1 : 0
  name                = "id-sre-\${local.name}"
  location            = local.sre_agent_location
  resource_group_name = local.rg_name
  tags                = local.tags
}

# The agent's own telemetry, separate from the workload's.
resource "azurerm_application_insights" "sre_agent" {
  count                        = local.sre_agent_on ? 1 : 0
  name                         = "appi-sre-\${local.name}"
  location                     = var.location
  resource_group_name          = local.rg_name
  workspace_id                 = local.law_id
  application_type             = "other"
  tags                         = local.tags
}

resource "azapi_resource" "sre_agent" {
  count                     = local.sre_agent_on ? 1 : 0
  type                      = "Microsoft.App/agents@${API}"
  schema_validation_enabled = false
  name                      = trimsuffix(substr("sre-\${local.name}", 0, 32), "-")
  location                  = local.sre_agent_location
  parent_id                 = local.rg_id
  tags                      = local.tags

  identity {
    type         = "SystemAssigned, UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.sre_agent[0].id]
  }

  body = {
    properties = {
      knowledgeGraphConfiguration = {
        identity         = azurerm_user_assigned_identity.sre_agent[0].id
        managedResources = [local.rg_id]
      }
      actionConfiguration = {
        identity    = azurerm_user_assigned_identity.sre_agent[0].id
        accessLevel = "${o.high ? "High" : "Low"}"
        # The preview API calls autonomous mode "Automatic".
        mode        = "${o.mode === "Autonomous" ? "Automatic" : "Review"}"
      }
      logConfiguration = {
        applicationInsightsConfiguration = {
          appId            = azurerm_application_insights.sre_agent[0].app_id
          connectionString = azurerm_application_insights.sre_agent[0].connection_string
        }
      }
      upgradeChannel        = "Stable"
      monthlyAgentUnitLimit = ${o.cap}
    }
  }
  response_export_values = ["properties.agentEndpoint"]
}

${readers("sre_agent", "azurerm_user_assigned_identity.sre_agent[0].principal_id", "local.sre_agent_on ? 1 : 0")}

# Connector queries run as the agent's system-assigned identity.
resource "azurerm_role_assignment" "sre_agent_system_reader" {
  count                = local.sre_agent_on ? 1 : 0
  scope                = local.rg_id
  role_definition_name = "Reader"
  principal_id         = azapi_resource.sre_agent[0].identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "sre_agent_system_logs" {
  count                = local.sre_agent_on ? 1 : 0
  scope                = local.rg_id
  role_definition_name = "Log Analytics Reader"
  principal_id         = azapi_resource.sre_agent[0].identity[0].principal_id
  principal_type       = "ServicePrincipal"
}

# Acknowledge and close the Azure Monitor alerts it investigates.
resource "azurerm_role_assignment" "sre_agent_alerts" {
  count                = local.sre_agent_on ? 1 : 0
  scope                = "/subscriptions/\${var.subscription_id}"
  role_definition_name = "Monitoring Contributor"
  principal_id         = azurerm_user_assigned_identity.sre_agent[0].principal_id
  principal_type       = "ServicePrincipal"
}
${
  o.high
    ? `
resource "azurerm_role_assignment" "sre_agent_contributor" {
  count                = local.sre_agent_on ? 1 : 0
  scope                = local.rg_id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.sre_agent[0].principal_id
  principal_type       = "ServicePrincipal"
}
`
    : ""
}
# Who approves its actions in Review mode. Azure Owner/Contributor don't carry the agent's data actions.
resource "azurerm_role_assignment" "sre_agent_admins" {
  count              = local.sre_agent_on && var.sre_agent_admin_group_id != "" ? 1 : 0
  scope              = azapi_resource.sre_agent[0].id
  role_definition_id = "/subscriptions/\${var.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/${ADMIN_ROLE}"
  principal_id       = var.sre_agent_admin_group_id
  principal_type     = "Group"
}

# The pipeline identity briefs the agent after apply (sre-agent/brief.sh), which needs the agent's data plane.
resource "azurerm_role_assignment" "sre_agent_pipeline" {
  count              = local.sre_agent_on ? 1 : 0
  scope              = azapi_resource.sre_agent[0].id
  role_definition_id = "/subscriptions/\${var.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/${ADMIN_ROLE}"
  principal_id       = data.azurerm_client_config.current.object_id
}
`,
  };
}

/* ---------------------------------------------------------------- the pack that briefs it ---------- */

export type PackFile = { path: string; content: string; purpose: string };

const fit = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 2).replace(/\n[^\n]*$/, "")}\n…`;

const nameOf = (id: string) => SERVICE_BY_ID.get(id)?.name ?? id;
const appServices = (selected: Selected[]) =>
  selected.filter(
    (s) =>
      ![
        "resource-group",
        "managed-identity",
        "security-baseline",
        "private-endpoints",
        "monitoring",
        "budget",
        "sre-agent",
      ].includes(s.id),
  );

/** What the service should look like if nothing has drifted: the design's invariants, one line each. */
function invariants(arch: Architecture): string[] {
  const { selected, topology } = arch;
  const out: string[] = [];
  for (const s of appServices(selected)) {
    const def = SERVICE_BY_ID.get(s.id);
    if (!def) continue;
    const bits: string[] = [];
    if (def.privateLink && topology.privateEndpoints)
      bits.push("reached through its private endpoint; public network access disabled");
    const set = Object.entries(s.settings)
      .filter(([k]) => !/^dev/.test(k))
      .map(([k, v]) => {
        const opt = def.options.find((x) => x.key === k);
        const label = (opt?.label ?? k).replace(/ · production$/, "");
        return `${label}: ${opt?.labels?.[v] ?? v}`;
      });
    if (set.length) bits.push(set.join(", "));
    out.push(`- ${def.name}: ${bits.join("; ") || "as deployed by the release"}.`);
  }
  if (!topology.publicAccess) out.push("- No public endpoints other than the designed edge.");
  return out;
}

export function srePack(product: string, version: string, arch: Architecture): PackFile[] {
  const review: Review = reviewWaf(arch);
  const flows: WorkloadFlow[] = workloadFlows(arch, arch.workload);
  const w = review.workload;
  const sre = sreSettings(arch.selected.find((s) => s.id === "sre-agent")?.settings);
  const slug = product.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const svc = appServices(arch.selected).map((s) => nameOf(s.id));
  const open = review.findings.filter((f) => f.result === "fail" || f.result === "warn");
  const traffic = flows.filter((f) => f.kind === "traffic" && f.available);
  const roles = flows.filter((f) => f.kind === "identity" && f.id !== "identity-attach");
  const logs = flows.filter((f) => f.kind === "logging" && f.available);

  const overview = fit(
    `# ${product} v${version}

${w.criticality[0]!.toUpperCase()}${w.criticality.slice(1).replace("-", " ")} workload. Availability target ${w.slo}%, recover within ${w.rtoMinutes} min, lose at most ${w.rpoMinutes} min of data. Data: ${w.data}. Users: ${w.audience}.

Services: ${svc.join(", ")}.
${arch.topology.publicAccess ? "Public entry through the designed edge only." : "Private: no public endpoints; data services only through private endpoints."}

How to work on this install:
- Compare what you find with architecture.md and the runbook; a difference from the design is drift, report it as such.
- Never take destructive actions without explicit approval${sre.mode === "Review" ? " (this agent runs in Review mode)" : ""}.
- Roll back by redeploying the previous release through the pipeline, not by changing resources by hand.
- Fixes to the design go back as a GitHub issue on the offering's repository.`,
    2000,
  );

  const architecture = fit(
    `# Architecture

Requests and calls:
${traffic.map((f) => `- ${f.title}`).join("\n")}

Identity: one user-assigned managed identity per install.
${roles.map((f) => `- ${f.title}`).join("\n")}

Diagnostics go to the install's Log Analytics workspace:
${logs.map((f) => `- ${f.title}`).join("\n")}`,
    1500,
  );

  const deployment = `# Deployment

Each release of ${product} is immutable. The pipeline plans, waits for production approval, applies the Terraform in waves (foundation, network and shared services, data, compute, ingress, protection), verifies policy and smoke tests, then briefs this agent.

To roll back: redeploy the previous release from the pipeline. Manual changes are drift and are reverted by the next deploy.
`;

  const runbook = `# ${product} v${version}: operations runbook

Generated from the design in Cloud Delivery. When a resource doesn't match this, it has drifted from the design.

## Targets
- Availability ${w.slo}% · RTO ${w.rtoMinutes} min · RPO ${w.rpoMinutes} min
- Criticality: ${w.criticality} · data: ${w.data} · audience: ${w.audience}

## What each service should look like
${invariants(arch).join("\n")}

## How traffic flows
${traffic.map((f) => `### ${f.title}\n${f.steps.map((s, i) => `${i + 1}. ${s.title}${s.via ? ` (${s.via})` : ""}`).join("\n")}`).join("\n\n")}

## Who can reach what
${roles.map((f) => `- ${f.title}: ${f.summary}`).join("\n") || "- The workload identity only."}

## Where to look
${logs.map((f) => `- ${f.title}`).join("\n")}

## Accepted risks at release
${open.length ? open.map((f) => `- [${f.result}] ${f.service ? `${nameOf(f.service)}: ` : ""}${f.rec.title} ${f.detail}`).join("\n") : "- None: every Well-Architected check passed."}
`;

  const drift = {
    name: "design-drift-check",
    description: `Daily check of ${product} against its design`,
    schedule: "0 7 * * *",
    prompt: `Compare every resource in the managed resource group with architecture.md and ${slug}-runbook.md. Report each difference from the design (public access, private endpoints, identities and roles, SKUs and zones, diagnostics), with the resource and what changed. Do not change anything.`,
    mode: "Review",
  };
  const targets = {
    name: "targets-weekly",
    description: `Weekly review of ${product} against its availability target`,
    schedule: "0 8 * * 1",
    prompt: `Summarize the last 7 days: incidents, alerts fired, availability against the ${w.slo}% target, and anything trending towards the accepted risks listed in ${slug}-runbook.md. Suggest design changes as GitHub issues; don't change resources.`,
    mode: "Review",
  };
  const yaml = (t: typeof drift) => `metadata:
  name: ${t.name}
spec:
  description: ${t.description}
  schedule: ${t.schedule}
  prompt: ${JSON.stringify(t.prompt)}
  enabled: true
  mode: ${t.mode}
`;
  const taskJson = (t: typeof drift) =>
    JSON.stringify({
      name: t.name,
      type: "ScheduledTask",
      tags: [],
      properties: {
        name: t.name,
        description: t.description,
        cronExpression: t.schedule,
        agentPrompt: t.prompt,
        agent: "",
        agentMode: t.mode,
        isEnabled: true,
      },
    });

  const brief = `#!/usr/bin/env bash
# Briefs this install's Azure SRE Agent with the design. Runs in the pipeline after terraform apply, as the
# pipeline identity (made SRE Agent Administrator on the agent by the Terraform).
# Calls are the ones Microsoft's own templates make (microsoft/sre-agent, sreagent-templates/bicep/apply-extras.sh).
set -euo pipefail
cd "$(dirname "$0")"
${
  sre.existing
    ? `AGENT_ID="\${SRE_AGENT_ID:?set SRE_AGENT_ID to the customer's agent}"
RG_ID="$(terraform -chdir=.. output -raw resource_group_id)"

# Add this install to the agent's managed resources, keeping the ones it already has.
az rest -m GET --url "https://management.azure.com\${AGENT_ID}?api-version=${API}" \\
  | jq --arg rg "$RG_ID" '{properties:{knowledgeGraphConfiguration:(.properties.knowledgeGraphConfiguration | .managedResources = (((.managedResources // []) + [$rg]) | unique))}}' > /tmp/sre-patch.json
az rest -m PATCH --url "https://management.azure.com\${AGENT_ID}?api-version=${API}" --body @/tmp/sre-patch.json >/dev/null
ENDPOINT="$(az rest -m GET --url "https://management.azure.com\${AGENT_ID}?api-version=${API}" --query properties.agentEndpoint -o tsv)"`
    : `ENDPOINT="$(terraform -chdir=.. output -raw sre_agent_endpoint)"
[ -n "$ENDPOINT" ] || { echo "No SRE Agent on this install (dev/test installs don't get one)."; exit 0; }`
}
TOKEN="$(az account get-access-token --resource https://azuresre.dev --query accessToken -o tsv)"

# Documents, indexed for search.
for f in knowledge/*.md; do
  curl -sSf -X POST "$ENDPOINT/api/v1/AgentMemory/upload?triggerIndexing=true" \\
    -H "Authorization: Bearer $TOKEN" \\
    -F "files=@$f;filename=$(basename "$f");type=text/markdown" >/dev/null
  echo "knowledge: $f"
done
${
  sre.existing
    ? `# A shared agent keeps its own always-loaded overview; this install's summary goes in as a document instead.
cp synthesized-knowledge/overview.md /tmp/${slug}-overview.md
curl -sSf -X POST "$ENDPOINT/api/v1/AgentMemory/upload?triggerIndexing=true" \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "files=@/tmp/${slug}-overview.md;filename=${slug}-overview.md;type=text/markdown" >/dev/null`
    : `# overview.md is always in the agent's context; architecture.md and deployment.md are its topic files.
tar -czf /tmp/sre-synth.tar.gz -C synthesized-knowledge .
curl -sSf -X POST "$ENDPOINT/api/v1/WorkspaceMemory/synthesized-knowledge" \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/gzip" \\
  --data-binary @/tmp/sre-synth.tar.gz >/dev/null
echo "synthesized knowledge: overview, architecture, deployment"`
}

# Scheduled checks against the design.
${[drift, targets]
  .map(
    (t) => `curl -sSf -X PUT "$ENDPOINT/api/v2/extendedAgent/scheduledtasks/${t.name}" \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  --data '${taskJson(t).replace(/'/g, "'\\''")}' >/dev/null
echo "scheduled task: ${t.name}"`,
  )
  .join("\n")}
`;

  return [
    {
      path: "sre-agent/synthesized-knowledge/overview.md",
      content: overview,
      purpose:
        "Always in the agent's context: targets, services, and how to behave on this install.",
    },
    {
      path: "sre-agent/synthesized-knowledge/architecture.md",
      content: architecture,
      purpose: "Components and connections: the flows, roles and diagnostics from the design.",
    },
    {
      path: "sre-agent/synthesized-knowledge/deployment.md",
      content: deployment,
      purpose: "How releases ship and roll back.",
    },
    {
      path: `sre-agent/knowledge/${slug}-runbook.md`,
      content: runbook,
      purpose:
        "What each service should look like, every flow step by step, and the accepted risks.",
    },
    {
      path: `sre-agent/knowledge/${slug}-design.md`,
      content: designDocument(product, arch, review, flows),
      purpose: "The full design document, the same one the design review downloads.",
    },
    {
      path: "sre-agent/scheduled-tasks/design-drift-check.yaml",
      content: yaml(drift),
      purpose: "Daily at 07:00 UTC: report differences from the design, change nothing.",
    },
    {
      path: "sre-agent/scheduled-tasks/targets-weekly.yaml",
      content: yaml(targets),
      purpose: "Mondays at 08:00 UTC: availability against the target, and the accepted risks.",
    },
    {
      path: "sre-agent/brief.sh",
      content: brief,
      purpose:
        "Run by the pipeline after apply: uploads the knowledge and creates the scheduled tasks.",
    },
  ];
}
