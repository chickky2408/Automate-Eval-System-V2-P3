-- Wipe ALL application data from PostgreSQL (schema stays; tables become empty).
-- DANGER: irreversible. Backup first: pg_dump -h HOST -U USER -d eval_system > backup.sql
--
-- Run (example):
--   psql "postgresql://USER:PASS@HOST:PORT/eval_system" -f backend/scripts/wipe_all_app_data.sql
--
-- After wipe: restart API; run app — init_db() will recreate empty rows only where your code inserts defaults.
-- Uploaded binaries under ./uploads (or FILE_STORE path) are NOT deleted by this script; remove that folder manually if you want a clean disk.

BEGIN;

TRUNCATE TABLE
  test_set_items,
  test_sets,
  test_cases,
  job_files,
  results,
  jobs,
  files,
  profiles,
  notifications,
  test_commands,
  file_tags,
  board_status,
  boards
RESTART IDENTITY CASCADE;

COMMIT;
