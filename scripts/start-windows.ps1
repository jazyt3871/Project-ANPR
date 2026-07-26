<#
.SYNOPSIS
  Project ANPR -- start (Windows).

.DESCRIPTION
  Run this after scripts\install-windows.ps1 has already set up the database
  and built the app. It does not install or configure anything -- it just
  starts the server.

.EXAMPLE
  .\scripts\start-windows.ps1
  Production server on http://localhost:3000

.EXAMPLE
  .\scripts\start-windows.ps1 -Dev
  Dev server, hot reload.

.EXAMPLE
  .\scripts\start-windows.ps1 -Port 8080
  A different port.
#>

[CmdletBinding()]
param(
  [switch]$Dev,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
Set-Location $AppDir

function Die { param($m) Write-Host "`nerror: $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $AppDir ".env"))) {
  Die "no .env found. Run .\scripts\install-windows.ps1 first."
}
if (-not (Test-Path (Join-Path $AppDir "node_modules"))) {
  Die "no node_modules. Run .\scripts\install-windows.ps1 first (or npm install)."
}
if (-not $Dev -and -not (Test-Path (Join-Path $AppDir ".next"))) {
  Die "no production build found. Run 'npm run build' or .\scripts\install-windows.ps1 first, or use -Dev."
}

$env:PORT = "$Port"

Write-Host "Starting on http://localhost:$Port" -ForegroundColor Green
if ($Dev) {
  npm run dev
} else {
  npm start -- --port $Port
}
