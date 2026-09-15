"""
Test verification schema fields on ResultORM and TestResult Pydantic model.
"""

import pytest
from datetime import datetime
from db.orm_models import ResultORM, JobORM, JobTargetORM, TestCaseORM, FileORM
from models.result import TestResult

def test_test_result_pydantic_includes_verification_fields():
    """Verify TestResult pydantic model accepts and serializes verification metrics."""
    res = TestResult(
        id="res-test-01",
        job_id="job-01",
        job_name="Test Job",
        board_id="kr260-01",
        board_name="KR260 #1",
        passed=True,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        duration_seconds=2.5,
        vcd_filename="golden.vcd",
        f1_score=99.85,
        sample_xor_score=91.67,
        majority_score=100.0,
        verification_status="PASS_WITH_JITTER"
    )
    assert res.f1_score == 99.85
    assert res.sample_xor_score == 91.67
    assert res.majority_score == 100.0
    assert res.verification_status == "PASS_WITH_JITTER"

    d = res.model_dump()
    assert d["f1_score"] == 99.85
    assert d["majority_score"] == 100.0
    assert d["verification_status"] == "PASS_WITH_JITTER"

def test_result_orm_has_verification_columns():
    """Verify ResultORM has the required columns for verification persistence."""
    orm = ResultORM(
        id="res-orm-01",
        job_id="job-01",
        job_target_id="jt-01",
        test_case_id="tc-01",
        f1_score=100.0,
        sample_xor_score=95.5,
        majority_score=100.0,
        verification_status="PASS"
    )
    assert hasattr(orm, "f1_score")
    assert hasattr(orm, "sample_xor_score")
    assert hasattr(orm, "majority_score")
    assert hasattr(orm, "verification_status")
    assert orm.f1_score == 100.0
    assert orm.majority_score == 100.0
    assert orm.verification_status == "PASS"
