<#
.SYNOPSIS
    Add the 3 new columns required for Enhancement Batch 3.

.DESCRIPTION
    Creates:
      • cgmp_uatrequired  (Boolean / Yes-No)  on cgmp_change
      • cgmp_changepoc    (Single Line Text)   on cgmp_change
      • cgmp_assignedlocations (Single Line Text) on cgmp_userprofile

    Authentication is attempted in order:
      1. Az PowerShell module  (instant if already logged in)
      2. Azure CLI             (instant if already logged in)
      3. Browser sign-in       (Authorization Code + PKCE)

    The script is idempotent — columns that already exist are skipped.

.PARAMETER SkipExport
    Skip the solution export step after creating columns.

.PARAMETER Port
    Local port for the browser OAuth redirect listener. Default: 8400.

.EXAMPLE
    .\scripts\add-batch3-columns.ps1
    .\scripts\add-batch3-columns.ps1 -SkipExport
#>

param (
    [switch]$SkipExport,
    [int]$Port = 8400
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Environment ───────────────────────────────────────────────────────────
$TenantId = 'e0793d39-0939-496d-b129-198edd916feb'
$OrgUrl   = 'https://org3cabab2d.crm.dynamics.com'
$ApiBase  = "$OrgUrl/api/data/v9.2"
$Solution = 'CgmpOptionSets'
$ClientId = '51f81489-12ee-4a9e-aaae-a2591f45987d'

# ── Columns to create (grouped by entity logical name) ────────────────────
# Entity logical name = singular form used by the Dataverse metadata API.
# The data API uses plural (cgmp_changes, cgmp_userprofiles); metadata API uses singular.
$ColumnsByEntity = @(
    @{
        Entity  = 'cgmp_change'
        Columns = @(
            @{
                LogicalName  = 'cgmp_uatrequired'
                DisplayName  = 'UAT Required'
                Type         = 'Boolean'
                Required     = 'None'
                DefaultValue = $false
            }
            @{
                LogicalName = 'cgmp_changepoc'
                DisplayName = 'Change POC'
                Type        = 'String'
                MaxLength   = 200
                Required    = 'None'
            }
        )
    }
    @{
        Entity  = 'cgmp_userprofile'
        Columns = @(
            @{
                LogicalName = 'cgmp_assignedlocations'
                DisplayName = 'Assigned Locations'
                Type        = 'String'
                MaxLength   = 500
                Required    = 'None'
            }
        )
    }
)

# ── Helpers ───────────────────────────────────────────────────────────────
function Write-Step([string]$msg) { Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   ✓ $msg" -ForegroundColor Green }
function Write-Skip([string]$msg) { Write-Host "   ○ $msg" -ForegroundColor DarkGray }
function Write-Warn([string]$msg) { Write-Host "   ! $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "`n   ✗ $msg`n" -ForegroundColor Red; exit 1 }

# ── Browser-based OAuth (Authorization Code + PKCE) ──────────────────────
function Get-TokenViaBrowser {
    Write-Host "  Opening browser for sign-in..." -ForegroundColor Yellow

    $verifierBytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($verifierBytes)
    $verifier  = [Convert]::ToBase64String($verifierBytes) -replace '\+','-' -replace '/','_' -replace '=',''
    $sha256    = [Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha256.ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier))
    $challenge = [Convert]::ToBase64String($hashBytes) -replace '\+','-' -replace '/','_' -replace '=',''

    $redirectUri = "http://localhost:$Port/"
    $scope       = "$OrgUrl/.default"
    $state       = [Guid]::NewGuid().ToString('N')

    $authUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/authorize" +
               "?client_id=$ClientId" +
               "&response_type=code" +
               "&redirect_uri=$([uri]::EscapeDataString($redirectUri))" +
               "&scope=$([uri]::EscapeDataString($scope))" +
               "&state=$state" +
               "&code_challenge=$challenge" +
               "&code_challenge_method=S256"

    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add($redirectUri)
    try { $listener.Start() } catch {
        Write-Fail "Cannot bind to $redirectUri. Close other apps on port $Port or re-run with -Port <other>."
    }

    Start-Process $authUrl
    Write-Host "  Waiting for browser sign-in (3-minute timeout)..." -ForegroundColor DarkGray

    $task = $listener.GetContextAsync()
    if (-not $task.Wait(180000)) {
        $listener.Stop()
        Write-Fail "Authentication timed out."
    }

    $ctx      = $task.Result
    $rawQuery = $ctx.Request.Url.Query

    $successHtml = @"
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>CGMP Sign-in</title></head>
<body style="font-family:'Segoe UI',sans-serif;text-align:center;padding-top:80px;color:#323130">
  <div style="font-size:56px;color:#107C10">&#10003;</div>
  <h2 style="margin:12px 0">Authentication complete</h2>
  <p style="color:#605E5C">You can close this tab and return to the terminal.</p>
</body></html>
"@
    $respBytes = [Text.Encoding]::UTF8.GetBytes($successHtml)
    $ctx.Response.ContentType     = 'text/html; charset=utf-8'
    $ctx.Response.ContentLength64 = $respBytes.Length
    $ctx.Response.OutputStream.Write($respBytes, 0, $respBytes.Length)
    $ctx.Response.Close()
    $listener.Stop()

    $qs = @{}
    foreach ($pair in $rawQuery.TrimStart('?').Split('&', [StringSplitOptions]::RemoveEmptyEntries)) {
        $kv = $pair.Split('=', 2)
        if ($kv.Count -eq 2) { $qs[$kv[0]] = [uri]::UnescapeDataString($kv[1].Replace('+', ' ')) }
    }

    if ($qs.ContainsKey('error')) { Write-Fail "Sign-in error: $($qs['error']) — $($qs['error_description'])" }
    if (-not $qs.ContainsKey('code')) { Write-Fail "No authorization code in redirect." }

    $tokenUrl  = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $tokenBody = "grant_type=authorization_code&client_id=$ClientId" +
                 "&code=$([uri]::EscapeDataString($qs['code']))" +
                 "&redirect_uri=$([uri]::EscapeDataString($redirectUri))" +
                 "&scope=$([uri]::EscapeDataString($scope))" +
                 "&code_verifier=$verifier"

    $tokenResp = Invoke-RestMethod -Method Post -Uri $tokenUrl `
        -ContentType 'application/x-www-form-urlencoded' -Body $tokenBody

    Write-OK "Signed in via browser"
    return $tokenResp.access_token
}

# ── Authentication dispatcher ─────────────────────────────────────────────
function Get-AccessToken {
    Write-Step "Obtaining Dataverse access token"

    if (Get-Command Get-AzAccessToken -ErrorAction SilentlyContinue) {
        try {
            $t = (Get-AzAccessToken -ResourceUrl $OrgUrl -TenantId $TenantId -ErrorAction Stop).Token
            if ($t) { Write-OK "Token via Az PowerShell module"; return $t }
        } catch { Write-Warn "Az module not logged in: $($_.Exception.Message)" }
    }

    if (Get-Command az -ErrorAction SilentlyContinue) {
        try {
            $raw = az account get-access-token --resource $OrgUrl --tenant $TenantId 2>$null
            if ($raw) {
                $t = ($raw | ConvertFrom-Json).accessToken
                if ($t) { Write-OK "Token via Azure CLI"; return $t }
            }
        } catch { Write-Warn "Azure CLI not logged in: $($_.Exception.Message)" }
    }

    return Get-TokenViaBrowser
}

function Get-ApiHeaders([string]$token) {
    return @{
        Authorization      = "Bearer $token"
        'Content-Type'     = 'application/json; charset=utf-8'
        'OData-MaxVersion' = '4.0'
        'OData-Version'    = '4.0'
        Accept             = 'application/json'
    }
}

# ── Dataverse metadata operations ─────────────────────────────────────────
function Assert-EntityExists([hashtable]$h, [string]$entity) {
    try {
        $url = "$ApiBase/EntityDefinitions(LogicalName='$entity')?" + '$select=LogicalName,EntitySetName'
        $e   = Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop
        Write-OK "Entity confirmed: LogicalName='$($e.LogicalName)'  SetName='$($e.EntitySetName)'"
    } catch {
        $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        if ($status -eq 404) {
            Write-Fail "Entity '$entity' not found. Verify the logical name in Maker Portal → Solutions → $Solution → Tables."
        }
        throw
    }
}

function Test-ColumnExists([hashtable]$h, [string]$entity, [string]$logicalName) {
    try {
        $url = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes(LogicalName='$logicalName')?" + '$select=LogicalName'
        Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop | Out-Null
        return $true
    } catch {
        $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        if ($status -eq 404) { return $false }
        throw
    }
}

function New-StringColumn([hashtable]$h, [string]$entity, [hashtable]$col) {
    $body = [ordered]@{
        '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'
        SchemaName    = $col.LogicalName
        RequiredLevel = [ordered]@{ Value = $col.Required }
        MaxLength     = $col.MaxLength
        FormatName    = [ordered]@{ Value = 'Text' }
        DisplayName   = [ordered]@{
            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
            LocalizedLabels = @(
                [ordered]@{
                    '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'
                    Label         = $col.DisplayName
                    LanguageCode  = 1033
                }
            )
        }
    } | ConvertTo-Json -Depth 10

    $createUrl = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes"
    Invoke-RestMethod -Method Post -Uri $createUrl -Headers $h -Body $body | Out-Null

    $getUrl = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes(LogicalName='$($col.LogicalName)')?" + '$select=MetadataId'
    $attr   = Invoke-RestMethod -Method Get -Uri $getUrl -Headers $h -ErrorAction Stop
    return [string]$attr.MetadataId
}

function New-BooleanColumn([hashtable]$h, [string]$entity, [hashtable]$col) {
    $defaultVal = if ($col.DefaultValue) { $true } else { $false }

    $body = [ordered]@{
        '@odata.type'  = 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata'
        SchemaName     = $col.LogicalName
        RequiredLevel  = [ordered]@{ Value = $col.Required }
        DefaultValue   = $defaultVal
        DisplayName    = [ordered]@{
            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
            LocalizedLabels = @(
                [ordered]@{
                    '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'
                    Label         = $col.DisplayName
                    LanguageCode  = 1033
                }
            )
        }
        OptionSet = [ordered]@{
            '@odata.type' = 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata'
            TrueOption    = [ordered]@{
                Value = 1
                Label = [ordered]@{
                    '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
                    LocalizedLabels = @(
                        [ordered]@{
                            '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'
                            Label         = 'Yes'
                            LanguageCode  = 1033
                        }
                    )
                }
            }
            FalseOption = [ordered]@{
                Value = 0
                Label = [ordered]@{
                    '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
                    LocalizedLabels = @(
                        [ordered]@{
                            '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'
                            Label         = 'No'
                            LanguageCode  = 1033
                        }
                    )
                }
            }
        }
    } | ConvertTo-Json -Depth 15

    $createUrl = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes"
    Invoke-RestMethod -Method Post -Uri $createUrl -Headers $h -Body $body | Out-Null

    $getUrl = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes(LogicalName='$($col.LogicalName)')?" + '$select=MetadataId'
    $attr   = Invoke-RestMethod -Method Get -Uri $getUrl -Headers $h -ErrorAction Stop
    return [string]$attr.MetadataId
}

function Add-ToSolution([hashtable]$h, [string]$metadataId) {
    $body = [ordered]@{
        ComponentId                     = $metadataId
        ComponentType                   = 2
        SolutionUniqueName              = $Solution
        AddRequiredComponents           = $false
        IncludedComponentSettingsValues = $null
    } | ConvertTo-Json -Depth 5

    Invoke-RestMethod -Method Post -Uri "$ApiBase/AddSolutionComponent" -Headers $h -Body $body | Out-Null
}

function Publish-Entity([hashtable]$h, [string]$entity) {
    $body = @{
        ParameterXml = "<importexportxml><entities><entity>$entity</entity></entities></importexportxml>"
    } | ConvertTo-Json

    Invoke-RestMethod -Method Post -Uri "$ApiBase/PublishXml" -Headers $h -Body $body | Out-Null
}

# ── Main ──────────────────────────────────────────────────────────────────
$totalColumns = ($ColumnsByEntity | ForEach-Object { $_.Columns.Count } | Measure-Object -Sum).Sum

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "  CGMP — Enhancement Batch 3 Schema Columns" -ForegroundColor White
Write-Host "  Tenant:   $TenantId"
Write-Host "  Org:      $OrgUrl"
Write-Host "  Solution: $Solution"
Write-Host "  Columns:  $totalColumns across $($ColumnsByEntity.Count) entities"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor DarkGray

$token   = Get-AccessToken
$headers = Get-ApiHeaders $token

$totalCreated = 0
$totalSkipped = 0

foreach ($entityGroup in $ColumnsByEntity) {
    $entity  = $entityGroup.Entity
    $columns = $entityGroup.Columns

    Write-Step "Entity: $entity ($($columns.Count) column(s))"
    Assert-EntityExists $headers $entity

    $entityCreated = 0

    foreach ($col in $columns) {
        if (Test-ColumnExists $headers $entity $col.LogicalName) {
            Write-Skip "$($col.LogicalName) ($($col.Type)) — already exists"
            $totalSkipped++
        } else {
            Write-Host "   + $($col.DisplayName) ($($col.LogicalName), $($col.Type))" `
                -NoNewline -ForegroundColor White

            $metadataId = switch ($col.Type) {
                'Boolean' { New-BooleanColumn $headers $entity $col }
                'String'  { New-StringColumn  $headers $entity $col }
                default   { Write-Fail "Unknown column type '$($col.Type)'" }
            }

            Write-Host "  [created]" -NoNewline -ForegroundColor Green
            Add-ToSolution $headers $metadataId
            Write-Host "  [→ $Solution]" -ForegroundColor Green

            $entityCreated++
            $totalCreated++
        }
    }

    if ($entityCreated -gt 0) {
        Write-Step "Publishing entity '$entity'"
        Publish-Entity $headers $entity
        Write-OK "Published '$entity'"
    }
}

Write-Host ""
Write-OK "$totalCreated column(s) created  |  $totalSkipped already existed"

if ($SkipExport -or $totalCreated -eq 0) {
    if ($totalCreated -eq 0) { Write-Warn "All columns already existed — nothing to export" }
    else { Write-Warn "-SkipExport: solution export skipped" }
} else {
    Write-Step "Exporting updated solution to source control"
    & (Join-Path $PSScriptRoot 'deploy-schema.ps1') -Action export
}

Write-Host ""
Write-Host "  ✅  Done." -ForegroundColor Green
Write-Host ""

if ($totalCreated -gt 0) {
    Write-Host "  Columns created:" -ForegroundColor White
    Write-Host "    • cgmp_uatrequired      (Boolean)  on cgmp_change" -ForegroundColor Gray
    Write-Host "    • cgmp_changepoc        (Text 200)  on cgmp_change" -ForegroundColor Gray
    Write-Host "    • cgmp_assignedlocations (Text 500) on cgmp_userprofile" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    1.  git diff solutions/CgmpOptionSets/" -ForegroundColor Gray
    Write-Host "    2.  npm run regen    (if a regen script exists)" -ForegroundColor Gray
    Write-Host "    3.  npm run build" -ForegroundColor Gray
    Write-Host ""
}
