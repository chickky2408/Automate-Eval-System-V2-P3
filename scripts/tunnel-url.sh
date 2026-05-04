#!/usr/bin/env bash
# Print the public https://*.trycloudflare.com URL from the tunnel container logs.
# Run after: make prod-tunnel-up

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! docker inspect eval-system-tunnel >/dev/null 2>&1; then
  echo "Tunnel container not found. Start with:" >&2
  echo "  make prod-tunnel-up" >&2
  exit 1
fi

running="$(docker inspect -f '{{.State.Running}}' eval-system-tunnel 2>/dev/null || echo false)"
if [[ "${running}" != "true" ]]; then
  echo "Tunnel container exists but is not running. Try:" >&2
  echo "  make prod-tunnel-up" >&2
  exit 1
fi

echo "Looking for trycloudflare.com in tunnel logs (up to ~45s)…" >&2
for _ in $(seq 1 45); do
  log="$(docker compose -f docker-compose.prod.yml logs tunnel 2>&1 || true)"
  url="$(echo "$log" | grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' | tail -1 || true)"
  if [[ -n "${url}" ]]; then
    echo "$url"
    exit 0
  fi
  sleep 1
done

echo "Could not find a public URL yet. View live logs:" >&2
echo "  make prod-tunnel-logs" >&2
echo "  (search for trycloudflare.com)" >&2
exit 1
