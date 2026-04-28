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
        for val in ("EROM", "ULP", "TXT"):
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

        # Migration: add owner_id / visibility / owner_display_name to test_cases + test_sets.
        # Mirrors the shape of files.owner_id so Library filters can be served from
        # normalized tables instead of walking profiles.data JSON.
        async with engine.begin() as conn:
            def _add_tc_set_owner_visibility(sync_conn):
                is_sqlite = "sqlite" in DATABASE_URL
                targets = [
                    ("test_cases", "owner_id", "VARCHAR(128)", "VARCHAR(128)"),
                    ("test_cases", "owner_display_name", "VARCHAR(255)", "VARCHAR(255)"),
                    ("test_cases", "visibility", "VARCHAR(32)", "VARCHAR(32)"),
                    ("test_sets", "owner_id", "VARCHAR(128)", "VARCHAR(128)"),
                    ("test_sets", "owner_display_name", "VARCHAR(255)", "VARCHAR(255)"),
                    ("test_sets", "visibility", "VARCHAR(32)", "VARCHAR(32)"),
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
    except Exception as e:
        print(f"[DB] Connection failed: {e}")


async def get_session() -> AsyncSession:
    """Get a database session."""
    async with async_session() as session:
        yield session
