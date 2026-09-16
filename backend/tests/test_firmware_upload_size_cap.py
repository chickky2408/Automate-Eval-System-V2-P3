"""
Regression test for a security-audit finding (2026-09-16): POST /api/boards/{id}/firmware
did `await firmwareFile.read()` with no size cap at all, unlike routers/files.py's
upload path (PROJECT.md B1.10) -- an attacker-controlled body of any size was
fully buffered before being discarded. Now reuses the same
_read_upload_with_size_cap / MAX_UPLOAD_SIZE_BYTES guard.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import io
import pytest


@pytest.mark.asyncio
async def test_oversized_firmware_upload_rejected():
    from db.database import init_db
    from db.orm_models import BoardStatusORM
    from db.database import async_session
    await init_db()

    board_id = "BOARD-1"
    async with async_session() as session:
        row = await session.get(BoardStatusORM, board_id)
        assert row is not None, "seeded demo board BOARD-1 must exist"

    from main import app
    from fastapi.testclient import TestClient
    from routers.files import MAX_UPLOAD_SIZE_BYTES

    client = TestClient(app)
    oversized = b"x" * (MAX_UPLOAD_SIZE_BYTES + 1024)
    resp = client.post(
        f"/api/boards/{board_id}/firmware",
        data={"firmwareVersion": "v9.9.9"},
        files={"firmwareFile": ("fw.bin", io.BytesIO(oversized), "application/octet-stream")},
    )
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_normal_firmware_upload_still_accepted():
    from db.database import init_db
    await init_db()
    from main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.post(
        "/api/boards/BOARD-1/firmware",
        data={"firmwareVersion": "v1.2.3"},
        files={"firmwareFile": ("fw.bin", io.BytesIO(b"small firmware bytes"), "application/octet-stream")},
    )
    assert resp.status_code == 200
