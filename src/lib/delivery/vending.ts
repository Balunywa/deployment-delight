/*
 * cd-vending: one request file per unit (requests/<kind>/<slug>.yaml) holding the unit's resolved spec — the exact
 * repository settings, environments, reviewers, identities, scopes and state it gets. Reviewers approve that file.
 * One static Terraform configuration reads every request and creates what it describes, like AFT's account
 * requests and Azure subscription vending ("one file for each subscription request").
 *
 * Vending creates only what lives with the ISV. Identities that live in a customer's tenant are created when the
 * customer's admin approves the install link, and their client IDs are added to the request afterwards.
 */
import { type Platform, type UnitSpec, isPlatformKind } from "./model";
import { toYaml } from "./scaffold";

export type VendingFile = { path: string; content: string };

export type RequestMeta = {
  requestedBy: string;
  reason: string;
  links: Record<string, string>;
};

export const requestPath = (spec: UnitSpec) => `requests/${spec.kind}/${spec.slug}.yaml`;

export function requestFile(spec: UnitSpec, meta: RequestMeta): VendingFile {
  return {
    path: requestPath(spec),
    content: [
      `# ${requestPath(spec)} — vending request for ${spec.repository.owner}/${spec.repository.name}`,
      `# Requested by ${meta.requestedBy}: ${meta.reason}`,
      "# Merging creates everything below after two approvals on the vend environment.",
      toYaml({ ...spec, request: meta }),
      "",
    ].join("\n"),
  };
}

const HCL_VERSIONS = `terraform {
  required_version = ">= 1.9"
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.6"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.50"
    }
  }
  # State: the vending container in the ISV state account (TF_STATE_* on the vend environments).
  backend "azurerm" {}
}

# Owner and token come from GITHUB_OWNER and GITHUB_TOKEN (a GitHub App installation token).
provider "github" {}

provider "azurerm" {
  features {}
  storage_use_azuread = true
  subscription_id     = var.platform_subscription_id
}
`;

const HCL_VARIABLES = `variable "platform_subscription_id" {
  type        = string
  description = "ISV platform subscription: vending identities and the state account live here."
}

variable "identity_resource_group_name" {
  type        = string
  description = "Resource group for unit identities created in the ISV tenant."
}

variable "state_account_id" {
  type        = string
  description = "Resource ID of the ISV state storage account."
}

variable "location" {
  type    = string
  default = "eastus2"
}
`;

// Reader, Storage Blob Data Contributor, Storage Blob Data Reader, Key Vault Secrets User.
const DELEGABLE = [
  "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
  "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
  "4633458b-17de-408a-b874-0445c86b69e6",
];

const HCL_MAIN = `locals {
  request_files = fileset("\${path.module}/../requests", "**/*.yaml")
  requests      = [for f in local.request_files : yamldecode(file("\${path.module}/../requests/\${f}"))]

  # Platform repositories are bootstrapped once; vending manages landing zones, solutions and customers.
  units = { for r in local.requests : r.repository.name => r if contains(["landing-zone", "solution", "customer"], r.kind) }

  environments = merge({}, [
    for repo, r in local.units : { for e in r.environments : "\${repo}/\${e.name}" => merge(e, { repo = repo }) }
  ]...)

  deployment_policies = merge({}, [
    for k, e in local.environments : {
      for ref in e.deploymentRefs : "\${k}/\${ref}" => {
        repo        = e.repo
        environment = e.name
        branch      = startswith(ref, "refs/heads/") ? trimprefix(ref, "refs/heads/") : null
        tag         = startswith(ref, "refs/tags/") ? trimprefix(ref, "refs/tags/") : null
      } if ref != "*"
    }
  ]...)

  variables = merge({}, [
    for k, e in local.environments : {
      for name, value in e.variables : "\${k}/\${name}" => { repo = e.repo, environment = e.name, name = name, value = value }
    }
  ]...)

  # Identities that live with the ISV. Customer-tenant identities are created at /connect.
  identities = merge({}, [
    for repo, r in local.units : {
      for i in r.identities : "\${repo}/\${i.environment}" => merge(i, { repo = repo }) if i.createdBy == "vending"
    }
  ]...)

  role_assignments = merge({}, [
    for k, i in local.identities : {
      for role in i.roles : "\${k}/\${split(" (", role)[0]}" => {
        identity    = k
        scope       = i.scope
        role        = split(" (", role)[0]
        conditioned = startswith(role, "Role Based Access Control Administrator")
      } if !strcontains(role, "state container") && !strcontains(i.scope, "<")
    }
  ]...)

  team_access = merge({}, [
    for repo, r in local.units : { for t in r.repository.teams : "\${repo}/\${t.team}" => merge(t, { repo = repo }) }
  ]...)

  reviewer_teams = toset(flatten([for e in local.environments : e.reviewers]))

  state_containers = toset(flatten([
    for r in local.units : [for s in r.state : s.container if s.location == "isv"]
  ]))

  state_access = merge({}, [
    for r in local.units : {
      for pair in setproduct([for s in r.state : s if s.location == "isv"], [for i in r.identities : i if i.createdBy == "vending"]) :
      "\${pair[0].container}/\${pair[1].name}" => {
        container = pair[0].container
        identity  = "\${r.repository.name}/\${pair[1].environment}"
      } if contains(pair[0].readers, pair[1].name)
    }
  ]...)

  delegable_roles = "${DELEGABLE.join(", ")}"
  rbac_condition  = <<-EOT
    (
      (!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'}))
      OR
      (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {\${local.delegable_roles}})
    )
    AND
    (
      (!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'}))
      OR
      (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {\${local.delegable_roles}})
    )
  EOT
}

data "github_team" "reviewer" {
  for_each = local.reviewer_teams
  slug     = each.value
}

data "azurerm_client_config" "current" {}

# ---------------------------------------------------------------- repositories

resource "github_repository" "unit" {
  for_each               = local.units
  name                   = each.key
  description            = "\${each.value.name} · Cloud Delivery \${each.value.kind}"
  visibility             = each.value.repository.visibility
  auto_init              = true
  has_issues             = true
  has_wiki               = false
  allow_merge_commit     = false
  allow_rebase_merge     = false
  allow_squash_merge     = true
  delete_branch_on_merge = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository_vulnerability_alerts" "unit" {
  for_each   = local.units
  repository = github_repository.unit[each.key].name
  enabled    = true
}

resource "github_repository_custom_property" "unit" {
  for_each = merge({}, [
    for repo, r in local.units : { for k, v in r.repository.customProperties : "\${repo}/\${k}" => { repo = repo, name = k, value = v } }
  ]...)
  repository     = github_repository.unit[each.value.repo].name
  property_name  = each.value.name
  property_type  = "string"
  property_value = [each.value.value]
}

# Cloud identities trust repository + environment + the pinned template workflow, nothing broader.
resource "github_actions_repository_oidc_subject_claim_customization_template" "unit" {
  for_each           = local.units
  repository         = github_repository.unit[each.key].name
  use_default        = false
  include_claim_keys = ["repo", "context", "job_workflow_ref"]
}

resource "github_team_repository" "unit" {
  for_each   = local.team_access
  team_id    = each.value.team
  repository = github_repository.unit[each.value.repo].name
  permission = each.value.permission
}

# ---------------------------------------------------------------- environments

resource "github_repository_environment" "unit" {
  for_each            = local.environments
  repository          = github_repository.unit[each.value.repo].name
  environment         = each.value.name
  wait_timer          = each.value.waitMinutes
  can_admins_bypass   = false
  prevent_self_review = each.value.preventSelfReview

  dynamic "reviewers" {
    for_each = length(each.value.reviewers) > 0 ? [1] : []
    content {
      teams = [for t in each.value.reviewers : data.github_team.reviewer[t].id]
    }
  }

  dynamic "deployment_branch_policy" {
    for_each = contains(each.value.deploymentRefs, "*") ? [] : [1]
    content {
      protected_branches     = false
      custom_branch_policies = true
    }
  }
}

resource "github_repository_environment_deployment_policy" "unit" {
  for_each       = local.deployment_policies
  repository     = github_repository.unit[each.value.repo].name
  environment    = github_repository_environment.unit["\${each.value.repo}/\${each.value.environment}"].environment
  branch_pattern = each.value.branch
  tag_pattern    = each.value.tag
}

resource "github_actions_environment_variable" "unit" {
  for_each      = local.variables
  repository    = github_repository.unit[each.value.repo].name
  environment   = github_repository_environment.unit["\${each.value.repo}/\${each.value.environment}"].environment
  variable_name = each.value.name
  value         = each.value.value
}

# ---------------------------------------------------------------- identities (ISV tenant)

resource "azurerm_user_assigned_identity" "unit" {
  for_each            = local.identities
  name                = each.value.name
  resource_group_name = var.identity_resource_group_name
  location            = var.location
  tags = {
    "cd-unit"        = each.value.repo
    "cd-environment" = each.value.environment
  }
}

resource "azurerm_federated_identity_credential" "unit" {
  for_each            = local.identities
  name                = "github-\${each.value.environment}"
  resource_group_name = var.identity_resource_group_name
  parent_id           = azurerm_user_assigned_identity.unit[each.key].id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = "https://token.actions.githubusercontent.com"
  subject             = each.value.subject
}

resource "github_actions_environment_variable" "client_id" {
  for_each      = local.identities
  repository    = github_repository.unit[each.value.repo].name
  environment   = github_repository_environment.unit[each.key].environment
  variable_name = "AZURE_CLIENT_ID"
  value         = azurerm_user_assigned_identity.unit[each.key].client_id
}

resource "github_actions_environment_variable" "tenant_id" {
  for_each      = { for k, i in local.identities : k => i if !contains(keys(local.environments[k].variables), "AZURE_TENANT_ID") }
  repository    = github_repository.unit[each.value.repo].name
  environment   = github_repository_environment.unit[each.key].environment
  variable_name = "AZURE_TENANT_ID"
  value         = data.azurerm_client_config.current.tenant_id
}

resource "azurerm_role_assignment" "unit" {
  for_each             = local.role_assignments
  scope                = each.value.scope
  role_definition_name = each.value.role
  principal_id         = azurerm_user_assigned_identity.unit[each.value.identity].principal_id
  principal_type       = "ServicePrincipal"
  condition            = each.value.conditioned ? local.rbac_condition : null
  condition_version    = each.value.conditioned ? "2.0" : null
}

# ---------------------------------------------------------------- Terraform state (ISV state account)

resource "azurerm_storage_container" "state" {
  for_each              = local.state_containers
  name                  = each.value
  storage_account_id    = var.state_account_id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "state" {
  for_each             = local.state_access
  scope                = "\${var.state_account_id}/blobServices/default/containers/\${azurerm_storage_container.state[each.value.container].name}"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.unit[each.value.identity].principal_id
  principal_type       = "ServicePrincipal"
}

# ---------------------------------------------------------------- guardrails every unit repository gets

resource "github_organization_ruleset" "units" {
  name        = "cd-units-main"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
    repository_name {
      include = ["lz-*", "sol-*", "cust-*"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true
    pull_request {
      required_approving_review_count   = 1
      require_code_owner_review         = true
      dismiss_stale_reviews_on_push     = true
      require_last_push_approval        = true
      required_review_thread_resolution = true
    }
  }
}
`;

const HCL_OUTPUTS = `output "units" {
  description = "Vended repositories."
  value       = { for k, r in github_repository.unit : k => r.html_url }
}

output "identities" {
  description = "Client IDs of identities created in the ISV tenant."
  value       = { for k, i in azurerm_user_assigned_identity.unit : k => i.client_id }
}
`;

export function vendingRepo(p: Platform, requests: VendingFile[]): VendingFile[] {
  return [
    {
      path: "README.md",
      content: `# cd-vending

One request file per unit, under \`requests/<kind>/<slug>.yaml\`. A request is the unit's resolved spec: its
repository, custom properties, team access, environments (reviewers, wait timers, allowed refs), cloud identities
(scope, roles, federated subject) and Terraform state. Reviewers approve exactly what will be created.

- Pull request: \`terraform plan\` of every request, posted to the run summary.
- Merge to main: \`terraform apply\` behind the \`vend\` environment (${p.teams.platform} + ${p.teams.security}).
- The control plane opens these pull requests; people can too.

After a repository exists, the control plane opens its first pull request with the unit's content (configuration,
rendered Terraform, caller workflows, CODEOWNERS), reviewed by the unit's owners like any other change.

Bootstrap (once, by an org admin): org custom properties \`cd-unit\`, \`cd-tenant\`, \`cd-owner-team\`,
\`cd-criticality\`; the Cloud Delivery GitHub App; this repository's vend identity; the ISV state account.

Generated by Cloud Delivery (\`src/lib/delivery/vending.ts\`).
`,
    },
    { path: "terraform/versions.tf", content: HCL_VERSIONS },
    { path: "terraform/variables.tf", content: HCL_VARIABLES },
    { path: "terraform/main.tf", content: HCL_MAIN },
    { path: "terraform/outputs.tf", content: HCL_OUTPUTS },
    {
      path: "terraform/vending.auto.tfvars.json",
      content: `${JSON.stringify(
        {
          platform_subscription_id: p.stateSubscriptionId,
          identity_resource_group_name: "rg-cd-identities",
          state_account_id: `/subscriptions/${p.stateSubscriptionId}/resourceGroups/${p.stateResourceGroup}/providers/Microsoft.Storage/storageAccounts/${p.stateAccount}`,
        },
        null,
        2,
      )}\n`,
    },
    {
      path: ".github/workflows/vend.yml",
      content: `name: vend
on:
  pull_request:
    paths: ["requests/**", "terraform/**"]
  push:
    branches: [main]
    paths: ["requests/**", "terraform/**"]
  workflow_dispatch: {}
permissions: {}
jobs:
  vend:
    uses: ${p.org}/${p.templatesRepo}/.github/workflows/vend.yml@${p.templatesRef}
    secrets: inherit
    permissions:
      id-token: write
      contents: read
    with:
      apply: \${{ github.event_name != 'pull_request' }}
`,
    },
    {
      path: ".github/CODEOWNERS",
      content: `* @${p.org}/${p.teams.platform} @${p.org}/${p.teams.security}\n/terraform/ @${p.org}/${p.teams.platform} @${p.org}/${p.teams.security} @${p.org}/${p.teams.admins}\n`,
    },
    ...requests,
  ];
}

/** Units vending manages (platform repositories are bootstrapped once). */
export const vendable = (spec: UnitSpec) => !isPlatformKind(spec.kind);
