#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE_URL:-http://localhost:8000/api}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

CURL_AUTH=()
if [[ -n "$AUTH_TOKEN" ]]; then
  CURL_AUTH=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi

tmp_files=()
cleanup() {
  for file in "${tmp_files[@]}"; do
    rm -f "$file"
  done
}
trap cleanup EXIT

log() {
  echo "$*" >&2
}

request() {
  local method="$1"
  local url="$2"
  shift 2
  local response http_code body
  response=$(curl -sS -X "$method" "${CURL_AUTH[@]}" "$@" -w "\n%{http_code}" "$url")
  http_code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if [[ "$http_code" =~ ^2 ]]; then
    log "OK ${method} ${url} (${http_code})"
  else
    log "FAIL ${method} ${url} (${http_code})"
    log "$body"
    exit 1
  fi
  printf '%s' "$body"
}

json_get() {
  local path="$1"
  python - "$path" <<'PY'
import json
import re
import sys

path = sys.argv[1]
data = json.load(sys.stdin)
cur = data
parts = re.findall(r'[^.\[\]]+|\[\d+\]', path)
for part in parts:
    if part.startswith('['):
        cur = cur[int(part[1:-1])]
    else:
        cur = cur[part]
if isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

log "Using API base: ${API_BASE}"

log "== System =="
request GET "${API_BASE}/system/health" >/dev/null
request GET "${API_BASE}/system/storage" >/dev/null
request GET "${API_BASE}/system/board-api/status" >/dev/null

log "== Boards =="
boards_json=$(request GET "${API_BASE}/boards")
board_id=$(printf '%s' "$boards_json" | json_get '[0].id' 2>/dev/null || true)
if [[ -n "${board_id:-}" ]]; then
  request GET "${API_BASE}/boards/${board_id}" >/dev/null
  request GET "${API_BASE}/boards/${board_id}/telemetry" >/dev/null
  request POST "${API_BASE}/boards/${board_id}/reboot" >/dev/null
  tmp_fw=$(mktemp /tmp/fw_smoke_XXXX.bin)
  tmp_files+=("$tmp_fw")
  printf 'fw' > "$tmp_fw"
  request POST "${API_BASE}/boards/${board_id}/firmware" \
    -F "firmwareVersion=v2.3.2" \
    -F "firmwareFile=@${tmp_fw}" >/dev/null
  request POST "${API_BASE}/boards/${board_id}/self-test" >/dev/null
  request POST "${API_BASE}/boards/batch" \
    -H "Content-Type: application/json" \
    -d "{\"boardIds\":[\"${board_id}\"],\"action\":\"reboot\"}" >/dev/null
else
  log "No boards returned; skipping board-specific tests"
fi

log "== Jobs =="
job_payload='{"name":"Smoke Job","tag":"Smoke","firmware":"fw_smoke.bin","boards":[],"files":[{"name":"smoke_001.vcd","order":1},{"name":"smoke_002.vcd","order":2}],"configName":"Default"}'
job_json=$(request POST "${API_BASE}/jobs" -H "Content-Type: application/json" -d "$job_payload")
job_id=$(printf '%s' "$job_json" | json_get 'id')
file_id=$(printf '%s' "$job_json" | json_get 'files[0].id' 2>/dev/null || true)

request GET "${API_BASE}/jobs" >/dev/null
request GET "${API_BASE}/jobs/${job_id}" >/dev/null
request POST "${API_BASE}/jobs/${job_id}/start" >/dev/null
request GET "${API_BASE}/jobs/${job_id}/files" >/dev/null

if [[ -n "${file_id:-}" ]]; then
  request POST "${API_BASE}/jobs/${job_id}/files/${file_id}/stop" >/dev/null
  request POST "${API_BASE}/jobs/${job_id}/files/${file_id}/move" \
    -H "Content-Type: application/json" \
    -d '{"direction":"down"}' >/dev/null
else
  log "No job file id found; skipping file actions"
fi

request PATCH "${API_BASE}/jobs/${job_id}" -H "Content-Type: application/json" -d '{"tag":"Smoke-Updated"}' >/dev/null
request GET "${API_BASE}/jobs/${job_id}/export" >/dev/null
request POST "${API_BASE}/jobs/${job_id}/stop" >/dev/null
request POST "${API_BASE}/jobs/stop-all" >/dev/null

log "== Files =="
tmp_upload=$(mktemp /tmp/upload_smoke_XXXX.txt)
tmp_files+=("$tmp_upload")
printf 'smoke file' > "$tmp_upload"
file_json=$(request POST "${API_BASE}/files/upload" -F "file=@${tmp_upload}")
upload_id=$(printf '%s' "$file_json" | json_get 'id')
request GET "${API_BASE}/files" >/dev/null
request GET "${API_BASE}/files/${upload_id}" >/dev/null
request DELETE "${API_BASE}/files/${upload_id}" >/dev/null

log "== Notifications =="
notif_json=$(request GET "${API_BASE}/notifications")
notif_id=$(printf '%s' "$notif_json" | json_get '[0].id' 2>/dev/null || true)
if [[ -n "${notif_id:-}" ]]; then
  request POST "${API_BASE}/notifications/${notif_id}/read" >/dev/null
else
  log "No notifications returned; skipping read"
fi
request POST "${API_BASE}/notifications/read-all" >/dev/null

log "Smoke tests completed"
