import os
os.environ["USE_SQLITE_DEMO"] = "1"
import tempfile
import unittest
import uuid
from datetime import datetime

import pytest
from fastapi import HTTPException

from db.database import async_session, init_db
from db.orm_models import FileORM, FileType, JobORM, JobTargetORM, ResultORM, TestCaseORM
from routers import results
from routers.agent_results import run_waveform_verification
from services.file_store import file_store


def create_sample_vcd(ch_values_at_times):
    """Generate a minimal valid VCD text string for testing."""
    lines = [
        "$date Today $end",
        "$version Tester $end",
        "$timescale 10 ns $end",
        "$scope module top $end",
        "$var wire 1 ! ch0 $end",
        "$var wire 1 \" ch1 $end",
        "$upscope $end",
        "$enddefinitions $end",
        "$dumpvars",
        "0!",
        "0\"",
        "$end",
    ]
    for time_pt, ch0_val, ch1_val in ch_values_at_times:
        lines.append(f"#{time_pt}")
        lines.append(f"{ch0_val}!")
        lines.append(f"{ch1_val}\"")
    return "\n".join(lines) + "\n"


class TestWaveformVerificationPipeline(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await init_db()
        self.temp_dir = tempfile.TemporaryDirectory()

    async def asyncTearDown(self):
        self.temp_dir.cleanup()

    async def test_waveform_verification_skipped_when_no_golden_vcd(self):
        result_id = f"res-skip-{uuid.uuid4().hex[:8]}"
        job_id = f"job-{uuid.uuid4().hex[:8]}"
        target_id = f"tgt-{uuid.uuid4().hex[:8]}"
        tc_id = f"tc-{uuid.uuid4().hex[:8]}"

        async with async_session() as db:
            job = JobORM(id=job_id, name="TestJob")
            tgt = JobTargetORM(id=target_id, job_id=job_id)
            # Test case with non-existent or dummy vcd_file_id
            tc = TestCaseORM(id=tc_id, name="TestCaseWithoutGolden", vcd_file_id="non-existent-file-id")
            res = ResultORM(
                id=result_id,
                job_id=job_id,
                job_target_id=target_id,
                test_case_id=tc_id,
                status="completed",
                verification_status="PENDING"
            )
            db.add_all([job, tgt, tc, res])
            await db.commit()

        # Run verification
        await run_waveform_verification(result_id)

        # Verify status is updated to SKIPPED
        async with async_session() as db:
            from sqlalchemy import select
            updated_res = (await db.execute(select(ResultORM).where(ResultORM.id == result_id))).scalar_one()
            self.assertEqual(updated_res.verification_status, "SKIPPED")

    async def test_waveform_verification_e2e_and_diff_endpoint(self):
        result_id = f"res-pass-{uuid.uuid4().hex[:8]}"
        job_id = f"job-{uuid.uuid4().hex[:8]}"
        target_id = f"tgt-{uuid.uuid4().hex[:8]}"
        tc_id = f"tc-{uuid.uuid4().hex[:8]}"
        file_id = f"file-{uuid.uuid4().hex[:8]}"

        # Create golden VCD and captured VCD files
        golden_content = create_sample_vcd([
            (100, 1, 0),
            (200, 0, 1),
            (300, 1, 0),
        ])
        # Captured has slight phase shift but identical pattern
        captured_content = create_sample_vcd([
            (102, 1, 0),
            (202, 0, 1),
            (302, 1, 0),
        ])

        golden_path = os.path.join(self.temp_dir.name, "golden.vcd")
        with open(golden_path, "w") as f:
            f.write(golden_content)

        captured_path = os.path.join(self.temp_dir.name, f"{result_id}_logic.vcd")
        with open(captured_path, "w") as f:
            f.write(captured_content)

        rel_golden = golden_path

        async with async_session() as db:
            job = JobORM(id=job_id, name="TestJob2")
            tgt = JobTargetORM(id=target_id, job_id=job_id)
            golden_file_rec = FileORM(
                id=file_id,
                filename="golden.vcd",
                file_type=FileType.VCD,
                storage_path=rel_golden,
                size_bytes=len(golden_content)
            )
            tc = TestCaseORM(id=tc_id, name="TestCaseWithGolden", vcd_file_id=file_id)
            res = ResultORM(
                id=result_id,
                job_id=job_id,
                job_target_id=target_id,
                test_case_id=tc_id,
                status="completed",
                verification_status="PENDING"
            )
            db.add_all([job, tgt, golden_file_rec, tc, res])
            await db.commit()

        # Run verification
        await run_waveform_verification(result_id, vcd_abs_path=captured_path)

        # Check DB updates
        async with async_session() as db:
            from sqlalchemy import select
            updated_res = (await db.execute(select(ResultORM).where(ResultORM.id == result_id))).scalar_one()
            self.assertEqual(updated_res.verification_status, "PASS")
            self.assertIsNotNone(updated_res.f1_score)
            self.assertGreater(updated_res.f1_score, 0.9)
            self.assertIsNotNone(updated_res.majority_score)

        # Check GET /api/v1/results/{id}/waveform-diff
        diff = await results.get_waveform_diff(result_id)
        self.assertIn("summary", diff)
        self.assertIn("mismatch_zones", diff)
        self.assertEqual(diff["summary"]["overall_pass"], True)

    async def test_diff_endpoint_404_when_missing(self):
        with self.assertRaises(HTTPException) as ctx:
            await results.get_waveform_diff("non-existent-result-id")
        self.assertEqual(ctx.exception.status_code, 404)
