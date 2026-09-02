import asyncio
import uuid
import datetime
import numpy as np
import os
import h5py
import hashlib

from db.database import async_session
from db.orm_models import JobORM, ResultORM, FileORM, FileType, JobTargetORM, TestCaseORM
from services.file_store import file_store

async def create_waveform_sample():
    # 1. Create realistic 8-channel waveform in HDF5 format
    result_id = str(uuid.uuid4())[:8]
    job_id = str(uuid.uuid4())[:16]
    n_samples = 3000
    fs = 4000.0  # 4 kHz sampling
    t = np.linspace(0, n_samples / fs, n_samples)
    
    rel_dir = "uploads/WAVEFORM/2026/09"
    os.makedirs(file_store.resolve_path(rel_dir), exist_ok=True)
    rel_path = f"{rel_dir}/{result_id}.h5"
    abs_path = file_store.resolve_path(rel_path)
    
    with h5py.File(abs_path, "w") as f:
        f.attrs["sample_rate_hz"] = fs
        f.attrs["time_unit"] = "s"
        f.attrs["total_duration"] = n_samples / fs
        
        grp = f.create_group("channels")
        # CH1: Clock (500Hz)
        grp.create_dataset("CH1", data=(np.sin(2 * np.pi * 500 * t) > 0).astype(np.int32), compression="gzip")
        # CH2: TX
        grp.create_dataset("CH2", data=((np.sin(2 * np.pi * 250 * t) + np.random.normal(0, 0.05, n_samples)) > 0).astype(np.int32), compression="gzip")
        # CH3: RX
        grp.create_dataset("CH3", data=((np.sin(2 * np.pi * 250 * (t - 0.001)) + np.random.normal(0, 0.05, n_samples)) > 0).astype(np.int32), compression="gzip")
        # CH4: Strobe
        grp.create_dataset("CH4", data=(np.sin(2 * np.pi * 125 * t) > 0.4).astype(np.int32), compression="gzip")
        # CH5: AMS_VCCINT (Analog)
        grp.create_dataset("CH5", data=(np.sin(2 * np.pi * 60 * t) * 0.15 + 1.2).astype(np.float32), compression="gzip")
        # CH6: VCC_AUX (Analog)
        grp.create_dataset("CH6", data=(np.cos(2 * np.pi * 40 * t) * 0.1 + 1.8).astype(np.float32), compression="gzip")
        # CH7: MISO
        grp.create_dataset("CH7", data=(np.sin(2 * np.pi * 1000 * t) > 0).astype(np.int32), compression="gzip")
        # CH8: IRQ
        grp.create_dataset("CH8", data=(np.sin(2 * np.pi * 50 * t) > 0.85).astype(np.int32), compression="gzip")

    wf_size = os.path.getsize(abs_path)
    wf_checksum = hashlib.sha256(open(abs_path, "rb").read()).hexdigest()

    # 2. Insert into database
    async with async_session() as session:
        # Create a source file for test case
        src_file_id = str(uuid.uuid4())
        src_file = FileORM(
            id=src_file_id,
            filename="instructions.ist",
            file_type=FileType.VCD,
            storage_path="uploads/VCD/instructions.ist",
            checksum_sha256=wf_checksum,
            size_bytes=1570,
            uploaded_at=datetime.datetime.utcnow()
        )
        session.add(src_file)
        await session.flush()

        job = JobORM(
            id=job_id,
            name="UART_Loopback_v2",
            state="completed",
            priority=0,
            created_at=datetime.datetime.utcnow()
        )
        session.add(job)
        await session.flush()

        mock_target = JobTargetORM(
            id=str(uuid.uuid4()),
            job_id=job.id,
            actual_board_id="kr260-28d429",
            status="completed"
        )
        session.add(mock_target)
        await session.flush()
        
        mock_tc = TestCaseORM(
            id=str(uuid.uuid4()),
            name="UART_Loopback_v2",
            vcd_file_id=src_file_id
        )
        session.add(mock_tc)
        await session.flush()
        
        metrics = {"packet_count": 1024, "crc_errors": 0}
        snapshot = {
            "job_name": "UART_Loopback_v2 (instructions.ist)",
            "board_id": "kr260-28d429",
            "board_name": "KR260-Fleet-01",
            "vcd_filename": "instructions.ist",
            "firmware_filename": "fpga_bitstream.bin",
        }
        
        orm = ResultORM(
            id=result_id,
            job_id=job.id,
            job_target_id=mock_target.id,
            test_case_id=mock_tc.id,
            status="completed",
            execution_order=0,
            try_count=1,
            passed=True,
            duration_seconds=4.82,
            metrics_json=metrics,
            snapshot_data=snapshot,
            started_at=datetime.datetime.utcnow() - datetime.timedelta(seconds=5),
            completed_at=datetime.datetime.utcnow(),
            created_at=datetime.datetime.utcnow()
        )
        session.add(orm)
        await session.flush()
        
        wf_file = FileORM(
            id=str(uuid.uuid4()),
            filename=f"{result_id}_waveform.h5",
            file_type=FileType.WAVEFORM,
            storage_path=rel_path,
            checksum_sha256=wf_checksum,
            size_bytes=wf_size,
            result_id=result_id,
            uploaded_at=datetime.datetime.utcnow()
        )
        session.add(wf_file)
        await session.commit()
        
    print(f"CREATED_RESULT_ID: {result_id}")

if __name__ == "__main__":
    asyncio.run(create_waveform_sample())
