<#
.SYNOPSIS
    Apply all Dataverse schema changes identified in the review findings (F-001 through F-064).

.DESCRIPTION
    Applies schema changes to unlock review-findings enhancements:

    Option set extensions:
      cgmp_userprofile  — cgmp_role: Observer (100000005), ISM Deputy (100000006),
                          Department Admin (100000007)

    Columns on existing entities:
      cgmp_bridge       — cgmp_cancellationreason (Memo 2000)
      cgmp_change       — cgmp_ismsignoffat (DateTime), cgmp_ismsignoffby (String 200),
                          cgmp_isdeleted (Boolean)
      cgmp_userprofile  — cgmp_lastseenat (DateTime)

    New custom tables:
      cgmp_appsetting     — 5 columns  (F-003 Feature Flags)
      cgmp_changehistory  — 5 columns  (F-024 Version History Events)

    Alternate keys:
      cgmp_change — cgmp_changenumber_key on cgmp_changenumber (F-064)

    Auditing:
      Enable Dataverse auditing on cgmp_change, cgmp_bridge, cgmp_userprofile (F-060)

    Manual-only items (documented as comments):
      F-001 Security Roles, F-056 Business Rules, F-058 recipientid lookup,
      F-059 relatedchangeid lookup

    Authentication: Az module → Azure CLI → browser PKCE (same as other add-*.ps1 scripts).
    The script is idempotent — existing columns/entities/options are skipped.

.PARAMETER SkipExport
    Skip the solution export step after schema changes.

.PARAMETER Port
    Local port for the browser OAuth redirect listener. Default: 8400.

.EXAMPLE
    .\Scripts\add-review-findings-schema.ps1
    .\Scripts\add-review-findings-schema.ps1 -SkipExport
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

# ── Option set extensions (F-006) ─────────────────────────────────────────
$OptionSetExtensions = @(
    @{ Entity = 'cgmp_userprofile'; Attribute = 'cgmp_role'; OptionSetName = 'cgmp_userrole'; Value = 100000005; Label = 'Observer'           }
    @{ Entity = 'cgmp_userprofile'; Attribute = 'cgmp_role'; OptionSetName = 'cgmp_userrole'; Value = 100000006; Label = 'ISM Deputy'         }
    @{ Entity = 'cgmp_userprofile'; Attribute = 'cgmp_role'; OptionSetName = 'cgmp_userrole'; Value = 100000007; Label = 'Department Admin'   }
)

# ── Columns on existing entities ──────────────────────────────────────────
$ColumnsByEntity = @(
    @{
        Entity  = 'cgmp_bridge'
        Columns = @(
            @{ LogicalName = 'cgmp_cancellationreason'; DisplayName = 'Cancellation Reason'; Type = 'Memo'; MaxLength = 2000; Required = 'None' }
        )
    }
    @{
        Entity  = 'cgmp_change'
        Columns = @(
            @{ LogicalName = 'cgmp_ismsignoffat'; DisplayName = 'ISM Sign-off At'; Type = 'DateTime'; Required = 'None' }
            @{ LogicalName = 'cgmp_ismsignoffby'; DisplayName = 'ISM Sign-off By'; Type = 'String'; MaxLength = 200; Required = 'None' }
            @{ LogicalName = 'cgmp_isdeleted';    DisplayName = 'Is Deleted';      Type = 'Boolean'; DefaultValue = $false; Required = 'None' }
        )
    }
    @{
        Entity  = 'cgmp_userprofile'
        Columns = @(
            @{ LogicalName = 'cgmp_lastseenat'; DisplayName = 'Last Seen At'; Type = 'DateTime'; Required = 'None' }
        )
    }
)

# ── New custom tables ─────────────────────────────────────────────────────
$NewEntities = @(
    @{
        SchemaName            = 'cgmp_appsetting'
        DisplayName           = 'App Setting'
        DisplayCollectionName = 'App Settings'
        Description           = 'Dataverse-backed feature flags and configuration values'
        Columns               = @(
            @{ LogicalName = 'cgmp_key';         DisplayName = 'Key';         Type = 'String';  MaxLength = 200;  Required = 'None' }
            @{ LogicalName = 'cgmp_value';        DisplayName = 'Value';       Type = 'Memo';    MaxLength = 2000; Required = 'None' }
            @{ LogicalName = 'cgmp_description';  DisplayName = 'Description'; Type = 'Memo';    MaxLength = 1000; Required = 'None' }
            @{ LogicalName = 'cgmp_isenabled';    DisplayName = 'Is Enabled';  Type = 'Boolean'; DefaultValue = $true;  Required = 'None' }
            @{ LogicalName = 'cgmp_environment';  DisplayName = 'Environment'; Type = 'String';  MaxLength = 100;  Required = 'None' }
        )
    }
    @{
        SchemaName            = 'cgmp_changehistory'
        DisplayName           = 'Change History'
        DisplayCollectionName = 'Change History Events'
        Description           = 'Version history events for changes (replaces JSON blob pattern)'
        Columns               = @(
            @{ LogicalName = 'cgmp_changeid';   DisplayName = 'Change ID';   Type = 'String';   MaxLength = 200;  Required = 'None' }
            @{ LogicalName = 'cgmp_eventtype';  DisplayName = 'Event Type';  Type = 'String';   MaxLength = 100;  Required = 'None' }
            @{ LogicalName = 'cgmp_timestamp';  DisplayName = 'Timestamp';   Type = 'DateTime'; Required = 'None' }
            @{ LogicalName = 'cgmp_actor';      DisplayName = 'Actor';       Type = 'String';   MaxLength = 200;  Required = 'None' }
            @{ LogicalName = 'cgmp_details';    DisplayName = 'Details';     Type = 'Memo';     MaxLength = 4000; Required = 'None' }
        )
    }
)

# ── Alternate keys (F-064) ────────────────────────────────────────────────
$AlternateKeys = @(
    @{
        Entity       = 'cgmp_change'
        SchemaName   = 'cgmp_change_changenumber_key'
        DisplayName  = 'Change Number Alternate Key'
        KeyAttributes = @('cgmp_changenumber')
    }
)

# ── Entities to enable auditing on (F-060) ───────────────────────────────
$AuditEntities = @('cgmp_change', 'cgmp_bridge', 'cgmp_userprofile')

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
        Write-Fail "Authentication timed out. Re-run and complete sign-in within 3 minutes."
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

# ── Metadata query helpers ────────────────────────────────────────────────
function Test-EntityExists([hashtable]$h, [string]$entity) {
    try {
        $url = "$ApiBase/EntityDefinitions(LogicalName='$entity')?" + '$select=LogicalName'
        Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop | Out-Null
        return $true
    } catch {
        $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        if ($status -eq 404) { return $false }
        throw
    }
}

function Assert-EntityExists([hashtable]$h, [string]$entity) {
    try {
        $url = "$ApiBase/EntityDefinitions(LogicalName='$entity')?" + '$select=LogicalName,EntitySetName'
        $e   = Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop
        Write-OK "Entity confirmed: $($e.LogicalName)"
    } catch {
        $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        if ($status -eq 404) { Write-Fail "Entity '$entity' not found. Check the logical name." }
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

function Get-AttributeMetadataId([hashtable]$h, [string]$entity, [string]$logicalName) {
    $url  = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes(LogicalName='$logicalName')?" + '$select=MetadataId'
    $attr = Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop
    return [string]$attr.MetadataId
}

function Get-EntityMetadataId([hashtable]$h, [string]$entity) {
    $url = "$ApiBase/EntityDefinitions(LogicalName='$entity')?" + '$select=MetadataId'
    $e   = Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop
    return [string]$e.MetadataId
}

function Add-ToSolution([hashtable]$h, [string]$metadataId, [int]$componentType) {
    # ComponentType: 1=Entity, 2=Attribute, 10=Relationship
    $body = [ordered]@{
        ComponentId                     = $metadataId
        ComponentType                   = $componentType
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

# ── Column creator (dispatches by Type) ───────────────────────────────────
function New-Column([hashtable]$h, [string]$entity, [hashtable]$col) {
    $createUrl  = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes"
    $dispName   = [ordered]@{
        '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
        LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $col.DisplayName; LanguageCode = 1033 } )
    }

    switch ($col.Type) {

        'String' {
            $body = [ordered]@{
                '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'
                SchemaName    = $col.LogicalName
                RequiredLevel = [ordered]@{ Value = $col.Required }
                MaxLength     = $col.MaxLength
                FormatName    = [ordered]@{ Value = 'Text' }
                DisplayName   = $dispName
            } | ConvertTo-Json -Depth 10
        }

        'Memo' {
            $body = [ordered]@{
                '@odata.type' = 'Microsoft.Dynamics.CRM.MemoAttributeMetadata'
                SchemaName    = $col.LogicalName
                RequiredLevel = [ordered]@{ Value = $col.Required }
                MaxLength     = $col.MaxLength
                DisplayName   = $dispName
            } | ConvertTo-Json -Depth 10
        }

        'Boolean' {
            $defVal = if ($col.ContainsKey('DefaultValue') -and $col.DefaultValue) { $true } else { $false }
            $body = [ordered]@{
                '@odata.type' = 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata'
                SchemaName    = $col.LogicalName
                RequiredLevel = [ordered]@{ Value = $col.Required }
                DefaultValue  = $defVal
                DisplayName   = $dispName
                OptionSet     = [ordered]@{
                    '@odata.type' = 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata'
                    TrueOption    = [ordered]@{
                        Value = 1
                        Label = [ordered]@{
                            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
                            LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = 'Yes'; LanguageCode = 1033 } )
                        }
                    }
                    FalseOption = [ordered]@{
                        Value = 0
                        Label = [ordered]@{
                            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
                            LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = 'No'; LanguageCode = 1033 } )
                        }
                    }
                }
            } | ConvertTo-Json -Depth 15
        }

        'Integer' {
            $body = [ordered]@{
                '@odata.type' = 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata'
                SchemaName    = $col.LogicalName
                RequiredLevel = [ordered]@{ Value = $col.Required }
                MinValue      = $col.MinValue
                MaxValue      = $col.MaxValue
                Format        = 'None'
                DisplayName   = $dispName
            } | ConvertTo-Json -Depth 10
        }

        'DateTime' {
            $body = [ordered]@{
                '@odata.type'    = 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata'
                SchemaName       = $col.LogicalName
                RequiredLevel    = [ordered]@{ Value = $col.Required }
                Format           = 'DateAndTime'
                DateTimeBehavior = [ordered]@{ Value = 'UserLocal' }
                DisplayName      = $dispName
            } | ConvertTo-Json -Depth 10
        }

        default { Write-Fail "Unknown column type '$($col.Type)' for '$($col.LogicalName)'" }
    }

    Invoke-RestMethod -Method Post -Uri $createUrl -Headers $h -Body $body | Out-Null
    return Get-AttributeMetadataId $h $entity $col.LogicalName
}

# ── Entity creator ────────────────────────────────────────────────────────
function New-Entity([hashtable]$h, [hashtable]$entityDef) {
    function Label([string]$text) {
        [ordered]@{
            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
            LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $text; LanguageCode = 1033 } )
        }
    }

    $body = [ordered]@{
        '@odata.type'         = 'Microsoft.Dynamics.CRM.EntityMetadata'
        SchemaName            = $entityDef.SchemaName
        DisplayName           = Label $entityDef.DisplayName
        DisplayCollectionName = Label $entityDef.DisplayCollectionName
        Description           = Label $entityDef.Description
        OwnershipType         = 'UserOwned'
        HasActivities         = $false
        HasNotes              = $false
        IsActivity            = $false
        Attributes            = @(
            [ordered]@{
                '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'
                IsPrimaryName = $true
                SchemaName    = 'cgmp_name'
                RequiredLevel = [ordered]@{ Value = 'None' }
                MaxLength     = 300
                FormatName    = [ordered]@{ Value = 'Text' }
                DisplayName   = Label 'Name'
            }
        )
    } | ConvertTo-Json -Depth 20

    Invoke-RestMethod -Method Post -Uri "$ApiBase/EntityDefinitions" -Headers $h -Body $body | Out-Null
}

# ── Option set value adder (F-006) ────────────────────────────────────────
# $optionSetName: pass the logical name of the global option set when the attribute
# is backed by a global (shared) option set — InsertOptionValue rejects entity/attribute
# params in that case (error 0x80048403).
function Add-OptionSetValue([hashtable]$h, [string]$entity, [string]$attribute, [int]$value, [string]$label, [string]$optionSetName = '') {
    $isGlobal = $optionSetName -ne ''

    # Check if value already exists
    try {
        if ($isGlobal) {
            $gos = Invoke-RestMethod -Method Get -Uri "$ApiBase/GlobalOptionSetDefinitions(Name='$optionSetName')" -Headers $h -ErrorAction Stop
            $existing = $gos.Options | Where-Object { $_.Value -eq $value }
        } else {
            $url  = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Attributes(LogicalName='$attribute')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?`$expand=OptionSet(`$select=Options)"
            $resp = Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop
            $existing = $resp.OptionSet.Options | Where-Object { $_.Value -eq $value }
        }
        if ($existing) { Write-Skip "Option $value ($label) already exists on $entity.$attribute"; return }
    } catch { }

    $labelBody = [ordered]@{
        '@odata.type' = 'Microsoft.Dynamics.CRM.Label'
        LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $label; LanguageCode = 1033 } )
    }

    if ($isGlobal) {
        $body = [ordered]@{
            OptionSetName = $optionSetName
            Value         = $value
            Label         = $labelBody
        } | ConvertTo-Json -Depth 10
    } else {
        $body = [ordered]@{
            AttributeLogicalName = $attribute
            EntityLogicalName    = $entity
            Value                = $value
            Label                = $labelBody
        } | ConvertTo-Json -Depth 10
    }

    Invoke-RestMethod -Method Post -Uri "$ApiBase/InsertOptionValue" -Headers $h -Body $body | Out-Null
    Write-OK "Added option $value ($label) to $entity.$attribute"
}

# ── Alternate key creator (F-064) ─────────────────────────────────────────
function New-AlternateKey([hashtable]$h, [string]$entity, [string]$keySchemaName, [string[]]$keyAttributes, [string]$displayName) {
    # Check if key already exists — EntityKeyMetadata only supports MetadataId as its
    # primary key, so use $filter on SchemaName rather than a direct key lookup.
    try {
        $url  = "$ApiBase/EntityDefinitions(LogicalName='$entity')/Keys?`$filter=SchemaName eq '$keySchemaName'&`$select=SchemaName"
        $resp = Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop
        if ($resp.value.Count -gt 0) {
            Write-Skip "Alternate key '$keySchemaName' already exists on $entity"
            return
        }
    } catch { }

    $body = [ordered]@{
        '@odata.type' = 'Microsoft.Dynamics.CRM.EntityKeyMetadata'
        SchemaName    = $keySchemaName
        DisplayName   = [ordered]@{
            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
            LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $displayName; LanguageCode = 1033 } )
        }
        KeyAttributes = @($keyAttributes)
    } | ConvertTo-Json -Depth 10

    Invoke-RestMethod -Method Post -Uri "$ApiBase/EntityDefinitions(LogicalName='$entity')/Keys" -Headers $h -Body $body | Out-Null
    Write-OK "Created alternate key '$keySchemaName' on $entity ($($keyAttributes -join ', '))"
}

# ── Auditing enabler (F-060) ──────────────────────────────────────────────
# Dataverse metadata endpoints return 405 on PATCH — must GET the full entity
# definition, set IsAuditEnabled.Value, then PUT the complete object back.
function Enable-EntityAudit([hashtable]$h, [string]$entity) {
    try {
        $entityDef = Invoke-RestMethod -Method Get -Uri "$ApiBase/EntityDefinitions(LogicalName='$entity')" -Headers $h -ErrorAction Stop

        if ($entityDef.IsAuditEnabled.Value -eq $true) {
            Write-Skip "Auditing already enabled on $entity"
            return
        }

        $entityDef.IsAuditEnabled.Value = $true
        $metadataId = $entityDef.MetadataId

        # @odata.context is a response-only annotation; remove it before PUT
        $entityDef.PSObject.Properties.Remove('@odata.context')

        $body = $entityDef | ConvertTo-Json -Depth 30

        Invoke-RestMethod -Method Put -Uri "$ApiBase/EntityDefinitions($metadataId)" -Headers $h -Body $body | Out-Null
        Write-OK "Enabled auditing on $entity"
    } catch {
        Write-Warn "Could not enable auditing on ${entity}: $($_.Exception.Message)"
    }
}

# ── Main ──────────────────────────────────────────────────────────────────
$totalExistingCols  = ($ColumnsByEntity | ForEach-Object { $_.Columns.Count } | Measure-Object -Sum).Sum
$totalNewEntityCols = ($NewEntities | ForEach-Object { $_.Columns.Count } | Measure-Object -Sum).Sum

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "  CGMP — Review Findings Schema Changes" -ForegroundColor White
Write-Host "  Tenant:        $TenantId"
Write-Host "  Org:           $OrgUrl"
Write-Host "  Solution:      $Solution"
Write-Host "  Option values: $($OptionSetExtensions.Count) (F-006)"
Write-Host "  Existing cols: $totalExistingCols across $($ColumnsByEntity.Count) entities"
Write-Host "  New tables:    $($NewEntities.Count) (with $totalNewEntityCols total columns)"
Write-Host "  Alternate keys: $($AlternateKeys.Count) (F-064)"
Write-Host "  Audit entities: $($AuditEntities.Count) (F-060)"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor DarkGray

$token   = Get-AccessToken
$headers = Get-ApiHeaders $token

$totalCreated = 0
$totalSkipped = 0

# ── Phase 0: F-001 Security Roles documentation ────────────────────────────
Write-Step "Phase 0 — F-001: Security Roles (documentation only)"

# ── F-001: Dataverse Security Roles ────────────────────────────────────────
# Security roles must be created MANUALLY in the Dataverse Admin Center or Maker Portal.
# Navigate to: admin.powerplatform.microsoft.com → Environments → [your env] → Security roles
#
# Create these security roles with the following table permissions:
#
# Role: CGMP User (base role)
#   cgmp_change:     Read
#   cgmp_project:    Read
#   cgmp_bridge:     Read
#   cgmp_notification: Read (own)
#   cgmp_auditlog:   Read
#
# Role: CGMP PMO (inherits CGMP User)
#   cgmp_change:     Read, Create, Write (own), AppendTo
#   cgmp_project:    Read, Create, Write (own)
#   cgmp_notification: Create
#
# Role: CGMP IT Ops (inherits CGMP User)
#   cgmp_change:     Read, Write (team — not Delete)
#   cgmp_bridge:     Read, Create, Write (own)
#
# Role: CGMP ISM (inherits CGMP User)
#   cgmp_change:     Read, Write (team — limited fields only)
#   cgmp_project:    Read, Write (own)
#
# Role: CGMP GIICC (inherits CGMP User)
#   cgmp_change:     Read
#   cgmp_bridge:     Read, Create, Write (own)
#
# Role: CGMP Admin (inherits all above)
#   All tables:      Full access
#   cgmp_userprofile: Read, Create, Write, Delete
#   Field-level security on cgmp_role: restrict to Admin role only
#   cgmp_auditlog:   Read ONLY (no Delete — compliance requirement)
Write-Warn "F-001: Security roles require manual creation — see comments above for full specification"

# ── Phase 1: Option set extensions (F-006) ────────────────────────────────
Write-Step "Phase 1 — F-006: Extend cgmp_role option set on cgmp_userprofile"

foreach ($ext in $OptionSetExtensions) {
    Add-OptionSetValue $headers $ext.Entity $ext.Attribute $ext.Value $ext.Label ([string]$ext.OptionSetName)
}

Publish-Entity $headers 'cgmp_userprofile'
Write-OK "Published 'cgmp_userprofile' (option set extension)"

# ── Phase 2: Columns on existing entities ─────────────────────────────────
Write-Step "Phase 2 — Columns on existing entities (F-017, F-025, F-038, F-061)"

foreach ($entityGroup in $ColumnsByEntity) {
    $entity        = $entityGroup.Entity
    $columns       = $entityGroup.Columns
    $entityCreated = 0

    Write-Host "`n  Entity: $entity" -ForegroundColor White
    Assert-EntityExists $headers $entity

    foreach ($col in $columns) {
        if (Test-ColumnExists $headers $entity $col.LogicalName) {
            Write-Skip "$($col.LogicalName) ($($col.Type)) — already exists"
            $totalSkipped++
        } else {
            Write-Host "   + $($col.DisplayName) ($($col.LogicalName), $($col.Type))" -NoNewline -ForegroundColor White
            $metadataId = New-Column $headers $entity $col
            Write-Host "  [created]" -NoNewline -ForegroundColor Green
            Add-ToSolution $headers $metadataId 2
            Write-Host "  [→ $Solution]" -ForegroundColor Green
            $totalCreated++
            $entityCreated++
        }
    }

    if ($entityCreated -gt 0) {
        Publish-Entity $headers $entity
        Write-OK "Published '$entity'"
    }
}

# ── Phase 3: New custom tables (F-003, F-024) ─────────────────────────────
Write-Step "Phase 3 — New custom tables (F-003 cgmp_appsetting, F-024 cgmp_changehistory)"

foreach ($entityDef in $NewEntities) {
    $entityLogical = $entityDef.SchemaName.ToLower()
    $entityCreated = 0

    Write-Host ""
    if (Test-EntityExists $headers $entityLogical) {
        Write-Skip "Table '$entityLogical' — already exists, checking columns..."
    } else {
        Write-Host "   + Table: $($entityDef.DisplayName) ($entityLogical)" -NoNewline -ForegroundColor White
        New-Entity $headers $entityDef
        Write-Host "  [created]" -NoNewline -ForegroundColor Green
        $entityMetadataId = Get-EntityMetadataId $headers $entityLogical
        Add-ToSolution $headers $entityMetadataId 1   # 1 = Entity
        Write-Host "  [→ $Solution]" -ForegroundColor Green
        $totalCreated++
    }

    foreach ($col in $entityDef.Columns) {
        if (Test-ColumnExists $headers $entityLogical $col.LogicalName) {
            Write-Skip "  $($col.LogicalName) ($($col.Type)) — already exists"
            $totalSkipped++
        } else {
            Write-Host "     + $($col.DisplayName) ($($col.LogicalName), $($col.Type))" -NoNewline -ForegroundColor White
            $metadataId = New-Column $headers $entityLogical $col
            Write-Host "  [created]" -NoNewline -ForegroundColor Green
            Add-ToSolution $headers $metadataId 2   # 2 = Attribute
            Write-Host "  [→ $Solution]" -ForegroundColor Green
            $totalCreated++
            $entityCreated++
        }
    }

    Publish-Entity $headers $entityLogical
    Write-OK "Published '$entityLogical'"
}

# ── Phase 4: Alternate keys (F-064) ──────────────────────────────────────
Write-Step "Phase 4 — F-064: Alternate key on cgmp_changenumber"

foreach ($key in $AlternateKeys) {
    New-AlternateKey $headers $key.Entity $key.SchemaName $key.KeyAttributes $key.DisplayName
}

# ── Phase 5: Enable auditing (F-060) ──────────────────────────────────────
Write-Step "Phase 5 — F-060: Enable Dataverse auditing on key entities"

foreach ($entity in $AuditEntities) {
    Enable-EntityAudit $headers $entity
}

# ── Phase 6: Manual migration notes (F-056, F-058, F-059) ─────────────────
Write-Step "Phase 6 — Manual migration notes"

# ── F-056: Dataverse Business Rules ────────────────────────────────────────
# The following business rules must be created MANUALLY in the Dataverse Maker Portal:
# 1. Rule: "Require End Time After Start Time"
#    Entity: cgmp_change
#    Condition: cgmp_endtime <= cgmp_starttime
#    Action: Show error "End time must be after start time"
# 2. Rule: "Require Future Start Time for Draft"
#    Entity: cgmp_change
#    Condition: cgmp_status == Draft && cgmp_starttime < Today()
#    Action: Show error "Start time must be in the future"
# Navigate to: make.powerapps.com → Solutions → CgmpOptionSets → cgmp_change → Business rules
Write-Warn "F-056: Dataverse business rules require manual creation in Maker Portal (see comments above)"

# ── F-058: cgmp_recipientid Lookup Migration ────────────────────────────────
# To convert cgmp_recipientid from String to Lookup on cgmp_notification:
# This requires: (1) creating a new lookup column, (2) migrating existing string GUIDs to the lookup,
# (3) removing the old string column. This is a data migration, not just a schema change.
# Create manually via Maker Portal and plan a data migration script.
Write-Warn "F-058: recipientid lookup migration requires manual data migration — see comments"

# ── F-059: cgmp_relatedchangeid Lookup Migration ─────────────────────────────
# To convert cgmp_relatedchangeid from String to Lookup on cgmp_task / cgmp_notification:
# This requires: (1) creating a new lookup column pointing to cgmp_change,
# (2) migrating existing string GUIDs to the new lookup column,
# (3) removing the old string column. This is a data migration, not just a schema change.
# Create manually via Maker Portal and plan a data migration script.
Write-Warn "F-059: relatedchangeid lookup migration requires manual data migration — see comments"

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host ""
Write-OK "$totalCreated schema component(s) created  |  $totalSkipped already existed"

if ($SkipExport -or $totalCreated -eq 0) {
    if ($totalCreated -eq 0) { Write-Warn "All schema components already existed — nothing to export" }
    else                     { Write-Warn "-SkipExport: solution export skipped" }
} else {
    Write-Step "Phase 7 — Exporting updated solution to source control"
    & (Join-Path $PSScriptRoot 'deploy-schema.ps1') -Action export
}

Write-Host ""
Write-Host "  ✅  Done." -ForegroundColor Green
Write-Host ""

if ($totalCreated -gt 0) {
    Write-Host "  Components created:" -ForegroundColor White
    Write-Host "    cgmp_userprofile  — cgmp_role options: Observer, ISM Deputy, Department Admin" -ForegroundColor Gray
    Write-Host "    cgmp_bridge       — cgmp_cancellationreason (Memo 2000)" -ForegroundColor Gray
    Write-Host "    cgmp_change       — cgmp_ismsignoffat, cgmp_ismsignoffby, cgmp_isdeleted" -ForegroundColor Gray
    Write-Host "    cgmp_userprofile  — cgmp_lastseenat (DateTime)" -ForegroundColor Gray
    Write-Host "    New table         — cgmp_appsetting (5 cols, F-003)" -ForegroundColor Gray
    Write-Host "    New table         — cgmp_changehistory (5 cols, F-024)" -ForegroundColor Gray
    Write-Host "    Alternate key     — cgmp_change_changenumber_key on cgmp_changenumber (F-064)" -ForegroundColor Gray
    Write-Host "    Auditing          — enabled on cgmp_change, cgmp_bridge, cgmp_userprofile (F-060)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    1. Regenerate TypeScript models:" -ForegroundColor Gray
    Write-Host "       pac modelbuilder build --outputDirectory ./src/generated" -ForegroundColor DarkGray
    Write-Host "       OR update src/generated/models/ and src/generated/services/ manually" -ForegroundColor DarkGray
    Write-Host "    2. npm run build" -ForegroundColor Gray
    Write-Host "    3. pac code push" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Enhancements now unblocked:" -ForegroundColor White
    Write-Host "    F-003  App Settings / Feature Flags  (cgmp_appsetting table)" -ForegroundColor Gray
    Write-Host "    F-006  Extended Role Codes           (Observer, ISM Deputy, Dept Admin)" -ForegroundColor Gray
    Write-Host "    F-017  Cancellation Reason           (cgmp_cancellationreason on cgmp_bridge)" -ForegroundColor Gray
    Write-Host "    F-024  Change History Events         (cgmp_changehistory table)" -ForegroundColor Gray
    Write-Host "    F-025  ISM Sign-off Fields           (cgmp_ismsignoffat, cgmp_ismsignoffby)" -ForegroundColor Gray
    Write-Host "    F-038  Last Seen At                  (cgmp_lastseenat on cgmp_userprofile)" -ForegroundColor Gray
    Write-Host "    F-060  Entity Auditing               (cgmp_change, cgmp_bridge, cgmp_userprofile)" -ForegroundColor Gray
    Write-Host "    F-061  Soft-Delete Flag              (cgmp_isdeleted on cgmp_change)" -ForegroundColor Gray
    Write-Host "    F-064  Alternate Key                 (cgmp_changenumber unique key)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Manual items still required:" -ForegroundColor White
    Write-Host "    F-001  Security roles — see Maker Portal" -ForegroundColor Yellow
    Write-Host "    F-056  Business rules — see Maker Portal" -ForegroundColor Yellow
    Write-Host "    F-058  recipientid lookup — data migration required" -ForegroundColor Yellow
    Write-Host "    F-059  relatedchangeid lookup — data migration required" -ForegroundColor Yellow
    Write-Host ""
}
