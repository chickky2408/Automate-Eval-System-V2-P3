"""
Test end-to-end FPGA LZ4 capture and REST chunked upload protocol ingestion.
Verifies that .bin.lz4 files uploaded via /v1/upload/init -> part -> complete
are automatically decompressed and converted into both HDF5 (.h5) and VCD (.vcd) files.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"
import shutil
import tempfile
import lz4.frame
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from main import app
from db.database import init_db


@pytest.mark.asyncio
async def test_lz4_chunked_upload_and_vcd_generation():
    await init_db()

    # 1. Generate sample 128-bit beat FPGA binary data
    sample_count = 1000
    stride_bytes = 16
    raw_bytes = bytearray(sample_count * stride_bytes)
    
    # Put changing values at column 0x0C (byte 12)
    for i in range(sample_count):
        val = 1 if (i % 20 < 10) else 0
        raw_bytes[i * stride_bytes + 0x0C] = val

    # 2. Compress via LZ4
    compressed_data = lz4.frame.compress(bytes(raw_bytes))
    part_size = 1024 * 1024

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step 1: Init Upload
        result_id = "test-res-e2e-101"
        init_resp = await client.post(
            "/v1/upload/init",
            json={
                "total_size_bytes": len(compressed_data),
                "part_size_bytes": part_size,
                "target_filename": f"{result_id}.bin.lz4",
            }
        )
        assert init_resp.status_code == 200
        upload_id = init_resp.json()["upload_id"]

        # Step 2: Upload Part
        import hashlib
        part_sha = hashlib.sha256(compressed_data).hexdigest()
        part_resp = await client.put(
            f"/v1/upload/part/{upload_id}/0",
            content=compressed_data,
            headers={
                "Content-Type": "application/octet-stream",
                "x-part-size": str(len(compressed_data)),
                "x-part-sha256": part_sha,
            }
        )
        assert part_resp.status_code == 200

        # Step 3: Complete Upload
        complete_resp = await client.post(
            f"/v1/upload/complete/{upload_id}",
            json={
                "expected_total_size_bytes": len(compressed_data),
                "expected_total_parts": 1,
            }
        )
        assert complete_resp.status_code == 200
        data = complete_resp.json()
        assert data["status"] == "completed"
        assert data["result_id"] == result_id
        assert data["hdf5_file_path"] is not None
        assert data["vcd_file_path"] is not None

        # Verify files exist on disk
        from services.file_store import file_store
        abs_h5 = file_store.resolve_path(data["hdf5_file_path"])
        abs_vcd = file_store.resolve_path(data["vcd_file_path"])

        assert os.path.exists(abs_h5), f"HDF5 file should exist at {abs_h5}"
        assert os.path.exists(abs_vcd), f"VCD file should exist at {abs_vcd}"
        assert os.path.getsize(abs_h5) > 0
        assert os.path.getsize(abs_vcd) > 0

        # Cleanup generated test files
        try:
            os.remove(abs_h5)
            os.remove(abs_vcd)
        except OSError:
            pass
