/*
 * Data and security services for an offering's Terraform. Each follows the Azure Well-Architected and
 * Microsoft cloud security benchmark defaults: Entra-only auth, no public network access behind private
 * endpoints, diagnostics to Log Analytics, and data-plane roles for the install's managed identity.
 * Production gets the architecture's settings; other environments are sized down.
 */
import { type ServiceTf, diag, pe, q, role } from "./hcl";

type S = Record<string, string>;

export const keyVault = (s: S): ServiceTf => ({
  subnets: ["endpoints"],
  zones: ["privatelink.vaultcore.azure.net"],
  outputs: { key_vault_uri: "azurerm_key_vault.this.vault_uri" },
  body: `
resource "azurerm_key_vault" "this" {
  name                          = "kv-\${local.short}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = ${q(s["keys"]?.startsWith("Customer") ? "premium" : "standard")}
  rbac_authorization_enabled    = true
  purge_protection_enabled      = local.prod
  soft_delete_retention_days    = local.prod ? 90 : 7
  public_network_access_enabled = !var.private_endpoints
  tags                          = local.tags

  network_acls {
    default_action = var.private_endpoints ? "Deny" : "Allow"
    bypass         = "AzureServices"
  }
}
${pe("key_vault", "azurerm_key_vault.this.id", "vault", ["privatelink.vaultcore.azure.net"])}${diag("key_vault", "azurerm_key_vault.this.id")}${role("key_vault_secrets", "azurerm_key_vault.this.id", "Key Vault Secrets User")}`,
});

export const storage = (s: S): ServiceTf => ({
  subnets: ["endpoints"],
  zones: ["privatelink.blob.core.windows.net"],
  outputs: { storage_account_name: "azurerm_storage_account.this.name" },
  body: `
resource "azurerm_storage_account" "this" {
  name                              = "st\${local.compact}\${random_string.suffix.result}"
  location                          = var.location
  resource_group_name               = local.rg_name
  account_kind                      = "StorageV2"
  account_tier                      = "Standard"
  account_replication_type          = local.prod ? ${q(s["replication"] ?? "ZRS")} : "LRS"
  min_tls_version                   = "TLS1_2"
  https_traffic_only_enabled        = true
  shared_access_key_enabled         = false
  default_to_oauth_authentication   = true
  allow_nested_items_to_be_public   = false
  infrastructure_encryption_enabled = true
  public_network_access_enabled     = !var.private_endpoints
  tags                              = local.tags

  network_rules {
    default_action = var.private_endpoints ? "Deny" : "Allow"
    bypass         = ["AzureServices"]
  }

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = local.prod ? 30 : 7
    }
    container_delete_retention_policy {
      days = local.prod ? 30 : 7
    }
  }
}

resource "azurerm_storage_container" "data" {
  name                  = "data"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}
${pe("storage_blob", "azurerm_storage_account.this.id", "blob", ["privatelink.blob.core.windows.net"])}${diag("storage", "azurerm_storage_account.this.id", { logs: false, metrics: "Transaction" })}${diag("storage_blob", '"${azurerm_storage_account.this.id}/blobServices/default"', { metrics: "Transaction" })}${role("storage_blob", "azurerm_storage_account.this.id", "Storage Blob Data Contributor")}`,
});

export const postgres = (s: S): ServiceTf => {
  const ha = s["ha"] ?? "Zone redundant";
  const mode = ha === "Zone redundant" ? "ZoneRedundant" : ha === "Same zone" ? "SameZone" : "";
  return {
    subnets: ["endpoints"],
    zones: ["privatelink.postgres.database.azure.com"],
    outputs: { postgres_fqdn: "azurerm_postgresql_flexible_server.this.fqdn" },
    body: `
resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "psql-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  version                       = ${q(s["version"] ?? "16")}
  sku_name                      = local.prod ? ${q(s["sku"] ?? "GP_Standard_D4ds_v5")} : "B_Standard_B1ms"
  storage_mb                    = local.prod ? 131072 : 32768
  auto_grow_enabled             = true
  backup_retention_days         = local.prod ? 35 : 7
  public_network_access_enabled = !var.private_endpoints
  zone                          = ${mode === "ZoneRedundant" ? `local.prod ? "1" : null` : "null"}
  tags                          = local.tags

  # Microsoft Entra authentication only — no passwords to store or rotate.
  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }
${
  mode
    ? `
  dynamic "high_availability" {
    for_each = local.prod ? [1] : []
    content {
      mode = "${mode}"${mode === "ZoneRedundant" ? `\n      standby_availability_zone = "2"` : ""}
    }
  }
`
    : ""
}
  lifecycle {
    # Azure may swap the primary and standby zones after a failover.
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "app" {
  server_name         = azurerm_postgresql_flexible_server.this.name
  resource_group_name = local.rg_name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  object_id           = azurerm_user_assigned_identity.app.principal_id
  principal_name      = azurerm_user_assigned_identity.app.name
  principal_type      = "ServicePrincipal"
}
${pe("postgres", "azurerm_postgresql_flexible_server.this.id", "postgresqlServer", ["privatelink.postgres.database.azure.com"])}${diag("postgres", "azurerm_postgresql_flexible_server.this.id")}`,
  };
};

export const sql = (s: S): ServiceTf => ({
  subnets: ["endpoints"],
  zones: ["privatelink.database.windows.net"],
  outputs: { sql_server_fqdn: "azurerm_mssql_server.this.fully_qualified_domain_name" },
  body: `
resource "azurerm_mssql_server" "this" {
  name                                 = "sql-\${local.name}-\${random_string.suffix.result}"
  location                             = var.location
  resource_group_name                  = local.rg_name
  version                              = "12.0"
  minimum_tls_version                  = "1.2"
  public_network_access_enabled        = !var.private_endpoints
  outbound_network_restriction_enabled = false
  primary_user_assigned_identity_id    = azurerm_user_assigned_identity.app.id
  tags                                 = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  # Entra-only authentication: the customer's SQL admin group when given, otherwise the install identity.
  azuread_administrator {
    login_username              = var.sql_admin_group_id != "" ? "sql-admins" : azurerm_user_assigned_identity.app.name
    object_id                   = var.sql_admin_group_id != "" ? var.sql_admin_group_id : azurerm_user_assigned_identity.app.principal_id
    azuread_authentication_only = true
  }
}

resource "azurerm_mssql_database" "app" {
  name                        = "app"
  server_id                   = azurerm_mssql_server.this.id
  sku_name                    = local.prod ? ${q(s["sku"] ?? "GP_Gen5_4")} : "GP_S_Gen5_1"
  max_size_gb                 = 32
  min_capacity                = local.prod ? null : 0.5
  auto_pause_delay_in_minutes = local.prod ? null : 60
  zone_redundant              = local.prod && ${q(s["sku"] ?? "GP_Gen5_4")} != "GP_Gen5_4"
  tags                        = local.tags
}
${pe("sql", "azurerm_mssql_server.this.id", "sqlServer", ["privatelink.database.windows.net"])}${diag("sql_database", "azurerm_mssql_database.app.id", { metrics: "Basic" })}`,
});

export const cosmos = (s: S): ServiceTf => {
  const serverless = (s["mode"] ?? "").startsWith("Serverless");
  return {
    subnets: ["endpoints"],
    zones: ["privatelink.documents.azure.com"],
    outputs: { cosmos_endpoint: "azurerm_cosmosdb_account.this.endpoint" },
    body: `
resource "azurerm_cosmosdb_account" "this" {
  name                          = "cosmos-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  offer_type                    = "Standard"
  kind                          = "GlobalDocumentDB"
  local_authentication_enabled  = false
  public_network_access_enabled = !var.private_endpoints
  minimal_tls_version           = "Tls12"
  tags                          = local.tags

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
    zone_redundant    = local.prod
  }

  backup {
    type = "Continuous"
    tier = "Continuous7Days"
  }

  dynamic "capabilities" {
    for_each = ${serverless ? "[1]" : "local.prod ? [] : [1]"}
    content {
      name = "EnableServerless"
    }
  }
}

resource "azurerm_cosmosdb_sql_database" "app" {
  name                = "app"
  resource_group_name = local.rg_name
  account_name        = azurerm_cosmosdb_account.this.name

  dynamic "autoscale_settings" {
    for_each = ${serverless ? "[]" : "local.prod ? [1] : []"}
    content {
      max_throughput = 4000
    }
  }
}

# Built-in Data Contributor, data plane only — keys are disabled.
resource "azurerm_cosmosdb_sql_role_assignment" "app" {
  resource_group_name = local.rg_name
  account_name        = azurerm_cosmosdb_account.this.name
  role_definition_id  = "\${azurerm_cosmosdb_account.this.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_user_assigned_identity.app.principal_id
  scope               = azurerm_cosmosdb_account.this.id
}
${pe("cosmos", "azurerm_cosmosdb_account.this.id", "Sql", ["privatelink.documents.azure.com"])}${diag("cosmos", "azurerm_cosmosdb_account.this.id", { metrics: "Requests" })}`,
  };
};

export const redis = (s: S): ServiceTf => {
  const premium = (s["sku"] ?? "Premium P1").startsWith("Premium");
  const cap = (s["sku"] ?? "").match(/\d+$/)?.[0] ?? "1";
  return {
    subnets: ["endpoints"],
    zones: ["privatelink.redis.cache.windows.net"],
    providers: ["Microsoft.Cache"],
    outputs: { redis_hostname: "azurerm_redis_cache.this.hostname" },
    body: `
resource "azurerm_redis_cache" "this" {
  name                               = "redis-\${local.name}-\${random_string.suffix.result}"
  location                           = var.location
  resource_group_name                = local.rg_name
  sku_name                           = local.prod ? "${premium ? "Premium" : "Standard"}" : "Standard"
  family                             = local.prod ? "${premium ? "P" : "C"}" : "C"
  capacity                           = local.prod ? ${cap} : 1
  minimum_tls_version                = "1.2"
  non_ssl_port_enabled               = false
  access_keys_authentication_enabled = false
  public_network_access_enabled      = !var.private_endpoints
  zones                              = local.prod && ${premium} ? ["1", "2"] : null
  tags                               = local.tags

  redis_configuration {
    active_directory_authentication_enabled = true
  }
}

resource "azurerm_redis_cache_access_policy_assignment" "app" {
  name               = "app"
  redis_cache_id     = azurerm_redis_cache.this.id
  access_policy_name = "Data Owner"
  object_id          = azurerm_user_assigned_identity.app.principal_id
  object_id_alias    = azurerm_user_assigned_identity.app.name
}
${pe("redis", "azurerm_redis_cache.this.id", "redisCache", ["privatelink.redis.cache.windows.net"])}${diag("redis", "azurerm_redis_cache.this.id")}`,
  };
};
