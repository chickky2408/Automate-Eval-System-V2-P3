import requests
import time
import json

CENTRAL_HOST = "http://localhost:8000"

def run_test():
    print("=== Step 1: Check Board Status ===")
    resp = requests.get(f"{CENTRAL_HOST}/api/boards")
    boards = resp.json()
    kr260 = next((b for b in boards if "kr260" in b.get("id", "").lower()), None)
    if not kr260 or kr260.get("status") != "online":
        print(f"Board not online: {kr260}")
        return
    print(f"KR260 Online: ID={kr260['id']}, Name={kr260.get('name')}")

    print("=== Step 2: Dispatch Job ===")
    payload = {
        "name": "KR260_Hardware_Execution_Test",
        "tag": "KR260,Hardware",
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
                "testCaseName": "KR260_Hardware_Execution_Test"
            }
        ]
    }
    
    r = requests.post(f"{CENTRAL_HOST}/api/jobs?start_immediately=true", json=payload)
    print("Dispatch Response:", r.status_code, r.json())
    job = r.json()
    job_id = job.get("id")

    print(f"=== Step 3: Polling Job {job_id} ===")
    for i in range(25):
        j_resp = requests.get(f"{CENTRAL_HOST}/api/jobs/{job_id}")
        if j_resp.status_code == 200:
            j = j_resp.json()
            status = j.get("status") or j.get("state")
            progress = j.get("progress", 0)
            print(f"[{i+1}s] Status: {status}, Progress: {progress}%")
            if status in ("completed", "finished", "success"):
                print(">>> Job execution completed successfully!")
                break
            if status in ("failed", "error", "cancelled"):
                print(f">>> Job failed: {j.get('error_message')}")
                break
        time.sleep(1)

    print("=== Step 4: Verify Waveform Ingestion ===")
    res_resp = requests.get(f"{CENTRAL_HOST}/api/results?limit=15")
    if res_resp.status_code == 200:
        results = res_resp.json()
        print(f"Total Results in DB: {len(results)}")
        for item in results[:6]:
            print(f"ID={item.get('id')}, Job={item.get('job_name')}, Pass={item.get('passed')}, WaveformAvail={item.get('waveform_available')}, File={item.get('waveform_filename')}")

if __name__ == "__main__":
    run_test()
