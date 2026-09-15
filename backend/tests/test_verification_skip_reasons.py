"""
Regression test for PROJECT.md B5.3: run_waveform_verification()'s five
SKIPPED early-returns all wrote the same verification_status="SKIPPED" with
no way to tell them apart -- indistinguishable from each other and from
"verified and clean" in the UI. Each now sets verification_skip_reason to a
specific code. test_verification_gates_passed.py covers GOLDEN_MISSING_ON_DISK
(via its existing with_golden=False fixture) and confirms PASS/FAIL/ERROR
clear the field; this file covers the other four causes.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from db.database import init_db, async_session
from db.orm_models import FileORM, TestCaseORM, JobORM, JobTargetORM, ResultORM
from routers.agent_results import run_waveform_verification
from services.file_store import file_store

# Both NO_TEST_CASE and NO_GOLDEN_VCD_ASSIGNED need a real backing row whose id
# is the empty string, since results.test_case_id and test_cases.vcd_file_id
# are FK'd and PRAGMA foreign_keys=ON (B1.9) requires a matching row even for
# an empty-string value. This is inserted in its OWN transaction, with no
# preceding SELECT on that connection -- empirically, issuing a plain SELECT
# before an INSERT within the same transaction defeats PRAGMA
# defer_foreign_keys=ON's deferral for this specific empty-string-PK case (the
# per-statement FK check fires immediately instead of waiting for commit, even
# though the pragma reads back as still enabled). That is a separate,
# deeper gap in B1.9 worth its own investigation; sidestepped here by never
# mixing a read and a write of this row in one transaction.
_PLACEHOLDER_ID = ""


async def _ensure_empty_id_placeholder():
    async with async_session() as session:
        try:
            session.add(FileORM(id=_PLACEHOLDER_ID, filename="placeholder", file_type="TXT",
                                 storage_path="uploads/TXT/placeholder.txt", size_bytes=0))
            session.add(TestCaseORM(id=_PLACEHOLDER_ID, name="empty-id-placeholder", vcd_file_id=_PLACEHOLDER_ID))
            await session.commit()
        except IntegrityError:
            await session.rollback()


def _write_vcd(rel_path: str) -> str:
    abs_path = file_store.resolve_path(rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write("$timescale 1ns $end\n$enddefinitions $end\n#0\n$dumpvars\nb0 !\n$end\n")
    return abs_path


async def _get_result(res_id: str) -> ResultORM:
    async with async_session() as session:
        return (await session.execute(select(ResultORM).where(ResultORM.id == res_id))).scalar_one()


async def _make_job_and_target() -> tuple[str, str]:
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    target_id = str(uuid.uuid4())
    async with async_session() as session:
        session.add(JobORM(id=job_id, name="Verify job", state="completed"))
        session.add(JobTargetORM(id=target_id, job_id=job_id, target_type="any", status="completed"))
        await session.commit()
    return job_id, target_id


@pytest.mark.asyncio
async def test_no_test_case_id_reason():
    await init_db()
    await _ensure_empty_id_placeholder()
    job_id, target_id = await _make_job_and_target()
    res_id = str(uuid.uuid4())[:8]
    async with async_session() as session:
        # test_case_id is nullable=False with an FK to test_cases.id (PRAGMA
        # foreign_keys=ON per B1.9); `if not run.test_case_id` treats "" the
        # same as missing, which is the actual condition this branch guards.
        session.add(ResultORM(
            id=res_id, job_id=job_id, job_target_id=target_id, test_case_id=_PLACEHOLDER_ID,
            status="completed", execution_order=1, passed=None,
        ))
        await session.commit()

    await run_waveform_verification(res_id, vcd_abs_path=None)
    run = await _get_result(res_id)
    assert run.verification_status == "SKIPPED"
    assert run.verification_skip_reason == "NO_TEST_CASE"
    assert run.passed is True


@pytest.mark.asyncio
async def test_no_golden_vcd_assigned_reason():
    await init_db()
    await _ensure_empty_id_placeholder()
    job_id, target_id = await _make_job_and_target()
    res_id = str(uuid.uuid4())[:8]
    tc_id = str(uuid.uuid4())
    async with async_session() as session:
        # vcd_file_id is nullable=False with an FK to files.id, so "no golden
        # assigned" is represented as an empty-string FK to the same
        # placeholder file row -- `if not test_case.vcd_file_id` treats ""
        # the same as missing.
        session.add(TestCaseORM(id=tc_id, name="TC no golden slot", vcd_file_id=_PLACEHOLDER_ID))
        session.add(ResultORM(
            id=res_id, job_id=job_id, job_target_id=target_id, test_case_id=tc_id,
            status="completed", execution_order=1, passed=None,
        ))
        await session.commit()

    await run_waveform_verification(res_id, vcd_abs_path=None)
    run = await _get_result(res_id)
    assert run.verification_status == "SKIPPED"
    assert run.verification_skip_reason == "NO_GOLDEN_VCD_ASSIGNED"


@pytest.mark.asyncio
async def test_golden_not_vcd_reason():
    await init_db()
    job_id, target_id = await _make_job_and_target()
    res_id = str(uuid.uuid4())[:8]
    tc_id = str(uuid.uuid4())
    golden_id = str(uuid.uuid4())
    # A real file, on disk, but not a .vcd -- distinct from GOLDEN_MISSING_ON_DISK.
    golden_rel = f"uploads/TXT/2026/09/{golden_id}_golden.txt"
    _write_vcd(golden_rel)  # content doesn't matter, only the extension check does

    async with async_session() as session:
        session.add(FileORM(id=golden_id, filename="golden.txt", file_type="TXT",
                             storage_path=golden_rel, size_bytes=10))
        session.add(TestCaseORM(id=tc_id, name="TC non-vcd golden", vcd_file_id=golden_id))
        session.add(ResultORM(
            id=res_id, job_id=job_id, job_target_id=target_id, test_case_id=tc_id,
            status="completed", execution_order=1, passed=None,
        ))
        await session.commit()

    await run_waveform_verification(res_id, vcd_abs_path=None)
    run = await _get_result(res_id)
    assert run.verification_status == "SKIPPED"
    assert run.verification_skip_reason == "GOLDEN_NOT_VCD"


@pytest.mark.asyncio
async def test_no_captured_vcd_reason():
    await init_db()
    job_id, target_id = await _make_job_and_target()
    res_id = str(uuid.uuid4())[:8]
    tc_id = str(uuid.uuid4())
    golden_id = str(uuid.uuid4())
    golden_rel = f"uploads/VCD/2026/09/{golden_id}_golden.vcd"
    _write_vcd(golden_rel)

    async with async_session() as session:
        session.add(FileORM(id=golden_id, filename="golden.vcd", file_type="VCD",
                             storage_path=golden_rel, size_bytes=10))
        session.add(TestCaseORM(id=tc_id, name="TC no capture", vcd_file_id=golden_id))
        session.add(ResultORM(
            id=res_id, job_id=job_id, job_target_id=target_id, test_case_id=tc_id,
            status="completed", execution_order=1, passed=None,
        ))
        await session.commit()

    # No vcd_abs_path given and no matching captured-VCD FileORM row exists.
    await run_waveform_verification(res_id, vcd_abs_path=None)
    run = await _get_result(res_id)
    assert run.verification_status == "SKIPPED"
    assert run.verification_skip_reason == "NO_CAPTURED_VCD"
