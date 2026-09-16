"""
Regression test, verified against real Postgres via docker (2026-09-16).

Found while verifying the profiles.py DELETE-FROM-test_cases fix (see
test_profile_sync_preserves_referenced_test_cases.py): the project's own
docker-compose dev Postgres, whose `results` table predates PROJECT.md B1.2
(CASCADE -> RESTRICT on results.test_case_id), still had the constraint as
CASCADE despite db/orm_models.py declaring RESTRICT. `Base.metadata.create_all()`
only creates tables that don't exist yet; it never alters an existing table's
constraints. So B1.2's fix never took effect on any Postgres database that
was already running before that ORM change landed -- confirmed by directly
querying `information_schema.referential_constraints` on the dev instance.

Fix: db/database.py's init_db() now checks the live constraint's delete_rule
and ALTERs it to RESTRICT if it isn't already, on every startup (idempotent,
Postgres-only -- SQLite has no ALTER TABLE for constraint changes and its
demo DB is disposable).

This test simulates the "already deployed with the old CASCADE constraint"
scenario directly (manually reverting the constraint), then calls init_db()
again and confirms the migration fixes it back to RESTRICT.
"""
import os
import socket

import pytest

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
           "service to run this. Run standalone, not as part of the whole suite "
           "(see test_postgres_flush_order.py's docstring for why).",
)


@pytest.mark.asyncio
async def test_stale_cascade_constraint_is_migrated_to_restrict():
    from db.database import init_db, engine
    from sqlalchemy import text

    await init_db()

    async def _get_delete_rule(conn):
        row = (await conn.execute(text(
            "SELECT delete_rule FROM information_schema.referential_constraints "
            "WHERE constraint_name = 'results_test_case_id_fkey'"
        ))).first()
        return row[0] if row else None

    # Simulate a deployment that predates B1.2: revert the live constraint
    # back to CASCADE, exactly as an old, never-migrated database would have.
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE results DROP CONSTRAINT results_test_case_id_fkey"))
        await conn.execute(text(
            "ALTER TABLE results ADD CONSTRAINT results_test_case_id_fkey "
            "FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE"
        ))

    async with engine.connect() as conn:
        assert await _get_delete_rule(conn) == "CASCADE"

    # init_db() must detect and fix this on the next startup.
    await init_db()

    async with engine.connect() as conn:
        assert await _get_delete_rule(conn) == "RESTRICT"

    await engine.dispose()
