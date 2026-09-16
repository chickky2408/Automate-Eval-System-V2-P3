"""
Database configuration and session management.

Defaults to PostgreSQL (asyncpg). Credentials are read from the standard
``DB_USER`` / ``DB_PASS`` / ``DB_HOST`` / ``DB_PORT`` / ``DB_NAME`` env vars,
matching the values in ``.env.example`` and ``docker-compose*.yml``.

For quick offline/demo runs (no Postgres service required) you can opt in to
the SQLite fallback by setting the environment variable ``USE_SQLITE_DEMO=1``.
"""
from sqlalchemy import text, event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os
import traceback

try:
    # Auto-load .env when present (for local `pipenv run uvicorn ...` dev);
    # harmless in Docker where env vars are already injected by compose.
    from pathlib import Path

    from dotenv import load_dotenv  # type: ignore

    # When cwd is `backend/`, still pick up repo-root `.env` (DB_HOST/DB_PORT for Docker DB on :5433).
    _repo_env = Path(__file__).resolve().parents[2] / ".env"
    if _repo_env.is_file():
        load_dotenv(_repo_env)
    load_dotenv()
except Exception:
    pass

# Opt-in SQLite fallback — default is PostgreSQL.
USE_SQLITE_DEMO = os.getenv("USE_SQLITE_DEMO", "0") == "1"

if USE_SQLITE_DEMO:
    # Single-file SQLite DB for quick offline demos (no external service needed).
    # SQLITE_PATH lets docker-compose mount a persistent volume for the DB file.
    SQLITE_PATH = os.getenv("SQLITE_PATH", "./eval_system_demo.db")
    DATABASE_URL = f"sqlite+aiosqlite:///{SQLITE_PATH}"
else:
    # PostgreSQL configuration (default)
    DB_USER = os.getenv("DB_USER", "eval_admin")
    DB_PASS = os.getenv("DB_PASS", "change_me_strong_password")
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "eval_system")
    DATABASE_URL = f"postgresql+asyncpg://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Create async engine
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # Set True for SQL debugging
    future=True,
)

# Session factory
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# PROJECT.md B1.9: SQLite does not enforce foreign keys by default -- every
# ON DELETE CASCADE / SET NULL / RESTRICT declared on the ORM models (including
# the RESTRICT added on results.test_case_id for B1.2) was previously a no-op
# under USE_SQLITE_DEMO=1. `PRAGMA foreign_keys` is a per-connection setting in
# SQLite, so it must be set on every new DBAPI connection, not once at startup.
#
# `defer_foreign_keys=ON` is also required, and is NOT just a nicety: none of
# these ORM models declare `relationship()` (grep confirms zero uses in
# db/orm_models.py) -- only raw Column(ForeignKey(...)). Without relationship()
# metadata, SQLAlchemy's flush-order dependency sort cannot reliably compute a
# fully-correct topological INSERT order across a multi-branch object graph
# (verified empirically: committing Job+JobTarget+File+TestCase+Result together
# in one session, with SQLite FK enforcement on, fails with "FOREIGN KEY
# constraint failed" on the results insert even though every referenced row IS
# present and `PRAGMA foreign_key_check` afterwards finds zero violations --
# it's a statement-ordering problem, not a data problem). `defer_foreign_keys`
# moves the check from "per-statement" to "per-transaction commit", which
# tolerates any statement order as long as the transaction is internally
# consistent by COMMIT time -- exactly what an ORM flush without
# relationship()-derived ordering produces. Per SQLite docs this value does NOT
# persist across transactions, so it must be re-applied on every transaction
# start, not just once per connection.
#
# UNVERIFIED ON POSTGRES: Postgres has no equivalent pragma (FK constraints
# there are checked per-statement unless declared DEFERRABLE, which these
# models are not), so if SQLAlchemy's computed insert order for this same
# five-object graph is ALSO wrong under the postgresql+asyncpg dialect, this
# exact failure could occur in production with no fix applied yet -- this
# workaround is deliberately scoped to `if "sqlite" in DATABASE_URL` only, and
# was never tested against a live Postgres (no docker daemon was available
# while writing it). See tests/test_postgres_flush_order.py -- run it against
# the project's docker-compose Postgres before relying on this in production.
if "sqlite" in DATABASE_URL:
    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    @event.listens_for(engine.sync_engine, "begin")
    def _defer_sqlite_foreign_keys(conn):
        conn.exec_driver_sql("PRAGMA defer_foreign_keys=ON")

    # PROJECT.md B1.9 follow-up (found while working on B5.3): the "begin"
    # listener above is NOT sufficient by itself. Per SQLite docs,
    # `defer_foreign_keys` reverts to OFF at the conclusion of every commit --
    # including an *implicit* one. pysqlite's default `isolation_level=""`
    # does not issue a real `BEGIN` for a plain SELECT, so a read-only query
    # issued earlier in the same ORM-level transaction (autoflush or an
    # explicit `session.execute(select(...))`) can run in autocommit mode and
    # silently clear the pragma before the multi-branch INSERT batch it exists
    # to protect ever runs. Verified empirically: a Job+JobTarget+File+
    # TestCase+Result commit that succeeds with no preceding SELECT fails with
    # "FOREIGN KEY constraint failed" (with every referenced row valid) when a
    # single unrelated SELECT runs first in the same session -- and re-issuing
    # this pragma between that SELECT and the writes fixes it. `before_flush`
    # fires immediately before the flush's INSERT/UPDATE/DELETE statements, so
    # re-asserting it there closes the gap regardless of what ran earlier.
    from sqlalchemy.orm import Session as _SyncSession

    @event.listens_for(_SyncSession, "before_flush")
    def _redefer_sqlite_foreign_keys_before_flush(session, flush_context, instances):
        bind = session.get_bind()
        if bind is not None and "sqlite" in str(bind.url):
            session.connection().exec_driver_sql("PRAGMA defer_foreign_keys=ON")


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


def _pg_filetype_enum_name(connection) -> str:
    """Name of the PostgreSQL enum type backing files.file_type (e.g. filetype)."""
    row = connection.execute(
        text(
            """
            SELECT t.typname::text
            FROM pg_type t
            JOIN pg_attribute a ON a.atttypid = t.oid
            WHERE a.attrelid = 'files'::regclass
              AND a.attname = 'file_type'
              AND t.typtype = 'e'
            LIMIT 1
            """
        )
    ).first()
    if row and row[0]:
        return str(row[0])
    return "filetype"


async def _ensure_postgres_filetype_enum_values() -> None:
    """
    Add EROM/ULP/TXT to the PostgreSQL filetype enum.

    Do NOT use execution_options(isolation_level=AUTOCOMMIT) on a connection from
    engine.connect()/run_sync — SQLAlchemy may have already started a transaction
    ("isolation_level may not be altered unless rollback() or commit() is called first").

    A dedicated async transaction that only runs ALTER TYPE ... ADD VALUE commits
    cleanly; backfill UPDATEs stay in a later migration block.
    """
    if "sqlite" in DATABASE_URL or USE_SQLITE_DEMO:
        return

    async with engine.begin() as conn:
        typ = await conn.run_sync(_pg_filetype_enum_name)
        for val in ("EROM", "ULP", "TXT", "SCRIPT", "LOG", "WAVEFORM", "REPORT", "OTHER", "DIFF"):
            try:
                await conn.execute(text(f'ALTER TYPE "{typ}" ADD VALUE IF NOT EXISTS \'{val}\''))
            except Exception:
                try:
                    await conn.execute(text(f'ALTER TYPE "{typ}" ADD VALUE \'{val}\''))
                except Exception:
                    pass


async def init_db():
    """Initialize database tables (create if not present). Runs migration to add set_id to files if needed."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        # PostgreSQL: ensure filetype enum includes EROM/ULP/TXT (must not rely only on
        # the transactional migration block — ADD VALUE can be rolled back or unusable
        # until commit, which caused INSERT ... 'ULP' / 'TXT' to fail on upload).
        await _ensure_postgres_filetype_enum_values()

        # Migration: add set_id to files if not present
        async with engine.begin() as conn:
            def _add_set_id(sync_conn):
                if "sqlite" in DATABASE_URL:
                    cur = sync_conn.execute(text("PRAGMA table_info(files)"))
                    cols = [row[1] for row in cur.fetchall()]
                    if "set_id" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN set_id VARCHAR(128)"))
                else:
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN set_id VARCHAR(128)"))
                    except Exception:
                        pass
            await conn.run_sync(_add_set_id)

        # Migration: add missing job columns (target_board_ids, tag, client_id, config_name, pairs_data)
        async with engine.begin() as conn:
            def _add_job_columns(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(jobs)"))
                    cols = [row[1] for row in cur.fetchall()]
                # (col_name, sqlite_type, pg_type)
                to_add = [
                    ("target_board_ids", "TEXT", "JSONB"),
                    ("tag", "VARCHAR(255)", "VARCHAR(255)"),
                    ("tag_color", "VARCHAR(32)", "VARCHAR(32)"),
                    ("client_id", "VARCHAR(128)", "VARCHAR(128)"),
                    ("profile_id", "VARCHAR(128)", "VARCHAR(128)"),
                    ("profile_display_name", "VARCHAR(255)", "VARCHAR(255)"),
                    ("config_name", "VARCHAR(255)", "VARCHAR(255)"),
                    ("pairs_data", "TEXT", "JSONB"),
                    ("enable_picoscope", "BOOLEAN DEFAULT FALSE", "BOOLEAN DEFAULT FALSE"),
                    ("current_step", "VARCHAR(255)", "VARCHAR(255)"),
                    ("error_message", "TEXT", "TEXT"),
                    ("priority", "INTEGER DEFAULT 0", "INTEGER DEFAULT 0"),
                    ("timeout_seconds", "INTEGER DEFAULT 60", "INTEGER DEFAULT 60"),
                ]
                for col_name, sqlite_type, pg_type in to_add:
                    if is_sqlite:
                        if col_name not in cols:
                            sync_conn.execute(text(f"ALTER TABLE jobs ADD COLUMN {col_name} {sqlite_type}"))
                    else:
                        try:
                            sync_conn.execute(text(f"ALTER TABLE jobs ADD COLUMN IF NOT EXISTS {col_name} {pg_type}"))
                        except Exception:
                            pass
            await conn.run_sync(_add_job_columns)

        # Migration: add owner_id, visibility to files if not present
        async with engine.begin() as conn:
            def _add_file_owner_visibility(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(files)"))
                    cols = [row[1] for row in cur.fetchall()]
                    if "owner_id" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN owner_id VARCHAR(128)"))
                    if "visibility" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN visibility VARCHAR(32)"))
                    if "owner_display_name" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN owner_display_name VARCHAR(255)"))
                    if "library_tags" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN library_tags TEXT"))
                    if "tag_color" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN tag_color VARCHAR(32)"))
                    if "result_id" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN result_id VARCHAR(36)"))
                else:
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS owner_id VARCHAR(128)"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS visibility VARCHAR(32)"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS owner_display_name VARCHAR(255)"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS library_tags TEXT"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS tag_color VARCHAR(32)"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS result_id VARCHAR(36)"))
                    except Exception:
                        pass
            await conn.run_sync(_add_file_owner_visibility)

        # Migration: add updated_at to files (last metadata change: tags, color, etc.)
        async with engine.begin() as conn:
            def _add_files_updated_at(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(files)"))
                    cols = [row[1] for row in cur.fetchall()]
                    if "updated_at" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN updated_at DATETIME"))
                        sync_conn.execute(
                            text("UPDATE files SET updated_at = uploaded_at WHERE updated_at IS NULL")
                        )
                else:
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN updated_at TIMESTAMP"))
                        sync_conn.execute(
                            text("UPDATE files SET updated_at = uploaded_at WHERE updated_at IS NULL")
                        )
                    except Exception:
                        pass

            await conn.run_sync(_add_files_updated_at)

        # Migration: add status/deleted_at to files (PROJECT.md B1.8 soft-delete).
        # Backfill existing rows to status='active' explicitly -- ADD COLUMN with
        # a server-side DEFAULT backfills existing rows on Postgres automatically,
        # but the SQLite branch below does not pass a DEFAULT clause, so it needs
        # the explicit UPDATE.
        async with engine.begin() as conn:
            def _add_files_soft_delete(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(files)"))
                    cols = [row[1] for row in cur.fetchall()]
                    if "status" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN status VARCHAR(16)"))
                        sync_conn.execute(text("UPDATE files SET status = 'active' WHERE status IS NULL"))
                    if "deleted_at" not in cols:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN deleted_at DATETIME"))
                else:
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS status VARCHAR(16)"))
                        sync_conn.execute(text("UPDATE files SET status = 'active' WHERE status IS NULL"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP"))
                    except Exception:
                        pass

            await conn.run_sync(_add_files_soft_delete)

        # Migration: dedup UNIQUE index on files (PROJECT.md B1.7). Dedup was a
        # racy application-level select-then-insert (services/file_store.py
        # add_file()) -- two simultaneous uploads of identical bytes could both
        # pass the SELECT and both INSERT. Backfill legacy empty-string
        # checksums (result_store.py used to write "" for a fabricated file
        # row) to NULL first, since the partial index below excludes NULLs
        # but "" would still collide with itself across multiple such rows.
        async with engine.begin() as conn:
            def _add_files_checksum_dedup_index(sync_conn):
                sync_conn.execute(text("UPDATE files SET checksum_sha256 = NULL WHERE checksum_sha256 = ''"))
                try:
                    sync_conn.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS files_checksum_dedup_uq "
                        "ON files(checksum_sha256, size_bytes, LOWER(filename)) "
                        "WHERE checksum_sha256 IS NOT NULL"
                    ))
                except Exception as e:
                    # Pre-existing duplicate (checksum, size, lower(filename)) rows
                    # would make this index creation fail -- don't block startup on
                    # a data-quality issue in an existing deployment; log loudly so
                    # it isn't missed like the swallowed exceptions B1.4 fixed.
                    print(f"[DB] WARNING: could not create files_checksum_dedup_uq (pre-existing duplicates?): {e}")

            await conn.run_sync(_add_files_checksum_dedup_index)

        # Migration: add verification_skip_reason to results (PROJECT.md B5.3 --
        # distinguishes the five different SKIPPED causes instead of one bucket).
        async with engine.begin() as conn:
            def _add_results_skip_reason(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(results)"))
                    cols = [row[1] for row in cur.fetchall()]
                    if "verification_skip_reason" not in cols:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN verification_skip_reason VARCHAR(64)"))
                else:
                    try:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS verification_skip_reason VARCHAR(64)"))
                    except Exception:
                        pass

            await conn.run_sync(_add_results_skip_reason)

        # Migration: fix results.test_case_id's ON DELETE rule on Postgres
        # (2026-09-16, follow-up to security audit / B1.2). B1.2 changed the
        # ORM declaration from CASCADE to RESTRICT so deleting a test case
        # can no longer silently destroy result history. But `create_all()`
        # only creates tables that don't already exist yet -- it never alters
        # an existing table's constraints. Verified directly: the project's
        # own docker-compose dev Postgres, whose `results` table predates
        # this ORM change, still had `results_test_case_id_fkey` as CASCADE
        # despite the model saying RESTRICT. Any already-running Postgres
        # deployment that predates B1.2 has the identical gap -- B1.2's fix
        # never took effect there. This ALTERs the live constraint to match
        # the ORM. (SQLite has no ALTER TABLE for constraint changes; the
        # demo DB is disposable, so this is scoped to Postgres only.)
        if "sqlite" not in DATABASE_URL:
            async with engine.begin() as conn:
                def _fix_results_test_case_fk_ondelete(sync_conn):
                    try:
                        row = sync_conn.execute(text(
                            "SELECT rc.delete_rule FROM information_schema.referential_constraints rc "
                            "WHERE rc.constraint_name = 'results_test_case_id_fkey'"
                        )).first()
                        if row and row[0] != "RESTRICT":
                            sync_conn.execute(text(
                                "ALTER TABLE results DROP CONSTRAINT results_test_case_id_fkey"
                            ))
                            sync_conn.execute(text(
                                "ALTER TABLE results ADD CONSTRAINT results_test_case_id_fkey "
                                "FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE RESTRICT"
                            ))
                            print(f"[DB] Migrated results_test_case_id_fkey from {row[0]} to RESTRICT")
                    except Exception as e:
                        print(f"[DB] WARNING: could not verify/fix results_test_case_id_fkey delete rule: {e}")

                await conn.run_sync(_fix_results_test_case_fk_ondelete)

        # Migration: ensure all BoardORM columns exist
        async with engine.begin() as conn:
            def _add_board_status_columns(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                board_cols = [
                    ("ip_address", "VARCHAR(64)", "VARCHAR(64)"),
                    ("mac_address", "VARCHAR(64)", "VARCHAR(64)"),
                    ("firmware_version", "VARCHAR(128)", "VARCHAR(128)"),
                    ("model", "VARCHAR(128)", "VARCHAR(128)"),
                    ("tag", "VARCHAR(255)", "VARCHAR(255)"),
                    ("connections", "TEXT", "JSONB"),
                    ("state", "VARCHAR(32)", "VARCHAR(32)"),
                    ("cpu_temp", "FLOAT", "FLOAT"),
                    ("cpu_load", "FLOAT", "FLOAT"),
                    ("ram_usage", "FLOAT", "FLOAT"),
                    ("current_job_id", "VARCHAR(32)", "VARCHAR(32)"),
                    ("last_heartbeat", "DATETIME", "TIMESTAMP"),
                    ("fpga_status", "VARCHAR(32)", "VARCHAR(32)"),
                    ("arm_status", "VARCHAR(32)", "VARCHAR(32)"),
                    ("created_at", "DATETIME", "TIMESTAMP"),
                ]
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(boards)"))
                    cols = [row[1] for row in cur.fetchall()]
                    for col, sq_t, _ in board_cols:
                        if col not in cols:
                            sync_conn.execute(text(f"ALTER TABLE boards ADD COLUMN {col} {sq_t}"))
                else:
                    for col, _, pg_t in board_cols:
                        try:
                            sync_conn.execute(text(f"ALTER TABLE boards ADD COLUMN IF NOT EXISTS {col} {pg_t}"))
                        except Exception:
                            pass
            await conn.run_sync(_add_board_status_columns)

        # Migration: add result file-id columns + backfill ids from files.filename
        async with engine.begin() as conn:
            def _add_result_file_id_columns(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(results)"))
                    cols = [row[1] for row in cur.fetchall()]
                    if "vcd_file_id" not in cols:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN vcd_file_id VARCHAR(36)"))
                    if "firmware_file_id" not in cols:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN firmware_file_id VARCHAR(36)"))
                    if "f1_score" not in cols:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN f1_score FLOAT"))
                    if "sample_xor_score" not in cols:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN sample_xor_score FLOAT"))
                    if "majority_score" not in cols:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN majority_score FLOAT"))
                    if "verification_status" not in cols:
                        sync_conn.execute(text("ALTER TABLE results ADD COLUMN verification_status VARCHAR(32) DEFAULT 'SKIPPED'"))
                else:
                    # Use IF NOT EXISTS to avoid aborting the whole transaction.
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS vcd_file_id VARCHAR(36)"))
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS firmware_file_id VARCHAR(36)"))
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS f1_score FLOAT"))
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS sample_xor_score FLOAT"))
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS majority_score FLOAT"))
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) DEFAULT 'SKIPPED'"))
                    
                    # Safe check before backfilling to avoid aborting Postgres transaction
                    has_col = sync_conn.execute(
                        text("SELECT 1 FROM information_schema.columns WHERE table_name='results' AND column_name='vcd_filename'")
                    ).scalar()
                    if has_col:
                        try:
                            sync_conn.execute(
                                text(
                                    """
                                    UPDATE results r
                                    SET vcd_file_id = f.id
                                    FROM files f
                                    WHERE r.vcd_file_id IS NULL
                                      AND r.vcd_filename IS NOT NULL
                                      AND f.filename = r.vcd_filename
                                    """
                                )
                            )
                        except Exception:
                            pass

                    has_fw_col = sync_conn.execute(
                        text("SELECT 1 FROM information_schema.columns WHERE table_name='results' AND column_name='firmware_filename'")
                    ).scalar()
                    if has_fw_col:
                        try:
                            sync_conn.execute(
                                text(
                                    """
                                    UPDATE results r
                                    SET firmware_file_id = f.id
                                    FROM files f
                                    WHERE r.firmware_file_id IS NULL
                                      AND r.firmware_filename IS NOT NULL
                                      AND f.filename = r.firmware_filename
                                    """
                                )
                            )
                        except Exception:
                            pass
            await conn.run_sync(_add_result_file_id_columns)

        # Migration: create board_status table + backfill latest status from boards.
        async with engine.begin() as conn:
            def _create_backfill_board_status(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    sync_conn.execute(
                        text(
                            """
                            CREATE TABLE IF NOT EXISTS board_status (
                                board_id VARCHAR(64) PRIMARY KEY,
                                state VARCHAR(32),
                                cpu_temp FLOAT,
                                cpu_load FLOAT,
                                ram_usage FLOAT,
                                current_job_id VARCHAR(32),
                                last_heartbeat DATETIME,
                                fpga_status VARCHAR(32),
                                arm_status VARCHAR(32),
                                updated_at DATETIME
                            )
                            """
                        )
                    )
                    sync_conn.execute(
                        text(
                            """
                            INSERT OR REPLACE INTO board_status
                            (board_id, state, cpu_temp, cpu_load, ram_usage, current_job_id, last_heartbeat, fpga_status, arm_status, updated_at)
                            SELECT
                              b.id,
                              COALESCE(b.state, 'offline'),
                              b.cpu_temp,
                              b.cpu_load,
                              b.ram_usage,
                              b.current_job_id,
                              b.last_heartbeat,
                              b.fpga_status,
                              b.arm_status,
                              CURRENT_TIMESTAMP
                            FROM boards b
                            """
                        )
                    )
                else:
                    sync_conn.execute(
                        text(
                            """
                            CREATE TABLE IF NOT EXISTS board_status (
                                board_id VARCHAR(64) PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
                                state VARCHAR(32),
                                cpu_temp FLOAT,
                                cpu_load FLOAT,
                                ram_usage FLOAT,
                                current_job_id VARCHAR(32),
                                last_heartbeat TIMESTAMP,
                                fpga_status VARCHAR(32),
                                arm_status VARCHAR(32),
                                updated_at TIMESTAMP DEFAULT NOW()
                            )
                            """
                        )
                    )
                    sync_conn.execute(
                        text(
                            """
                            INSERT INTO board_status
                            (board_id, state, cpu_temp, cpu_load, ram_usage, current_job_id, last_heartbeat, fpga_status, arm_status, updated_at)
                            SELECT
                              b.id,
                              COALESCE(b.state, 'offline'),
                              b.cpu_temp,
                              b.cpu_load,
                              b.ram_usage,
                              b.current_job_id,
                              b.last_heartbeat,
                              b.fpga_status,
                              b.arm_status,
                              NOW()
                            FROM boards b
                            ON CONFLICT (board_id) DO UPDATE SET
                              state = EXCLUDED.state,
                              cpu_temp = EXCLUDED.cpu_temp,
                              cpu_load = EXCLUDED.cpu_load,
                              ram_usage = EXCLUDED.ram_usage,
                              current_job_id = EXCLUDED.current_job_id,
                              last_heartbeat = EXCLUDED.last_heartbeat,
                              fpga_status = EXCLUDED.fpga_status,
                              arm_status = EXCLUDED.arm_status,
                              updated_at = NOW()
                            """
                        )
                    )
            await conn.run_sync(_create_backfill_board_status)

        # Migration: add owner_id / visibility / owner_display_name to test_cases.
        # Mirrors the shape of files.owner_id so Library filters can be served from
        # normalized tables instead of walking profiles.data JSON.
        #
        # NOTE (PROJECT.md B1.4): there is no physical `test_sets` table -- "test sets"
        # are an alias over `run_sets` (services/test_case_store.py). This migration
        # used to also target `test_sets`, and on SQLite `PRAGMA table_info()` against a
        # nonexistent table returns an empty result rather than erroring, so the "column
        # not present" check passed and the following `ALTER TABLE test_sets ADD COLUMN`
        # raised `OperationalError: no such table`. That exception unwound to init_db()'s
        # outer try/except and was swallowed as "[DB] Connection failed", silently
        # abandoning every migration block below this one on every single startup.
        async with engine.begin() as conn:
            def _add_tc_set_owner_visibility(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                targets = [
                    ("test_cases", "owner_id", "VARCHAR(128)", "VARCHAR(128)"),
                    ("test_cases", "owner_display_name", "VARCHAR(255)", "VARCHAR(255)"),
                    ("test_cases", "visibility", "VARCHAR(32)", "VARCHAR(32)"),
                ]
                if is_sqlite:
                    existing = {}
                    for table in {t[0] for t in targets}:
                        cur = sync_conn.execute(text(f"PRAGMA table_info({table})"))
                        existing[table] = {row[1] for row in cur.fetchall()}
                    for table, col, sqlite_type, _ in targets:
                        if col not in existing.get(table, set()):
                            sync_conn.execute(
                                text(f"ALTER TABLE {table} ADD COLUMN {col} {sqlite_type}")
                            )
                else:
                    for table, col, _, pg_type in targets:
                        try:
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {pg_type}"
                                )
                            )
                        except Exception:
                            pass

            await conn.run_sync(_add_tc_set_owner_visibility)

        # Migration: test_cases file snapshots + try/status (normalized mirror of profile JSON).
        async with engine.begin() as conn:
            def _add_test_cases_snapshot_columns(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                targets = [
                    ("test_cases", "vcd_filename", "VARCHAR(255)", "VARCHAR(255)"),
                    ("test_cases", "ulp_filename", "VARCHAR(255)", "VARCHAR(255)"),
                    ("test_cases", "mdi_text_filename", "VARCHAR(255)", "VARCHAR(255)"),
                    ("test_cases", "try_count", "INTEGER", "INTEGER"),
                    ("test_cases", "status_cached", "VARCHAR(64)", "VARCHAR(64)"),
                    ("results", "created_at", "DATETIME", "TIMESTAMP"),
                ]
                if is_sqlite:
                    existing = {}
                    for table in {t[0] for t in targets}:
                        cur = sync_conn.execute(text(f"PRAGMA table_info({table})"))
                        existing[table] = {row[1] for row in cur.fetchall()}
                    for table, col, sqlite_type, _ in targets:
                        if col not in existing.get(table, set()):
                            sync_conn.execute(
                                text(f"ALTER TABLE {table} ADD COLUMN {col} {sqlite_type}")
                            )
                else:
                    for table, col, _, pg_type in targets:
                        try:
                            sync_conn.execute(
                                text(
                                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {pg_type}"
                                )
                            )
                        except Exception:
                            pass

            await conn.run_sync(_add_test_cases_snapshot_columns)

        # Final cutover: drop legacy filename columns after file-id migration is in place.
        async with engine.begin() as conn:
            def _drop_legacy_filename_columns(sync_conn):
                if "sqlite" in DATABASE_URL:
                    # SQLite DROP COLUMN support varies by version and migration complexity.
                    # Keep legacy columns in SQLite demo DB.
                    return
                sync_conn.execute(text("ALTER TABLE jobs DROP COLUMN IF EXISTS vcd_filename"))
                sync_conn.execute(text("ALTER TABLE jobs DROP COLUMN IF EXISTS firmware_filename"))
                sync_conn.execute(text("ALTER TABLE results DROP COLUMN IF EXISTS vcd_filename"))
                sync_conn.execute(text("ALTER TABLE results DROP COLUMN IF EXISTS firmware_filename"))
            await conn.run_sync(_drop_legacy_filename_columns)

        # Backfill: files.file_type from filename (enum labels EROM/ULP/TXT added in _ensure_postgres_filetype_enum_values)
        async with engine.begin() as conn:
            def _migrate_filetype_enum_backfill(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                pg_filetype = None
                if not is_sqlite:
                    row = sync_conn.execute(
                        text(
                            """
                            SELECT t.typname::text
                            FROM pg_type t
                            JOIN pg_attribute a ON a.atttypid = t.oid
                            WHERE a.attrelid = 'files'::regclass
                              AND a.attname = 'file_type'
                              AND t.typtype = 'e'
                            LIMIT 1
                            """
                        )
                    ).first()
                    pg_filetype = row[0] if row else None
                where_by_kind = {
                    "VCD": "LOWER(filename) LIKE '%.vcd'",
                    "EROM": "LOWER(filename) LIKE '%.erom' OR LOWER(filename) LIKE '%.bin' OR LOWER(filename) LIKE '%.hex' OR LOWER(filename) LIKE '%.elf'",
                    "ULP": "LOWER(filename) LIKE '%.ulp' OR LOWER(filename) LIKE '%.lin'",
                    "TXT": "LOWER(filename) LIKE '%.txt'",
                }
                for val, w in where_by_kind.items():
                    if is_sqlite:
                        stmt = f"UPDATE files SET file_type = '{val}' WHERE ({w})"
                    elif pg_filetype:
                        stmt = f"UPDATE files SET file_type = '{val}'::\"{pg_filetype}\" WHERE ({w})"
                    else:
                        continue
                    try:
                        sync_conn.execute(text(stmt))
                    except Exception:
                        pass
                if is_sqlite:
                    try:
                        sync_conn.execute(
                            text("UPDATE files SET file_type = 'EROM' WHERE file_type = 'FIRMWARE'")
                        )
                    except Exception:
                        pass
                elif pg_filetype:
                    try:
                        sync_conn.execute(
                            text(
                                f"UPDATE files SET file_type = 'EROM'::\"{pg_filetype}\" "
                                f"WHERE file_type::text = 'FIRMWARE'"
                            )
                        )
                    except Exception:
                        pass

            await conn.run_sync(_migrate_filetype_enum_backfill)

        # Seed demo boards when inventory is empty (dev / first boot)
        from db.seed_boards import seed_demo_boards_if_empty

        inserted = await seed_demo_boards_if_empty()
        if inserted:
            print(f"[DB] Seeded {inserted} default board(s) for local demo")

        print(f"[DB] Database ready at {DATABASE_URL}")
    except Exception:
        # PROJECT.md B1.4: this used to be `print(f"[DB] Connection failed: {e}")`,
        # which swallowed the exception -- any migration failure (e.g. an ALTER TABLE
        # against a table that doesn't exist) silently abandoned every migration block
        # below it, on every startup, with no visible error. Fail loud instead: log the
        # full traceback and re-raise so app startup actually fails when a migration
        # can't complete, rather than serving traffic against a half-migrated schema.
        print("[DB] init_db() failed -- startup aborted. Full traceback:")
        traceback.print_exc()
        raise


async def get_session() -> AsyncSession:
    """Get a database session."""
    async with async_session() as session:
        yield session
