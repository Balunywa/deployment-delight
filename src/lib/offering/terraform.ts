/*
 * Turns an offering's architecture into a deployable Terraform root module for one install environment
 * (azurerm 4.x). The same module deploys every customer and every environment; what differs is the
 * variables file: subscription, region, environment (sizing), resource group, network and platform inputs.
 *
 * Landing-zone aware: subnets are created with their NSG in one call (the ALZ "subnets must have an NSG"
 * deny policy), private DNS can be local, the platform's zones, or left to the platform's DINE policy, and
 * egress can be forced through the customer's firewall.
 */
import {
  SERVICE_BY_ID,
  type Selected,
  type Topology,
  inputsFor,
  monthlyEstimate,
} from "@/lib/catalog";

import { aiFoundry, aiSearch, dataExplorer, eventHubs, iotHub, serviceBus } from "./ai-services";
import { aks, appService, containerApps, functions } from "./compute-services";
import { cosmos, keyVault, postgres, redis, sql, storage } from "./data-services";
import {
  apim,
  appGateway,
  appInsights,
  budget,
  defender,
  frontDoor,
  policyPack,
} from "./edge-services";
import {
  DELEGATION_ACTIONS,
  SUBNETS,
  type ServiceTf,
  type SubnetKey,
  fmtHcl,
  list,
  q,
} from "./hcl";

export const AZURERM_VERSION = "~> 4.50";

const GENERATORS: Record<string, (s: Record<string, string>) => ServiceTf> = {
  "key-vault": keyVault,
  storage,
  postgres,
  sql,
  cosmos,
  redis,
  "ai-foundry": aiFoundry,
  "ai-search": aiSearch,
  "data-explorer": dataExplorer,
  "iot-hub": iotHub,
  "event-hubs": eventHubs,
  "service-bus": serviceBus,
  aks,
  "container-apps": containerApps,
  "app-service": appService,
  functions,
  apim,
  "app-gateway": appGateway,
  "front-door": frontDoor,
  "app-insights": appInsights,
  defender,
  budget,
  "security-baseline": policyPack,
};

/** Services the foundation file always covers (resource group, identity, network, monitoring). */
const FOUNDATION = new Set([
  "resource-group",
  "managed-identity",
  "network-spoke",
  "private-endpoints",
  "monitoring",
]);

export type TfFile = { path: string; content: string };

export function offeringTerraform(opts: {
  product: string;
  selected: Selected[];
  topology: Topology;
}): TfFile[] {
  const { selected, topology } = opts;
  const has = (id: string) => selected.some((s) => s.id === id);
  const generated = selected
    .filter((s) => GENERATORS[s.id])
    .map((s) => ({ id: s.id, tf: GENERATORS[s.id]!(s.settings) }));
  const subnets = new Set<SubnetKey>(generated.flatMap((g) => g.tf.subnets ?? []));
  if (!topology.privateEndpoints) subnets.delete("endpoints");
  const zones = [...new Set(generated.flatMap((g) => g.tf.zones ?? []))].sort();
  const providers = [...new Set(generated.flatMap((g) => g.tf.providers ?? []))].sort();
  const mon = selected.find((s) => s.id === "monitoring")?.settings ?? {};
  const days = (v: string | undefined, d: number) => Number(v?.match(/\d+/)?.[0] ?? d);
  const retention = days(mon["retention"], 90);
  const devRetention = days(mon["devRetention"], 30);
  const inputs = inputsFor(selected, topology);

  const appHostname = has("container-apps")
    ? "azurerm_container_app.app.ingress[0].fqdn"
    : has("app-service")
      ? "azurerm_linux_web_app.this.default_hostname"
      : has("functions")
        ? "local.functions_hostname"
        : '""';

  const files: TfFile[] = [];

  files.push({
    path: "versions.tf",
    content: `terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "${AZURERM_VERSION}"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
`,
  });

  files.push({
    path: "providers.tf",
    content: `provider "azurerm" {
  subscription_id                 = var.subscription_id
  storage_use_azuread             = true
  resource_provider_registrations = "core"
  resource_providers_to_register  = ${list(providers)}

  features {
    resource_group {
      # The install owns its resource group; removing the install removes everything in it.
      prevent_deletion_if_contains_resources = false
    }
    key_vault {
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
    cognitive_account {
      purge_soft_delete_on_destroy = true
    }
    storage {
      # Storage is private behind endpoints; manage it through Azure Resource Manager only.
      data_plane_available = false
    }
  }
}
`,
  });

  const v = (name: string, type: string, description: string, def?: string, extra = "") =>
    `variable "${name}" {
  type        = ${type}
  description = ${q(description)}${def !== undefined ? `\n  default     = ${def}` : ""}${extra}
}
`;
  files.push({
    path: "variables.tf",
    content: [
      v("subscription_id", "string", "Subscription the install is deployed into."),
      v(
        "location",
        "string",
        "Azure region.",
        undefined,
        `\n\n  validation {\n    condition     = contains(var.allowed_regions, var.location)\n    error_message = "This offering supports: \${join(", ", var.allowed_regions)}."\n  }`,
      ),
      v(
        "allowed_regions",
        "list(string)",
        "Regions the offering supports.",
        list(topology.regions),
      ),
      v(
        "install_name",
        "string",
        "Customer code and environment, e.g. metro-energy-prod. Used in every resource name.",
        undefined,
        `\n\n  validation {\n    condition     = can(regex("^[a-z][a-z0-9-]{2,38}[a-z0-9]$", var.install_name))\n    error_message = "Lowercase letters, numbers and hyphens, 4 to 40 characters."\n  }`,
      ),
      v(
        "environment",
        "string",
        "dev, test, qa, uat, stg or prod. Production gets the architecture's sizing; other environments are sized down.",
        '"dev"',
        `\n\n  validation {\n    condition     = contains(["dev", "test", "qa", "uat", "stg", "prod"], var.environment)\n    error_message = "Use dev, test, qa, uat, stg or prod."\n  }`,
      ),
      v(
        "resource_group_name",
        "string",
        "Resource group for the install. Empty: rg-<install_name>.",
        '""',
      ),
      v(
        "create_resource_group",
        "bool",
        "Create the resource group (true), or deploy into one that already exists (false).",
        "true",
      ),
      v(
        "address_space",
        "string",
        "Spoke address space, /22 or larger. Must not overlap the hub or other spokes.",
        '"10.60.0.0/22"',
        `\n\n  validation {\n    condition     = can(cidrhost(var.address_space, 0)) && tonumber(split("/", var.address_space)[1]) <= 22\n    error_message = "Use a valid /22 or larger range."\n  }`,
      ),
      v(
        "public_access",
        "bool",
        "Allow public ingress to the app tier.",
        String(topology.publicAccess),
      ),
      v(
        "private_endpoints",
        "bool",
        "Private endpoints for every data service, with public network access disabled.",
        String(topology.privateEndpoints),
      ),
      v(
        "hub_virtual_network_id",
        "string",
        "Hub VNet to peer with (the hub side is the platform team's).",
        '""',
      ),
      v(
        "firewall_private_ip",
        "string",
        "Hub firewall IP: when set, all egress is routed through it.",
        '""',
      ),
      v(
        "private_dns_mode",
        "string",
        "local: zones in the install. platform: the hub's zones (set private_dns_zone_resource_group_id). policy: ALZ policy registers records.",
        topology.landing === "existing-customer-hub" ? '"policy"' : '"local"',
        `\n\n  validation {\n    condition     = contains(["local", "platform", "policy"], var.private_dns_mode)\n    error_message = "Use local, platform or policy."\n  }`,
      ),
      v(
        "private_dns_zone_resource_group_id",
        "string",
        "Resource group ID of the platform's private DNS zones.",
        '""',
      ),
      v(
        "log_analytics_workspace_id",
        "string",
        "Existing Log Analytics workspace (the platform's). Empty: the install creates its own.",
        '""',
      ),
      v("log_retention_days", "number", "Log retention in production.", String(retention)),
      v("dev_log_retention_days", "number", "Log retention in dev/test.", String(devRetention)),
      v("tags", "map(string)", "Extra tags on every resource.", "{}"),
      v(
        "ai_model_versions",
        "map(string)",
        "Model version per AI deployment. Empty: the region's default version.",
        "{}",
      ),
      v(
        "app_image",
        "string",
        "Container image the first revision runs.",
        '"mcr.microsoft.com/k8se/quickstart:latest"',
      ),
      v("cluster_admin_group_id", "string", "Entra group granted AKS cluster admin.", '""'),
      v(
        "sql_admin_group_id",
        "string",
        "Entra group that administers Azure SQL. Empty: the install identity.",
        '""',
      ),
      v(
        "apim_publisher_name",
        "string",
        "Publisher shown on the API developer portal.",
        q(opts.product),
      ),
      v(
        "apim_publisher_email",
        "string",
        "Publisher email for API Management.",
        '"api@example.com"',
      ),
      v("custom_domain", "string", "Hostname users reach the product on.", '""'),
      v(
        "monthly_budget",
        "number",
        "Monthly budget for a production install.",
        String(Math.ceil(monthlyEstimate(selected) * 1.2)),
      ),
      v(
        "budget_contact_emails",
        "list(string)",
        "Who gets budget alerts, besides subscription owners.",
        "[]",
      ),
      v("enable_defender", "bool", "Turn on Defender plans on the subscription.", "true"),
    ].join("\n"),
  });

  const subnetBlocks = [...subnets]
    .sort((a, b) => SUBNETS[a].index * 16 - SUBNETS[b].index * 16 || a.localeCompare(b))
    .map((k) => {
      const sn = SUBNETS[k];
      const lines = [
        `  subnet {`,
        `    name             = "${sn.name}"`,
        `    address_prefixes = [cidrsubnet(var.address_space, ${sn.newbits}, ${sn.index})]`,
        `    security_group   = azurerm_network_security_group.${k}.id`,
      ];
      if (sn.udr) lines.push(`    route_table_id   = one(azurerm_route_table.egress[*].id)`);
      if (k === "endpoints") lines.push(`    private_endpoint_network_policies = "Enabled"`);
      if (sn.delegation)
        lines.push(
          `\n    delegation {`,
          `      name = "delegation"`,
          `      service_delegation {`,
          `        name    = "${sn.delegation}"`,
          `        actions = ${list(DELEGATION_ACTIONS[sn.delegation] ?? [])}`,
          `      }`,
          `    }`,
        );
      lines.push(`  }`);
      return lines.join("\n");
    });

  const nsgs = [...subnets]
    .map((k) => {
      const rules =
        k === "appgw"
          ? `
  security_rule {
    name                       = "AllowGatewayManager"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "65200-65535"
    source_address_prefix      = "GatewayManager"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowWebFromInternet"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["80", "443"]
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowAzureLoadBalancer"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }
`
          : "";
      return `resource "azurerm_network_security_group" "${k}" {
  name                = "nsg-\${local.name}-${k}"
  location            = var.location
  resource_group_name = local.rg_name
  tags                = local.tags
${rules}}
${`
resource "azurerm_monitor_diagnostic_setting" "nsg_${k}" {
  name                       = "diag-to-law"
  target_resource_id         = azurerm_network_security_group.${k}.id
  log_analytics_workspace_id = local.law_id

  enabled_log {
    category_group = "allLogs"
  }
}
`}`;
    })
    .join("\n");

  files.push({
    path: "main.tf",
    content: `# ${opts.product} — one install environment. Generated from the offering; customer differences are
# variables, never forks.

data "azurerm_client_config" "current" {}

# Keeps globally unique names (storage, Key Vault, databases) stable for the life of the install.
resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

locals {
  prod    = var.environment == "prod"
  name    = var.install_name
  short   = trim(substr(var.install_name, 0, 14), "-")
  compact = substr(replace(var.install_name, "-", ""), 0, 14)
  tags = merge(var.tags, {
    "managed-by"     = "cloud-delivery"
    "cd-product"     = ${q(opts.product)}
    "cd-install"     = var.install_name
    "cd-environment" = var.environment
  })
  requested_rg_name = var.resource_group_name != "" ? var.resource_group_name : "rg-\${var.install_name}"
}

# ---------------------------------------------------------------- resource group
# New installs get their own resource group; re-deploys keep it (it's in state), and installs into a
# customer-provided group read it instead.
resource "azurerm_resource_group" "this" {
  count    = var.create_resource_group ? 1 : 0
  name     = local.requested_rg_name
  location = var.location
  tags     = local.tags
}

data "azurerm_resource_group" "existing" {
  count = var.create_resource_group ? 0 : 1
  name  = local.requested_rg_name
}

locals {
  rg_name = var.create_resource_group ? azurerm_resource_group.this[0].name : data.azurerm_resource_group.existing[0].name
  rg_id   = var.create_resource_group ? azurerm_resource_group.this[0].id : data.azurerm_resource_group.existing[0].id
}

# ---------------------------------------------------------------- identity
# Every service runs as this identity; access is granted with Azure roles, never keys or passwords.
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-\${local.name}"
  location            = var.location
  resource_group_name = local.rg_name
  tags                = local.tags
}

# ---------------------------------------------------------------- monitoring
resource "azurerm_log_analytics_workspace" "this" {
  count               = var.log_analytics_workspace_id == "" ? 1 : 0
  name                = "log-\${local.name}"
  location            = var.location
  resource_group_name = local.rg_name
  sku                 = "PerGB2018"
  retention_in_days   = local.prod ? var.log_retention_days : var.dev_log_retention_days
  tags                = local.tags
}

locals {
  law_id                         = var.log_analytics_workspace_id != "" ? var.log_analytics_workspace_id : azurerm_log_analytics_workspace.this[0].id
  app_insights_connection_string = ${has("app-insights") ? "azurerm_application_insights.this.connection_string" : '""'}
  app_hostname                   = ${appHostname}
}

# ---------------------------------------------------------------- network
${nsgs}
resource "azurerm_route_table" "egress" {
  count                         = var.firewall_private_ip != "" ? 1 : 0
  name                          = "rt-\${local.name}"
  location                      = var.location
  resource_group_name           = local.rg_name
  bgp_route_propagation_enabled = false
  tags                          = local.tags

  route {
    name                   = "default-via-firewall"
    address_prefix         = "0.0.0.0/0"
    next_hop_type          = "VirtualAppliance"
    next_hop_in_ip_address = var.firewall_private_ip
  }
}

# Subnets are declared inline so each is created together with its NSG — landing zone policy denies
# subnets without one.
resource "azurerm_virtual_network" "this" {
  name                = "vnet-\${local.name}"
  location            = var.location
  resource_group_name = local.rg_name
  address_space       = [var.address_space]
  tags                = local.tags
${subnetBlocks.length ? "\n" + subnetBlocks.join("\n\n") + "\n" : ""}}

locals {
  subnet_ids = { for s in azurerm_virtual_network.this.subnet : s.name => s.id }
}

resource "azurerm_virtual_network_peering" "to_hub" {
  count                        = var.hub_virtual_network_id != "" ? 1 : 0
  name                         = "peer-to-hub"
  resource_group_name          = local.rg_name
  virtual_network_name         = azurerm_virtual_network.this.name
  remote_virtual_network_id    = var.hub_virtual_network_id
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  use_remote_gateways          = false
}

resource "azurerm_monitor_diagnostic_setting" "vnet" {
  name                       = "diag-to-law"
  target_resource_id         = azurerm_virtual_network.this.id
  log_analytics_workspace_id = local.law_id

  enabled_metric {
    category = "AllMetrics"
  }
}

# ---------------------------------------------------------------- private DNS
locals {
  dns_zones = ${zones.length ? `[\n${zones.map((z) => `    ${q(z)},`).join("\n")}\n  ]` : "[]"}
}

resource "azurerm_private_dns_zone" "this" {
  for_each            = var.private_endpoints && var.private_dns_mode == "local" ? toset(local.dns_zones) : toset([])
  name                = each.value
  resource_group_name = local.rg_name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  for_each              = azurerm_private_dns_zone.this
  name                  = "link-\${local.name}"
  resource_group_name   = local.rg_name
  private_dns_zone_name = each.value.name
  virtual_network_id    = azurerm_virtual_network.this.id
  registration_enabled  = false
  tags                  = local.tags
}

locals {
  dns_zone_ids = var.private_dns_mode == "platform" ? {
    for z in local.dns_zones : z => "\${var.private_dns_zone_resource_group_id}/providers/Microsoft.Network/privateDnsZones/\${z}"
  } : { for k, z in azurerm_private_dns_zone.this : k => z.id }
}
`,
  });

  for (const g of generated)
    files.push({
      path: `${g.id}.tf`,
      content: `# ${SERVICE_BY_ID.get(g.id)?.name ?? g.id}\n${g.tf.body}`,
    });

  const outputs: Record<string, string> = {
    resource_group_name: "local.rg_name",
    resource_group_id: "local.rg_id",
    identity_client_id: "azurerm_user_assigned_identity.app.client_id",
    identity_principal_id: "azurerm_user_assigned_identity.app.principal_id",
    virtual_network_id: "azurerm_virtual_network.this.id",
    log_analytics_workspace_id: "local.law_id",
    ...Object.assign({}, ...generated.map((g) => g.tf.outputs ?? {})),
  };
  files.push({
    path: "outputs.tf",
    content: Object.entries(outputs)
      .map(
        ([k, e]) =>
          `output "${k}" {\n  value${k.includes("connection_string") ? "     = " + e + "\n  sensitive = true" : " = " + e}\n}\n`,
      )
      .join("\n"),
  });

  files.push({
    path: "README.md",
    content: `# ${opts.product}

Generated Terraform (azurerm ${AZURERM_VERSION}) for one install environment. Every customer and every
environment uses this module; only the variables differ.

| Service | What it gets |
|---|---|
${selected
  .filter((s) => !FOUNDATION.has(s.id) || s.id === "monitoring")
  .map(
    (s) =>
      `| ${SERVICE_BY_ID.get(s.id)?.name ?? s.id} | ${Object.values(s.settings).join(", ") || "defaults"} |`,
  )
  .join("\n")}

Always on: its own managed identity (roles, no keys), diagnostics to Log Analytics, NSGs on every subnet,
${topology.privateEndpoints ? "private endpoints with public network access disabled, " : ""}TLS 1.2+, and tags for cost and ownership.

Production and dev/test installs each use the SKUs chosen for them in the offering (dev/test runs single
zone, with shorter retention).

Customer inputs: ${inputs.map((i) => i.label).join(", ")}.
`,
  });

  return files.map((f) => (f.path.endsWith(".tf") ? { ...f, content: fmtHcl(f.content) } : f));
}
