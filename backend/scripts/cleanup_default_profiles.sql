-- =============================================================================
-- ลบ profile ที่ชื่อขึ้นต้นด้วย "Default" (ไม่สนตัวพิมพ์ใหญ่/เล็ก)
-- เช่น "Default (85)", "default (1)"
--
-- ไม่ลบชื่ออื่น เช่น "Phimada", "Pim Ja"
--
-- ก่อนรัน: สำรอง DB (แนะนำ)
--   pg_dump -h 127.0.0.1 -p 5433 -U eval_admin eval_system > backup_profiles.sql
--
-- เชื่อมต่อ (ปรับจาก .env ของคุณ):
--   psql "postgresql://eval_admin:PASSWORD@127.0.0.1:5433/eval_system"
-- =============================================================================

-- 1) ดูจำนวนและตัวอย่าง (ควรรันก่อน DELETE เสมอ)
SELECT COUNT(*) AS matching_rows
FROM profiles
WHERE name ILIKE 'default%';

SELECT id, name, updated_at
FROM profiles
WHERE name ILIKE 'default%'
ORDER BY name
LIMIT 50;

-- 2) ลบ (เปิด comment เมื่อพร้อม)
-- BEGIN;
-- DELETE FROM profiles
-- WHERE name ILIKE 'default%';
-- COMMIT;

-- 3) หลังลบแล้ว ให้ sync ตาราง normalized (test_cases / test_sets) ให้ตรงกับ profile ที่เหลือ
--    เปิด API แล้วรัน:
--    curl -X POST "http://localhost:PORT/api/profiles/sync-normalized"
--    (ปรับ PORT และ path prefix ตามที่โปรเจกต์ใช้ — ดูใน main.py / OpenAPI)
