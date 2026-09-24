// Cloud Delivery console — one-click deployment into any Azure tenant (the ISV's own, or anyone's).
//
// Deploys: App Service (Linux, Node 22) running the prebuilt app package, Azure Database for PostgreSQL
// Flexible Server, Application Insights, and — for password auth only — a Key Vault holding the connection
// string. This is the console itself, not the Azure services ISVs provision for their customers.
//
// Identity model (default, databaseAuth = 'entra'):
//   * The web app gets a system-assigned managed identity.
//   * That identity is made the Microsoft Entra administrator of the PostgreSQL server, so the app
//     connects with a short-lived Entra token. No database password exists anywhere.
//   * No role assignments are needed, so Contributor on the resource group is enough to deploy.
// Fallback (databaseAuth = 'password'): the connection string goes into Key Vault and the app reads it
// through a Key Vault reference; the web app identity is granted Key Vault Secrets User (needs Owner or
// User Access Administrator on the resource group).

targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short name used to build resource names.')
@minLength(3)
@maxLength(16)
param namePrefix string = 'clouddelivery'

@description('App Service plan size.')
@allowed(['B1', 'B2', 'P0v3', 'P1v3'])
param appServiceSku string = 'B1'

@description('PostgreSQL compute size.')
@allowed(['Standard_B1ms', 'Standard_B2s', 'Standard_D2ds_v5'])
param postgresSku string = 'Standard_B1ms'

@description('How the app signs in to PostgreSQL: entra (managed identity, no password) or password.')
@allowed(['entra', 'password'])
param databaseAuth string = 'entra'

@description('PostgreSQL administrator login (password auth only).')
param administratorLogin string = 'cdadmin'

@description('PostgreSQL administrator password (password auth only).')
@secure()
param administratorLoginPassword string = ''

@description('Load the GridWorks demo data into the empty database on first start.')
param seedDemoData bool = true

@description('URL of the prebuilt app package (release asset built by .github/workflows/release-app.yml).')
param packageUrl string = 'https://github.com/Balunywa/deployment-delight/releases/download/app-latest/cloud-delivery-app.zip'

var suffix = take(uniqueString(resourceGroup().id, namePrefix), 6)
var webAppName = '${namePrefix}-${suffix}'
var planName = '${namePrefix}-plan-${suffix}'
var postgresName = '${namePrefix}-pg-${suffix}'
var keyVaultName = take('cd-kv-${uniqueString(resourceGroup().id, namePrefix)}', 24)
var insightsName = '${namePrefix}-ai-${suffix}'
var workspaceName = '${namePrefix}-law-${suffix}'
var databaseName = 'cloud_delivery'
var useEntra = databaseAuth == 'entra'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: {
    name: postgresSku
    tier: startsWith(postgresSku, 'Standard_B') ? 'Burstable' : 'GeneralPurpose'
  }
  properties: {
    version: '16'
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: {
      activeDirectoryAuth: useEntra ? 'Enabled' : 'Disabled'
      passwordAuth: useEntra ? 'Disabled' : 'Enabled'
      tenantId: useEntra ? subscription().tenantId : null
    }
    administratorLogin: useEntra ? null : administratorLogin
    administratorLoginPassword: useEntra ? null : administratorLoginPassword
  }
}

// The app creates its own database on first start (AUTO_MIGRATE), so its identity owns it —
// PostgreSQL 15+ only lets a database's owner create objects in the public schema.

// Public endpoint restricted to Azure services (App Service outbound). TLS is required by default.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: { reserved: true }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = if (!useEntra) {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!useEntra) {
  parent: keyVault
  name: 'database-url'
  properties: {
    value: 'postgres://${administratorLogin}:${uriComponent(administratorLoginPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}'
  }
}

var databaseSettings = useEntra
  ? [
      {
        name: 'DATABASE_URL'
        value: 'postgres://${webAppName}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}'
      }
      { name: 'AZURE_POSTGRES_ENTRA_AUTH', value: 'true' }
    ]
  : [
      {
        name: 'DATABASE_URL'
        value: '@Microsoft.KeyVault(SecretUri=https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/database-url)'
      }
    ]

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node .output/server/index.mjs'
      alwaysOn: appServiceSku != 'B1'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      healthCheckPath: '/'
      // Static settings only — every value is known at deployment time, so no post-deployment script is needed.
      // WEBSITE_RUN_FROM_PACKAGE mounts the prebuilt zip read-only as wwwroot: no server-side build.
      appSettings: concat(
        [
          { name: 'WEBSITE_RUN_FROM_PACKAGE', value: packageUrl }
          { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
          { name: 'NODE_ENV', value: 'production' }
          { name: 'PORT', value: '8080' }
          { name: 'WEBSITES_PORT', value: '8080' }
          { name: 'AUTO_MIGRATE', value: 'true' }
          { name: 'SEED_DEMO_DATA', value: seedDemoData ? 'true' : 'false' }
          { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
          { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
        ],
        databaseSettings
      )
    }
  }
  dependsOn: [allowAzure, databaseUrlSecret]
}

// Entra auth: the web app's managed identity becomes the server's Entra administrator.
module postgresEntraAdmin 'modules/postgres-entra-admin.bicep' = if (useEntra) {
  name: 'postgres-entra-admin'
  params: {
    serverName: postgres.name
    principalId: webApp.identity.principalId
    principalName: webAppName
  }
  dependsOn: [allowAzure]
}

// Password auth: let the web app identity read the connection string from Key Vault.
resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!useEntra) {
  name: guid(keyVaultName, webAppName, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}

output webAppName string = webAppName
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output postgresServer string = postgres.properties.fullyQualifiedDomainName
output databaseAuth string = databaseAuth
