"""
PROJECT.md B1.9 follow-up: verify the multi-branch flush-ordering gap found on
SQLite does NOT also affect Postgres in production.

Context: db/orm_models.py declares zero relationship() constructs -- only raw
Column(ForeignKey(...)). Without relationship() metadata, SQLAlchemy's flush-order
dependency sort could not reliably compute a correct INSERT order for a
multi-branch object graph (Job->JobTarget + File->TestCase converging into
Result) under SQLite with immediate FK checking; `PRAGMA defer_foreign_keys=ON`
was added as the fix (see db/database.py). That fix is SQLite-only (guarded by
`if "sqlite" in DATABASE_URL`) because Postgres has no equivalent pragma --
FKs there are checked per-statement unless the constraint is declared
DEFERRABLE, which these models do not do.

This test was NOT run against a live Postgres during development (no docker
daemon available in that environment). Run it manually against the project's
docker-compose Postgres before relying on B1's job-creation path in production:

    docker compose -f docker-compose.prod.yml up -d db
    DB_HOST=localhost DB_PORT=5433 DB_USER=eval_admin DB_PASS=<from .env> \
        DB_NAME=eval_system python -m pytest tests/test_postgres_flush_order.py -q

If this fails on Postgres, add `relationship()` declarations between JobORM/
JobTargetORM/ResultORM/TestCaseORM/FileORM (or split the five-object insert in
job_queue.py's add_job()/_precreate_results_from_pairs() into two flushes,
which is known to work -- see the manual repro in the B1.9 commit history) --
that is a real production bug, not a test-only concern.
"""
import os
import socket
import uuid

import pytest

# Force Postgres (opt out of the SQLite fallback other test files force via
# USE_SQLITE_DEMO=1 in conftest.py) -- this test is meaningless under SQLite.
os.environ["USE_SQLITE_DEMO"] = "0"


def _postgres_reachable() -> bool:
    host = os.getenv("DB_HOST", "localhost")
    port = int(os.getenv("DB_PORT", "5433"))
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _postgres_reachable(),
    reason="No Postgres reachable at DB_HOST:DB_PORT -- start docker-compose's db "
           "service to run this. Not run in the sandboxed dev environment this fix "
           "was written in; see module docstring.",
)


@pytest.mark.asyncio
async def test_multi_branch_commit_does_not_deadlock_on_fk_order():
    """The exact 5-object graph that failed on SQLite before defer_foreign_keys:
    Job + JobTarget (independent branch) and File + TestCase (independent branch)
    converging into one Result, all added to one session and committed together --
    the same shape job_queue.add_job()/_precreate_results_from_pairs() produces.
    """
    from db.database import init_db, async_session
    from db.orm_models import FileORM, TestCaseORM, JobORM, JobTargetORM, ResultORM

    await init_db()

    job_id = f"job-pgflush-{uuid.uuid4().hex[:8]}"
    target_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())
    file_id = str(uuid.uuid4())
    res_id = str(uuid.uuid4())[:8]

    async with async_session() as session:
        session.add(JobORM(id=job_id, name="pg flush order check", state="running"))
        session.add(JobTargetORM(id=target_id, job_id=job_id, target_type="any", status="running"))
        session.add(FileORM(id=file_id, filename="f.vcd", file_type="VCD",
                             storage_path="uploads/VCD/pgflush.vcd", size_bytes=1))
        session.add(TestCaseORM(id=tc_id, name="pg flush tc", vcd_file_id=file_id))
        session.add(ResultORM(id=res_id, job_id=job_id, job_target_id=target_id,
                               test_case_id=tc_id, status="running"))
        await session.commit()  # <-- this is what failed on SQLite pre-fix
