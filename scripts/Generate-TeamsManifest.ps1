<#
.SYNOPSIS
  Generates teams/manifest.json from teams/manifest.template.json by substituting environment-specific values.
.PARAMETER TenantId
  Azure AD Tenant ID (GUID)
.PARAMETER AppId
  Power Apps Code App GUID
.PARAMETER EnvId
  Power Platform Environment ID (GUID)
.EXAMPLE
  .\Generate-TeamsManifest.ps1 -TenantId "xxxx" -AppId "yyyy" -EnvId "zzzz"
#>
param(
  [Parameter(Mandatory)][string]$TenantId,
  [Parameter(Mandatory)][string]$AppId,
  [Parameter(Mandatory)][string]$EnvId
)

$templatePath = Join-Path $PSScriptRoot '..\teams\manifest.template.json'
$outputPath   = Join-Path $PSScriptRoot '..\teams\manifest.json'

if (-not (Test-Path $templatePath)) {
  Write-Error "Template not found: $templatePath"
  exit 1
}

$content = Get-Content $templatePath -Raw
$content = $content -replace '\{\{TENANT_ID\}\}', $TenantId
$content = $content -replace '\{\{APP_ID\}\}',    $AppId
$content = $content -replace '\{\{ENV_ID\}\}',    $EnvId

Set-Content -Path $outputPath -Value $content -Encoding UTF8
Write-Host "Generated: $outputPath"
