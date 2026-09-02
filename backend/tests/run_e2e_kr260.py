import paramiko
import requests
import time
import json
import os

KR260_IP = "192.168.1.111"
KR260_USER = "petalinux"
KR260_PASS = "Sic1219!"
CENTRAL_HOST = "http://localhost:8000"
BACKEND_FOR_BOARD = "http://192.168.1.103:8000"

def step1_ensure_board_agent_running():
    print("=== Step 1: Connecting to KR260 via SSH ===")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(KR260_IP, port=22, username=KR260_USER, password=KR260_PASS, timeout=5)
    
    # Configure backend_url in agent.toml
    stdin, stdout, stderr = ssh.exec_command('cat /home/petalinux/board_agent/agent.toml')
    content = stdout.read().decode('utf-8')
    lines = []
    for line in content.splitlines():
        if line.strip().startswith('backend_url'):
            lines.append(f'backend_url     = "{BACKEND_FOR_BOARD}"')
        else:
            lines.append(line)
    
    sftp = ssh.open_sftp()
    with sftp.open('/home/petalinux/board_agent/agent.toml', 'w') as f:
        f.write('\n'.join(lines))
    sftp.close()
    
    # Restart agent
    ssh.exec_command('killall -9 python3 2>/dev/null; nohup python3 /home/petalinux/board_agent/main.py > /tmp/board_agent.log 2>&1 &')
    time.sleep(3)
    
    stdin, stdout, stderr = ssh.exec_command('tail -n 15 /tmp/board_agent.log')
    print("KR260 Agent Log:\n", stdout.read().decode('utf-8'))
    ssh.close()

def step2_verify_board_online():
    print("=== Step 2: Verifying Board Online in Fleet ===")
    for _ in range(10):
        resp = requests.get(f"{CENTRAL_HOST}/api/boards")
        if resp.status_code == 200:
            boards = resp.json()
            kr260 = next((b for b in boards if "kr260" in b.get("id", "").lower()), None)
            if kr260 and kr260.get("status") == "online":
                print(f"Board is ONLINE! ID: {kr260.get('id')}, Name: {kr260.get('name')}, Temp: {kr260.get('cpu_temp')}C")
                return kr260
        time.sleep(2)
    raise RuntimeError("Board kr260 did not report online in time")

def step3_dispatch_job(board_id):
    print("=== Step 3: Dispatching Test Job (instructions.ist) ===")
    payload = {
        "name": "Live_KR260_E2E_Test",
        "tag": "E2E,KR260",
        "tagColor": "mint",
        "boards": [board_id],
        "files": [
            {
                "name": "instructions.ist",
                "order": 1,
                "vcd": "instructions.ist",
                "erom": None,
                "ulp": None,
                "try_count": 1,
                "testCaseName": "Live_KR260_E2E_Test"
            }
        ]
    }
    
    resp = requests.post(f"{CENTRAL_HOST}/api/jobs?start_immediately=true", json=payload)
    print("Create Job Response:", resp.status_code, resp.json())
    job_data = resp.json()
    job_id = job_data.get("id")
    return job_id

def step4_poll_job_completion(job_id):
    print(f"=== Step 4: Polling Job {job_id} Execution on Hardware ===")
    for i in range(30):
        resp = requests.get(f"{CENTRAL_HOST}/api/jobs/{job_id}")
        if resp.status_code == 200:
            job = resp.json()
            state = job.get("state")
            progress = job.get("progress", 0)
            print(f"[{i+1}s] Job State: {state}, Progress: {progress}%")
            if state in ("completed", "finished", "success"):
                print("Job finished successfully!")
                return True
            if state in ("failed", "error", "cancelled"):
                print(f"Job finished with state: {state}, error: {job.get('error_message')}")
                return False
        time.sleep(2)
    print("Job polling timed out")
    return False

def step5_verify_waveform_in_results():
    print("=== Step 5: Checking Waveform Ingestion in Results ===")
    resp = requests.get(f"{CENTRAL_HOST}/api/results?limit=10")
    if resp.status_code == 200:
        results = resp.json()
        print(f"Total Results: {len(results)}")
        for r in results:
            print(f"ID: {r.get('id')}, Job: {r.get('job_name')}, Waveform Available: {r.get('waveform_available')}, File: {r.get('waveform_filename')}")
            if r.get("waveform_available"):
                prev_resp = requests.get(f"{CENTRAL_HOST}/api/results/{r.get('id')}/preview")
                print(f" -> Preview Check: Status={prev_resp.status_code}, Channels={len(prev_resp.json().get('channels', [])) if prev_resp.status_code == 200 else 'ERR'}")

if __name__ == "__main__":
    try:
        step1_ensure_board_agent_running()
        board = step2_verify_board_online()
        job_id = step3_dispatch_job(board.get("id"))
        step4_poll_job_completion(job_id)
        step5_verify_waveform_in_results()
    except Exception as e:
        print("Error during E2E test:", e)
