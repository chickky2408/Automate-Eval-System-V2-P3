# Node (Pico) Service — Waveform Sender

Node เป็น service แยกจาก Backend: จำลองสัญญาณ (หรืออ่านจาก hardware จริง) แล้วส่ง chunk ไปยัง Backend

## Flow

```
Node (Pico/PC)  →  POST /api/waveform/chunk  →  Backend  →  broadcast  →  Frontend /ws/waveform
```

## รัน Node (PC / dev)

1. เปิด Backend ก่อน: `cd backend && pipenv run uvicorn main:app --reload`
2. ติดตั้งและรัน Node:

```bash
cd node
pip install -r requirements.txt
python waveform_sender.py
```

หรือส่งไปที่ Backend อื่น:

```bash
python waveform_sender.py --url http://192.168.1.10:8000/api/waveform/chunk
```

## API สำหรับ Node (Pico)

Node ส่ง **POST** ไปที่ `{BACKEND_URL}/api/waveform/chunk`:

- **Method:** `POST`
- **Content-Type:** `application/json`
- **Body:**

```json
{
  "samples": [ -1.0, 0.5, ... ],
  "fs": 4000,
  "freq_hz": 125000,
  "index": 12345
}
```

| Field    | Type     | คำอธิบาย                          |
|----------|----------|-----------------------------------|
| samples  | float[]  | ค่า waveform ต่อ chunk (เช่น 200 ค่า) |
| fs       | int      | อัตรา sample ที่แสดง (Hz)         |
| freq_hz  | int      | ความถี่สัญญาณ (Hz)                |
| index    | int, opt | index ลำดับ sample (ถ้ามี)         |

Backend จะ broadcast ข้อมูลนี้ไปยัง frontend ทุก client ที่เชื่อมต่อ WebSocket `/ws/waveform`

## บน Pico / MicroPython

ใช้ `urequests` แทน `requests` และส่ง JSON เดียวกัน:

```python
import urequests
import json
# ... สร้าง samples ...
r = urequests.post("http://BACKEND_IP:8000/api/waveform/chunk", json={"samples": samples, "fs": 4000, "freq_hz": 125000})
```
