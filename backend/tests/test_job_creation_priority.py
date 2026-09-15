"""
Regression test for PROJECT.md B4.2: POST /api/jobs hardcoded priority=0 at
creation, with priority only settable to 10 via a query param on the separate
/{job_id}/start endpoint -- undiscoverable, and effectively made "set priority
before running" a two-step dance. JobCreatePayload now accepts an optional
priority: "high" | "normal" at creation, using the same vocabulary /start
already used.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import JobORM


@pytest.mark.asyncio
async def test_create_job_with_high_priority():
    await init_db()
    from main import app
    client = TestClient(app)

    resp = client.post("/api/jobs", json={"name": "prio-high-job", "priority": "high"})
    assert resp.status_code == 200
    job_id = resp.json()["id"]

    async with async_session() as session:
        job = (await session.execute(select(JobORM).where(JobORM.id == job_id))).scalar_one()
        assert job.priority == 10


@pytest.mark.asyncio
async def test_create_job_without_priority_defaults_normal():
    await init_db()
    from main import app
    client = TestClient(app)

    resp = client.post("/api/jobs", json={"name": "prio-default-job"})
    assert resp.status_code == 200
    job_id = resp.json()["id"]

    async with async_session() as session:
        job = (await session.execute(select(JobORM).where(JobORM.id == job_id))).scalar_one()
        assert job.priority == 0


@pytest.mark.asyncio
async def test_create_job_rejects_invalid_priority_value():
    await init_db()
    from main import app
    client = TestClient(app)

    resp = client.post("/api/jobs", json={"name": "prio-bad-job", "priority": "urgent"})
    assert resp.status_code == 422
