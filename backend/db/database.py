"""
Database configuration and session management.

Defaults to PostgreSQL (asyncpg). Credentials are read from the standard
``DB_USER`` / ``DB_PASS`` / ``DB_HOST`` / ``DB_PORT`` / ``DB_NAME`` env vars,
matching the values in ``.env.example`` and ``docker-compose*.yml``.

For quick offline/demo runs (no Postgres service required) you can opt in to
the SQLite fallback by setting the environment variable ``USE_SQLITE_DEMO=1``.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os

try:
    # Auto-load .env when present (for local `pipenv run uvicorn ...` dev);
    # harmless in Docker where env vars are already injected by compose.
    from dotenv import load_dotenv  # type: ignore
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


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


async def init_db():
    """Initialize database tables (create if not present). Runs migration to add set_id to files if needed."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

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
                ]
                for col_name, sqlite_type, pg_type in to_add:
                    if is_sqlite:
                        if col_name not in cols:
                            sync_conn.execute(text(f"ALTER TABLE jobs ADD COLUMN {col_name} {sqlite_type}"))
                    else:
                        try:
                            sync_conn.execute(text(f"ALTER TABLE jobs ADD COLUMN {col_name} {pg_type}"))
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
                else:
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN owner_id VARCHAR(128)"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN visibility VARCHAR(32)"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN owner_display_name VARCHAR(255)"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN library_tags TEXT"))
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(text("ALTER TABLE files ADD COLUMN tag_color VARCHAR(32)"))
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

        # Migration: add fpga_status, arm_status to boards if not present
        async with engine.begin() as conn:
            def _add_board_status_columns(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                if is_sqlite:
                    cur = sync_conn.execute(text("PRAGMA table_info(boards)"))
                    cols = [row[1] for row in cur.fetchall()]
                    if "fpga_status" not in cols:
                        sync_conn.execute(text("ALTER TABLE boards ADD COLUMN fpga_status VARCHAR(32)"))
                    if "arm_status" not in cols:
                        sync_conn.execute(text("ALTER TABLE boards ADD COLUMN arm_status VARCHAR(32)"))
                else:
                    for col in ["fpga_status", "arm_status"]:
                        try:
                            sync_conn.execute(text(f"ALTER TABLE boards ADD COLUMN {col} VARCHAR(32)"))
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
                else:
                    # Use IF NOT EXISTS to avoid aborting the whole transaction.
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS vcd_file_id VARCHAR(36)"))
                    sync_conn.execute(text("ALTER TABLE results ADD COLUMN IF NOT EXISTS firmware_file_id VARCHAR(36)"))
                    # Best-effort backfill by filename match.
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
                    try:
                        sync_conn.execute(
                            text(
                                """
                                UPDATE jobs j
                                SET vcd_file_id = f.id
                                FROM files f
                                WHERE j.vcd_file_id IS NULL
                                  AND j.vcd_filename IS NOT NULL
                                  AND f.filename = j.vcd_filename
                                """
                            )
                        )
                    except Exception:
                        pass
                    try:
                        sync_conn.execute(
                            text(
                                """
                                UPDATE jobs j
                                SET firmware_file_id = f.id
                                FROM files f
                                WHERE j.firmware_file_id IS NULL
                                  AND j.firmware_filename IS NOT NULL
                                  AND f.filename = j.firmware_filename
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

        # Seed demo boards when inventory is empty (dev / first boot)
        from db.seed_boards import seed_demo_boards_if_empty

        inserted = await seed_demo_boards_if_empty()
        if inserted:
            print(f"[DB] Seeded {inserted} default board(s) for local demo")

        print(f"[DB] Database ready at {DATABASE_URL}")
    except Exception as e:
        print(f"[DB] Connection failed: {e}")


async def get_session() -> AsyncSession:
    """Get a database session."""
    async with async_session() as session:
        yield session
