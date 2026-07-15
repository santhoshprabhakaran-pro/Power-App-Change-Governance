<#
.SYNOPSIS
    Add all Dataverse schema changes needed to unlock Group A enhancements.

.DESCRIPTION
    Adds columns to existing entities and creates three new custom tables:

    Existing entity changes:
      cgmp_change       — cgmp_pirstatus (Choice), + cgmp_parentchangeid via relationship
      cgmp_notification — cgmp_acknowledgedby (Text), cgmp_acknowledgedat (DateTime)
      cgmp_userprofile  — cgmp_notificationcategories (Memo), cgmp_isactive (Boolean),
                          cgmp_quiethoursstart (Integer), cgmp_quiethoursend (Integer),
                          cgmp_powerbiurl (Text)

    New tables:
      cgmp_changetemplate   — 13 columns  (#1  Change Templates)
      cgmp_blackoutperiod   — 5 columns   (#10 Blackout Calendar)
      cgmp_notificationrule — 4 columns   (#95 Notification Rules UI)

    Relationships (lookup columns):
      cgmp_change_parentchange — self-referential OTM on cgmp_change (#5 Dependency Linking)

    Enhancements unlocked after running this script + regenerating TypeScript models:
      #1 #5 #10 #45 #52 #86 #94 #95 #96 #97 #103 #132 #136

    Authentication: Az module → Azure CLI → browser PKCE (same as other add-*.ps1 scripts).
    The script is idempotent — existing columns/entities/relationships are skipped.

.PARAMETER SkipExport
    Skip the solution export step after schema changes.

.PARAMETER Port
    Local port for the browser OAuth redirect listener. Default: 8400.

.EXAMPLE
    .\scripts\add-group-a-schema.ps1
    .\scripts\add-group-a-schema.ps1 -SkipExport
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

# ── Columns on existing entities ──────────────────────────────────────────
$ColumnsByEntity = @(
    @{
        Entity  = 'cgmp_change'
        Columns = @(
            @{
                LogicalName  = 'cgmp_pirstatus'
                DisplayName  = 'PIR Status'
                Type         = 'Choice'
                Required     = 'None'
                DefaultValue = 100000000
                Options      = @(
                    @{ Value = 100000000; Label = 'Draft'     }
                    @{ Value = 100000001; Label = 'Submitted' }
                    @{ Value = 100000002; Label = 'Approved'  }
                    @{ Value = 100000003; Label = 'Rejected'  }
                )
            }
        )
    }
    @{
        Entity  = 'cgmp_notification'
        Columns = @(
            @{ LogicalName = 'cgmp_acknowledgedby'; DisplayName = 'Acknowledged By'; Type = 'String';   MaxLength = 200; Required = 'None' }
            @{ LogicalName = 'cgmp_acknowledgedat'; DisplayName = 'Acknowledged At'; Type = 'DateTime'; Required = 'None' }
        )
    }
    @{
        Entity  = 'cgmp_userprofile'
        Columns = @(
            @{ LogicalName = 'cgmp_notificationcategories'; DisplayName = 'Notification Categories';  Type = 'Memo';    MaxLength = 4000; Required = 'None' }
            @{ LogicalName = 'cgmp_isactive';               DisplayName = 'Is Active';                Type = 'Boolean'; DefaultValue = $true;  Required = 'None' }
            @{ LogicalName = 'cgmp_quiethoursstart';        DisplayName = 'Quiet Hours Start (0-23)'; Type = 'Integer'; MinValue = 0; MaxValue = 23; Required = 'None' }
            @{ LogicalName = 'cgmp_quiethoursend';          DisplayName = 'Quiet Hours End (0-23)';   Type = 'Integer'; MinValue = 0; MaxValue = 23; Required = 'None' }
            @{ LogicalName = 'cgmp_powerbiurl';             DisplayName = 'Power BI URL';             Type = 'String';  MaxLength = 500; Required = 'None' }
        )
    }
)

# ── New custom tables ─────────────────────────────────────────────────────
$NewEntities = @(
    @{
        SchemaName            = 'cgmp_changetemplate'
        DisplayName           = 'Change Template'
        DisplayCollectionName = 'Change Templates'
        Description           = 'Reusable templates that pre-fill common change type fields'
        Columns               = @(
            @{ LogicalName = 'cgmp_category';    DisplayName = 'Category';       Type = 'String';  MaxLength = 200;  Required = 'None' }
            @{ LogicalName = 'cgmp_changetype';  DisplayName = 'Change Type';    Type = 'String';  MaxLength = 100;  Required = 'None' }
            @{ LogicalName = 'cgmp_risklevel';   DisplayName = 'Risk Level';     Type = 'Integer'; MinValue = 100000000; MaxValue = 100000003; Required = 'None' }
            @{ LogicalName = 'cgmp_impactlevel'; DisplayName = 'Impact Level';   Type = 'Integer'; MinValue = 100000000; MaxValue = 100000003; Required = 'None' }
            @{ LogicalName = 'cgmp_location';    DisplayName = 'Location';       Type = 'String';  MaxLength = 200;  Required = 'None' }
            @{ LogicalName = 'cgmp_region';      DisplayName = 'Region';         Type = 'String';  MaxLength = 100;  Required = 'None' }
            @{ LogicalName = 'cgmp_country';     DisplayName = 'Country';        Type = 'String';  MaxLength = 100;  Required = 'None' }
            @{ LogicalName = 'cgmp_description'; DisplayName = 'Description';    Type = 'Memo';    MaxLength = 4000; Required = 'None' }
            @{ LogicalName = 'cgmp_projectids';  DisplayName = 'Project IDs';    Type = 'Memo';    MaxLength = 2000; Required = 'None' }
            @{ LogicalName = 'cgmp_timeline';    DisplayName = 'Timeline';       Type = 'String';  MaxLength = 200;  Required = 'None' }
            @{ LogicalName = 'cgmp_uatrequired'; DisplayName = 'UAT Required';   Type = 'Boolean'; DefaultValue = $false; Required = 'None' }
            @{ LogicalName = 'cgmp_isemergency'; DisplayName = 'Is Emergency';   Type = 'Boolean'; DefaultValue = $false; Required = 'None' }
            @{ LogicalName = 'cgmp_uatusers';    DisplayName = 'UAT Users JSON'; Type = 'Memo';    MaxLength = 4000; Required = 'None' }
        )
    }
    @{
        SchemaName            = 'cgmp_blackoutperiod'
        DisplayName           = 'Blackout Period'
        DisplayCollectionName = 'Blackout Periods'
        Description           = 'Date ranges during which new changes are blocked from scheduling'
        Columns               = @(
            @{ LogicalName = 'cgmp_startdate';         DisplayName = 'Start Date';         Type = 'DateTime'; Required = 'ApplicationRequired' }
            @{ LogicalName = 'cgmp_enddate';           DisplayName = 'End Date';           Type = 'DateTime'; Required = 'ApplicationRequired' }
            @{ LogicalName = 'cgmp_reason';            DisplayName = 'Reason';             Type = 'String';   MaxLength = 500;  Required = 'None' }
            @{ LogicalName = 'cgmp_affectedlocations'; DisplayName = 'Affected Locations'; Type = 'Memo';     MaxLength = 2000; Required = 'None' }
            @{ LogicalName = 'cgmp_createdbyupn';      DisplayName = 'Created By UPN';     Type = 'String';   MaxLength = 200;  Required = 'None' }
        )
    }
    @{
        SchemaName            = 'cgmp_notificationrule'
        DisplayName           = 'Notification Rule'
        DisplayCollectionName = 'Notification Rules'
        Description           = 'Per-user conditional rules that trigger notifications on matching events'
        Columns               = @(
            @{ LogicalName = 'cgmp_userid';     DisplayName = 'User UPN';    Type = 'String';  MaxLength = 200;  Required = 'ApplicationRequired' }
            @{ LogicalName = 'cgmp_conditions'; DisplayName = 'Conditions';  Type = 'Memo';    MaxLength = 4000; Required = 'None' }
            @{ LogicalName = 'cgmp_eventtype';  DisplayName = 'Event Type';  Type = 'String';  MaxLength = 100;  Required = 'None' }
            @{ LogicalName = 'cgmp_isactive';   DisplayName = 'Is Active';   Type = 'Boolean'; DefaultValue = $true; Required = 'None' }
        )
    }
)

# ── Relationships (lookup columns via One-to-Many) ────────────────────────
$Relationships = @(
    @{
        SchemaName        = 'cgmp_change_parentchange'
        ReferencedEntity  = 'cgmp_change'   # "one" side — the parent
        ReferencingEntity = 'cgmp_change'   # "many" side — where lookup column lives
        LookupSchemaName  = 'cgmp_parentchangeid'
        LookupDisplayName = 'Parent Change'
        LookupDescription = 'The parent change this change depends on (dependency linking)'
        MenuLabel         = 'Dependent Changes'
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

function Test-RelationshipExists([hashtable]$h, [string]$schemaName) {
    try {
        $url = "$ApiBase/RelationshipDefinitions(SchemaName='$schemaName')?" + '$select=SchemaName'
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

function Get-RelationshipMetadataId([hashtable]$h, [string]$schemaName) {
    $url = "$ApiBase/RelationshipDefinitions(SchemaName='$schemaName')?" + '$select=MetadataId'
    $r   = Invoke-RestMethod -Method Get -Uri $url -Headers $h -ErrorAction Stop
    return [string]$r.MetadataId
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

        'Choice' {
            $opts = $col.Options | ForEach-Object {
                $v = $_
                [ordered]@{
                    Value = $v.Value
                    Label = [ordered]@{
                        '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
                        LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $v.Label; LanguageCode = 1033 } )
                    }
                }
            }
            $defVal = if ($col.ContainsKey('DefaultValue')) { $col.DefaultValue } else { $null }
            $body = [ordered]@{
                '@odata.type'    = 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata'
                SchemaName       = $col.LogicalName
                RequiredLevel    = [ordered]@{ Value = $col.Required }
                DefaultFormValue = $defVal
                DisplayName      = $dispName
                OptionSet        = [ordered]@{
                    '@odata.type' = 'Microsoft.Dynamics.CRM.OptionSetMetadata'
                    IsGlobal      = $false
                    OptionSetType = 'Picklist'
                    Options       = @($opts)
                }
            } | ConvertTo-Json -Depth 15
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

# ── Relationship creator ──────────────────────────────────────────────────
function New-Relationship([hashtable]$h, [hashtable]$rel) {
    function Label([string]$text) {
        [ordered]@{
            '@odata.type'   = 'Microsoft.Dynamics.CRM.Label'
            LocalizedLabels = @( [ordered]@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $text; LanguageCode = 1033 } )
        }
    }

    $body = [ordered]@{
        '@odata.type'        = 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata'
        SchemaName           = $rel.SchemaName
        ReferencedEntity     = $rel.ReferencedEntity
        ReferencingEntity    = $rel.ReferencingEntity
        CascadeConfiguration = [ordered]@{
            '@odata.type' = 'Microsoft.Dynamics.CRM.CascadeConfiguration'
            Assign        = 'Cascade'
            Delete        = 'RemoveLink'
            Merge         = 'Cascade'
            Reparent      = 'Cascade'
            Share         = 'Cascade'
            Unshare       = 'Cascade'
        }
        AssociatedMenuConfiguration = [ordered]@{
            '@odata.type' = 'Microsoft.Dynamics.CRM.AssociatedMenuConfiguration'
            Behavior      = 'UseLabel'
            Group         = 'Details'
            Label         = Label $rel.MenuLabel
            Order         = 10000
        }
        Lookup = [ordered]@{
            '@odata.type' = 'Microsoft.Dynamics.CRM.LookupAttributeMetadata'
            SchemaName    = $rel.LookupSchemaName
            RequiredLevel = [ordered]@{ Value = 'None' }
            DisplayName   = Label $rel.LookupDisplayName
            Description   = Label $rel.LookupDescription
        }
    } | ConvertTo-Json -Depth 20

    Invoke-RestMethod -Method Post -Uri "$ApiBase/RelationshipDefinitions" -Headers $h -Body $body | Out-Null
}

# ── Main ──────────────────────────────────────────────────────────────────
$totalExistingCols  = ($ColumnsByEntity | ForEach-Object { $_.Columns.Count } | Measure-Object -Sum).Sum
$totalNewEntityCols = ($NewEntities | ForEach-Object { $_.Columns.Count } | Measure-Object -Sum).Sum

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "  CGMP — Group A Schema Changes" -ForegroundColor White
Write-Host "  Tenant:        $TenantId"
Write-Host "  Org:           $OrgUrl"
Write-Host "  Solution:      $Solution"
Write-Host "  Existing cols: $totalExistingCols across $($ColumnsByEntity.Count) entities"
Write-Host "  New tables:    $($NewEntities.Count) (with $totalNewEntityCols total columns)"
Write-Host "  Relationships: $($Relationships.Count)"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor DarkGray

$token   = Get-AccessToken
$headers = Get-ApiHeaders $token

$totalCreated = 0
$totalSkipped = 0

# ── Phase 1: Columns on existing entities ─────────────────────────────────
Write-Step "Phase 1 — Columns on existing entities"

foreach ($entityGroup in $ColumnsByEntity) {
    $entity  = $entityGroup.Entity
    $columns = $entityGroup.Columns
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

# ── Phase 2: New custom tables ────────────────────────────────────────────
Write-Step "Phase 2 — New custom tables"

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

# ── Phase 3: Relationships ────────────────────────────────────────────────
Write-Step "Phase 3 — Relationships (lookup columns)"

foreach ($rel in $Relationships) {
    if (Test-RelationshipExists $headers $rel.SchemaName) {
        Write-Skip "Relationship '$($rel.SchemaName)' — already exists"
        $totalSkipped++
    } else {
        Write-Host "   + $($rel.SchemaName) ($($rel.LookupSchemaName) on $($rel.ReferencingEntity))" -NoNewline -ForegroundColor White
        New-Relationship $headers $rel
        Write-Host "  [created]" -NoNewline -ForegroundColor Green
        $relMetadataId = Get-RelationshipMetadataId $headers $rel.SchemaName
        Add-ToSolution $headers $relMetadataId 10   # 10 = Relationship
        Write-Host "  [→ $Solution]" -ForegroundColor Green
        $totalCreated++

        Publish-Entity $headers $rel.ReferencedEntity
        Publish-Entity $headers $rel.ReferencingEntity
        Write-OK "Published related entities"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host ""
Write-OK "$totalCreated schema component(s) created  |  $totalSkipped already existed"

if ($SkipExport -or $totalCreated -eq 0) {
    if ($totalCreated -eq 0) { Write-Warn "All schema components already existed — nothing to export" }
    else                     { Write-Warn "-SkipExport: solution export skipped" }
} else {
    Write-Step "Exporting updated solution to source control"
    & (Join-Path $PSScriptRoot 'deploy-schema.ps1') -Action export
}

Write-Host ""
Write-Host "  ✅  Done." -ForegroundColor Green
Write-Host ""

if ($totalCreated -gt 0) {
    Write-Host "  Components created:" -ForegroundColor White
    Write-Host "    cgmp_change       — cgmp_pirstatus (Choice)" -ForegroundColor Gray
    Write-Host "    cgmp_notification — cgmp_acknowledgedby, cgmp_acknowledgedat" -ForegroundColor Gray
    Write-Host "    cgmp_userprofile  — cgmp_notificationcategories, cgmp_isactive, cgmp_quiethoursstart, cgmp_quiethoursend, cgmp_powerbiurl" -ForegroundColor Gray
    Write-Host "    New tables        — cgmp_changetemplate (13 cols), cgmp_blackoutperiod (5 cols), cgmp_notificationrule (4 cols)" -ForegroundColor Gray
    Write-Host "    Relationship      — cgmp_change_parentchange  →  cgmp_parentchangeid lookup on cgmp_change" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    1. Regenerate TypeScript models:" -ForegroundColor Gray
    Write-Host "       pac modelbuilder build --outputDirectory ./src/generated" -ForegroundColor DarkGray
    Write-Host "       OR update src/generated/models/ and src/generated/services/ manually" -ForegroundColor DarkGray
    Write-Host "    2. npm run build" -ForegroundColor Gray
    Write-Host "    3. pac code push" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Enhancements now unblocked:" -ForegroundColor White
    Write-Host "    #1   Change Templates          (cgmp_changetemplate table)" -ForegroundColor Gray
    Write-Host "    #5   Change Dependency Linking (cgmp_parentchangeid)" -ForegroundColor Gray
    Write-Host "    #10  Blackout Calendar         (cgmp_blackoutperiod table)" -ForegroundColor Gray
    Write-Host "    #45  PIR Approval Workflow     (cgmp_pirstatus)" -ForegroundColor Gray
    Write-Host "    #52  Post-PIR Status Badge     (cgmp_pirstatus)" -ForegroundColor Gray
    Write-Host "    #86  PIR Sign-off Workflow     (cgmp_pirstatus)" -ForegroundColor Gray
    Write-Host "    #94  Reply/Acknowledge         (cgmp_acknowledgedby, cgmp_acknowledgedat)" -ForegroundColor Gray
    Write-Host "    #95  Notification Rules UI     (cgmp_notificationrule table)" -ForegroundColor Gray
    Write-Host "    #96  Category Prefs to DV      (cgmp_notificationcategories)" -ForegroundColor Gray
    Write-Host "    #97  Quiet Hours (UI only)     (cgmp_quiethoursstart, cgmp_quiethoursend)" -ForegroundColor Gray
    Write-Host "    #103 User Deactivation         (cgmp_isactive)" -ForegroundColor Gray
    Write-Host "    #132 Category Prefs (same)     (cgmp_notificationcategories)" -ForegroundColor Gray
    Write-Host "    #136 Power BI URL in DV        (cgmp_powerbiurl)" -ForegroundColor Gray
    Write-Host ""
}
