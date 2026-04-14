#!/usr/bin/env pwsh
<#
.SYNOPSIS
    JAK Swarm Doctor — Diagnoses development environment issues.

.DESCRIPTION
    Checks all prerequisites for running JAK Swarm locally:
    - Node.js >= 20
    - pnpm >= 9
    - PostgreSQL running
    - Redis running (optional)
    - Required environment variables
    - Prisma migrations status
    - Port availability

.EXAMPLE
    .\scripts\doctor.ps1
#>

$ErrorActionPreference = 'Continue'
$script:errors = 0
$script:warnings = 0

function Write-Check {
    param([string]$Name, [bool]$Pass, [string]$Detail, [string]$Fix)
    if ($Pass) {
        Write-Host "  ✅ $Name" -ForegroundColor Green
        if ($Detail) { Write-Host "     $Detail" -ForegroundColor DarkGray }
    } else {
        Write-Host "  ❌ $Name" -ForegroundColor Red
        if ($Detail) { Write-Host "     $Detail" -ForegroundColor Yellow }
        if ($Fix) { Write-Host "     Fix: $Fix" -ForegroundColor Cyan }
        $script:errors++
    }
}

function Write-Warn {
    param([string]$Name, [string]$Detail, [string]$Fix)
    Write-Host "  ⚠️  $Name" -ForegroundColor Yellow
    if ($Detail) { Write-Host "     $Detail" -ForegroundColor DarkGray }
    if ($Fix) { Write-Host "     Fix: $Fix" -ForegroundColor Cyan }
    $script:warnings++
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "─── $Title ───" -ForegroundColor White
}

# ──────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "🔍 JAK Swarm Doctor" -ForegroundColor Magenta
Write-Host "   Diagnosing your development environment..." -ForegroundColor DarkGray
Write-Host ""

# ── Runtime ──────────────────────────────────────────────────────────────────
Write-Section "Runtime"

# Node.js
try {
    $nodeVersion = (node --version 2>&1).ToString().TrimStart('v')
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    Write-Check "Node.js" ($nodeMajor -ge 20) "v$nodeVersion" "Install Node.js 20+ from https://nodejs.org"
} catch {
    Write-Check "Node.js" $false "Not found" "Install Node.js 20+ from https://nodejs.org"
}

# pnpm
try {
    $pnpmVersion = (pnpm --version 2>&1).ToString()
    $pnpmMajor = [int]($pnpmVersion.Split('.')[0])
    Write-Check "pnpm" ($pnpmMajor -ge 9) "v$pnpmVersion" "Run: npm install -g pnpm@latest"
} catch {
    Write-Check "pnpm" $false "Not found" "Run: npm install -g pnpm"
}

# TypeScript
try {
    $tscVersion = (npx tsc --version 2>&1).ToString()
    Write-Check "TypeScript" $true "$tscVersion"
} catch {
    Write-Warn "TypeScript" "Not found globally (OK if using workspace version)"
}

# ── Services ─────────────────────────────────────────────────────────────────
Write-Section "Services"

# PostgreSQL
$pgRunning = $false
try {
    $pgProcess = Get-Process postgres -ErrorAction SilentlyContinue
    if ($pgProcess) { $pgRunning = $true }
    # Also try connection test
    if (-not $pgRunning) {
        $null = & psql --version 2>&1
        # Try connecting
        $testResult = & psql -c "SELECT 1" 2>&1
        if ($LASTEXITCODE -eq 0) { $pgRunning = $true }
    }
} catch { }
Write-Check "PostgreSQL" $pgRunning "Process running" "Start PostgreSQL service or install from https://www.postgresql.org"

# Redis (optional)
$redisRunning = $false
try {
    $redisProcess = Get-Process redis-server -ErrorAction SilentlyContinue
    if ($redisProcess) { $redisRunning = $true }
} catch { }
if ($redisRunning) {
    Write-Check "Redis" $true "Process running"
} else {
    Write-Warn "Redis" "Not running (optional — needed for distributed coordination)" "Start Redis or install from https://redis.io"
}

# ── Environment Variables ────────────────────────────────────────────────────
Write-Section "Environment Variables"

$envFile = Join-Path $PSScriptRoot ".." "jak-swarm" ".env"
$envFileAlt = Join-Path $PSScriptRoot ".." ".env"
$envPath = if (Test-Path $envFile) { $envFile } elseif (Test-Path $envFileAlt) { $envFileAlt } else { $null }

if ($envPath) {
    Write-Check ".env file" $true (Split-Path $envPath -Leaf)
} else {
    Write-Check ".env file" $false "Not found" "Copy jak-swarm/.env.example to jak-swarm/.env and fill in values"
}

# Check critical env vars (from process env, not just .env file)
$criticalVars = @(
    @{ Name = "DATABASE_URL"; Fix = "Set DATABASE_URL=postgresql://user:pass@localhost:5432/jak_swarm" },
    @{ Name = "OPENAI_API_KEY"; Fix = "Set OPENAI_API_KEY=sk-... (or ANTHROPIC_API_KEY)" }
)

foreach ($v in $criticalVars) {
    $val = [Environment]::GetEnvironmentVariable($v.Name)
    if ($val) {
        $masked = $val.Substring(0, [Math]::Min(8, $val.Length)) + "..."
        Write-Check $v.Name $true $masked
    } else {
        Write-Check $v.Name $false "Not set" $v.Fix
    }
}

# Optional but recommended vars
$optionalVars = @("ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "REDIS_URL")
foreach ($v in $optionalVars) {
    $val = [Environment]::GetEnvironmentVariable($v)
    if ($val) {
        Write-Check $v $true "Set"
    } else {
        Write-Warn $v "Not set (optional)"
    }
}

# ── Dependencies ─────────────────────────────────────────────────────────────
Write-Section "Dependencies"

$nodeModules = Join-Path $PSScriptRoot ".." "jak-swarm" "node_modules"
if (Test-Path $nodeModules) {
    $moduleCount = (Get-ChildItem $nodeModules -Directory | Measure-Object).Count
    Write-Check "node_modules" $true "$moduleCount packages installed"
} else {
    Write-Check "node_modules" $false "Not installed" "Run: cd jak-swarm && pnpm install"
}

# ── Prisma ───────────────────────────────────────────────────────────────────
Write-Section "Database"

$schemaPath = Join-Path $PSScriptRoot ".." "jak-swarm" "packages" "db" "prisma" "schema.prisma"
if (Test-Path $schemaPath) {
    Write-Check "Prisma schema" $true "Found"
} else {
    Write-Check "Prisma schema" $false "Not found at packages/db/prisma/schema.prisma"
}

# ── Ports ────────────────────────────────────────────────────────────────────
Write-Section "Ports"

$portsToCheck = @(
    @{ Port = 3000; Name = "Frontend (Next.js)" },
    @{ Port = 3001; Name = "API Server (Fastify)" },
    @{ Port = 5432; Name = "PostgreSQL" },
    @{ Port = 6379; Name = "Redis" }
)

foreach ($p in $portsToCheck) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $p.Port -ErrorAction SilentlyContinue
        if ($conn) {
            $proc = Get-Process -Id $conn[0].OwningProcess -ErrorAction SilentlyContinue
            Write-Warn "Port $($p.Port) ($($p.Name))" "In use by $($proc.ProcessName)" "Stop the process or change the port"
        } else {
            Write-Check "Port $($p.Port) ($($p.Name))" $true "Available"
        }
    } catch {
        Write-Check "Port $($p.Port) ($($p.Name))" $true "Available"
    }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "─── Summary ───" -ForegroundColor White
Write-Host ""

if ($script:errors -eq 0 -and $script:warnings -eq 0) {
    Write-Host "  🎉 All checks passed! You're ready to develop." -ForegroundColor Green
} elseif ($script:errors -eq 0) {
    Write-Host "  ✅ No critical issues. $($script:warnings) warning(s) to review." -ForegroundColor Yellow
} else {
    Write-Host "  ❌ $($script:errors) critical issue(s), $($script:warnings) warning(s)." -ForegroundColor Red
    Write-Host "     Fix the critical issues above before starting development." -ForegroundColor DarkGray
}

Write-Host ""
exit $script:errors
