import requests
import time
import json
import uuid

CENTRAL_HOST = "http://localhost:8000"

def run_fresh_test():
    print("==================================================")
    print("[START] Starting Fresh End-to-End Hardware Test on KR260")
    print("==================================================")

    # 1. Check Board
    print("\n[Step 1] Checking KR260 status in fleet...")
    resp = requests.get(f"{CENTRAL_HOST}/api/boards")
    if resp.status_code != 200:
        print("Failed to contact backend:", resp.status_code)
        return
    boards = resp.json()
    kr260 = next((b for b in boards if "kr260" in b.get("id", "").lower()), None)
    if not kr260:
        print("KR260 board not found in fleet list!")
        return
    print(f"[OK] KR260 Board Found: ID={kr260['id']}, Name={kr260.get('name')}, Status={kr260.get('status')}")

    # 2. Dispatch New Job
    test_run_name = f"KR260_E2E_Run_{str(uuid.uuid4())[:4].upper()}"
    print(f"\n[Step 2] Dispatching Job: '{test_run_name}' with instructions.ist...")
    payload = {
        "name": test_run_name,
        "tag": "E2E,Hardware,KR260",
        "tagColor": "mint",
        "boards": [kr260["id"]],
        "files": [
            {
                "name": "instructions.ist",
                "order": 1,
                "vcd": "instructions.ist",
                "erom": None,
                "ulp": None,
                "try_count": 1,
                "testCaseName": test_run_name
            }
        ]
    }
    
    r = requests.post(f"{CENTRAL_HOST}/api/jobs?start_immediately=true", json=payload)
    if r.status_code not in (200, 201):
        print(f"Failed to create job: {r.status_code} {r.text}")
        return
    job_info = r.json()
    job_id = job_info.get("id")
    print(f"[OK] Job Created & Dispatched! Job ID: {job_id}")

    # 3. Poll for Hardware Execution
    print(f"\n[Step 3] Monitoring Hardware Execution on KR260...")
    completed = False
    for sec in range(25):
        j_resp = requests.get(f"{CENTRAL_HOST}/api/jobs/{job_id}")
        if j_resp.status_code == 200:
            j = j_resp.json()
            status = j.get("status") or j.get("state")
            progress = j.get("progress", 0)
            print(f"   [{sec+1:02d}s] Board Status: RUNNING | Job Progress: {progress}% | State: {status}")
            if status in ("completed", "finished", "success"):
                print("   [SUCCESS] FPGA Test Completed Successfully on Hardware!")
                completed = True
                break
            if status in ("failed", "error", "cancelled"):
                print(f"   [ERROR] FPGA Test Failed: {j.get('error_message')}")
                break
        time.sleep(1)

    # 4. Check Waveform Ingestion
    print("\n[Step 4] Checking Waveform Ingestion in Central Platform...")
    res_resp = requests.get(f"{CENTRAL_HOST}/api/results?limit=10")
    if res_resp.status_code == 200:
        results = res_resp.json()
        print(f"Total Waveform Results Ready: {len(results)}")
        for idx, item in enumerate(results[:6], 1):
            print(f"   #{idx} ID: {item.get('id')} | Job: {item.get('job_name')} | Status: {'PASS' if item.get('passed') else 'FAIL'} | Waveform File: {item.get('waveform_filename')}")
            
    print("\n==================================================")
    print("[DONE] End-to-End Test Run Completed!")
    print("==================================================")

if __name__ == "__main__":
    run_fresh_test()
