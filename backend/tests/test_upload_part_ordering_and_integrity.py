"""
Regression tests for PROJECT.md B4.4: the chunked upload protocol
(/v1/upload/init -> part -> complete) had three bugs:

1. Bytes were appended to the shared destination file as they streamed in,
   BEFORE the per-part SHA-256 was compared -- a rejected part still left its
   (possibly corrupt) bytes in the file.
2. part_index was recorded but never used for positioning; the writer was a
   plain sequential append, so parts arriving out of order corrupted the
   assembled file silently.
3. expected_total_parts was accepted and modeled but never compared against
   what actually arrived on complete().

Each part is now written to its own file keyed by part_index and assembled in
index order at complete() time, after per-part hashes are verified and the
part count/coverage is checked.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"
import hashlib

import pytest
from httpx import ASGITransport, AsyncClient

from main import app
from db.database import init_db


async def _init(client, result_id: str, total_size: int):
    resp = await client.post(
        "/v1/upload/init",
        json={
            "total_size_bytes": total_size,
            "part_size_bytes": 1024 * 1024,
            "target_filename": f"{result_id}.bin",
        },
    )
    assert resp.status_code == 200
    return resp.json()["upload_id"]


async def _put_part(client, upload_id: str, idx: int, data: bytes, sha: str | None = None):
    return await client.put(
        f"/v1/upload/part/{upload_id}/{idx}",
        content=data,
        headers={
            "Content-Type": "application/octet-stream",
            "x-part-sha256": sha or hashlib.sha256(data).hexdigest(),
        },
    )


@pytest.mark.asyncio
async def test_out_of_order_parts_assemble_in_index_order():
    await init_db()
    part_a = b"AAAA" * 1000  # index 0
    part_b = b"BBBB" * 1000  # index 1
    total = part_a + part_b

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_id = await _init(client, "test-order-101", len(total))

        # Upload part 1 BEFORE part 0 -- the old sequential-append writer would
        # have produced BBBB...AAAA... on disk regardless of part_index.
        r1 = await _put_part(client, upload_id, 1, part_b)
        assert r1.status_code == 200
        r0 = await _put_part(client, upload_id, 0, part_a)
        assert r0.status_code == 200

        complete_resp = await client.post(
            f"/v1/upload/complete/{upload_id}",
            json={"expected_total_size_bytes": len(total), "expected_total_parts": 2},
        )
        assert complete_resp.status_code == 200
        assert complete_resp.json()["sha256"] == hashlib.sha256(total).hexdigest()


@pytest.mark.asyncio
async def test_bad_hash_part_is_rejected_and_leaves_no_residue():
    await init_db()
    good = b"GOOD" * 1000
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_id = await _init(client, "test-badhash-101", len(good))

        # Wrong hash -- must be rejected, and must not leave any bytes behind
        # for part 0's slot.
        bad_resp = await _put_part(client, upload_id, 0, good, sha="0" * 64)
        assert bad_resp.status_code == 400

        # Retry with the correct hash must succeed and produce exactly `good`,
        # not `good` twice or corrupted bytes from the rejected attempt.
        good_resp = await _put_part(client, upload_id, 0, good)
        assert good_resp.status_code == 200

        complete_resp = await client.post(
            f"/v1/upload/complete/{upload_id}",
            json={"expected_total_size_bytes": len(good), "expected_total_parts": 1},
        )
        assert complete_resp.status_code == 200
        assert complete_resp.json()["sha256"] == hashlib.sha256(good).hexdigest()


@pytest.mark.asyncio
async def test_complete_rejects_part_count_mismatch():
    await init_db()
    data = b"X" * 100
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_id = await _init(client, "test-countmismatch-101", len(data))
        await _put_part(client, upload_id, 0, data)

        # Client claims 2 parts were sent; only 1 actually arrived.
        resp = await client.post(
            f"/v1/upload/complete/{upload_id}",
            json={"expected_total_parts": 2},
        )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_complete_rejects_missing_part_index_gap():
    await init_db()
    data0 = b"A" * 100
    data2 = b"C" * 100
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        upload_id = await _init(client, "test-gap-101", len(data0) + len(data2))
        await _put_part(client, upload_id, 0, data0)
        # Index 1 never sent; index 2 arrives instead (e.g. client-side bug).
        await _put_part(client, upload_id, 2, data2)

        resp = await client.post(
            f"/v1/upload/complete/{upload_id}",
            json={"expected_total_parts": 2},
        )
        assert resp.status_code == 400
