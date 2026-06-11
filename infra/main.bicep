// Osborn Finance — core Azure infrastructure (Enterprise Plan §2)
// Deploy: az deployment sub create --location eastus2 -f infra/main.bicep -p pgPassword=<strong-password>
targetScope = 'subscription'
param location string = 'eastus2'
param env string = 'prod'
@secure()
param pgPassword string

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-osbornfinance-${env}'
  location: location
}

module core 'modules.bicep' = {
  scope: rg
  name: 'core'
  params: { location: location, env: env, pgPassword: pgPassword }
}
