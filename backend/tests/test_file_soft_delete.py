"""
Regression test for PROJECT.md B1.8: DELETE /api/files/{id} used to hard-delete
the row and disk file unconditionally. It now soft-deletes by default
(status='archived', deleted_at set) -- the row and file stay so existing
references (test_cases.vcd_file_id, get_file, get_file_content) keep
resolving -- and only disappears from the Library listing. `?force=true`
does the previous hard delete, gated by the existing cleanup passcode.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
import pytest
from fastapi.testclient import TestClient

from db.database import init_db, async_session
from db.orm_models import FileORM
from services.file_store import file_store


async def _make_file_on_disk(rel_suffix: str) -> str:
    file_id = str(uuid.uuid4())
    rel = f"uploads/VCD/{rel_suffix}"
    abs_path = file_store.resolve_path(rel)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(b"dummy vcd bytes")
    async with async_session() as session:
        session.add(FileORM(id=file_id, filename=rel_suffix, file_type="VCD",
                             storage_path=rel, size_bytes=15))
        await session.commit()
    return file_id


@pytest.mark.asyncio
async def test_default_delete_is_soft_and_content_still_resolves():
    await init_db()
    file_id = await _make_file_on_disk(f"soft-{uuid.uuid4().hex[:8]}.vcd")
    from main import app
    client = TestClient(app)

    resp = client.delete(f"/api/files/{file_id}")
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "hardDeleted": False}

    # Single-file lookups are NOT status-filtered -- historical references
    # (a test case's vcd_file_id, an agent's download_asset) must still resolve.
    assert client.get(f"/api/files/{file_id}").status_code == 200
    content_resp = client.get(f"/api/files/{file_id}/content")
    assert content_resp.status_code == 200
    assert content_resp.content == b"dummy vcd bytes"


@pytest.mark.asyncio
async def test_soft_deleted_file_excluded_from_library_listing():
    await init_db()
    file_id = await _make_file_on_disk(f"hide-{uuid.uuid4().hex[:8]}.vcd")
    from main import app
    client = TestClient(app)

    client.delete(f"/api/files/{file_id}")
    listing = client.get("/api/files").json()
    assert file_id not in {f["id"] for f in listing}


@pytest.mark.asyncio
async def test_force_delete_without_passcode_is_denied_and_file_survives():
    await init_db()
    file_id = await _make_file_on_disk(f"force-{uuid.uuid4().hex[:8]}.vcd")
    from main import app
    client = TestClient(app)

    resp = client.delete(f"/api/files/{file_id}?force=true")
    assert resp.status_code in (401, 403)
    # Denied force must not have soft- or hard-deleted the file either.
    assert client.get(f"/api/files/{file_id}").status_code == 200


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_default_delete_is_soft_and_content_still_resolves()
        print("test_default_delete_is_soft_and_content_still_resolves OK")
        await test_soft_deleted_file_excluded_from_library_listing()
        print("test_soft_deleted_file_excluded_from_library_listing OK")
        await test_force_delete_without_passcode_is_denied_and_file_survives()
        print("test_force_delete_without_passcode_is_denied_and_file_survives OK")

    asyncio.run(_run())
