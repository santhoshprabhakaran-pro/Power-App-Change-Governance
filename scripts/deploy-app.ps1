<#
.SYNOPSIS
    Deploy the CGMP React Code App to Power Apps.

.DESCRIPTION
    Track 1 — Frontend deployment.
    Builds the React app and pushes it to the Power Apps environment
    defined in power.config.json using pac code push.

.PARAMETER SkipBuild
    Skip the npm build step (use existing ./dist).

.EXAMPLE
    .\scripts\deploy-app.ps1
    .\scripts\deploy-app.ps1 -SkipBuild
#>

param (
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ──────────────────────────────────────────────────────────
function Write-Step([string]$msg) { Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   ✓ $msg" -ForegroundColor Green }
function Write-Fail([string]$msg) { Write-Host "   ✗ $msg" -ForegroundColor Red; exit 1 }

# ── Verify pac CLI ────────────────────────────────────────────────────
Write-Step "Checking PAC CLI"
if (-not (Get-Command pac -ErrorAction SilentlyContinue)) {
    Write-Fail "pac CLI not found. Install the Power Platform CLI: https://aka.ms/PowerAppsCLI"
}
Write-OK "pac CLI found: $(pac --version 2>&1 | Select-Object -First 1)"

# ── Verify authentication ─────────────────────────────────────────────
Write-Step "Checking PAC authentication"
$authList = pac auth list 2>&1
if ($authList -match "No profiles") {
    Write-Fail "No PAC auth profile found. Run: pac auth create --url https://org3cabab2d.crm.dynamics.com"
}
Write-OK "Authenticated"
$authList | Where-Object { $_ -match '\*' } | ForEach-Object { Write-Host "   Active: $_" -ForegroundColor Gray }

# ── Build ─────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step "Building React app (tsc + vite)"
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Build failed. Fix TypeScript/build errors before deploying." }
    Write-OK "Build succeeded → ./dist"
} else {
    Write-Host "   (skipping build — using existing ./dist)" -ForegroundColor Yellow
    if (-not (Test-Path "./dist/index.html")) {
        Write-Fail "./dist/index.html not found. Remove -SkipBuild or run npm run build first."
    }
}

# ── Push ──────────────────────────────────────────────────────────────
Write-Step "Pushing Code App (pac code push)"
pac code push
if ($LASTEXITCODE -ne 0) { Write-Fail "pac code push failed." }
Write-OK "Code App deployed successfully"

Write-Host "`n🚀  Frontend deployment complete.`n" -ForegroundColor Green
