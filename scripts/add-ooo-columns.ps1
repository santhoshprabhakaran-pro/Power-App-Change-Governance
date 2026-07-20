<#
.SYNOPSIS
    Add Out of Office (OOO) management columns to cgmp_userprofile in Dataverse.

.DESCRIPTION
    Creates two new Single Line of Text columns on the cgmp_userprofile entity
    to support ISM Out of Office scheduling:

      cgmp_ooostart  — OOO start date stored as "YYYY-MM-DD" ISO string
      cgmp_oooend    — OOO end date stored as "YYYY-MM-DD" ISO string

    Both are optional (None required level). The app code reads and writes these
    fields via type-cast access, so no model regeneration is required to use them;
    however running 'npm run regen' after this script will add them to the
    generated TypeScript interface for full type safety.

    Authentication is attempted in order:
      1. Az PowerShell module  (Get-AzAccessToken — instant if already logged in)
      2. Azure CLI             (az account get-access-token — instant if already logged in)
      3. Browser sign-in       (Authorization Code + PKCE — opens the system browser)

    The script is idempotent: columns that already exist are skipped.

.PARAMETER SkipExport
    Add/verify columns only; skip the solution export step.

.PARAMETER Port
    Local port for the browser OAuth redirect listener. Default: 8400.

.EXAMPLE
    .\scripts\add-ooo-columns.ps1
    .\scripts\add-ooo-columns.ps1 -SkipExport
#>

param (
    [switch]$SkipExport,
    [int]$Port = 8400
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Environment ──────────────────────────────────────────────────────────
$TenantId  = 'e0793d39-0939-496d-b129-198edd916feb'
$OrgUrl    = 'https://org3cabab2d.crm.dynamics.com'
$ApiBase   = "$OrgUrl/api/data/v9.2"
$Solution  = 'CgmpOptionSets'
$Entity    = 'cgmp_userprofile'   # singular logical name for metadata API

$ClientId  = '51f81489-12ee-4a9e-aaae-a2591f45987d'

# ── OOO Columns ──────────────────────────────────────────────────────────
$Columns = @(
    @{
        LogicalName = 'cgmp_ooostart'
        DisplayName = 'OOO Start Date'
        MaxLength   = 10           # "YYYY-MM-DD"
        Required    = 'None'
        Description = 'ISO date (YYYY-MM-DD) when the Primary ISM Out of Office period begins.'
    }
    @{
        LogicalName = 'cgmp_oooend'
        DisplayName = 'OOO End Date'
        MaxLength   = 10
        Required    = 'None'
        Description = 'ISO date (YYYY-MM-DD) when the Primary ISM Out of Office period ends (inclusive).'
    }
)

# ── Helpers ──────────────────────────────────────────────────────────────
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
    $verifier  = [Convert]::ToBase64String($verifierBytes) `
                    -replace '\+', '-' -replace '/', '_' -replace '=', ''
    $sha256    = [Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha256.ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier))
    $challenge = [Convert]::ToBase64String($hashBytes) `
                    -replace '\+', '-' -replace '/', '_' -replace '=', ''

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
        Write-Fail ("Cannot bind to $redirectUri. " +
                    "Close other apps on port $Port, or re-run with -Port <other>.")
    }

    Start-Process $authUrl
    Write-Host "  Waiting for browser sign-in (3-minute timeout)..." -ForegroundColor DarkGray

    $task = $listener.GetContextAsync()
    if (-not $task.Wait(180000)) {
        $listener.Stop()
        Write-Fail "Authentication timed out. Re-run the script and complete sign-in within 3 minutes."
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
    $tokenBody = "grant_type=authorization_code" +
                 "&client_id=$ClientId" +
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

function Assert-EntityExists([hashtable]$h) {
    try {
        $url = "$ApiBase/EntityDefinitions(LogicalName='$Entity')?" + '$select=LogicalName'
        Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop | Out-Null
        Write-OK "Entity '$Entity' confirmed"
    } catch {
        $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        if ($status -eq 404) { Write-Fail "Entity '$Entity' not found. Verify the logical name in the Maker Portal." }
        throw
    }
}

function Test-ColumnExists([hashtable]$h, [string]$logicalName) {
    try {
        $url = "$ApiBase/EntityDefinitions(LogicalName='$Entity')/Attributes(LogicalName='$logicalName')?" + '$select=LogicalName'
        Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop | Out-Null
        return $true
    } catch {
        $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        if ($status -eq 404) { return $false }
        throw
    }
}

function New-StringColumn([hashtable]$h, [hashtable]$col) {
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
        Description = [ordered]@{
            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
            LocalizedLabels = @(
                [ordered]@{
                    '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'
                    Label         = $col.Description
                    LanguageCode  = 1033
                }
            )
        }
    } | ConvertTo-Json -Depth 10

    $createUrl = "$ApiBase/EntityDefinitions(LogicalName='$Entity')/Attributes"
    Invoke-RestMethod -Method Post -Uri $createUrl -Headers $h -Body $body | Out-Null

    $getUrl = "$ApiBase/EntityDefinitions(LogicalName='$Entity')/Attributes(LogicalName='$($col.LogicalName)')?" + '$select=MetadataId'
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

function Publish-Entity([hashtable]$h) {
    $body = @{
        ParameterXml = "<importexportxml><entities><entity>$Entity</entity></entities></importexportxml>"
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$ApiBase/PublishXml" -Headers $h -Body $body | Out-Null
}

# ── Main ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "  CGMP — Add OOO Columns to $Entity" -ForegroundColor White
Write-Host "  Tenant:   $TenantId"
Write-Host "  Org:      $OrgUrl"
Write-Host "  Entity:   $Entity"
Write-Host "  Solution: $Solution"
Write-Host "  Columns:  $($Columns.Count) to check / create"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor DarkGray

$token   = Get-AccessToken
$headers = Get-ApiHeaders $token

Write-Step "Verifying entity exists"
Assert-EntityExists $headers

Write-Step "Checking / creating $($Columns.Count) OOO columns on $Entity"

$created = 0
$skipped = 0

foreach ($col in $Columns) {
    if (Test-ColumnExists $headers $col.LogicalName) {
        Write-Skip "$($col.LogicalName) — already exists"
        $skipped++
    } else {
        Write-Host "   + $($col.DisplayName) ($($col.LogicalName))" -NoNewline -ForegroundColor White
        $id = New-StringColumn $headers $col
        Write-Host "  [created]" -NoNewline -ForegroundColor Green
        Add-ToSolution $headers $id
        Write-Host "  [→ $Solution]" -ForegroundColor Green
        $created++
    }
}

Write-Host ""
Write-OK "$created column(s) created  |  $skipped already existed"

if ($created -gt 0) {
    Write-Step "Publishing entity customizations"
    Publish-Entity $headers
    Write-OK "Entity '$Entity' published"
}

if ($SkipExport) {
    Write-Warn "-SkipExport: solution export skipped"
} elseif ($created -eq 0) {
    Write-Warn "All columns already existed — nothing to export"
} else {
    Write-Step "Exporting updated solution to source control"
    & (Join-Path $PSScriptRoot 'deploy-schema.ps1') -Action export
}

Write-Host ""
Write-Host "  ✅  Done." -ForegroundColor Green
Write-Host ""

if ($created -gt 0 -and -not $SkipExport) {
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    1.  git diff solutions/CgmpOptionSets/" -ForegroundColor Gray
    Write-Host "    2.  npm run regen   (updates generated TypeScript model)" -ForegroundColor Gray
    Write-Host "    3.  npm run build" -ForegroundColor Gray
    Write-Host "    4.  git add solutions/ src/generated/ && git commit" -ForegroundColor Gray
    Write-Host "    5.  pac code push" -ForegroundColor Gray
    Write-Host ""
}
