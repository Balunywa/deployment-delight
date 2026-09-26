/*
 * AI, analytics and messaging services for an offering's Terraform: keyless (local auth off), private by
 * default, diagnostics on, and data-plane roles for the install's managed identity.
 */
import { type ServiceTf, diag, pe, q, role } from "./hcl";

type S = Record<string, string>;

export const MODELS: Record<string, { name: string; format: string }[]> = {
  "gpt-4.1 + gpt-4.1-mini": [
    { name: "gpt-4.1", format: "OpenAI" },
    { name: "gpt-4.1-mini", format: "OpenAI" },
  ],
  "gpt-4.1-mini": [{ name: "gpt-4.1-mini", format: "OpenAI" }],
  "gpt-4.1 + text-embedding-3-large": [
    { name: "gpt-4.1", format: "OpenAI" },
    { name: "text-embedding-3-large", format: "OpenAI" },
  ],
};
export const DEPLOYMENT_SKU: Record<string, string> = {
  "Data zone standard": "DataZoneStandard",
  "Global standard": "GlobalStandard",
  "Provisioned (PTU)": "ProvisionedManaged",
};

export const aiFoundry = (s: S): ServiceTf => {
  const models = MODELS[s["models"] ?? ""] ?? MODELS["gpt-4.1-mini"]!;
  const sku = DEPLOYMENT_SKU[s["deployment"] ?? ""] ?? "DataZoneStandard";
  const zones = [
    "privatelink.cognitiveservices.azure.com",
    "privatelink.openai.azure.com",
    "privatelink.services.ai.azure.com",
  ];
  // Model deployments on one account must be created one at a time.
  const deployments = models
    .map(
      (m, i) => `
resource "azurerm_cognitive_deployment" "${m.name.replace(/[^a-z0-9]/gi, "_")}" {
  name                   = ${q(m.name)}
  cognitive_account_id   = azurerm_cognitive_account.this.id
  version_upgrade_option = "OnceNewDefaultVersionAvailable"

  model {
    format = ${q(m.format)}
    name   = ${q(m.name)}
  }

  sku {
    name     = ${q(sku)}
    capacity = ${sku === "ProvisionedManaged" ? "local.prod ? 50 : 15" : "local.prod ? 100 : 10"}
  }
${i > 0 ? `\n  depends_on = [azurerm_cognitive_deployment.${models[i - 1]!.name.replace(/[^a-z0-9]/gi, "_")}]\n` : ""}}
`,
    )
    .join("");
  return {
    subnets: ["endpoints"],
    zones,
    providers: ["Microsoft.CognitiveServices"],
    outputs: { ai_endpoint: "azurerm_cognitive_account.this.endpoint" },
    body: `
resource "azurerm_cognitive_account" "this" {
  name                          = "ai-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  kind                          = "AIServices"
  sku_name                      = "S0"
  custom_subdomain_name         = "ai-\${local.name}-\${random_string.suffix.result}"
  local_auth_enabled            = false
  public_network_access_enabled = !var.private_endpoints
  tags                          = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  network_acls {
    default_action = var.private_endpoints ? "Deny" : "Allow"
    bypass         = "AzureServices"
  }
}
${deployments}${pe("ai", "azurerm_cognitive_account.this.id", "account", zones)}${diag("ai", "azurerm_cognitive_account.this.id")}${role("ai_openai_user", "azurerm_cognitive_account.this.id", "Cognitive Services OpenAI User")}`,
  };
};

export const aiSearch = (s: S): ServiceTf => ({
  subnets: ["endpoints"],
  zones: ["privatelink.search.windows.net"],
  providers: ["Microsoft.Search"],
  outputs: { search_endpoint: '"https://${azurerm_search_service.this.name}.search.windows.net"' },
  body: `
resource "azurerm_search_service" "this" {
  name                          = "srch-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  sku                           = local.prod ? ${q(s["sku"] ?? "standard")} : "basic"
  replica_count                 = local.prod && ${q(s["sku"] ?? "standard")} != "basic" ? 2 : 1
  partition_count               = 1
  local_authentication_enabled  = false
  public_network_access_enabled = !var.private_endpoints
  tags                          = local.tags

  identity {
    type = "SystemAssigned"
  }
}
${pe("search", "azurerm_search_service.this.id", "searchService", ["privatelink.search.windows.net"])}${diag("search", "azurerm_search_service.this.id")}${role("search_index", "azurerm_search_service.this.id", "Search Index Data Contributor")}`,
});

export const dataExplorer = (s: S): ServiceTf => {
  const [size, count] = (s["sku"] ?? "Standard_E8ads_v5 × 2").split(" × ");
  const zones = [
    "privatelink.${var.location}.kusto.windows.net",
    "privatelink.blob.core.windows.net",
    "privatelink.queue.core.windows.net",
    "privatelink.table.core.windows.net",
  ];
  return {
    subnets: ["endpoints"],
    zones,
    providers: ["Microsoft.Kusto"],
    outputs: { kusto_uri: "azurerm_kusto_cluster.this.uri" },
    body: `
resource "azurerm_kusto_cluster" "this" {
  name                          = "adx\${local.compact}\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  public_network_access_enabled = !var.private_endpoints
  auto_stop_enabled             = !local.prod
  disk_encryption_enabled       = true
  streaming_ingestion_enabled   = true
  zones                         = local.prod ? ["1", "2", "3"] : null
  tags                          = local.tags

  sku {
    name     = local.prod ? ${q(size ?? "Standard_E8ads_v5")} : "Dev(No SLA)_Standard_E2a_v4"
    capacity = local.prod ? ${Number(count ?? 2)} : 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
}

resource "azurerm_kusto_database" "telemetry" {
  name                = "telemetry"
  resource_group_name = local.rg_name
  location            = var.location
  cluster_name        = azurerm_kusto_cluster.this.name
  hot_cache_period    = "P7D"
  soft_delete_period  = local.prod ? "P365D" : "P31D"
}

resource "azurerm_kusto_database_principal_assignment" "app" {
  name                = "app-ingestor"
  resource_group_name = local.rg_name
  cluster_name        = azurerm_kusto_cluster.this.name
  database_name       = azurerm_kusto_database.telemetry.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  principal_id        = azurerm_user_assigned_identity.app.client_id
  principal_type      = "App"
  role                = "Admin"
}
${pe("kusto", "azurerm_kusto_cluster.this.id", "cluster", zones)}${diag("kusto", "azurerm_kusto_cluster.this.id")}`,
  };
};

export const iotHub = (s: S): ServiceTf => ({
  subnets: ["endpoints"],
  zones: ["privatelink.azure-devices.net"],
  providers: ["Microsoft.Devices"],
  outputs: { iot_hub_hostname: "azurerm_iothub.this.hostname" },
  body: `
# Field devices reach IoT Hub over the internet; services inside the network use the private endpoint.
resource "azurerm_iothub" "this" {
  name                          = "iot-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  min_tls_version               = "1.2"
  public_network_access_enabled = true
  tags                          = local.tags

  sku {
    name     = local.prod ? ${q(s["sku"] ?? "S2")} : "S1"
    capacity = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
}
${pe("iot_hub", "azurerm_iothub.this.id", "iotHub", ["privatelink.azure-devices.net"])}${diag("iot_hub", "azurerm_iothub.this.id")}${role("iot_hub_data", "azurerm_iothub.this.id", "IoT Hub Data Contributor")}`,
});

export const eventHubs = (s: S): ServiceTf => ({
  subnets: ["endpoints"],
  zones: ["privatelink.servicebus.windows.net"],
  providers: ["Microsoft.EventHub"],
  outputs: {
    event_hubs_namespace: '"${azurerm_eventhub_namespace.this.name}.servicebus.windows.net"',
  },
  body: `
resource "azurerm_eventhub_namespace" "this" {
  name                          = "evhns-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  sku                           = local.prod ? ${q(s["tier"] ?? "Premium")} : "Standard"
  capacity                      = 1
  local_authentication_enabled  = false
  public_network_access_enabled = !var.private_endpoints
  minimum_tls_version           = "1.2"
  tags                          = local.tags
}

resource "azurerm_eventhub" "telemetry" {
  name              = "telemetry"
  namespace_id      = azurerm_eventhub_namespace.this.id
  partition_count   = 4
  message_retention = 1
}
${pe("event_hubs", "azurerm_eventhub_namespace.this.id", "namespace", ["privatelink.servicebus.windows.net"])}${diag("event_hubs", "azurerm_eventhub_namespace.this.id")}${role("event_hubs_data", "azurerm_eventhub_namespace.this.id", "Azure Event Hubs Data Owner")}`,
});

export const serviceBus = (s: S): ServiceTf => {
  const premium = (s["tier"] ?? "Premium") === "Premium";
  return {
    subnets: ["endpoints"],
    zones: ["privatelink.servicebus.windows.net"],
    providers: ["Microsoft.ServiceBus"],
    outputs: {
      service_bus_namespace: '"${azurerm_servicebus_namespace.this.name}.servicebus.windows.net"',
    },
    body: `
# Private endpoints need the Premium tier; Standard stays keyless on the public endpoint.
resource "azurerm_servicebus_namespace" "this" {
  name                          = "sbns-\${local.name}-\${random_string.suffix.result}"
  location                      = var.location
  resource_group_name           = local.rg_name
  sku                           = local.sb_premium ? "Premium" : "Standard"
  capacity                      = local.sb_premium ? 1 : 0
  premium_messaging_partitions  = local.sb_premium ? 1 : 0
  local_auth_enabled            = false
  public_network_access_enabled = !(var.private_endpoints && local.sb_premium)
  minimum_tls_version           = "1.2"
  tags                          = local.tags
}

locals {
  sb_premium = local.prod && ${premium}
}

resource "azurerm_servicebus_queue" "commands" {
  name         = "commands"
  namespace_id = azurerm_servicebus_namespace.this.id
}

resource "azurerm_private_endpoint" "service_bus" {
  count               = var.private_endpoints && local.sb_premium ? 1 : 0
  name                = "pe-\${local.name}-service-bus"
  location            = var.location
  resource_group_name = local.rg_name
  subnet_id           = local.subnet_ids["snet-endpoints"]
  tags                = local.tags

  private_service_connection {
    name                           = "psc-service-bus"
    private_connection_resource_id = azurerm_servicebus_namespace.this.id
    subresource_names              = ["namespace"]
    is_manual_connection           = false
  }

  dynamic "private_dns_zone_group" {
    for_each = var.private_dns_mode == "policy" ? [] : [1]
    content {
      name                 = "default"
      private_dns_zone_ids = [local.dns_zone_ids["privatelink.servicebus.windows.net"]]
    }
  }

  lifecycle {
    ignore_changes = [private_dns_zone_group]
  }
}
${diag("service_bus", "azurerm_servicebus_namespace.this.id")}${role("service_bus_data", "azurerm_servicebus_namespace.this.id", "Azure Service Bus Data Owner")}`,
  };
};
