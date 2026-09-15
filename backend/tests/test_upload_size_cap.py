"""
Regression test for PROJECT.md B1.10: POST /api/files/upload used to read the
entire request body into memory with no size limit at all -- the 50 MB cap
in SetupPage.jsx is a client-side courtesy check only, trivially bypassed by
any direct API call (curl, a malicious/misbehaving client). Now enforced
server-side, aborting the read once the cap is exceeded rather than buffering
the whole oversized body first.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import pytest
from fastapi.testclient import TestClient

from db.database import init_db


@pytest.mark.asyncio
async def test_oversized_upload_rejected_with_413():
    await init_db()
    from main import app
    client = TestClient(app)
    oversized = b"\x00" * (51 * 1024 * 1024)
    resp = client.post("/api/files/upload", files={"file": ("big.ist", oversized, "application/octet-stream")})
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_normal_upload_still_succeeds():
    await init_db()
    from main import app
    client = TestClient(app)
    resp = client.post("/api/files/upload", files={"file": ("small.ist", b"0xA0020000 1\n", "application/octet-stream")})
    assert resp.status_code == 200


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_oversized_upload_rejected_with_413()
        print("test_oversized_upload_rejected_with_413 OK")
        await test_normal_upload_still_succeeds()
        print("test_normal_upload_still_succeeds OK")

    asyncio.run(_run())
