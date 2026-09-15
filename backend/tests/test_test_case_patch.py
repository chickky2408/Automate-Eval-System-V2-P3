"""
Regression test for PROJECT.md B1.3: PATCH /test-cases/{id} used to raise
TypeError -> 500 on every call because the router passed firmware_filename=
and tags= to a store method that accepts neither. Now uses a JSON body that
matches services.test_case_store.update_test_case()'s real signature.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
import pytest
from fastapi.testclient import TestClient

from db.database import init_db, async_session
from db.orm_models import TestCaseORM, FileORM


@pytest.mark.asyncio
async def test_patch_test_case_returns_200_and_persists():
    await init_db()
    tc_id = str(uuid.uuid4())
    vcd_id = str(uuid.uuid4())
    bin_id = str(uuid.uuid4())
    async with async_session() as session:
        session.add(FileORM(id=vcd_id, filename="golden.vcd", file_type="VCD",
                             storage_path="uploads/VCD/x.vcd", size_bytes=10))
        session.add(FileORM(id=bin_id, filename="fw.erom", file_type="EROM",
                             storage_path="uploads/EROM/x.erom", size_bytes=10))
        session.add(TestCaseORM(id=tc_id, name="TC before", vcd_file_id=vcd_id))
        await session.commit()

    from main import app
    client = TestClient(app)

    # Previously: 500 TypeError. Now: 200, and all four file slots + config_options
    # are reachable (only name/vcd_file_id were exposed before).
    resp = client.patch(
        f"/api/test-management/test-cases/{tc_id}",
        json={"name": "TC after PATCH", "bin_file_id": bin_id, "config_options": {"sampling_rate_hz": 100000000}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"success": True}

    resp2 = client.get(f"/api/test-management/test-cases/{tc_id}")
    body = resp2.json()
    assert body["name"] == "TC after PATCH"
    assert body["bin_file_id"] == bin_id
    assert body["config_options"] == {"sampling_rate_hz": 100000000}


if __name__ == "__main__":
    import asyncio
    asyncio.run(test_patch_test_case_returns_200_and_persists())
    print("test_patch_test_case_returns_200_and_persists OK")
