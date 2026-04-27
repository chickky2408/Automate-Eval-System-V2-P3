"""
Eval System V2 - FastAPI Backend
Main entry point for the API server.
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
from urllib.parse import urlparse

from routers import boards, jobs, results, system, files, notifications, ws, agent, sets, profiles, test_cases, test_commands, job_files
from services.job_queue import job_queue_service
from db.database import init_db


def _print_startup_browser_urls() -> None:
    """Log the URL to open; optional hairpin hint when using a LAN hostname."""
    external_url = (os.getenv("APP_EXTERNAL_URL") or "").strip()
    if not external_url:
        return
    print(f"[STARTUP] Open in browser: {external_url}")
    try:
        parsed = urlparse(external_url)
        host = (parsed.hostname or "").lower()
        if host in ("", "localhost", "127.0.0.1", "::1"):
            return
        # Host-mapped port for 127.0.0.1 (set in docker-compose as APP_PORT)
        env_port = os.getenv("APP_PORT", "").strip()
        if env_port.isdigit():
            hint_port = int(env_port)
        elif parsed.port is not None:
            hint_port = parsed.port
        else:
            hint_port = 443 if (parsed.scheme or "http") == "https" else 8000
        print(
            "[STARTUP] On the server machine only: if that URL fails in your browser, "
            f"try http://127.0.0.1:{hint_port} (same app; some systems block access to your own LAN IP)."
        )
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    print("[STARTUP] Eval System V2 Backend starting...")
    # Initialize database
    await init_db()
    # Initialize services
    await job_queue_service.initialize()
    # Set APP_EXTERNAL_URL in .env (e.g. LAN link for the team)
    _print_startup_browser_urls()
    yield
    # Cleanup
    print("[SHUTDOWN] Eval System V2 Backend shutting down...")
    await job_queue_service.shutdown()


app = FastAPI(
    title="Eval System V2 API",
    description="API for managing Zybo board fleet and test job execution",
    version="2.0.0",
    lifespan=lifespan,
)


@app.exception_handler(FastAPIHTTPException)
async def http_exception_handler(request: Request, exc: FastAPIHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "message": exc.detail if isinstance(exc.detail, str) else "Request error",
            "code": "HTTP_ERROR",
            "details": exc.detail if isinstance(exc.detail, dict) else {},
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "message": "Internal Server Error",
            "code": "INTERNAL_ERROR",
            "details": {},
        },
    )

# CORS: `allow_origins=["*"]` คู่กับ `allow_credentials=True` สเปก CORS ไม่อนุญาต — browser
# อาจ block preflight/PUT เป็น "Load failed" ข้ามพอร์ต (เช่น Vite 5173 → API 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=False,  # JWT ใส่ใน header ไม่ต้องใช้ credentialed CORS
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(boards.router, prefix="/api/boards", tags=["Boards"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["Jobs"])
app.include_router(results.router, prefix="/api/results", tags=["Results"])
app.include_router(system.router, prefix="/api/system", tags=["System"])
app.include_router(files.router, prefix="/api/files", tags=["Files"])
app.include_router(sets.router, prefix="/api/sets", tags=["Sets"])
app.include_router(profiles.router, prefix="/api/profiles", tags=["Profiles"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(test_cases.router, prefix="/api/test-management", tags=["Test Management"])
app.include_router(test_commands.router, prefix="/api/test-commands", tags=["Test Commands"])
app.include_router(job_files.router, prefix="/api/jobs", tags=["Job Files"])
app.include_router(agent.router, prefix="/api/agent", tags=["Agent"])
app.include_router(ws.router, tags=["WebSocket"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "2.0.0"}


# Serve frontend static files (in production, built by Vite → /app/frontend)
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
INDEX_HTML = os.path.join(FRONTEND_DIR, "index.html")

if os.path.isdir(FRONTEND_DIR) and os.path.isfile(INDEX_HTML):
    print(f"[STARTUP] Serving frontend from {FRONTEND_DIR}")

    # Hashed Vite bundles (JS/CSS) under /assets/*
    assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    def _spa_response(full_path: str = ""):
        if full_path:
            candidate = os.path.join(FRONTEND_DIR, full_path)
            # Prevent path traversal outside the frontend dir
            if os.path.isfile(candidate) and os.path.commonpath(
                [os.path.abspath(candidate), FRONTEND_DIR]
            ) == FRONTEND_DIR:
                return FileResponse(candidate)
        return FileResponse(INDEX_HTML)

    # Explicit root (some Starlette versions don't match "/" with {path:path})
    @app.get("/", include_in_schema=False)
    @app.head("/", include_in_schema=False)
    async def serve_spa_root():
        return _spa_response("")

    # SPA fallback: serve the exact file if present, otherwise index.html
    # (keeps API routes intact because they were registered before this)
    @app.get("/{full_path:path}", include_in_schema=False)
    @app.head("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        return _spa_response(full_path)
else:
    print(f"[STARTUP] Frontend dir not found: {FRONTEND_DIR} (API-only mode)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
