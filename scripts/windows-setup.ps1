<#
.SYNOPSIS
  Project ANPR — Windows setup.

.DESCRIPTION
  Sets the whole thing up on a Windows PC: Postgres, the database, the photo
  directory, .env, and a production build. Everything stays on this machine.

  To put it on the internet afterwards, use a Cloudflare Tunnel — free, no
  port forwarding, real HTTPS on your own domain. See -Tunnel below and the
  "Running it from a Windows PC" section of the README.

  Dependencies are installed with winget where they are missing. PostGIS is
  NOT required: db/schema.sql detects it and skips the geometry column when it
  is absent, which is the normal case on Windows.

.EXAMPLE
  .\scripts\windows-setup.ps1
  Install, set up the database, build. Then `npm start`.

.EXAMPLE
  .\scripts\windows-setup.ps1 -Check
  Report what is installed and what is missing. Changes nothing.

.EXAMPLE
  .\scripts\windows-setup.ps1 -Tunnel -Domain anpr.example.com
  As above, then print the exact cloudflared commands for that hostname.

.NOTES
  Run from an ordinary PowerShell window — winget will prompt for elevation
  by itself when it needs it. If script execution is blocked, either:
     powershell -ExecutionPolicy Bypass -File .\scripts\windows-setup.ps1
  or unblock this repo once:
     Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#>

[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Tunnel,
  [string]$Domain = "",
  [string]$DbName = "anpr",
  [string]$DbUser = "anpr",
  [string]$DbPassword = "",
  [int]$Port = 3000,
  [string]$UploadDir = "",
  [switch]$Seed,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $AppDir ".env"
if (-not $UploadDir) { $UploadDir = Join-Path $AppDir "storage\uploads" }

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "  [ok] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Write-Info { param($m) Write-Host "       $m" -ForegroundColor DarkGray }
function Die        { param($m) Write-Host "`nerror: $m" -ForegroundColor Red; exit 1 }

function Test-Cmd { param($n) [bool](Get-Command $n -ErrorAction SilentlyContinue) }

# Installing a package puts it on the machine PATH, but this already-running
# process keeps the environment it started with. Re-read it so the very next
# command can find what was just installed.
function Update-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User")
}

# psql is not added to PATH by the Postgres installer; find it where EDB puts it.
function Find-Psql {
  if (Test-Cmd "psql") { return "psql" }
  $candidates = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending
  if ($candidates) { return $candidates[0].FullName }
  return $null
}

# ---------------------------------------------------------------------------
# 0. Dependency report — all of -Check, and the preamble of a real run
# ---------------------------------------------------------------------------
Write-Step "Dependency check"

$psqlPath = Find-Psql

if (Test-Cmd "node") {
  $nodeVersion = (node -v).TrimStart("v")
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -ge 20) { Write-Ok "node $nodeVersion" }
  else { Write-Warn "node $nodeVersion is too old — Next.js 15 needs 20.9+" }
} else { Write-Warn "node missing" }

if (Test-Cmd "npm")  { Write-Ok "npm $(npm -v)" } else { Write-Warn "npm missing" }
if ($psqlPath)       { Write-Ok "psql found at $psqlPath" } else { Write-Warn "postgres missing" }
if (Test-Cmd "winget") { Write-Ok "winget available" } else { Write-Warn "winget missing — install 'App Installer' from the Microsoft Store" }
if (Test-Cmd "cloudflared") { Write-Ok "cloudflared $(cloudflared --version 2>$null)" }
else { Write-Info "cloudflared not installed (only needed for -Tunnel)" }

$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService) { Write-Ok "service $($pgService.Name) is $($pgService.Status)" }
else { Write-Warn "no postgresql service registered" }

if ($Check) {
  Write-Host "`n-Check only: nothing was changed." -ForegroundColor DarkGray
  exit 0
}

# ---------------------------------------------------------------------------
# 1. Install what is missing
# ---------------------------------------------------------------------------
Write-Step "Installing missing dependencies"

if (-not (Test-Cmd "winget")) {
  Die "winget is required to install things automatically. Install 'App Installer' from the Microsoft Store, or install Node 22 and PostgreSQL 16 by hand and re-run."
}

if (-not (Test-Cmd "node") -or [int]((node -v).TrimStart("v").Split(".")[0]) -lt 20) {
  Write-Info "installing Node.js 22 LTS"
  winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  Update-Path
  if (-not (Test-Cmd "node")) { Die "Node install finished but node is still not on PATH — open a new terminal and re-run." }
  Write-Ok "node $(node -v)"
} else { Write-Ok "node already present" }

if (-not $psqlPath) {
  Write-Info "installing PostgreSQL 16 (this one is slow, and it may prompt)"
  # The EDB installer takes the superuser password as a parameter; without it
  # the install is interactive. Generate one and record it in the summary.
  $script:PgSuperPassword = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  winget install --id PostgreSQL.PostgreSQL.16 --silent --accept-package-agreements --accept-source-agreements `
    --custom "--superpassword `"$script:PgSuperPassword`" --enable_acledit 1"
  Update-Path
  $psqlPath = Find-Psql
  if (-not $psqlPath) { Die "PostgreSQL installed but psql.exe was not found. Open a new terminal and re-run." }
  Write-Ok "postgres installed"
  Write-Warn "postgres superuser password: $script:PgSuperPassword"
  Write-Info "write that down — it is the 'postgres' account, separate from the app's own login"
} else { Write-Ok "postgres already present" }

$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService -and $pgService.Status -ne "Running") {
  Start-Service $pgService.Name
  Write-Ok "started $($pgService.Name)"
}

# ---------------------------------------------------------------------------
# 2. Database
# ---------------------------------------------------------------------------
Write-Step "Database"

# Reuse the password already in .env so re-runs do not lock the app out.
if (-not $DbPassword -and (Test-Path $EnvFile)) {
  $existing = Select-String -Path $EnvFile -Pattern '^DATABASE_URL="postgresql://[^:]+:([^@]+)@' -ErrorAction SilentlyContinue
  if ($existing) {
    $DbPassword = $existing.Matches[0].Groups[1].Value
    Write-Info "reusing the database password already in .env"
  }
}
if (-not $DbPassword) {
  $DbPassword = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
}

# psql needs the superuser password; ask unless this run just generated one.
if (-not $script:PgSuperPassword) {
  $secure = Read-Host "Password for the postgres superuser (set when PostgreSQL was installed)" -AsSecureString
  $script:PgSuperPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
$env:PGPASSWORD = $script:PgSuperPassword

function Invoke-Psql {
  param([string]$Database = "postgres", [string]$Sql, [string]$File)
  if ($File) { $out = & $psqlPath -v ON_ERROR_STOP=1 -q -U postgres -h 127.0.0.1 -d $Database -f $File }
  else       { $out = & $psqlPath -v ON_ERROR_STOP=1 -tAq -U postgres -h 127.0.0.1 -d $Database -c $Sql }
  # A native command failing sets $LASTEXITCODE; it does not raise, so an
  # unchecked call would sail past a dead connection and fail confusingly later.
  if ($LASTEXITCODE -ne 0) { Die "psql failed (exit $LASTEXITCODE). See the message above." }
  return $out
}

$null = & $psqlPath -tAq -U postgres -h 127.0.0.1 -d postgres -c "select 1" 2>&1
if ($LASTEXITCODE -ne 0) {
  Die "cannot connect to Postgres as the 'postgres' user — wrong password, or the service is not running."
}

$roleExists = Invoke-Psql -Sql "select 1 from pg_roles where rolname = '$DbUser'"
if ($roleExists -eq "1") {
  Invoke-Psql -Sql "alter role ""$DbUser"" with login password '$DbPassword'" | Out-Null
  Write-Ok "role $DbUser exists (password synced with .env)"
} else {
  Invoke-Psql -Sql "create role ""$DbUser"" with login password '$DbPassword'" | Out-Null
  Write-Ok "created role $DbUser"
}

$dbExists = Invoke-Psql -Sql "select 1 from pg_database where datname = '$DbName'"
if ($dbExists -eq "1") {
  Write-Ok "database $DbName exists"
} else {
  Invoke-Psql -Sql "create database ""$DbName"" owner ""$DbUser""" | Out-Null
  Write-Ok "created database $DbName"
}

Write-Step "Applying db/schema.sql"
# PostGIS is optional — the schema file detects it and skips the geometry
# column when it is missing, which is the normal case on Windows.
Invoke-Psql -Database $DbName -File (Join-Path $AppDir "db\schema.sql")
Invoke-Psql -Database $DbName -Sql "grant all on schema public to ""$DbUser""" | Out-Null
Invoke-Psql -Database $DbName -Sql "grant all privileges on all tables in schema public to ""$DbUser""" | Out-Null
Invoke-Psql -Database $DbName -Sql "grant all privileges on all sequences in schema public to ""$DbUser""" | Out-Null
Write-Ok "schema applied and granted to $DbUser"

$hasPostgis = Invoke-Psql -Database $DbName -Sql "select 1 from pg_extension where extname = 'postgis'"
if ($hasPostgis -eq "1") { Write-Ok "postgis enabled — geometry column is present" }
else { Write-Info "no postgis: geometry column skipped, everything the app uses works without it" }

$env:PGPASSWORD = $null

# ---------------------------------------------------------------------------
# 3. Uploads and .env
# ---------------------------------------------------------------------------
Write-Step "Photo directory and .env"
New-Item -ItemType Directory -Force -Path $UploadDir | Out-Null
Write-Ok "uploads: $UploadDir"

$databaseUrl = "postgresql://${DbUser}:${DbPassword}@127.0.0.1:5432/${DbName}?schema=public&connection_limit=10"

if (Test-Path $EnvFile) {
  # Rewrite only the lines this script owns; anything else stays.
  $lines = Get-Content $EnvFile
  $managed = @{ "DATABASE_URL" = $databaseUrl; "UPLOAD_DIR" = $UploadDir }
  foreach ($key in $managed.Keys) {
    if ($lines -match "^$key=") {
      $lines = $lines | ForEach-Object {
        if ($_ -match "^$key=") { "$key=`"$($managed[$key])`"" } else { $_ }
      }
    } else {
      $lines += "$key=`"$($managed[$key])`""
    }
  }
  $lines | Set-Content $EnvFile -Encoding UTF8
  Write-Ok "updated existing .env"
} else {
  $salt = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
  @"
# Written by scripts\windows-setup.ps1

# Postgres on this machine, over the loopback interface.
DATABASE_URL="$databaseUrl"

# Photos on this machine's disk, served through /api/photos.
UPLOAD_DIR="$UploadDir"

# Submission limits
MAX_UPLOAD_BYTES="8388608"
RATE_LIMIT_PER_HOUR="20"

# Salts the coarse submitter tag stored with each row.
SUBMITTER_SALT="$salt"
"@ | Set-Content $EnvFile -Encoding UTF8
  Write-Ok "wrote $EnvFile"
}

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------
if (-not $SkipBuild) {
  Write-Step "Installing dependencies and building"
  Push-Location $AppDir
  try {
    if (Test-Path (Join-Path $AppDir "package-lock.json")) {
      # npm ci refuses to run when the lockfile has drifted; fall back rather
      # than fail the whole setup.
      npm ci --no-audit --fund=false
      if ($LASTEXITCODE -ne 0) {
        Write-Warn "npm ci failed or out of sync — falling back to npm install"
        npm install --no-audit --fund=false
        if ($LASTEXITCODE -ne 0) { Die "npm install failed" }
      }
    } else {
      npm install --no-audit --fund=false
      if ($LASTEXITCODE -ne 0) { Die "npm install failed" }
    }

    npx prisma generate
    if ($LASTEXITCODE -ne 0) { Die "prisma generate failed" }

    npm run build
    if ($LASTEXITCODE -ne 0) { Die "next build failed" }
    Write-Ok "built"

    if ($Seed) {
      npm run db:seed
      Write-Ok "seeded"
    }
  } finally { Pop-Location }
} else {
  Write-Warn "skipping build (-SkipBuild)"
}

# ---------------------------------------------------------------------------
# 5. Tunnel instructions
# ---------------------------------------------------------------------------
if ($Tunnel) {
  Write-Step "Cloudflare Tunnel"
  if (-not (Test-Cmd "cloudflared")) {
    Write-Info "installing cloudflared"
    winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
    Update-Path
  }
  if (Test-Cmd "cloudflared") { Write-Ok "cloudflared ready" }

  $host_ = if ($Domain) { $Domain } else { "<your-domain>" }
  Write-Host @"

  Your domain's nameservers must point at Cloudflare first (add the site at
  dash.cloudflare.com, it walks you through it). Then, once:

    cloudflared tunnel login
    cloudflared tunnel create project-anpr
    cloudflared tunnel route dns project-anpr $host_

  And to serve it (leave this running, alongside ``npm start``):

    cloudflared tunnel run --url http://localhost:$Port project-anpr

  To keep it running without a terminal open, install it as a service:

    cloudflared service install

"@ -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
Write-Host @"

Project ANPR is set up.

  start it        npm start          (then http://localhost:$Port)
  photos          $UploadDir
  env             $EnvFile
  database        psql -U $DbUser -h 127.0.0.1 $DbName

  Rebuild after a git pull:
    git pull; .\scripts\windows-setup.ps1

  Note: the GPS and compass steps need HTTPS. On http://localhost they work
  fine, but over your LAN or a plain-HTTP address they do not — which is what
  the Cloudflare Tunnel (-Tunnel) is for.

"@ -ForegroundColor Green
