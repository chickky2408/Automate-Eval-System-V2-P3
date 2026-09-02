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

TEST_SCENARIOS = [
    {
        "name": "DMA_Stream_Capture_100M",
        "file": "dma_stream.ist",
        "passed": True,
        "board": "kr260-28d429",
        "freq_scale": 1.5,
        "noise": 0.02,
    },
    {
        "name": "SPI_Flash_Read_Verify",
        "file": "spi_verify.ist",
        "passed": True,
        "board": "kr260-28d429",
        "freq_scale": 2.0,
        "noise": 0.01,
    },
    {
        "name": "I2C_Sensor_Scan_Stress",
        "file": "i2c_scan.ist",
        "passed": False,
        "board": "kr260-28d429",
        "freq_scale": 0.8,
        "noise": 0.15,
        "error": "ACK timeout on byte 14: SCL held low by target",
    },
    {
        "name": "GPIO_Loopback_Stress_v3",
        "file": "gpio_loopback.ist",
        "passed": True,
        "board": "kr260-28d429",
        "freq_scale": 1.2,
        "noise": 0.03,
    },
]

async def seed_multiple():
    rel_dir = "uploads/WAVEFORM/2026/09"
    os.makedirs(file_store.resolve_path(rel_dir), exist_ok=True)
    
    n_samples = 3000
    fs = 4000.0
    t = np.linspace(0, n_samples / fs, n_samples)
    
    async with async_session() as session:
        for sc in TEST_SCENARIOS:
            result_id = str(uuid.uuid4())[:8]
            job_id = str(uuid.uuid4())[:16]
            rel_path = f"{rel_dir}/{result_id}.h5"
            abs_path = file_store.resolve_path(rel_path)
            
            # 1. Write H5
            with h5py.File(abs_path, "w") as f:
                f.attrs["sample_rate_hz"] = fs
                f.attrs["time_unit"] = "s"
                f.attrs["total_duration"] = n_samples / fs
                
                scale = sc["freq_scale"]
                grp = f.create_group("channels")
                grp.create_dataset("CH1", data=(np.sin(2 * np.pi * 500 * scale * t) > 0).astype(np.int32), compression="gzip")
                grp.create_dataset("CH2", data=((np.sin(2 * np.pi * 250 * scale * t) + np.random.normal(0, sc["noise"], n_samples)) > 0).astype(np.int32), compression="gzip")
                grp.create_dataset("CH3", data=((np.sin(2 * np.pi * 250 * scale * (t - 0.001)) + np.random.normal(0, sc["noise"], n_samples)) > 0).astype(np.int32), compression="gzip")
                grp.create_dataset("CH4", data=(np.sin(2 * np.pi * 125 * scale * t) > 0.4).astype(np.int32), compression="gzip")
                grp.create_dataset("CH5", data=(np.sin(2 * np.pi * 60 * t) * 0.15 + 1.2 + np.random.normal(0, sc["noise"] * 0.5, n_samples)).astype(np.float32), compression="gzip")
                grp.create_dataset("CH6", data=(np.cos(2 * np.pi * 40 * t) * 0.1 + 1.8).astype(np.float32), compression="gzip")
                grp.create_dataset("CH7", data=(np.sin(2 * np.pi * 1000 * scale * t) > 0).astype(np.int32), compression="gzip")
                grp.create_dataset("CH8", data=(np.sin(2 * np.pi * 50 * t) > 0.85).astype(np.int32), compression="gzip")

            wf_size = os.path.getsize(abs_path)
            wf_checksum = hashlib.sha256(open(abs_path, "rb").read()).hexdigest()

            # 2. Register File, Job, Target, TestCase, Result
            src_file_id = str(uuid.uuid4())
            session.add(FileORM(
                id=src_file_id,
                filename=sc["file"],
                file_type=FileType.VCD,
                storage_path=f"uploads/VCD/{sc['file']}",
                checksum_sha256=wf_checksum,
                size_bytes=2048,
                uploaded_at=datetime.datetime.utcnow()
            ))
            await session.flush()

            job = JobORM(
                id=job_id,
                name=sc["name"],
                state="completed" if sc["passed"] else "failed",
                priority=0,
                created_at=datetime.datetime.utcnow()
            )
            session.add(job)
            await session.flush()

            mock_target = JobTargetORM(
                id=str(uuid.uuid4()),
                job_id=job.id,
                actual_board_id=sc["board"],
                status="completed" if sc["passed"] else "error"
            )
            session.add(mock_target)
            await session.flush()

            mock_tc = TestCaseORM(
                id=str(uuid.uuid4()),
                name=sc["name"],
                vcd_file_id=src_file_id
            )
            session.add(mock_tc)
            await session.flush()

            snapshot = {
                "job_name": f"{sc['name']} ({sc['file']})",
                "board_id": sc["board"],
                "board_name": "KR260-Fleet-01",
                "vcd_filename": sc["file"],
                "firmware_filename": "fpga_bitstream.bin",
            }

            orm = ResultORM(
                id=result_id,
                job_id=job.id,
                job_target_id=mock_target.id,
                test_case_id=mock_tc.id,
                status="completed" if sc["passed"] else "error",
                execution_order=0,
                try_count=1,
                passed=sc["passed"],
                duration_seconds=3.5,
                error_message=sc.get("error"),
                metrics_json={"packet_count": 2048, "crc_errors": 0 if sc["passed"] else 5},
                snapshot_data=snapshot,
                started_at=datetime.datetime.utcnow() - datetime.timedelta(seconds=10),
                completed_at=datetime.datetime.utcnow(),
                created_at=datetime.datetime.utcnow()
            )
            session.add(orm)
            await session.flush()

            session.add(FileORM(
                id=str(uuid.uuid4()),
                filename=f"{result_id}_waveform.h5",
                file_type=FileType.WAVEFORM,
                storage_path=rel_path,
                checksum_sha256=wf_checksum,
                size_bytes=wf_size,
                result_id=result_id,
                uploaded_at=datetime.datetime.utcnow()
            ))
            await session.flush()
            print(f"Seeded: {sc['name']} (ID: {result_id}, Pass: {sc['passed']})")

        await session.commit()
    print("All sample waveforms seeded successfully!")

if __name__ == "__main__":
    asyncio.run(seed_multiple())
