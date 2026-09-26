/*
 * Compute services for an offering's Terraform. They run as the install's managed identity, integrate
 * into the spoke (egress through the customer's firewall when there is one), send telemetry to Log
 * Analytics, and are only reachable privately unless the architecture allows public access.
 */
import { sizing } from "@/lib/skus";

import { type ServiceTf, bool, diag, envSel, pe, q } from "./hcl";

type S = Record<string, string>;
const counts = (v: string | undefined, d: [number, number]) =>
  (v?.match(/\d+/g)?.map(Number) as [number, number] | undefined) ?? d;

export const aks = (s: S): ServiceTf => {
  const [tier, node] = sizing("aks", s);
  const [sys, user] = counts(s["nodes"], [3, 3]);
  const [devSys, devUser] = counts(s["devNodes"], [1, 1]);
  const zonal = (s["nodes"] ?? "").includes("zonal");
  const priv = (s["access"] ?? "Private cluster") === "Private cluster";
  return {
    subnets: ["aks"],
    providers: ["Microsoft.ContainerService"],
    outputs: { aks_name: "azurerm_kubernetes_cluster.this.name" },
    body: `
resource "azurerm_kubernetes_cluster" "this" {
  name                              = "aks-\${local.name}"
  location                          = var.location
  resource_group_name               = local.rg_name
  dns_prefix                        = "aks-\${local.name}"
  sku_tier                          = ${envSel(q(tier!.prod.value), q(tier!.dev.value))}
  automatic_upgrade_channel         = "patch"
  node_os_upgrade_channel           = "NodeImage"
  local_account_disabled            = true
  oidc_issuer_enabled               = true
  workload_identity_enabled         = true
  azure_policy_enabled              = true
  image_cleaner_enabled             = true
  image_cleaner_interval_hours      = 48
  private_cluster_enabled           = ${priv}
  # No private DNS zone of its own — landing zone policy usually denies them outside the platform.
  private_dns_zone_id                 = ${priv ? '"None"' : "null"}
  private_cluster_public_fqdn_enabled = ${priv}
  tags                              = local.tags

  default_node_pool {
    name                         = "system"
    vm_size                      = ${envSel(q(node!.prod.value), q(node!.dev.value))}
    node_count                   = ${envSel(String(sys), String(devSys))}
    vnet_subnet_id               = local.subnet_ids["snet-aks"]
    only_critical_addons_enabled = true
    os_sku                       = "AzureLinux"
    zones                        = local.prod && ${zonal} ? ["1", "2", "3"] : null
    temporary_name_for_rotation  = "systemtmp"

    upgrade_settings {
      max_surge = "10%"
    }
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_data_plane  = "cilium"
    network_policy      = "cilium"
    outbound_type       = var.firewall_private_ip != "" ? "userDefinedRouting" : "loadBalancer"
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled     = true
    admin_group_object_ids = var.cluster_admin_group_id != "" ? [var.cluster_admin_group_id] : []
  }

  oms_agent {
    log_analytics_workspace_id      = local.law_id
    msi_auth_for_monitoring_enabled = true
  }

  key_vault_secrets_provider {
    secret_rotation_enabled = true
  }

  depends_on = [azurerm_role_assignment.aks_network]
}

resource "azurerm_kubernetes_cluster_node_pool" "user" {
  name                  = "user"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  vm_size               = ${envSel(q(node!.prod.value), q(node!.dev.value))}
  node_count            = ${envSel(String(user), String(devUser))}
  vnet_subnet_id        = local.subnet_ids["snet-aks"]
  os_sku                = "AzureLinux"
  zones                 = local.prod && ${zonal} ? ["1", "2", "3"] : null
  tags                  = local.tags
}

# The cluster identity joins its nodes to the spoke subnet.
resource "azurerm_role_assignment" "aks_network" {
  scope                = azurerm_virtual_network.this.id
  role_definition_name = "Network Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}
${diag("aks", "azurerm_kubernetes_cluster.this.id", { logs: "audit" })}`,
  };
};

const acaProfile = (v: string) =>
  v === "Consumption"
    ? { name: "Consumption", type: "Consumption", dedicated: false }
    : { name: v.split(" ")[1]!.toLowerCase(), type: v.split(" ")[1]!, dedicated: true };

export const containerApps = (s: S): ServiceTf => {
  const [pr] = sizing("container-apps", s);
  const p = acaProfile(pr!.prod.value);
  const d = acaProfile(pr!.dev.value);
  return {
    subnets: ["aca"],
    providers: ["Microsoft.App"],
    outputs: { app_url: '"https://${azurerm_container_app.app.ingress[0].fqdn}"' },
    body: `
resource "azurerm_container_app_environment" "this" {
  name                           = "cae-\${local.name}"
  location                       = var.location
  resource_group_name            = local.rg_name
  log_analytics_workspace_id     = local.law_id
  infrastructure_subnet_id       = local.subnet_ids["snet-aca"]
  internal_load_balancer_enabled = !var.public_access
  zone_redundancy_enabled        = local.prod
  tags                           = local.tags

  workload_profile {
    name                  = ${envSel(q(p.name), q(d.name))}
    workload_profile_type = ${envSel(q(p.type), q(d.type))}
    minimum_count         = ${envSel(p.dedicated ? "3" : "null", d.dedicated ? "1" : "null")}
    maximum_count         = ${envSel(p.dedicated ? "10" : "null", d.dedicated ? "2" : "null")}
  }

  lifecycle {
    # Azure fills in the managed infrastructure resource group name.
    ignore_changes = [infrastructure_resource_group_name]
  }
}

# First revision runs a placeholder image; the release pipeline rolls out the product's image.
resource "azurerm_container_app" "app" {
  name                         = "ca-\${local.short}-app"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = local.rg_name
  revision_mode                = "Single"
  workload_profile_name        = ${envSel(q(p.name), q(d.name))}
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  ingress {
    external_enabled = true
    target_port      = 80
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = local.prod ? 2 : 0
    max_replicas = local.prod ? 10 : 2

    container {
      name   = "app"
      image  = var.app_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }
    }
  }

  lifecycle {
    # The release pipeline owns the running image.
    ignore_changes = [template[0].container[0].image]
  }
}
`,
  };
};

export const appService = (s: S): ServiceTf => {
  const [plan] = sizing("app-service", s);
  const zoned = !!plan!.prod.zones;
  return {
    subnets: ["web", "endpoints"],
    zones: ["privatelink.azurewebsites.net"],
    outputs: { app_url: '"https://${azurerm_linux_web_app.this.default_hostname}"' },
    body: `
resource "azurerm_service_plan" "web" {
  name                   = "asp-\${local.name}"
  location               = var.location
  resource_group_name    = local.rg_name
  os_type                = "Linux"
  sku_name               = ${envSel(q(plan!.prod.value), q(plan!.dev.value))}
  worker_count           = ${envSel(zoned ? "3" : "1", "1")}
  zone_balancing_enabled = ${envSel(bool(zoned), "false")}
  tags                   = local.tags
}

resource "azurerm_linux_web_app" "this" {
  name                                           = "app-\${local.name}-\${random_string.suffix.result}"
  location                                       = var.location
  resource_group_name                            = local.rg_name
  service_plan_id                                = azurerm_service_plan.web.id
  https_only                                     = true
  public_network_access_enabled                  = var.public_access || !var.private_endpoints
  virtual_network_subnet_id                      = local.subnet_ids["snet-web"]
  key_vault_reference_identity_id                = azurerm_user_assigned_identity.app.id
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false
  tags                                           = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  site_config {
    always_on              = true
    ftps_state             = "Disabled"
    http2_enabled          = true
    minimum_tls_version    = "1.2"
    vnet_route_all_enabled = true

    application_stack {
      node_version = "20-lts"
    }
  }

  app_settings = {
    AZURE_CLIENT_ID                       = azurerm_user_assigned_identity.app.client_id
    APPLICATIONINSIGHTS_CONNECTION_STRING = local.app_insights_connection_string
  }
}
${pe("web", "azurerm_linux_web_app.this.id", "sites", ["privatelink.azurewebsites.net"])}${diag("web", "azurerm_linux_web_app.this.id")}`,
  };
};

export const functions = (s: S): ServiceTf => {
  const [plan] = sizing("functions", s);
  const pFlex = plan!.prod.value === "FC1";
  const dFlex = plan!.dev.value === "FC1";
  // Flex Consumption and Premium are different resource types; each environment gets the one its plan needs.
  const flex = envSel(bool(pFlex), bool(dFlex));
  const subnets: ("func" | "web" | "endpoints")[] = ["endpoints"];
  if (pFlex || dFlex) subnets.push("func");
  if (!pFlex || !dFlex) subnets.push("web");
  const pick = (attr: string) => {
    const f = `one(azurerm_function_app_flex_consumption.this[*].${attr})`;
    const l = `one(azurerm_linux_function_app.this[*].${attr})`;
    return pFlex && dFlex ? f : !pFlex && !dFlex ? l : `local.functions_flex ? ${f} : ${l}`;
  };
  return {
    subnets,
    zones: ["privatelink.blob.core.windows.net"],
    providers: ["Microsoft.App"],
    outputs: {
      functions_url: '"https://${local.functions_hostname}"',
    },
    body: `
locals {
  functions_flex     = ${flex}
  functions_hostname = ${pick("default_hostname")}
}

# Functions keeps its deployment packages and host state in its own storage account, reached with the
# install identity (no keys).
resource "azurerm_storage_account" "functions" {
  name                            = "stfn\${local.compact}\${random_string.suffix.result}"
  location                        = var.location
  resource_group_name             = local.rg_name
  account_kind                    = "StorageV2"
  account_tier                    = "Standard"
  account_replication_type        = local.prod ? "ZRS" : "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = !var.private_endpoints
  tags                            = local.tags

  network_rules {
    default_action = var.private_endpoints ? "Deny" : "Allow"
    bypass         = ["AzureServices"]
  }
}

resource "azurerm_storage_container" "functions" {
  name                  = "deployments"
  storage_account_id    = azurerm_storage_account.functions.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "functions_storage" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}
${pe("functions_blob", "azurerm_storage_account.functions.id", "blob", ["privatelink.blob.core.windows.net"])}
resource "azurerm_service_plan" "functions" {
  name                = "asp-\${local.name}-func"
  location            = var.location
  resource_group_name = local.rg_name
  os_type             = "Linux"
  sku_name            = ${envSel(q(plan!.prod.value), q(plan!.dev.value))}
  tags                = local.tags
}
${
  pFlex || dFlex
    ? `
resource "azurerm_function_app_flex_consumption" "this" {
  count                             = local.functions_flex ? 1 : 0
  name                              = "func-\${local.name}-\${random_string.suffix.result}"
  location                          = var.location
  resource_group_name               = local.rg_name
  service_plan_id                   = azurerm_service_plan.functions.id
  runtime_name                      = "node"
  runtime_version                   = "20"
  storage_container_type            = "blobContainer"
  storage_container_endpoint        = "\${azurerm_storage_account.functions.primary_blob_endpoint}\${azurerm_storage_container.functions.name}"
  storage_authentication_type       = "UserAssignedIdentity"
  storage_user_assigned_identity_id = azurerm_user_assigned_identity.app.id
  maximum_instance_count            = local.prod ? 100 : 40
  instance_memory_in_mb             = 2048
  https_only                        = true
  public_network_access_enabled     = var.public_access || !var.private_endpoints
  virtual_network_subnet_id         = local.subnet_ids["snet-func"]
  tags                              = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  site_config {
    minimum_tls_version                    = "1.2"
    application_insights_connection_string = local.app_insights_connection_string
  }

  app_settings = {
    AZURE_CLIENT_ID = azurerm_user_assigned_identity.app.client_id
  }

  depends_on = [azurerm_role_assignment.functions_storage]
}
`
    : ""
}${
      !pFlex || !dFlex
        ? `
resource "azurerm_linux_function_app" "this" {
  count                         = local.functions_flex ? 0 : 1
  name                          = "func-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  service_plan_id               = azurerm_service_plan.functions.id
  storage_account_name          = azurerm_storage_account.functions.name
  storage_uses_managed_identity = true
  https_only                    = true
  public_network_access_enabled = var.public_access || !var.private_endpoints
  virtual_network_subnet_id     = local.subnet_ids["snet-web"]
  tags                          = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  site_config {
    minimum_tls_version                    = "1.2"
    vnet_route_all_enabled                 = true
    application_insights_connection_string = local.app_insights_connection_string

    application_stack {
      node_version = "20"
    }
  }

  app_settings = {
    AZURE_CLIENT_ID = azurerm_user_assigned_identity.app.client_id
  }

  depends_on = [azurerm_role_assignment.functions_storage]
}
`
        : ""
    }
resource "azurerm_monitor_diagnostic_setting" "functions" {
  name                       = "diag-to-law"
  target_resource_id         = ${pick("id")}
  log_analytics_workspace_id = local.law_id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
`,
  };
};
