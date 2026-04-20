#!/usr/bin/env bash
# Eval System V2 — one-stop helper script for Docker deployment
#
# Usage:
#   ./scripts/eval.sh demo              # start demo mode (SQLite) on :8001
#   ./scripts/eval.sh prod              # start production mode (Postgres) on :8000
#   ./scripts/eval.sh stop              # stop both stacks
#   ./scripts/eval.sh restart [demo|prod]
#   ./scripts/eval.sh logs  [demo|prod] # tail logs
#   ./scripts/eval.sh ps                # show running containers
#   ./scripts/eval.sh rebuild [demo|prod]
#   ./scripts/eval.sh backup            # pg_dump to ./backups/YYYYmmdd-HHMM.sql
#   ./scripts/eval.sh restore <file>    # restore a pg_dump .sql file
#   ./scripts/eval.sh shell [demo|prod] # exec bash inside the app container
#   ./scripts/eval.sh psql              # psql into the Postgres container
#   ./scripts/eval.sh clean             # stop + remove volumes (DANGER: wipes data)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

DEMO_FILE="docker-compose.yml"
PROD_FILE="docker-compose.prod.yml"

# ---------- colors ----------
if [[ -t 1 ]]; then
    C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'
    C_BLUE=$'\033[1;34m';  C_DIM=$'\033[2m';      C_RESET=$'\033[0m'
else
    C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_DIM=""; C_RESET=""
fi

info()  { echo "${C_BLUE}[info]${C_RESET} $*"; }
ok()    { echo "${C_GREEN}[ok]${C_RESET}   $*"; }
warn()  { echo "${C_YELLOW}[warn]${C_RESET} $*"; }
die()   { echo "${C_RED}[err]${C_RESET}  $*" >&2; exit 1; }

# ---------- preconditions ----------
require_docker() {
    command -v docker >/dev/null 2>&1 || die "Docker is not installed. https://docs.docker.com/get-docker/"
    docker info >/dev/null 2>&1 || die "Docker daemon is not running. Start Docker Desktop / colima first."
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is required (docker compose)."
}

ensure_env_file() {
    if [[ ! -f .env ]]; then
        if [[ -f .env.example ]]; then
            warn ".env not found — copying from .env.example"
            cp .env.example .env
            warn "Please edit .env and change DB_PASS before exposing the service."
        else
            die "Missing .env and .env.example. Cannot continue."
        fi
    fi
}

compose_file_for() {
    case "${1:-}" in
        demo) echo "${DEMO_FILE}" ;;
        prod) echo "${PROD_FILE}" ;;
        *)    die "Unknown target '$1' (expected: demo | prod)" ;;
    esac
}

app_url_for() {
    case "${1:-}" in
        demo) echo "http://localhost:8001" ;;
        prod)
            local port="${APP_PORT:-8000}"
            if [[ -f .env ]]; then
                local p
                p=$(grep -E '^APP_PORT=' .env | tail -n1 | cut -d= -f2- || true)
                [[ -n "$p" ]] && port="$p"
            fi
            echo "http://localhost:${port}"
            ;;
    esac
}

# ---------- commands ----------
cmd_demo() {
    require_docker
    info "Starting DEMO stack (SQLite)..."
    docker compose -f "${DEMO_FILE}" up --build -d
    ok "Demo is up → $(app_url_for demo)"
    echo "${C_DIM}Follow logs:  ./scripts/eval.sh logs demo${C_RESET}"
}

cmd_prod() {
    require_docker
    ensure_env_file
    info "Starting PRODUCTION stack (PostgreSQL + app)..."
    docker compose -f "${PROD_FILE}" up --build -d
    ok "Production is up → $(app_url_for prod)"
    echo "${C_DIM}Follow logs:  ./scripts/eval.sh logs prod${C_RESET}"
}

cmd_stop() {
    require_docker
    info "Stopping both stacks (if running)..."
    docker compose -f "${DEMO_FILE}" down || true
    docker compose -f "${PROD_FILE}" down || true
    ok "Stopped."
}

cmd_restart() {
    local target="${1:-prod}"
    local f; f=$(compose_file_for "$target")
    require_docker
    info "Restarting ${target}..."
    docker compose -f "$f" restart
    ok "Restarted."
}

cmd_rebuild() {
    local target="${1:-prod}"
    local f; f=$(compose_file_for "$target")
    require_docker
    [[ "$target" == "prod" ]] && ensure_env_file
    info "Rebuilding ${target} (no cache, force recreate)..."
    # --no-cache forces Dockerfile layers to re-run (picks up requirements.txt / code changes
    # even when Docker's legacy builder misses the diff).
    # --force-recreate ensures a new container is started with the fresh image.
    docker compose -f "$f" build --no-cache
    docker compose -f "$f" up -d --force-recreate
    ok "Rebuilt. URL → $(app_url_for "$target")"
}

cmd_logs() {
    local target="${1:-prod}"
    local f; f=$(compose_file_for "$target")
    require_docker
    docker compose -f "$f" logs -f --tail=200
}

cmd_ps() {
    require_docker
    echo "${C_BLUE}-- demo --${C_RESET}"
    docker compose -f "${DEMO_FILE}" ps || true
    echo
    echo "${C_BLUE}-- prod --${C_RESET}"
    docker compose -f "${PROD_FILE}" ps || true
}

cmd_shell() {
    local target="${1:-prod}"
    local f; f=$(compose_file_for "$target")
    require_docker
    docker compose -f "$f" exec eval bash || docker compose -f "$f" exec eval sh
}

cmd_psql() {
    require_docker
    ensure_env_file
    # Load DB creds from .env
    # shellcheck disable=SC1091
    set -a; source .env; set +a
    docker compose -f "${PROD_FILE}" exec db \
        psql -U "${DB_USER:-eval_admin}" -d "${DB_NAME:-eval_system}"
}

cmd_backup() {
    require_docker
    ensure_env_file
    set -a; source .env; set +a
    mkdir -p backups
    local stamp; stamp="$(date +%Y%m%d-%H%M)"
    local out="backups/${stamp}.sql"
    info "Dumping Postgres → ${out}"
    docker compose -f "${PROD_FILE}" exec -T db \
        pg_dump -U "${DB_USER:-eval_admin}" "${DB_NAME:-eval_system}" > "$out"
    ok "Backup saved to ${out} ($(du -h "$out" | cut -f1))"
}

cmd_restore() {
    local file="${1:-}"
    [[ -n "$file" ]] || die "Usage: $0 restore <backup.sql>"
    [[ -f "$file" ]] || die "File not found: $file"
    require_docker
    ensure_env_file
    set -a; source .env; set +a
    warn "About to restore '${file}' into database '${DB_NAME:-eval_system}'."
    read -r -p "Type YES to continue: " confirm
    [[ "$confirm" == "YES" ]] || die "Aborted."
    docker compose -f "${PROD_FILE}" exec -T db \
        psql -U "${DB_USER:-eval_admin}" -d "${DB_NAME:-eval_system}" < "$file"
    ok "Restore complete."
}

cmd_tunnel() {
    require_docker
    ensure_env_file
    info "Starting Cloudflare Quick Tunnel (public HTTPS URL for the team)..."
    info "If the prod stack is not running yet, it will be started first."
    docker compose -f "${PROD_FILE}" --profile tunnel up -d --build

    info "Waiting for tunnel URL (≈10s)..."
    local url=""
    for _ in $(seq 1 30); do
        url=$(docker compose -f "${PROD_FILE}" logs tunnel 2>/dev/null \
            | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' \
            | tail -n1 || true)
        [[ -n "$url" ]] && break
        sleep 1
    done

    echo
    if [[ -n "$url" ]]; then
        ok "Public URL ready:"
        echo "  ${C_GREEN}${url}${C_RESET}"
        echo
        echo "${C_DIM}Share this link with your team — works from any network.${C_RESET}"
        echo "${C_DIM}Tunnel keeps running in the background. Stop with:${C_RESET}"
        echo "${C_DIM}  ./scripts/eval.sh tunnel-stop${C_RESET}"
    else
        warn "Could not find the public URL in tunnel logs yet."
        warn "Check manually:  ./scripts/eval.sh logs prod  (look for trycloudflare.com)"
    fi
}

cmd_tunnel_stop() {
    require_docker
    info "Stopping Cloudflare Tunnel (app stays running)..."
    docker compose -f "${PROD_FILE}" --profile tunnel stop tunnel || true
    docker compose -f "${PROD_FILE}" --profile tunnel rm -f tunnel || true
    ok "Tunnel stopped. App is still up at $(app_url_for prod)"
}

cmd_tunnel_url() {
    require_docker
    local url
    url=$(docker compose -f "${PROD_FILE}" logs tunnel 2>/dev/null \
        | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' \
        | tail -n1 || true)
    if [[ -n "$url" ]]; then
        echo "$url"
    else
        die "No tunnel URL found. Is the tunnel running? Try: ./scripts/eval.sh tunnel"
    fi
}

cmd_clean() {
    require_docker
    warn "This will REMOVE all containers AND VOLUMES (pg_data, eval_data, eval_uploads)."
    warn "All jobs, uploads, and database content will be PERMANENTLY LOST."
    read -r -p "Type DELETE to confirm: " confirm
    [[ "$confirm" == "DELETE" ]] || die "Aborted."
    docker compose -f "${DEMO_FILE}" down -v || true
    docker compose -f "${PROD_FILE}" down -v || true
    ok "Cleaned."
}

cmd_help() {
    cat <<EOF
${C_GREEN}Eval System V2 — Docker helper${C_RESET}

Usage: ./scripts/eval.sh <command> [args]

${C_BLUE}Lifecycle:${C_RESET}
  demo                  Start demo mode (SQLite)       → http://localhost:8001
  prod                  Start production (PostgreSQL)  → http://localhost:8000
  stop                  Stop both stacks
  restart [demo|prod]   Restart containers (default: prod)
  rebuild [demo|prod]   Rebuild image and restart (default: prod)
  clean                 Stop and delete ALL volumes (destructive)

${C_BLUE}Observe:${C_RESET}
  ps                    Show running containers
  logs [demo|prod]      Tail logs (default: prod)
  shell [demo|prod]     Open a shell inside the app container

${C_BLUE}Database (prod only):${C_RESET}
  psql                  Open psql in the Postgres container
  backup                Dump DB to ./backups/YYYYmmdd-HHMM.sql
  restore <file>        Restore a .sql dump

${C_BLUE}Public access (Cloudflare Tunnel):${C_RESET}
  tunnel                Start a public HTTPS URL (https://*.trycloudflare.com)
                        Share with the team — works from ANY network.
  tunnel-url            Print the current public URL
  tunnel-stop           Stop the tunnel (app keeps running locally)

EOF
}

# ---------- dispatch ----------
cmd="${1:-help}"; shift || true
case "$cmd" in
    demo)     cmd_demo "$@" ;;
    prod)     cmd_prod "$@" ;;
    stop)     cmd_stop "$@" ;;
    restart)  cmd_restart "$@" ;;
    rebuild)  cmd_rebuild "$@" ;;
    logs)     cmd_logs "$@" ;;
    ps)       cmd_ps "$@" ;;
    shell)    cmd_shell "$@" ;;
    psql)     cmd_psql "$@" ;;
    backup)   cmd_backup "$@" ;;
    restore)  cmd_restore "$@" ;;
    tunnel)       cmd_tunnel "$@" ;;
    tunnel-url)   cmd_tunnel_url "$@" ;;
    tunnel-stop)  cmd_tunnel_stop "$@" ;;
    clean)    cmd_clean "$@" ;;
    help|-h|--help) cmd_help ;;
    *) cmd_help; die "Unknown command: $cmd" ;;
esac
