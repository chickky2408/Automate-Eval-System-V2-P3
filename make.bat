@echo off
setlocal

if "%1"=="" goto help
if "%1"=="help" goto help

:: -------------------------------------------------------
::  Ensure Docker Desktop Linux engine is ready
:: -------------------------------------------------------
:check_docker
docker info >nul 2>&1
if errorlevel 1 (
    echo [WARN] Docker daemon not ready. Waiting 5s...
    timeout /t 5 /nobreak >nul
    goto check_docker
)

:: -------------------------------------------------------
::  Ensure context is desktop-linux
:: -------------------------------------------------------
docker context use desktop-linux >nul 2>&1

:: -------------------------------------------------------
::  Commands
:: -------------------------------------------------------
if "%1"=="up" (
    echo [INFO] Starting stack (dev)...
    docker compose -f docker-compose.yml up --build -d
    if errorlevel 1 goto error
    echo [OK] App running at http://localhost:%APP_PORT%
    if "%APP_PORT%"=="" echo [OK] App running at http://localhost:8000
    goto end
)
if "%1"=="down" (
    echo [INFO] Stopping stack...
    docker compose -f docker-compose.yml down
    goto end
)
if "%1"=="compose" (
    echo [INFO] Building and starting (docker compose up --build -d)...
    docker compose -f docker-compose.yml up --build -d
    if errorlevel 1 goto error
    goto end
)
if "%1"=="prod" (
    echo [INFO] Starting PROD stack...
    docker compose -f docker-compose.prod.yml up --build -d
    if errorlevel 1 goto error
    goto end
)
if "%1"=="dev" (
    echo [INFO] Starting DEV stack...
    docker compose -f docker-compose.yml up --build -d
    if errorlevel 1 goto error
    goto end
)
if "%1"=="stop" (
    echo [INFO] Stopping all stacks...
    docker compose -f docker-compose.yml down
    docker compose -f docker-compose.prod.yml down
    goto end
)
if "%1"=="rebuild" (
    echo [INFO] Rebuilding without cache...
    docker compose -f docker-compose.yml build --no-cache
    docker compose -f docker-compose.yml up -d --force-recreate
    if errorlevel 1 goto error
    goto end
)
if "%1"=="logs" (
    docker compose -f docker-compose.yml logs -f eval
    goto end
)
if "%1"=="ps" (
    docker compose -f docker-compose.yml ps
    goto end
)
if "%1"=="pull" (
    echo [INFO] Pulling latest images...
    docker compose -f docker-compose.yml pull
    goto end
)

echo [ERROR] Unknown command: %1

:help
echo.
echo Eval System V2 - Docker Compose Helper
echo.
echo Usage:   .\make.bat ^<command^>
echo.
echo Commands:
echo   up        Build ^& start dev stack  (http://localhost:8000)
echo   down      Stop dev stack
echo   compose   Same as up (alias)
echo   dev       Start dev stack (docker-compose.yml)
echo   prod      Start prod stack (docker-compose.prod.yml)
echo   stop      Stop both dev and prod stacks
echo   rebuild   Rebuild image without cache and restart
echo   pull      Pull latest base images
echo   logs      Follow container logs (eval service)
echo   ps        List running containers
echo.
goto end

:error
echo.
echo [ERROR] docker compose failed. Run  .\make.bat logs  to see details.
exit /b 1

:end
endlocal
