"""
Regression test for PROJECT.md B1.10: GET /api/files/{id}/content used to
expose no integrity signal at all -- the board agent's download_asset() has no
way to verify what it downloaded before flashing it, asymmetric with the
upload path (which hashes every chunk). Now streams via FileResponse and sets
X-Content-SHA256 when the row has a checksum.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import hashlib
import uuid

import pytest
from fastapi.testclient import TestClient

from db.database import init_db


@pytest.mark.asyncio
async def test_content_endpoint_sets_sha256_header_matching_body():
    await init_db()
    from main import app
    client = TestClient(app)

    body = b"sample stimulus bytes for content endpoint check\n"
    upload = client.post("/api/files/upload", files={"file": ("check.ist", body, "application/octet-stream")})
    assert upload.status_code == 200
    file_id = upload.json()["id"]

    resp = client.get(f"/api/files/{file_id}/content")
    assert resp.status_code == 200
    assert resp.content == body
    assert resp.headers.get("x-content-sha256") == hashlib.sha256(body).hexdigest()


@pytest.mark.asyncio
async def test_content_endpoint_404_for_missing_file():
    await init_db()
    from main import app
    client = TestClient(app)
    resp = client.get(f"/api/files/{uuid.uuid4()}/content")
    assert resp.status_code == 404


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_content_endpoint_sets_sha256_header_matching_body()
        print("test_content_endpoint_sets_sha256_header_matching_body OK")
        await test_content_endpoint_404_for_missing_file()
        print("test_content_endpoint_404_for_missing_file OK")

    asyncio.run(_run())
