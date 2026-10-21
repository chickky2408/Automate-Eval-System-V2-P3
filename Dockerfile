# Eval System V2 — single image: Vite build + FastAPI (static + API on port 8000)

# ─── Stage 1: Build frontend ─────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Same-origin API/WebSocket when users open http://<host>:8000
ENV VITE_API_BASE_URL=/api
RUN npm run build

# ─── Stage 2: Download Surfer WASM ───────────────────────────────────────────
FROM alpine:3.19 AS surfer-wasm-download
# Surfer web build (WASM) from latest GitLab CI artifact (main branch)
# Artifact URL: https://gitlab.com/surfer-project/surfer/-/jobs/artifacts/main/download?job=pages
ARG SURFER_ARTIFACT_URL="https://gitlab.com/surfer-project/surfer/-/jobs/artifacts/main/download?job=pages"
RUN apk add --no-cache curl unzip \
    && mkdir -p /surfer_wasm \
    && echo "[Surfer] Downloading WASM build..." \
    && curl -L --fail --retry 3 --retry-delay 5 \
         --output /tmp/surfer_web.zip \
         "${SURFER_ARTIFACT_URL}" \
    && echo "[Surfer] Extracting..." \
    && unzip -q /tmp/surfer_web.zip -d /tmp/surfer_extracted \
    # GitLab pages artifact unpacks into public/ subdirectory
    && if [ -d /tmp/surfer_extracted/public ]; then \
         mv /tmp/surfer_extracted/public/* /surfer_wasm/; \
       else \
         mv /tmp/surfer_extracted/* /surfer_wasm/; \
       fi \
    && rm -rf /tmp/surfer_web.zip /tmp/surfer_extracted \
    && echo "[Surfer] WASM files ready:" \
    && ls /surfer_wasm/ | head -20

# ─── Stage 3: Python runtime ─────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    USE_SQLITE_DEMO=0

# System deps: libpq for PostgreSQL (psycopg2), curl for healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./

# Frontend SPA (built by Vite)
COPY --from=frontend-build /app/frontend/dist ./frontend

# Surfer WASM (served at /surfer/)
COPY --from=surfer-wasm-download /surfer_wasm ./surfer_wasm

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
