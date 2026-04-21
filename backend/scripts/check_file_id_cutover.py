"""
Post-cutover sanity checks for jobs/results file-id columns.

Usage:
    cd backend
    pipenv run python scripts/check_file_id_cutover.py

What it checks:
1) jobs/results totals
2) rows still missing *_file_id (informational)
3) reports that legacy filename columns are no longer used
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ["USE_SQLITE_DEMO"] = "0"
from db.database import DATABASE_URL  # noqa: E402


QUERIES = {
    "jobs_total": "SELECT COUNT(*) FROM jobs",
    "results_total": "SELECT COUNT(*) FROM results",
    "jobs_missing_vcd_id": "SELECT COUNT(*) FROM jobs WHERE vcd_file_id IS NULL",
    "jobs_missing_fw_id": "SELECT COUNT(*) FROM jobs WHERE firmware_file_id IS NULL",
    "results_missing_vcd_id": "SELECT COUNT(*) FROM results WHERE vcd_file_id IS NULL",
    "results_missing_fw_id": "SELECT COUNT(*) FROM results WHERE firmware_file_id IS NULL",
}


async def main() -> None:
    engine = create_async_engine(DATABASE_URL, future=True)
    print(f"[CUTOVER-CHECK] Database: {DATABASE_URL}")
    try:
        async with engine.begin() as conn:
            out = {}
            for key, sql in QUERIES.items():
                val = await conn.scalar(text(sql))
                out[key] = int(val or 0)

        for k in sorted(out.keys()):
            print(f"{k:30} = {out[k]}")

        ready = (
            out["jobs_missing_vcd_id"] == 0
            and out["jobs_missing_fw_id"] == 0
            and out["results_missing_vcd_id"] == 0
            and out["results_missing_fw_id"] == 0
        )
        if ready:
            print("[CUTOVER-CHECK] READY: all jobs/results rows have file IDs.")
        else:
            print("[CUTOVER-CHECK] NOTICE: some rows still have NULL file IDs (check if expected for command-only jobs).")
        print("[CUTOVER-CHECK] Legacy filename columns are no longer used by this check.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

