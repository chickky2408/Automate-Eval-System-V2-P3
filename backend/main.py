"""
Eval System V2 - FastAPI Backend
Main entry point for the API server.
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

from routers import boards, jobs, results, system, files, notifications, ws, agent, sets, profiles, test_cases, test_commands, job_files
from services.job_queue import job_queue_service
from db.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    print("[STARTUP] Eval System V2 Backend starting...")
    # Initialize database
    await init_db()
    # Initialize services
    await job_queue_service.initialize()
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

# CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
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


# Serve frontend static files (in production)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
