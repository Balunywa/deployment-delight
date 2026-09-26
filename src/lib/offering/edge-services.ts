/*
 * Edge, observability and governance services for an offering's Terraform.
 */
import { sizing } from "@/lib/skus";

import { type ServiceTf, bool, diag, envSel, q } from "./hcl";

type S = Record<string, string>;

const APIM_SKU: Record<string, string> = {
  Consumption: "Consumption_0",
  Developer: "Developer_1",
  Basic: "Basic_1",
  Standard: "Standard_1",
  Premium: "Premium_1",
  "Basic v2": "BasicV2_1",
  "Standard v2": "StandardV2_1",
  "Premium v2": "PremiumV2_1",
};

// The gateway is public (it's the product's API edge); backends are reached through the install's network.
export const apim = (s: S): ServiceTf => {
  const [t] = sizing("apim", s);
  return {
    providers: ["Microsoft.ApiManagement"],
    outputs: { apim_gateway_url: "azurerm_api_management.this.gateway_url" },
    body: `
resource "azurerm_api_management" "this" {
  name                 = "apim-\${local.name}-\${random_string.suffix.result}"
  location             = var.location
  resource_group_name  = local.rg_name
  publisher_name       = var.apim_publisher_name
  publisher_email      = var.apim_publisher_email
  sku_name             = ${envSel(q(APIM_SKU[t!.prod.value] ?? "StandardV2_1"), q(APIM_SKU[t!.dev.value] ?? "Consumption_0"))}
  tags                 = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  security {
    frontend_tls10_enabled = false
    frontend_tls11_enabled = false
    backend_tls10_enabled  = false
    backend_tls11_enabled  = false
  }
}
${diag("apim", "azurerm_api_management.this.id")}`,
  };
};

export const appGateway = (s: S, o: { webVmss?: boolean } = {}): ServiceTf => {
  const [g] = sizing("app-gateway", s);
  const waf = envSel(bool(g!.prod.value === "WAF_v2"), bool(g!.dev.value === "WAF_v2"));
  const anyWaf = g!.prod.value === "WAF_v2" || g!.dev.value === "WAF_v2";
  return {
    subnets: ["appgw"],
    outputs: { gateway_public_ip: "azurerm_public_ip.appgw.ip_address" },
    body: `
resource "azurerm_public_ip" "appgw" {
  name                = "pip-\${local.name}-agw"
  location            = var.location
  resource_group_name = local.rg_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = local.prod ? ["1", "2", "3"] : null
  tags                = local.tags
}

locals {
  appgw_waf = ${waf}
}
${
  anyWaf
    ? `
resource "azurerm_web_application_firewall_policy" "this" {
  count               = local.appgw_waf ? 1 : 0
  name                = "waf-\${local.name}"
  location            = var.location
  resource_group_name = local.rg_name
  tags                = local.tags

  policy_settings {
    enabled                     = true
    mode                        = local.prod ? "Prevention" : "Detection"
    request_body_check          = true
    max_request_body_size_in_kb = 128
  }

  managed_rules {
    managed_rule_set {
      type    = "Microsoft_DefaultRuleSet"
      version = "2.1"
    }
    managed_rule_set {
      type    = "Microsoft_BotManagerRuleSet"
      version = "1.1"
    }
  }
}
`
    : ""
}
# HTTP listener to the app; add the customer's certificate from Key Vault for HTTPS on their domain.
resource "azurerm_application_gateway" "this" {
  name                = "agw-\${local.name}"
  location            = var.location
  resource_group_name = local.rg_name
  firewall_policy_id  = ${anyWaf ? "one(azurerm_web_application_firewall_policy.this[*].id)" : "null"}
  zones               = local.prod ? ["1", "2", "3"] : null
  tags                = local.tags

  sku {
    name = ${envSel(q(g!.prod.value), q(g!.dev.value))}
    tier = ${envSel(q(g!.prod.value), q(g!.dev.value))}
  }

  autoscale_configuration {
    min_capacity = local.prod ? 2 : 1
    max_capacity = local.prod ? 10 : 2
  }

  gateway_ip_configuration {
    name      = "gateway"
    subnet_id = local.subnet_ids["snet-appgw"]
  }

  frontend_ip_configuration {
    name                 = "public"
    public_ip_address_id = azurerm_public_ip.appgw.id
  }

  frontend_port {
    name = "http"
    port = 80
  }

${
  o.webVmss
    ? `  # The web tier's scale set registers its instances in this pool.
  backend_address_pool {
    name = "app"
  }

  backend_http_settings {
    name                  = "app-https"
    cookie_based_affinity = "Disabled"
    port                  = 80
    protocol              = "Http"
    request_timeout       = 30
  }`
    : `  backend_address_pool {
    name  = "app"
    fqdns = local.app_hostname != "" ? [local.app_hostname] : []
  }

  backend_http_settings {
    name                                = "app-https"
    cookie_based_affinity               = "Disabled"
    port                                = 443
    protocol                            = "Https"
    request_timeout                     = 30
    pick_host_name_from_backend_address = true
  }`
}

  http_listener {
    name                           = "http"
    frontend_ip_configuration_name = "public"
    frontend_port_name             = "http"
    protocol                       = "Http"
    host_name                      = var.custom_domain != "" ? var.custom_domain : null
  }

  request_routing_rule {
    name                       = "app"
    rule_type                  = "Basic"
    priority                   = 100
    http_listener_name         = "http"
    backend_address_pool_name  = "app"
    backend_http_settings_name = "app-https"
  }

  ssl_policy {
    policy_type = "Predefined"
    policy_name = "AppGwSslPolicy20220101S"
  }
}
${diag("appgw", "azurerm_application_gateway.this.id")}`,
  };
};

export const frontDoor = (s: S): ServiceTf => {
  const [t] = sizing("front-door", s);
  const premium = envSel(bool(t!.prod.value === "Premium"), bool(t!.dev.value === "Premium"));
  return {
    providers: ["Microsoft.Cdn"],
    outputs: { front_door_url: '"https://${azurerm_cdn_frontdoor_endpoint.this.host_name}"' },
    body: `
resource "azurerm_cdn_frontdoor_profile" "this" {
  name                = "afd-\${local.name}"
  resource_group_name = local.rg_name
  sku_name            = ${envSel(q(`${t!.prod.value}_AzureFrontDoor`), q(`${t!.dev.value}_AzureFrontDoor`))}
  tags                = local.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "this" {
  name                     = "fde-\${local.name}-\${random_string.suffix.result}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  tags                     = local.tags
}

resource "azurerm_cdn_frontdoor_origin_group" "app" {
  name                     = "app"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id

  load_balancing {}

  health_probe {
    protocol            = "Https"
    interval_in_seconds = 60
    request_type        = "HEAD"
    path                = "/"
  }
}

resource "azurerm_cdn_frontdoor_origin" "app" {
  name                           = "app"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.app.id
  enabled                        = true
  host_name                      = local.app_hostname
  origin_host_header             = local.app_hostname
  certificate_name_check_enabled = true
}

resource "azurerm_cdn_frontdoor_route" "app" {
  name                          = "app"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.this.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.app.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.app.id]
  supported_protocols           = ["Http", "Https"]
  patterns_to_match             = ["/*"]
  forwarding_protocol           = "HttpsOnly"
  https_redirect_enabled        = true
  link_to_default_domain        = true
}

resource "azurerm_cdn_frontdoor_firewall_policy" "this" {
  name                = "waf\${local.compact}"
  resource_group_name = local.rg_name
  sku_name            = azurerm_cdn_frontdoor_profile.this.sku_name
  mode                = local.prod ? "Prevention" : "Detection"
  tags                = local.tags

  # Managed rule sets are a Premium feature.
  dynamic "managed_rule" {
    for_each = (${premium}) ? [1] : []
    content {
      type    = "Microsoft_DefaultRuleSet"
      version = "2.1"
      action  = "Block"
    }
  }
}

resource "azurerm_cdn_frontdoor_security_policy" "this" {
  name                     = "waf"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id

  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.this.id
      association {
        patterns_to_match = ["/*"]
        domain {
          cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.this.id
        }
      }
    }
  }
}
${diag("front_door", "azurerm_cdn_frontdoor_profile.this.id")}`,
  };
};

export const appInsights = (): ServiceTf => ({
  outputs: {
    app_insights_connection_string: "azurerm_application_insights.this.connection_string",
  },
  body: `
resource "azurerm_application_insights" "this" {
  name                         = "appi-\${local.name}"
  location                     = var.location
  resource_group_name          = local.rg_name
  workspace_id                 = local.law_id
  application_type             = "web"
  local_authentication_enabled = false
  tags                         = local.tags
}

# Keyless telemetry: the install identity publishes metrics with Entra ID.
resource "azurerm_role_assignment" "app_insights_publisher" {
  scope                = azurerm_application_insights.this.id
  role_definition_name = "Monitoring Metrics Publisher"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}
`,
});

const DEFENDER_PLANS: Record<string, [string, string | null][]> = {
  "Containers + Databases + Storage": [
    ["Containers", null],
    ["OpenSourceRelationalDatabases", null],
    ["SqlServers", null],
    ["StorageAccounts", "DefenderForStorageV2"],
  ],
  "CSPM only": [["CloudPosture", null]],
};

export const defender = (s: S): ServiceTf => ({
  providers: ["Microsoft.Security"],
  body: `
# Defender plans are set on the whole subscription the install lives in.
${(DEFENDER_PLANS[s["plans"] ?? ""] ?? DEFENDER_PLANS["CSPM only"]!)
  .map(
    ([type, sub]) => `
resource "azurerm_security_center_subscription_pricing" "${type.toLowerCase()}" {
  count         = var.enable_defender ? 1 : 0
  tier          = "Standard"
  resource_type = "${type}"${sub ? `\n  subplan       = "${sub}"` : ""}
}
`,
  )
  .join("")}`,
});

export const budget = (): ServiceTf => ({
  body: `
resource "azurerm_consumption_budget_resource_group" "this" {
  name              = "budget-\${local.name}"
  resource_group_id = local.rg_id
  amount            = local.prod ? var.monthly_budget : ceil(var.monthly_budget * 0.3)
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_roles  = ["Owner"]
    contact_emails = var.budget_contact_emails
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_roles  = ["Owner"]
    contact_emails = var.budget_contact_emails
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}
`,
});

const PROFILE_POLICIES: Record<string, { id: string; name: string; params?: string }[]> = {
  baseline: [
    {
      id: "/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8",
      name: "mcsb",
    },
  ],
  hardened: [
    {
      id: "/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8",
      name: "mcsb",
    },
    {
      id: "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c",
      name: "allowed-locations",
      params:
        'jsonencode({ listOfAllowedLocations = { value = concat(var.allowed_regions, ["global"]) } })',
    },
  ],
};
PROFILE_POLICIES["utility-critical"] = [
  ...PROFILE_POLICIES["hardened"]!,
  {
    // Storage accounts should disable public network access
    id: "/providers/Microsoft.Authorization/policyDefinitions/b2982f36-99f2-4db5-8eff-283140c09693",
    name: "storage-no-public",
    params: 'jsonencode({ effect = { value = "Deny" } })',
  },
];

export const policyPack = (s: S): ServiceTf => ({
  body: `
# The install's security baseline, assigned at its resource group and evaluated after every deploy.
${(PROFILE_POLICIES[s["profile"] ?? "hardened"] ?? PROFILE_POLICIES["hardened"]!)
  .map(
    (p) => `
resource "azurerm_resource_group_policy_assignment" "${p.name.replace(/-/g, "_")}" {
  name                 = "cd-${p.name}"
  display_name         = "Cloud Delivery · ${p.name}"
  resource_group_id    = local.rg_id
  policy_definition_id = "${p.id}"${p.params ? `\n  parameters           = ${p.params}` : ""}
}
`,
  )
  .join("")}`,
});
