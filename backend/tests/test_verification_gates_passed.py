"""
Regression test for PROJECT.md B1.6: `passed` must reflect verification_status
when a golden VCD reference exists, instead of being written True before the
checker runs. Covers all four outcomes: SKIPPED (no golden reference -> hardware
success stands), PASS, FAIL, and ERROR (fail closed).
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import select

from db.database import init_db, async_session
from db.orm_models import FileORM, TestCaseORM, JobORM, JobTargetORM, ResultORM
from routers.agent_results import run_waveform_verification
from services.file_store import file_store


def _write_vcd(rel_path: str) -> str:
    abs_path = file_store.resolve_path(rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write("$timescale 1ns $end\n$enddefinitions $end\n#0\n$dumpvars\nb0 !\n$end\n")
    return abs_path


async def _make_result(with_golden: bool) -> tuple[str, str]:
    """Returns (result_id, actual_vcd_abs_path)."""
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    target_id = str(uuid.uuid4())
    res_id = str(uuid.uuid4())[:8]
    tc_id = str(uuid.uuid4())

    golden_id = str(uuid.uuid4())
    golden_rel = f"uploads/VCD/2026/09/{golden_id}_golden.vcd"

    async with async_session() as session:
        if with_golden:
            _write_vcd(golden_rel)
            session.add(FileORM(id=golden_id, filename="golden.vcd", file_type="VCD",
                                 storage_path=golden_rel, size_bytes=10))
            session.add(TestCaseORM(id=tc_id, name="TC verify", vcd_file_id=golden_id))
        else:
            # PRAGMA foreign_keys=ON (B1.9) enforces test_cases.vcd_file_id -> files.id
            # even for this "no usable golden reference" case -- the FK target must
            # be a real (if irrelevant) files row; the SKIPPED path is triggered by
            # the file having no storage_path/existing-on-disk .vcd, not by the FK itself.
            missing_ref_id = str(uuid.uuid4())
            session.add(FileORM(id=missing_ref_id, filename="not-a-vcd.txt", file_type="TXT",
                                 storage_path="uploads/TXT/not-a-vcd.txt", size_bytes=1))
            session.add(TestCaseORM(id=tc_id, name="TC no-golden", vcd_file_id=missing_ref_id))

        session.add(JobORM(id=job_id, name="Verify job", state="completed"))
        session.add(JobTargetORM(id=target_id, job_id=job_id, target_type="any", status="completed"))
        session.add(ResultORM(
            id=res_id, job_id=job_id, job_target_id=target_id, test_case_id=tc_id,
            status="completed", execution_order=1, passed=None,  # pending, per B1.6
        ))
        await session.commit()

    actual_rel = f"uploads/WAVEFORM/2026/09/{res_id}_logic.vcd"
    actual_abs = _write_vcd(actual_rel)
    return res_id, actual_abs


async def _get_result(res_id: str) -> ResultORM:
    async with async_session() as session:
        return (await session.execute(select(ResultORM).where(ResultORM.id == res_id))).scalar_one()


@pytest.mark.asyncio
async def test_skipped_when_no_golden_reference_resolves_passed_true():
    await init_db()
    res_id, actual_abs = await _make_result(with_golden=False)
    await run_waveform_verification(res_id, vcd_abs_path=actual_abs)
    run = await _get_result(res_id)
    assert run.verification_status == "SKIPPED"
    assert run.passed is True  # nothing to check against -> hardware success stands


@pytest.mark.asyncio
async def test_fail_verdict_sets_passed_false():
    await init_db()
    res_id, actual_abs = await _make_result(with_golden=True)
    with patch(
        "routers.agent_results.waveform_comparator_service.compare_and_build_diff",
        return_value={"summary": {"overall_pass": False, "avg_f1_score": 42.0}},
    ), patch("routers.agent_results.waveform_comparator_service.save_diff_artifact"):
        await run_waveform_verification(res_id, vcd_abs_path=actual_abs)
    run = await _get_result(res_id)
    assert run.verification_status == "FAIL"
    # This is the actual bug: before B1.6 this was always True regardless of the verdict.
    assert run.passed is False


@pytest.mark.asyncio
async def test_pass_verdict_sets_passed_true():
    await init_db()
    res_id, actual_abs = await _make_result(with_golden=True)
    with patch(
        "routers.agent_results.waveform_comparator_service.compare_and_build_diff",
        return_value={"summary": {"overall_pass": True, "avg_f1_score": 99.5}},
    ), patch("routers.agent_results.waveform_comparator_service.save_diff_artifact"):
        await run_waveform_verification(res_id, vcd_abs_path=actual_abs)
    run = await _get_result(res_id)
    assert run.verification_status == "PASS"
    assert run.passed is True


@pytest.mark.asyncio
async def test_comparator_exception_fails_closed():
    await init_db()
    res_id, actual_abs = await _make_result(with_golden=True)
    with patch(
        "routers.agent_results.waveform_comparator_service.compare_and_build_diff",
        side_effect=RuntimeError("corrupt vcd"),
    ):
        await run_waveform_verification(res_id, vcd_abs_path=actual_abs)
    run = await _get_result(res_id)
    assert run.verification_status == "ERROR"
    # Fail closed: an inconclusive verdict must not read as a pass.
    assert run.passed is False


if __name__ == "__main__":
    import asyncio

    async def _run():
        await test_skipped_when_no_golden_reference_resolves_passed_true()
        print("test_skipped_when_no_golden_reference_resolves_passed_true OK")
        await test_fail_verdict_sets_passed_false()
        print("test_fail_verdict_sets_passed_false OK")
        await test_pass_verdict_sets_passed_true()
        print("test_pass_verdict_sets_passed_true OK")
        await test_comparator_exception_fails_closed()
        print("test_comparator_exception_fails_closed OK")

    asyncio.run(_run())
