"""
Regression test for PROJECT.md B1.10: DELETE /api/files/{id}'s ownership guard
used to be skippable by omitting BOTH X-Acting-Profile-Id and X-Acting-Client-Id
headers entirely -- `if actor_profile or actor_client: ...` meant the check only
ran when at least one header was present. Now it's deny-by-default: a file with
an owner requires the caller to identify as that owner.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
import pytest
from fastapi.testclient import TestClient

from db.database import init_db, async_session
from db.orm_models import FileORM, ProfileORM


async def _make_owned_file() -> tuple[str, str]:
    """Returns (file_id, owner_profile_id)."""
    file_id = str(uuid.uuid4())
    profile_id = str(uuid.uuid4())
    async with async_session() as session:
        session.add(ProfileORM(id=profile_id, name="Owner"))
        session.add(FileORM(id=file_id, filename="owned.vcd", file_type="VCD",
                             storage_path=f"uploads/VCD/{file_id}.vcd", size_bytes=1,
                             owner_id=profile_id))
        await session.commit()
    return file_id, profile_id


@pytest.mark.asyncio
async def test_delete_owned_file_with_no_headers_is_denied():
    await init_db()
    file_id, _ = await _make_owned_file()
    from main import app
    client = TestClient(app)
    # This is the exact bypass: omitting both headers used to skip the check
    # entirely and let the delete through.
    resp = client.delete(f"/api/files/{file_id}")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_owned_file_with_wrong_actor_is_denied():
    await init_db()
    file_id, _ = await _make_owned_file()
    from main import app
    client = TestClient(app)
    resp = client.delete(f"/api/files/{file_id}", headers={"X-Acting-Client-Id": "not-the-owner"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_owned_file_by_actual_owner_succeeds():
    await init_db()
    file_id, profile_id = await _make_owned_file()
    from main import app
    client = TestClient(app)
    resp = client.delete(f"/api/files/{file_id}", headers={"X-Acting-Client-Id": profile_id})
    assert resp.status_code == 200


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_delete_owned_file_with_no_headers_is_denied()
        print("test_delete_owned_file_with_no_headers_is_denied OK")
        await test_delete_owned_file_with_wrong_actor_is_denied()
        print("test_delete_owned_file_with_wrong_actor_is_denied OK")
        await test_delete_owned_file_by_actual_owner_succeeds()
        print("test_delete_owned_file_by_actual_owner_succeeds OK")

    asyncio.run(_run())
