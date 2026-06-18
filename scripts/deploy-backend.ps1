Write-Host "Updating Azure Container App with latest backend image..."

az containerapp update `
  --name covisor-api `
  --resource-group rg-covisor-prod `
  --image acrcontainerregistry.azurecr.io/covisor-api:latest

Write-Host "Checking backend health..."

Invoke-RestMethod https://covisor-api.nicesea-2474b3f8.northcentralus.azurecontainerapps.io/api/health
