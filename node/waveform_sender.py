#!/usr/bin/env python3
"""
Node Service: จำลอง Sine 125kHz @ fs=1MHz แล้วส่ง chunk ไปยัง Backend

Flow: Node นี้ → POST /api/waveform/chunk → Backend broadcast → Frontend /ws/waveform

รัน: python waveform_sender.py
หรือบน Pico/MicroPython: ใช้ urequests POST แทน requests 
"""





import math
import time
import argparse
import sys
import select

try:
    import requests
except ImportError:
    print("Install: pip install requests")
    raise

# (Sine ~125kHz @ 1MHz, downsampled → 4kHz)
# ใช้ 125_100 แทน 125_000 เพื่อไม่ให้ phase ต่อ sample เป็นพหุคูณของ 90°
# (125000 ให้ค่าแค่ -1,0,1 จาก aliasing)
FREQ_HZ = 125_100
FS_HZ = 1_000_000
DOWNSAMPLE = 250
CHUNK_SIZE = 200
SEND_INTERVAL_SEC = 0.05
DISPLAY_FS = FS_HZ // DOWNSAMPLE  # 4000

# Amplitude (peak) ของ sine wave (1.0 = เดิม)
DEFAULT_AMPLITUDE = 1.0
AMP_STEP = 0.1  # ขนาดการเพิ่ม/ลด amplitude ต่อครั้งด้วยปุ่ม A/D


def main():
    parser = argparse.ArgumentParser(description="Node waveform sender → Backend")
    parser.add_argument(
        "--url",
        default="http://localhost:8000/api/waveform/chunk",
        help="Backend URL สำหรับ POST chunk",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=SEND_INTERVAL_SEC,
        help="Send interval (seconds)",
    )
    parser.add_argument(
        "--amp",
        type=float,
        default=None,
        help="Amplitude (peak) ของ sine wave เช่น 0.5, 1.0, 2.0",
    )
    args = parser.parse_args()

    # เลือก amplitude จาก argument หรือให้ user พิมพ์ผ่าน keyboard
    amplitude = DEFAULT_AMPLITUDE
    if args.amp is not None:
      amplitude = float(args.amp)
    else:
      try:
          text = input(f"Amplitude (peak) ของ sine wave [default {DEFAULT_AMPLITUDE}]: ").strip()
          if text:
              amplitude = float(text)
      except Exception:
          amplitude = DEFAULT_AMPLITUDE

    sample_index = 0
    print(f"Node: Sine {FREQ_HZ} Hz @ fs={FS_HZ} Hz, amp={amplitude} → POST {args.url} ทุก {args.interval}s")
    print("กด D แล้ว Enter = เพิ่ม amplitude, กด A แล้ว Enter = ลด amplitude, กด Q แล้ว Enter = หยุด\n")

    while True:
        # เช็ค input จาก keyboard แบบ non-blocking
        try:
            if sys.stdin in select.select([sys.stdin], [], [], 0)[0]:
                cmd = sys.stdin.readline().strip().lower()
                if cmd == "d":
                    amplitude += AMP_STEP
                    print(f"[KEY] D → amplitude = {amplitude:.3f}")
                elif cmd == "a":
                    amplitude = max(0.0, amplitude - AMP_STEP)
                    print(f"[KEY] A → amplitude = {amplitude:.3f}")
                elif cmd in ("q", "quit", "exit"):
                    print("Stopping sender by keyboard (q).")
                    break
        except Exception:
            # ถ้าอ่าน stdin มีปัญหา ให้ข้ามไป (ยังส่ง wave ต่อได้)
            pass

        # สร้างสัญญาณ 4 channel ที่สัมพันธ์กัน
        ch1_chunk = []  # CH1: sine หลัก
        ch2_chunk = []  # CH2: sine เลื่อน phase 90°
        ch3_chunk = []  # CH3: amplitude ครึ่งหนึ่ง
        ch4_chunk = []  # CH4: sine หลัก + ฮาร์มอนิกเล็กน้อย

        for _ in range(CHUNK_SIZE):
            t = sample_index / FS_HZ
            theta = 2 * math.pi * FREQ_HZ * t

            v1 = amplitude * math.sin(theta)
            v2 = amplitude * math.sin(theta + math.pi / 2)  # phase shift 90°
            v3 = 0.5 * amplitude * math.sin(theta)
            # เพิ่มฮาร์มอนิกเล็กน้อย แต่ยังอยู่ใกล้ช่วง [-1, 1]
            v4 = amplitude * math.sin(theta) + 0.25 * amplitude * math.sin(2 * theta)

            ch1_chunk.append(round(v1, 6))
            ch2_chunk.append(round(v2, 6))
            ch3_chunk.append(round(v3, 6))
            ch4_chunk.append(round(v4, 6))

            sample_index += DOWNSAMPLE

        # Multi-channel payload: CH1–CH4
        payload = {
            "channels": [
                {
                    "id": "CH1",
                    "samples": ch1_chunk,
                },
                {
                    "id": "CH2",
                    "samples": ch2_chunk,
                },
                {
                    "id": "CH3",
                    "samples": ch3_chunk,
                },
                {
                    "id": "CH4",
                    "samples": ch4_chunk,
                },
            ],
            "fs": DISPLAY_FS,
            "freq_hz": FREQ_HZ,
            "index": sample_index,
        }
        try:
            r = requests.post(args.url, json=payload, timeout=2)
            if r.status_code != 200:
                print(f"POST {r.status_code}: {r.text[:80]}")
        except requests.RequestException as e:
            print(f"POST error: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
