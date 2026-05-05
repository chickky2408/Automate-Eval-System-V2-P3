# Eval System — quick commands (see .env.example for prod DB / APP_PORT)
.PHONY: help dev-local up down compose logs db prod-up prod-down prod-logs prod-build prod-tunnel-up prod-tunnel-logs prod-tunnel-url db-cleanup-default-profiles db-cleanup-default-profiles-dry

help:
	@echo "One command local dev (DB in Docker + backend + frontend):"
	@echo "  make dev-local       bash scripts/dev-local.sh — open http://localhost:5173"
	@echo ""
	@echo "Dev (Docker DB only, then: pipenv run dev + npm run dev in frontend/)"
	@echo "  make db              Postgres on host :5433 — same DB as many dev workflows"
	@echo ""
	@echo "Dev stack (DB + app in Docker, UI http://localhost:8001)"
	@echo "  make up | down | compose | logs"
	@echo ""
	@echo "Production-like (built UI + API on http://127.0.0.1:8000 by default)"
	@echo "  make prod-up         docker compose -f docker-compose.prod.yml up --build -d"
	@echo "  make prod-down       stop prod stack"
	@echo "  make prod-logs       follow app logs"
	@echo "  make prod-build      rebuild image only"
	@echo ""
	@echo "Public URL for remote team (Cloudflare Quick Tunnel — any network):"
	@echo "  make prod-tunnel-up   prod stack + tunnel (needs Docker + outbound HTTPS)"
	@echo "  make prod-tunnel-url  print https://....trycloudflare.com (share with team)"
	@echo "  make prod-tunnel-logs follow tunnel logs if URL not found yet"
	@echo ""
	@echo "Feature parity: same app code everywhere. localStorage is per browser URL;"
	@echo "use backend profiles or Profile Export/Import when switching 5173 <-> :8000."
	@echo ""
	@echo "Database housekeeping:"
	@echo "  make db-cleanup-default-profiles-dry   preview deleting profiles named Default*"
	@echo "  make db-cleanup-default-profiles       delete those profiles + sync normalized TC tables"

up:
	docker compose up -d

down:
	docker compose down

compose:
	docker compose up --build -d

logs:
	docker compose logs -f eval

## Only PostgreSQL (native backend + Vite dev = one origin :5173, “fullest” local UX)
db:
	docker compose up -d db

## DB + pipenv (backend :8000) + npm (frontend :5173) in one terminal; Ctrl+C stops all
dev-local:
	bash scripts/dev-local.sh

prod-up:
	docker compose -f docker-compose.prod.yml up --build -d

prod-down:
	docker compose -f docker-compose.prod.yml down

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f eval

prod-build:
	docker compose -f docker-compose.prod.yml build eval

## Cloudflare quick tunnel — public https URL for off-LAN demos (see docker-compose.prod.yml)
prod-tunnel-up:
	docker compose -f docker-compose.prod.yml --profile tunnel up --build -d

prod-tunnel-logs:
	docker compose -f docker-compose.prod.yml logs -f tunnel

prod-tunnel-url:
	@bash scripts/tunnel-url.sh

## Remove profiles whose name starts with "Default" (see backend/scripts/cleanup_default_profiles.sql)
db-cleanup-default-profiles-dry:
	cd backend && pipenv run python scripts/cleanup_default_profiles.py --dry-run

db-cleanup-default-profiles:
	cd backend && pipenv run python scripts/cleanup_default_profiles.py
