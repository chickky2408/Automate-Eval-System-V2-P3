"""
PROJECT.md B1.9 follow-up, verified against real Postgres via docker (2026-09-16).

Original concern: db/orm_models.py declares zero relationship() constructs --
only raw Column(ForeignKey(...)). B1.9 worried that without relationship()
metadata, SQLAlchemy's flush-order dependency sort could not reliably compute
a correct INSERT order for a multi-branch object graph (Job+JobTarget branch,
File+TestCase branch, converging on Result) added to one session in one flush.

**Root cause, confirmed precisely (the original theory above was imprecise):**
SQLAlchemy computes flush/INSERT order from raw FK metadata just fine without
relationship() -- that part of the original theory was wrong. The real cause
is a genuine 3-table FK cycle in the schema: `files.result_id -> results.id`
(orm_models.py:43), `results.test_case_id -> test_cases.id` (:209),
`test_cases.vcd_file_id -> files.id` (:131). Confirmed directly:

    from sqlalchemy.schema import sort_tables
    sort_tables(Base.metadata.tables.values())
    # UserWarning: Cannot correctly sort tables; there are unresolvable
    # cycles between tables "files, results, test_cases" ...

A cycle has no valid topological order, so SQLAlchemy's flush-order sort
resolves it by dropping one of the three FK constraints from consideration
(unspecified which, and not guaranteed stable across SQLAlchemy versions) and
inserts in whatever order remains. On this version that happens to insert
`results` before `test_cases` exists, which is what fails.

**This was run against the project's docker-compose Postgres:**

1. `test_naive_multi_branch_insert_fails_without_explicit_flush` below
   reproduces the cycle exactly, and it DOES fail on real Postgres with an
   IntegrityError -- confirming the cycle really does break auto-ordering,
   not a fluke. The specific FK name in the error is NOT asserted (see above:
   which constraint loses is unspecified and could change), only that some
   IntegrityError occurs.

2. `test_real_add_job_flow_succeeds_on_postgres` below calls the ACTUAL
   production code path -- job_queue_service.add_job() with pairs_data that
   forces a brand-new TestCaseORM -- and it SUCCEEDS. Auditing every
   production call site that builds these ORM objects together
   (job_queue.py's add_job()/_precreate_results_from_pairs(),
   job_file_store.py's create_job_file(), result_store.py's add_result() --
   confirmed dead code, only called by tests/seed_waveform_result.py, but
   checked anyway) found each one already avoids the cycle by construction:
   Job+JobTarget are committed in a separate transaction before results are
   ever created, and any newly-created TestCaseORM or FileORM is
   `session.add()`-ed then immediately `await session.flush()`-ed before the
   row that references it is even constructed. That flush sends the INSERT
   to Postgres before the dependent object exists, so the cycle is never
   presented to the flush-order sort as a single unresolved batch.

**Conclusion: verified safe on every production path audited, by explicit
flush-before-reference convention -- not fixed at the schema level (the FK
cycle is real and still exists) and not guaranteed for any future code that
doesn't follow the same convention.** Test (1) stays as a guardrail against
exactly that: code that adds several new cycle-adjacent rows to one session
without this flush discipline will fail on Postgres.

**Run this file on its own, not as part of the whole suite.** Every test file
in this directory sets `os.environ["USE_SQLITE_DEMO"]` at module import time,
and db/database.py builds its engine once, from whatever that variable says
at the moment db.database is *first* imported in the process -- whichever
test file's module-level line last ran before that first import wins,
regardless of which test is actually executing. Running `pytest` over the
whole tests/ directory does not reliably exercise Postgres here even when
this file's skip check says "reachable": confirmed by running the full suite
in this environment, where this file's tests failed instead of skipping,
because an unrelated file's `USE_SQLITE_DEMO=1` had already locked in a
SQLite engine before this file's tests ran, while the plain TCP reachability
check below (which runs before any dotenv-driven port resolution) happened
to succeed anyway against an unrelated service occupying the same fallback
port. Fixing this needs the module-level env writes moved into a conftest
fixture across the whole suite -- real work, not done here. Until then:
`python -m pytest tests/test_postgres_flush_order.py -q` (this file alone).
"""
import os
import socket
import uuid

import pytest
import pytest_asyncio

# Force Postgres (opt out of the SQLite fallback other test files force via
# USE_SQLITE_DEMO=1 in conftest.py) -- these tests are meaningless under SQLite.
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
           "service to run this (`docker compose up -d db`, then set DB_HOST/DB_PORT "
           "to match). Skipped by default in sandboxed dev environments without docker.",
)


@pytest_asyncio.fixture(autouse=True)
async def _dispose_engine_after_each_test():
    """asyncpg connections are bound to the event loop that created them, and
    db/database.py's `engine` is a module-level singleton pool. pytest-asyncio
    gives each test function its own event loop, so a pooled connection from
    an earlier test's loop is unusable in the next test ("'NoneType' object
    has no attribute 'send'" from a torn-down transport) -- only surfaces here
    because this is the one file with more than one real-Postgres async test."""
    yield
    from db.database import engine
    await engine.dispose()


@pytest.mark.asyncio
async def test_naive_multi_branch_insert_fails_without_explicit_flush():
    """Guardrail, not a live production bug -- see module docstring point (1).
    Adding Job+JobTarget+File+TestCase+Result to one session and committing
    once, with NO intermediate flush, reproduces a real Postgres FK-ordering
    failure. Production code never does this (see point (2) below) -- this
    test exists so nobody "simplifies" that flush discipline away later."""
    from sqlalchemy.exc import IntegrityError
    from db.database import init_db, async_session
    from db.orm_models import FileORM, TestCaseORM, JobORM, JobTargetORM, ResultORM

    await init_db()

    job_id = f"job-pgflush-{uuid.uuid4().hex[:8]}"
    target_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())
    file_id = str(uuid.uuid4())
    res_id = str(uuid.uuid4())[:8]

    with pytest.raises(IntegrityError):
        async with async_session() as session:
            session.add(JobORM(id=job_id, name="pg flush order check", state="running"))
            session.add(JobTargetORM(id=target_id, job_id=job_id, target_type="any", status="running"))
            session.add(FileORM(id=file_id, filename="f.vcd", file_type="VCD",
                                 storage_path="uploads/VCD/pgflush.vcd", size_bytes=1))
            session.add(TestCaseORM(id=tc_id, name="pg flush tc", vcd_file_id=file_id))
            session.add(ResultORM(id=res_id, job_id=job_id, job_target_id=target_id,
                                   test_case_id=tc_id, status="running"))
            await session.commit()  # <-- fails: results inserted before test_cases


@pytest.mark.asyncio
async def test_real_add_job_flow_succeeds_on_postgres():
    """The actual production path (PROJECT.md B1.1/B1.9): a job with pairs_data
    that resolves to a real on-disk vcd file with no existing TestCaseORM yet,
    forcing add_job() to create Job, JobTarget, TestCase, and Result in the
    course of one add_job() call. Must succeed on Postgres exactly as it does
    on SQLite."""
    from db.database import init_db
    from db.orm_models import FileORM
    from db.database import async_session
    from services.job_queue import job_queue_service
    from services.file_store import file_store
    from models.job import JobCreate

    await init_db()

    file_id = str(uuid.uuid4())
    filename = f"pgflow_{uuid.uuid4().hex[:8]}.vcd"
    rel_path = f"VCD/1999/01/{file_id}_{filename}"
    abs_path = file_store.resolve_path(rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(b"$end\n")

    async with async_session() as session:
        session.add(FileORM(
            id=file_id, filename=filename, file_type="VCD",
            storage_path=rel_path, checksum_sha256=None, size_bytes=5,
        ))
        await session.commit()

    job_data = JobCreate(
        name="pg-add-job-e2e",
        vcd_filename=filename,
        pairs_data=[{"testCaseName": "TC_pgflow", "vcdName": filename}],
    )

    job = await job_queue_service.add_job(job_data)
    assert job.id
