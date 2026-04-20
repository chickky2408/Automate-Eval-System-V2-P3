# Eval System V2 — Deployment Guide

สองโหมดพร้อมใช้งาน ใช้ Docker Compose อย่างเดียว (ไม่ต้องติดตั้ง Python/Node บนเครื่อง server)

## 1. Demo mode (SQLite, ติดตั้งเร็วสุด)

เหมาะสำหรับทดลอง/demo ภายในทีม

```bash
docker compose up --build -d
# เปิดเบราว์เซอร์: http://<server-ip>:8001
```

ข้อมูลเก็บใน Docker volume `eval_data` (SQLite) และ `eval_uploads` (ไฟล์ VCD / firmware) — ลบ container ได้ ข้อมูลไม่หาย

## 2. Production mode (PostgreSQL) — ใช้จริงกับทีม

```bash
cp .env.example .env
# แก้ .env -> เปลี่ยน DB_PASS เป็น password ของจริง

docker compose -f docker-compose.prod.yml up --build -d
# เปิดเบราว์เซอร์: http://<server-ip>:8000
```

บริการที่ขึ้น:
- `eval-system-db` — PostgreSQL 16 (volume `pg_data`)
- `eval-system-app` — FastAPI + built frontend (volume `eval_uploads`)

ตอนบูตครั้งแรก backend จะสร้าง schema อัตโนมัติผ่าน `init_db()` (SQLAlchemy `create_all` + idempotent migrations ใน `backend/db/database.py`) จึงไม่ต้องรัน alembic แยก

### ตรวจสถานะ / ดู log

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f eval
```

### Healthcheck

- App: `GET /api/health` (Docker เช็คทุก 30s)
- DB : `pg_isready`

### Backup / restore Postgres

```bash
# backup
docker exec eval-system-db pg_dump -U eval_admin eval_system > backup.sql

# restore
cat backup.sql | docker exec -i eval-system-db psql -U eval_admin -d eval_system
```

### อัปเดต deploy ใหม่

```bash
git pull
docker compose -f docker-compose.prod.yml up --build -d
```

ข้อมูลใน volumes `pg_data` และ `eval_uploads` จะอยู่เหมือนเดิม

## ย้ายไปเครื่องใหม่

1. `git clone <repo>` บนเครื่องใหม่
2. ติดตั้ง Docker + Docker Compose v2
3. ทำตาม **Production mode** ด้านบน
4. ถ้าต้องการย้ายข้อมูลจากเครื่องเก่า — ใช้ `pg_dump` / `pg_restore` และ `docker cp` สำหรับ volume `eval_uploads`
