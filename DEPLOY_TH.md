# คู่มือติดตั้ง Eval System V2 สำหรับทีม (ภาษาไทย)

> **สำหรับเพื่อนร่วมทีมที่รับหน้าที่ host เซิร์ฟเวอร์:**  
> ทำตามนี้ครั้งเดียว เสร็จแล้วทุกคนในออฟฟิศเปิดเบราว์เซอร์เข้าใช้งานได้ทันที

---

## สิ่งที่ต้องมีบนเครื่อง host

- **Docker Desktop** หรือ **Colima + Docker CLI** (macOS/Linux)
- **Git**
- เครื่องอยู่ **Wi-Fi / LAN เดียวกับทีม** และ **เปิดทิ้งไว้** ช่วงเวลาทำงาน
- Port `8000` ว่าง

ตรวจว่า Docker พร้อม:
```bash
docker --version
docker compose version
```

---

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

### 1) Clone โปรเจกต์
```bash
git clone <repo-url>
cd Automate-Eval-System-V2-P2-main
```

### 2) ตั้งค่า environment
```bash
cp .env.example .env
```

เปิด `.env` แก้ `DB_PASS` เป็นรหัสผ่านที่แข็งแรง (อย่าใช้ค่า default ถ้าจะใช้ production จริง):
```
DB_USER=eval_admin
DB_PASS=<ใส่รหัสผ่านของคุณที่นี่>
DB_NAME=eval_system
APP_PORT=8000
```

### 3) สตาร์ทระบบ
```bash
./scripts/eval.sh start prod
```

หรือถ้า script รันไม่ได้:
```bash
docker compose -f docker-compose.prod.yml up --build -d
```

รอประมาณ 1–2 นาที (ครั้งแรกโหลด image + build frontend)

### 4) ตรวจว่าขึ้นจริง
```bash
docker compose -f docker-compose.prod.yml ps
# ทั้ง eval-system-db และ eval-system-app ต้อง Status = Up (healthy)

curl http://localhost:8000/api/health
# ควรตอบ {"status":"ok","version":"2.0.0"}
```

---

## หา IP ของเครื่อง host เพื่อส่งให้ทีม

**macOS:**
```bash
ipconfig getifaddr en0
```

**Linux:**
```bash
hostname -I | awk '{print $1}'
```

**Windows (PowerShell):**
```powershell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -match "Wi-Fi|Ethernet"}).IPAddress
```

จะได้เลขประมาณ `192.168.x.x` หรือ `10.x.x.x`

---

## ลิงก์ที่ส่งให้ทีม

```
http://<ip-ของคุณ>:8000
```

ตัวอย่าง: `http://192.168.1.42:8000`

ทุกคนในออฟฟิศเปิดเบราว์เซอร์ paste ลิงก์นี้ได้เลย ข้อมูลทุกคน share เดียวกัน (อยู่ใน PostgreSQL ของ host)

---

## ถ้าทีมเข้าไม่ได้

### 1) Firewall บน host block อยู่

**macOS** → System Settings → Network → Firewall  
→ ถ้าเปิดอยู่ ให้เพิ่ม `Docker` / `colima` เป็น Allow หรือปิดชั่วคราว

**Windows** → Control Panel → Windows Defender Firewall → Allow an app  
→ เพิ่ม Docker Desktop + port 8000

**Linux (ufw):**
```bash
sudo ufw allow 8000/tcp
```

### 2) IP เครื่อง host เปลี่ยน
IP เครื่องที่รัน Docker อาจเปลี่ยนเมื่อย้าย Wi-Fi / router จ่าย IP ใหม่  
→ ตรวจด้วยคำสั่งข้างบนแล้วส่งลิงก์ใหม่ให้ทีม  
→ ทางที่ดีคือขอ IT จอง **static IP** หรือ DHCP reservation

### 3) Sleep mode ทำให้เว็บล่ม
ถ้าเครื่อง host เข้า sleep → container พัก → ทีมเข้าไม่ได้

**macOS:** System Settings → Lock Screen → Turn display off → **Never** (ตอนเสียบปลั๊ก)  
**Windows:** Control Panel → Power Options → Sleep = Never  
**Linux:** `systemctl mask sleep.target suspend.target`

---

## คำสั่งที่ใช้บ่อย

```bash
# ดู log live
./scripts/eval.sh logs prod

# stop
./scripts/eval.sh stop prod

# restart
./scripts/eval.sh restart prod

# อัปเดตเวอร์ชันใหม่ (เมื่อ git pull)
./scripts/eval.sh rebuild prod

# backup database
./scripts/eval.sh backup

# restore database
./scripts/eval.sh restore backups/<file>.sql.gz
```

---

## สำหรับผู้ใช้ที่อยู่คนละเครือข่าย (เช่น WFH, Wi-Fi นศ.ฝึกงาน)

เครื่องคุณ **อยู่นอกออฟฟิศ** → ต้องใช้ช่องทางอื่น เลือกได้ 3 วิธี:

### วิธี A: VPN บริษัท (แนะนำ ถ้ามี)
ติดต่อ IT ขอ VPN → ต่อแล้วเข้าได้เหมือนอยู่ในออฟฟิศ  
ใช้ลิงก์เดียวกับทีม: `http://<ip-host>:8000`

### วิธี B: ngrok (ฟรี, setup 2 นาที)
ให้เพื่อนที่ host เซิร์ฟเวอร์รันเพิ่ม:
```bash
# ติดตั้ง (ครั้งเดียว)
brew install ngrok           # macOS
# หรือดาวน์โหลดจาก https://ngrok.com/download

# สมัคร account ฟรี ที่ https://ngrok.com
# เอา authtoken มาใส่
ngrok config add-authtoken <token>

# รันพร้อมกับ docker ที่เปิดอยู่แล้ว
ngrok http 8000
```
จะได้ public URL เช่น `https://xxxx.ngrok-free.app` → เข้าได้จากทุกที่ทั่วโลก

### วิธี C: ย้ายไป deploy บน Cloud VPS
DigitalOcean / Vultr / Hetzner ~$5/เดือน → public IP ถาวร  
ขั้นตอนเหมือนในคู่มือนี้ แต่รันบน VPS แทนเครื่องเพื่อน

---

## ติดปัญหา?

```bash
# ดู log เต็ม
docker compose -f docker-compose.prod.yml logs eval

# เข้า shell ของ app
docker compose -f docker-compose.prod.yml exec eval bash

# ตรวจว่า Postgres ขึ้นจริง
docker compose -f docker-compose.prod.yml exec db pg_isready
```

ถ้าแก้ไม่ได้ → ส่ง output ของ `docker compose -f docker-compose.prod.yml logs` ให้ทีมพัฒนา
