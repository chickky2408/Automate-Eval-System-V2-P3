"""
Regression test for a security-audit finding (2026-09-16): POST /v1/upload/init
took the client-supplied upload_id and interpolated it directly into
filesystem paths (tmp_path/part_dir) with no sanitization at all -- unlike
target_filename, sanitized on the very next line via Path(target).name. A
value like "../../../../some/writable/path/x" let a caller (this endpoint
has no auth, by design, matching the rest of the agent API) make the server
create directories and write files far outside uploads/_agent_tmp -- an
arbitrary-file-write primitive, not merely a spoofable id.

The real board agent (backend_client.py) never supplies its own upload_id;
it always lets the server generate one and reads it back from the init
response, so restricting the accepted shape breaks no real usage.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import pytest


@pytest.mark.asyncio
async def test_path_traversal_upload_id_rejected():
    from db.database import init_db
    await init_db()
    from main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.post("/v1/upload/init", json={
        "upload_id": "../../../../tmp/evil",
        "target_filename": "capture.bin.lz4", "part_size_bytes": 8388608,
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_normal_upload_id_still_accepted():
    from db.database import init_db
    await init_db()
    from main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.post("/v1/upload/init", json={
        "upload_id": "abc-123_def",
        "target_filename": "capture.bin.lz4", "part_size_bytes": 8388608,
    })
    assert resp.status_code == 200
    assert resp.json()["upload_id"] == "abc-123_def"


@pytest.mark.asyncio
async def test_server_generated_upload_id_unaffected():
    from db.database import init_db
    await init_db()
    from main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.post("/v1/upload/init", json={"target_filename": "capture.bin.lz4", "part_size_bytes": 8388608})
    assert resp.status_code == 200
    assert resp.json()["upload_id"]
