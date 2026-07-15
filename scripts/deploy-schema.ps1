<#
.SYNOPSIS
    Export or import the CgmpOptionSets Dataverse solution.

.DESCRIPTION
    Track 2 — Dataverse schema deployment.
    Manages the full solution lifecycle: export from Dev, unpack for source control,
    pack from source, and import to UAT or Production.

    Actions:
      export          Export unmanaged solution from current auth'd environment
                      and unpack into ./solutions/CgmpOptionSets/ for source control.

      import          Pack solution from source and import (unmanaged) to the
                      specified target environment. Used for Dev → UAT.

      import-managed  Export managed from current auth, then import to target.
                      Used for UAT → Production.

      pack-only       Pack the source into a zip without importing. Useful for
                      inspecting the artifact before deploying.

.PARAMETER Action
    One of: export | import | import-managed | pack-only

.PARAMETER TargetUrl
    The Dataverse org URL for the target environment (required for import actions).
    Example: https://myorg-uat.crm.dynamics.com

.EXAMPLE
    # Export solution from Dev after making schema changes
    .\scripts\deploy-schema.ps1 -Action export

    # Import to UAT
    .\scripts\deploy-schema.ps1 -Action import -TargetUrl https://myorg-uat.crm.dynamics.com

    # Import managed to Production
    .\scripts\deploy-schema.ps1 -Action import-managed -TargetUrl https://myorg-prod.crm.dynamics.com
#>

param (
    [Parameter(Mandatory = $true)]
    [ValidateSet('export', 'import', 'import-managed', 'pack-only')]
    [string]$Action,

    [string]$TargetUrl = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────────
$SolutionName    = 'CgmpOptionSets'
$SolutionSrcDir  = Join-Path $PSScriptRoot '..\solutions\CgmpOptionSets'
$ArtifactsDir    = Join-Path $PSScriptRoot '..\solutions'
$UnmanagedZip    = Join-Path $ArtifactsDir 'CgmpOptionSets_unmanaged.zip'
$ManagedZip      = Join-Path $ArtifactsDir 'CgmpOptionSets_managed.zip'

# Dev environment — always export from here regardless of which PAC auth profile is active.
# The active PAC profile may point to a different org (e.g. Accenture Default).
# Passing --environment overrides it and uses the signed-in user's credentials
# to connect to this specific org.
$DevUrl          = 'https://org3cabab2d.crm.dynamics.com'

# Ensure artifacts dir exists (source dir created on first export)
New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

# ── Helpers ──────────────────────────────────────────────────────────
function Write-Step([string]$msg) { Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   ✓ $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "   ✗ $msg" -ForegroundColor Red; exit 1 }
function Remove-Zip([string]$path) { if (Test-Path $path) { Remove-Item $path -Force } }

function Assert-Pac {
    if (-not (Get-Command pac -ErrorAction SilentlyContinue)) {
        Write-Fail "pac CLI not found. Install from: https://aka.ms/PowerAppsCLI"
    }
    Write-OK "pac CLI: $(pac --version 2>&1 | Select-Object -First 1)"
}

function Assert-Auth {
    $authList = pac auth list 2>&1
    if ($authList -match "No profiles") {
        Write-Fail "No PAC auth profile. Run: pac auth create --url https://org3cabab2d.crm.dynamics.com"
    }
    $authList | Where-Object { $_ -match '\*' } |
        ForEach-Object { Write-Host "   Active env: $_" -ForegroundColor Gray }
}

function Switch-Auth([string]$url) {
    if (-not $url) { return }
    Write-Step "Switching auth to $url"
    pac auth create --url $url
    if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to authenticate to $url" }
    Write-OK "Authenticated to $url"
}

function Export-Unmanaged {
    Write-Step "Exporting unmanaged solution '$SolutionName'"
    Remove-Zip $UnmanagedZip
    pac solution export --name $SolutionName --path $UnmanagedZip --environment $DevUrl
    if ($LASTEXITCODE -ne 0) { Write-Fail "Export failed." }
    Write-OK "Exported → $UnmanagedZip"

    Write-Step "Unpacking solution into source control folder"
    New-Item -ItemType Directory -Path $SolutionSrcDir -Force | Out-Null
    pac solution unpack `
        --zipfile $UnmanagedZip `
        --folder $SolutionSrcDir `
        --processCanvasApps false
    if ($LASTEXITCODE -ne 0) { Write-Fail "Unpack failed." }
    Write-OK "Unpacked → $SolutionSrcDir"

    Remove-Zip $UnmanagedZip
    Write-OK "Temporary zip removed"
}

function Pack-From-Source {
    if (-not (Test-Path (Join-Path $SolutionSrcDir 'solution.xml'))) {
        Write-Fail "solution.xml not found in $SolutionSrcDir. Run export first."
    }
    Write-Step "Packing solution from source"
    Remove-Zip $UnmanagedZip
    pac solution pack `
        --zipfile $UnmanagedZip `
        --folder $SolutionSrcDir
    if ($LASTEXITCODE -ne 0) { Write-Fail "Pack failed." }
    Write-OK "Packed → $UnmanagedZip"
}

function Import-To-Target([string]$zipPath) {
    Write-Step "Importing solution to current environment"
    pac solution import --path $zipPath --activate-plugins
    if ($LASTEXITCODE -ne 0) { Write-Fail "Import failed." }
    Write-OK "Solution imported successfully"
    Remove-Zip $zipPath
}

# ── Main ──────────────────────────────────────────────────────────────
Write-Host "`nCGMP Schema Deployment — Action: $Action" -ForegroundColor White
Write-Step "Checking PAC CLI"
Assert-Pac

switch ($Action) {

    'export' {
        Write-Step "Checking PAC authentication (Dev environment)"
        Assert-Auth
        Export-Unmanaged
        Write-Host @"

  ✅  Export complete.

  Next steps:
     1. Review changes:  git diff solutions/CgmpOptionSets/
     2. Regenerate models (if columns were added):
           pac modelbuilder build --outputDirectory ./src/generated
     3. Commit:  git add solutions/ src/generated/ && git commit
     4. Deploy to UAT:
           .\scripts\deploy-schema.ps1 -Action import -TargetUrl https://<uat>.crm.dynamics.com

"@ -ForegroundColor Green
    }

    'import' {
        if (-not $TargetUrl) { Write-Fail "-TargetUrl is required for 'import'. Example: https://myorg-uat.crm.dynamics.com" }
        Pack-From-Source
        Switch-Auth $TargetUrl
        Import-To-Target $UnmanagedZip
        Write-Host "`n  ✅  Unmanaged import to $TargetUrl complete.`n" -ForegroundColor Green
    }

    'import-managed' {
        if (-not $TargetUrl) { Write-Fail "-TargetUrl is required for 'import-managed'." }

        # Export managed from the currently auth'd Dev/build environment
        Write-Step "Checking PAC authentication (source environment for managed export)"
        Assert-Auth
        Write-Step "Exporting managed solution '$SolutionName'"
        Remove-Zip $ManagedZip
        pac solution export --name $SolutionName --path $ManagedZip --managed --environment $DevUrl
        if ($LASTEXITCODE -ne 0) { Write-Fail "Managed export failed." }
        Write-OK "Managed solution exported → $ManagedZip"

        # Switch to Production and import
        Switch-Auth $TargetUrl
        Write-Step "Importing managed solution to $TargetUrl"
        pac solution import --path $ManagedZip --activate-plugins
        if ($LASTEXITCODE -ne 0) { Write-Fail "Managed import failed." }
        Write-OK "Managed solution imported"
        Remove-Zip $ManagedZip

        Write-Host "`n  ✅  Managed import to $TargetUrl complete.`n" -ForegroundColor Green
    }

    'pack-only' {
        Pack-From-Source
        Write-Host "`n  ✅  Solution packed → $UnmanagedZip  (not imported)`n" -ForegroundColor Green
    }
}
