// Makes a managed identity the Microsoft Entra administrator of a PostgreSQL Flexible Server.
// A module is required because the administrator's resource name is the identity's object id,
// which is only known once the web app has been created.
param serverName string
param principalId string
param principalName string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: serverName
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: principalId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: principalName
    tenantId: subscription().tenantId
  }
}
