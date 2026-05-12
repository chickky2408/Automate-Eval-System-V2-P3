@echo off
if "%1"=="up" (
    docker compose up -d
) else if "%1"=="down" (
    docker compose down
) else if "%1"=="compose" (
    docker compose up --build -d
) else if "%1"=="logs" (
    docker compose logs -f eval
) else (
    echo Unknown command: %1
)
