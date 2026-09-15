import os
os.environ["USE_SQLITE_DEMO"] = "1"
import uuid
import h5py
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from main import app
from db.database import init_db, async_session
from db.orm_models import JobORM, JobTargetORM, TestCaseORM, ResultORM, FileORM, FileType
from services.result_store import result_store
from services.file_store import file_store


@pytest.mark.asyncio
async def test_waveform_reading_and_downsampling():
    await init_db()

    res_id = f"res-downsample-{uuid.uuid4().hex[:6]}"
    job_id = f"job-{uuid.uuid4().hex[:6]}"
    target_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())

    # Create a realistic test HDF5 file with 10,000 samples
    h5_rel = f"uploads/WAVEFORM/2026/09/{res_id}.h5"
    h5_abs = file_store.resolve_path(h5_rel)
    os.makedirs(os.path.dirname(h5_abs), exist_ok=True)

    n_samples = 10000
    t = np.linspace(0, 1, n_samples)
    sig_ch1 = (np.sin(2 * np.pi * 5 * t) > 0).astype(np.int32)
    sig_ch2 = (np.cos(2 * np.pi * 5 * t) > 0).astype(np.int32)

    with h5py.File(h5_abs, "w") as f:
        f.attrs["time_unit"] = "us"
        f.attrs["total_duration"] = 1.0
        f.attrs["sample_rate_hz"] = 10000.0
        grp = f.create_group("channels")
        ds1 = grp.create_dataset("CH1", data=sig_ch1)
        ds1.attrs["color"] = "#10b981"
        ds2 = grp.create_dataset("CH2", data=sig_ch2)
        ds2.attrs["color"] = "#3b82f6"

    # Seed DB
    async with async_session() as session:
        job = JobORM(id=job_id, name="Downsample Test Job", state="completed")
        session.add(job)
        target = JobTargetORM(id=target_id, job_id=job_id, requested_board_id="kr260-test", status="completed")
        session.add(target)
        tc = TestCaseORM(id=tc_id, name="Downsample TC", vcd_file_id="dummy")
        session.add(tc)
        res = ResultORM(
            id=res_id,
            job_id=job_id,
            job_target_id=target_id,
            test_case_id=tc_id,
            status="completed",
            passed=True,
            execution_order=1
        )
        session.add(res)
        f_row = FileORM(
            id=str(uuid.uuid4()),
            filename=f"{res_id}.h5",
            file_type=FileType.WAVEFORM,
            storage_path=h5_rel,
            result_id=res_id,
            size_bytes=os.path.getsize(h5_abs),
            checksum_sha256="dummy-sha"
        )
        session.add(f_row)
        await session.commit()

    # 1. Test result_store.get_waveform with downsampling (max_samples=1000)
    wf_downsampled = await result_store.get_waveform(res_id, max_samples=1000)
    assert wf_downsampled is not None
    assert len(wf_downsampled.channels) == 2
    assert len(wf_downsampled.channels[0].data) == 1000
    assert wf_downsampled.channels[0].color == "#10b981"

    # 2. Test result_store.get_waveform with max_samples=0 (full resolution)
    wf_full = await result_store.get_waveform(res_id, max_samples=0)
    assert wf_full is not None
    assert len(wf_full.channels[0].data) == n_samples

    # 3. Test HTTP API GET /api/results/{id}/waveform?max_samples=500
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/results/{res_id}/waveform?max_samples=500")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["channels"]) == 2
        assert len(body["channels"][0]["data"]) == 500
        assert body["time_unit"] == "us"

    # Clean up file
    if os.path.exists(h5_abs):
        os.remove(h5_abs)
