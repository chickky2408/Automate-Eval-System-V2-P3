#!/usr/bin/env bash
# One-shot local dev: Docker Postgres (host :5433) + FastAPI + Vite.
# Usage: from repo root —  bash scripts/dev-local.sh
# Requires: Docker, pipenv (backend), npm (frontend). Root .env optional (DB_USER, DB_PASS, DB_NAME).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Native backend always talks to Postgres published on the host (see docker-compose.yml db ports).
export DB_HOST=127.0.0.1
export DB_PORT="${DB_PORT:-5433}"
export DB_USER="${DB_USER:-eval_admin}"
export DB_PASS="${DB_PASS:-change_me_strong_password}"
export DB_NAME="${DB_NAME:-eval_system}"

echo "[dev-local] Starting Postgres (docker compose db)…"
docker compose up -d db

echo "[dev-local] Waiting for Postgres to accept connections…"
for _ in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

cleanup() {
  echo ""
  echo "[dev-local] Shutting down child processes…"
  local p
  p=$(jobs -p 2>/dev/null || true)
  if [[ -n "${p}" ]]; then
    kill ${p} 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[dev-local] Starting backend (http://0.0.0.0:8000) and frontend (http://localhost:5173)…"
echo "[dev-local] Press Ctrl+C to stop both."
echo ""

( cd "$ROOT/backend" && pipenv run dev ) &
( cd "$ROOT/frontend" && npm run dev ) &
wait
