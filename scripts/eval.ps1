<#
.SYNOPSIS
    Eval System V2 — PowerShell Helper Script for Docker Deployment (Windows)

.DESCRIPTION
    Convenient wrapper for docker compose commands supporting both dev and production stacks.
#>

param (
    [Parameter(Position = 0)]
    [ValidateSet('dev', 'prod', 'stop', 'restart', 'rebuild', 'logs', 'ps', 'psql', 'help')]
    [string]$Action = 'help',

    [Parameter(Position = 1)]
    [string]$Target = 'dev'
)

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

function Test-DockerRunning {
    $dockerCheck = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[ERROR] Docker is not running or not installed. Please start Docker Desktop.' -ForegroundColor Red
        exit 1
    }
}

function Get-ComposeFile([string]$stack) {
    if ($stack -eq 'prod') {
        return 'docker-compose.prod.yml'
    }
    return 'docker-compose.yml'
}

Test-DockerRunning

switch ($Action) {
    'dev' {
        Write-Host '[INFO] Starting DEV stack (docker-compose.yml)...' -ForegroundColor Cyan
        docker compose -f docker-compose.yml up --build -d
        Write-Host '[OK] Dev stack is running.' -ForegroundColor Green
        Write-Host '     Follow logs with: .\scripts\eval.ps1 logs dev' -ForegroundColor Gray
    }
    'prod' {
        Write-Host '[INFO] Starting PRODUCTION stack (docker-compose.prod.yml)...' -ForegroundColor Cyan
        docker compose -f docker-compose.prod.yml up --build -d
        Write-Host '[OK] Production stack is running at: http://localhost:8000' -ForegroundColor Green
        Write-Host '     Follow logs with: .\scripts\eval.ps1 logs prod' -ForegroundColor Gray
    }
    'stop' {
        Write-Host '[INFO] Stopping stacks...' -ForegroundColor Yellow
        docker compose -f docker-compose.yml down
        docker compose -f docker-compose.prod.yml down
        Write-Host '[OK] Stopped all stacks.' -ForegroundColor Green
    }
    'restart' {
        $file = Get-ComposeFile $Target
        Write-Host "[INFO] Restarting $Target stack using $file..." -ForegroundColor Cyan
        docker compose -f $file restart
        Write-Host '[OK] Restarted.' -ForegroundColor Green
    }
    'rebuild' {
        $file = Get-ComposeFile $Target
        Write-Host "[INFO] Rebuilding $Target image (no-cache)..." -ForegroundColor Cyan
        docker compose -f $file build --no-cache
        docker compose -f $file up -d --force-recreate
        Write-Host "[OK] Rebuilt and started $Target stack." -ForegroundColor Green
    }
    'logs' {
        $file = Get-ComposeFile $Target
        Write-Host "[INFO] Following logs for $Target ($file)... Press Ctrl+C to exit." -ForegroundColor Cyan
        docker compose -f $file logs -f --tail=100
    }
    'ps' {
        Write-Host "`n=== Dev Containers ===" -ForegroundColor Cyan
        docker compose -f docker-compose.yml ps
        Write-Host "`n=== Prod Containers ===" -ForegroundColor Cyan
        docker compose -f docker-compose.prod.yml ps
    }
    'psql' {
        Write-Host '[INFO] Connecting to Postgres via psql...' -ForegroundColor Cyan
        docker exec -it eval-system-db-dev psql -U eval_admin -d eval_system
    }
    Default {
        Write-Host ''
        Write-Host 'Eval System V2 — Docker Helper Script' -ForegroundColor Green
        Write-Host 'Usage: .\scripts\eval.ps1 [command] [target]' -ForegroundColor White
        Write-Host ''
        Write-Host 'Commands:' -ForegroundColor Yellow
        Write-Host '  dev               Start Dev stack (Postgres + App) on http://localhost:8001'
        Write-Host '  prod              Start Prod stack (Postgres + App) on http://localhost:8000'
        Write-Host '  stop              Stop all Docker containers'
        Write-Host '  restart [dev|prod] Restart containers (default: dev)'
        Write-Host '  rebuild [dev|prod] Rebuild Docker image without cache and recreate container'
        Write-Host '  logs    [dev|prod] Follow container logs (default: dev)'
        Write-Host '  ps                List running containers'
        Write-Host '  psql              Open interactive psql CLI in database container'
        Write-Host ''
    }
}
