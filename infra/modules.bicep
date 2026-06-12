// Osborn Finance core infrastructure — hardened per code review (INFRA-1..4)
param location string
param env string
@secure()
param pgPassword string
var prefix = 'osfin${env}'

/* ============ INFRA-1: VNet with three isolated subnets + NSGs ============
   Subnets alone don't isolate anything — the NSG rules attached to each subnet
   are what enforce that the database only ever hears from the App Service. */

resource nsgApp 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: '${prefix}-nsg-app'
  location: location
  properties: {
    securityRules: [
      { name: 'allow-https-in', properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'Internet', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '443' } }
      { name: 'allow-out-db', properties: { priority: 100, direction: 'Outbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '10.0.1.0/26', sourcePortRange: '*', destinationAddressPrefix: '10.0.2.0/28', destinationPortRange: '5432' } }
      { name: 'allow-out-pe', properties: { priority: 110, direction: 'Outbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '10.0.1.0/26', sourcePortRange: '*', destinationAddressPrefix: '10.0.3.0/28', destinationPortRange: '443' } }
      { name: 'allow-out-internet-https', properties: { priority: 120, direction: 'Outbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '10.0.1.0/26', sourcePortRange: '*', destinationAddressPrefix: 'Internet', destinationPortRange: '443' } } // Plaid + Stripe APIs
      { name: 'deny-out-all', properties: { priority: 4096, direction: 'Outbound', access: 'Deny', protocol: '*', sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '*' } }
    ]
  }
}

resource nsgDb 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: '${prefix}-nsg-db'
  location: location
  properties: {
    securityRules: [
      { name: 'allow-app-to-pg', properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '10.0.1.0/26', sourcePortRange: '*', destinationAddressPrefix: '10.0.2.0/28', destinationPortRange: '5432' } }
      { name: 'deny-in-all', properties: { priority: 4096, direction: 'Inbound', access: 'Deny', protocol: '*', sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '*' } }
    ]
  }
}

resource nsgPe 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: '${prefix}-nsg-pe'
  location: location
  properties: {
    securityRules: [
      { name: 'allow-app-to-pe', properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: '10.0.1.0/26', sourcePortRange: '*', destinationAddressPrefix: '10.0.3.0/28', destinationPortRange: '443' } }
      { name: 'deny-in-all', properties: { priority: 4096, direction: 'Inbound', access: 'Deny', protocol: '*', sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '*' } }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.0.0.0/16'] }
    subnets: [
      {
        name: 'snet-app' // App Service VNet integration
        properties: {
          addressPrefix: '10.0.1.0/26'
          networkSecurityGroup: { id: nsgApp.id }
          delegations: [{ name: 'web', properties: { serviceName: 'Microsoft.Web/serverFarms' } }]
        }
      }
      {
        name: 'snet-db' // Postgres private — no public hostname at all
        properties: {
          addressPrefix: '10.0.2.0/28'
          networkSecurityGroup: { id: nsgDb.id }
          delegations: [{ name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
      {
        name: 'snet-pe' // private endpoints: Key Vault, Storage
        properties: {
          addressPrefix: '10.0.3.0/28'
          networkSecurityGroup: { id: nsgPe.id }
        }
      }
    ]
  }
}

/* Private DNS — without these zones the App Service cannot resolve the private IPs */
resource pgDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.postgres.database.azure.com'
  location: 'global'
}
resource pgDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: pgDns
  name: '${prefix}-pg-link'
  location: 'global'
  properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
}
resource kvDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
}
resource kvDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: kvDns
  name: '${prefix}-kv-link'
  location: 'global'
  properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
}

/* ============ Database — private only, inside snet-db ============ */
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${prefix}-pg'
  location: location
  sku: { name: 'Standard_B2s', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: 'osfinadmin' // INFRA-4: admin for migrations/maintenance ONLY.
    administratorLoginPassword: pgPassword
    storage: { storageSizeGB: 64 }
    backup: { backupRetentionDays: 35, geoRedundantBackup: 'Disabled' }
    network: {
      delegatedSubnetResourceId: vnet.properties.subnets[1].id
      privateDnsZoneArmResourceId: pgDns.id
      publicNetworkAccess: 'Disabled'
    }
    // INFRA-3 (tracked): enable ZoneRedundant HA at ~$2k MRR — see docs/build_tracker backlog.
    highAvailability: { mode: 'Disabled' }
  }
  dependsOn: [pgDnsLink]
}
// INFRA-4: the API must connect as the least-privilege user created by
// infra/post-deploy.sql (osfinapp), never as osfinadmin.

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${prefix}-kv'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
  }
}
resource kvPe 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${prefix}-kv-pe'
  location: location
  properties: {
    subnet: { id: vnet.properties.subnets[2].id }
    privateLinkServiceConnections: [{ name: 'kv', properties: { privateLinkServiceId: kv.id, groupIds: ['vault'] } }]
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${prefix}-plan'
  location: location
  sku: { name: 'S1', tier: 'Standard' }
  kind: 'linux'
  properties: { reserved: true }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: '${prefix}-api'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: vnet.properties.subnets[0].id // INFRA-1: outbound through snet-app
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      minTlsVersion: '1.2'
      vnetRouteAllEnabled: true
      appSettings: [
        { name: 'AUTH_MODE', value: 'entra' }
        { name: 'PLAID_ENV', value: 'production' }
        // DATABASE_URL (osfinapp user!), PLAID_*, STRIPE_*, TOKEN_ENC_KEY, ENTRA_* via Key Vault references
      ]
    }
  }
}

/* ============ INFRA-2: static hosting for the SPA ============ */
resource spa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${prefix}-spa'
  location: location
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: replace('${prefix}store', '-', '')
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-appi'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web' }
}

output apiHost string = api.properties.defaultHostName
output spaHost string = spa.properties.defaultHostname
output kvName string = kv.name
