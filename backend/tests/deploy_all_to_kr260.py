import paramiko
import os
from pathlib import Path
import time

KR260_IP = "192.168.1.111"
KR260_USER = "petalinux"
KR260_PASS = "Sic1219!"
LOCAL_AGENT_DIR = "d:/siliconcraft/eval_system/V2/fpga_interface/board_agent"
REMOTE_AGENT_DIR = "/home/petalinux/fpga_interface/board_agent"

def deploy_all_to_kr260():
    print("==================================================")
    print("[DEPLOY] DEPLOYING COMPLETE BOARD AGENT TO KR260")
    print(f"Target: {KR260_USER}@{KR260_IP}:{REMOTE_AGENT_DIR}")
    print("==================================================")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(KR260_IP, port=22, username=KR260_USER, password=KR260_PASS, timeout=10)

    # 1. Stop service
    print("\n[Step 1] Stopping board-agent systemd service...")
    ssh.exec_command("echo Sic1219! | sudo -S systemctl stop board-agent")
    time.sleep(1)

    # 2. Ensure remote directory
    ssh.exec_command(f"mkdir -p {REMOTE_AGENT_DIR}")

    # 3. SFTP Upload all python files, toml, html
    print("\n[Step 2] Uploading updated codebase to KR260...")
    sftp = ssh.open_sftp()
    
    files_to_sync = [
        "main.py",
        "runner.py",
        "backend_client.py",
        "config.py",
        "hardware.py",
        "metrics.py",
        "simulator.py",
        "axidma_driver.py",
        "hex_loader.py",
        "agent.toml",
    ]

    for fname in files_to_sync:
        local_path = os.path.join(LOCAL_AGENT_DIR, fname)
        remote_path = f"{REMOTE_AGENT_DIR}/{fname}"
        if os.path.exists(local_path):
            sftp.put(local_path, remote_path)
            print(f"   -> Synced {fname}")

    # 4. Systemd service configuration
    print("\n[Step 3] Updating systemd service configuration...")
    service_content = f"""[Unit]
Description=FPGA Board Agent Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={REMOTE_AGENT_DIR}
ExecStart=/usr/bin/python3 {REMOTE_AGENT_DIR}/main.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""
    with sftp.open("/tmp/board-agent.service", "w") as f:
        f.write(service_content)
    sftp.close()

    # 5. Reload and restart systemd
    print("\n[Step 4] Reloading systemd and restarting board-agent...")
    cmds = [
        "echo Sic1219! | sudo -S cp /tmp/board-agent.service /etc/systemd/system/board-agent.service",
        "echo Sic1219! | sudo -S systemctl daemon-reload",
        "echo Sic1219! | sudo -S systemctl enable board-agent",
        f"echo Sic1219! | sudo -S rm -rf {REMOTE_AGENT_DIR}/__pycache__",
        "echo Sic1219! | sudo -S systemctl restart board-agent",
        "sleep 2",
    ]
    for c in cmds:
        stdin, stdout, stderr = ssh.exec_command(c)
        stdout.channel.recv_exit_status()

    # 6. Check status
    stdin, stdout, stderr = ssh.exec_command("echo Sic1219! | sudo -S systemctl is-active board-agent")
    status = stdout.read().decode('utf-8').strip()
    print(f"\n[Step 5] Service Status: {status.upper()}")

    # 7. Print latest logs
    stdin, stdout, stderr = ssh.exec_command("echo Sic1219! | sudo -S journalctl -u board-agent -n 15 --no-pager")
    logs = stdout.read().decode('utf-8', errors='replace')
    print("\n--- Board Agent Daemon Logs ---")
    print(logs)

    ssh.close()
    print("\n==================================================")
    print("[DONE] DEPLOYMENT TO KR260 COMPLETED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    deploy_all_to_kr260()
