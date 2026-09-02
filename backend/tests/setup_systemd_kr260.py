import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

service_file = """[Unit]
Description=FPGA Board Agent Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/petalinux/board_agent
ExecStart=/usr/bin/python3 /home/petalinux/board_agent/main.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""

# Write service file
sftp = ssh.open_sftp()
with sftp.open('/tmp/board-agent.service', 'w') as f:
    f.write(service_file)
sftp.close()

# Move to systemd and start
setup_cmds = [
    "echo Sic1219! | sudo -S cp /tmp/board-agent.service /etc/systemd/system/board-agent.service",
    "echo Sic1219! | sudo -S systemctl daemon-reload",
    "echo Sic1219! | sudo -S systemctl enable board-agent",
    "echo Sic1219! | sudo -S systemctl restart board-agent",
    "sleep 3",
    "echo Sic1219! | sudo -S systemctl status board-agent --no-pager",
]

for cmd in setup_cmds:
    stdin, stdout, stderr = ssh.exec_command(cmd)
    stdout.channel.recv_exit_status()

# Read journal logs
stdin, stdout, stderr = ssh.exec_command("echo Sic1219! | sudo -S journalctl -u board-agent -n 25 --no-pager")
output = stdout.read().decode('utf-8', errors='replace')
with open("d:/siliconcraft/eval_system/V2/Automate-Eval-System-V2-P3/backend/tests/systemd_kr260.log", "w", encoding="utf-8") as lf:
    lf.write(output)
print("Systemd Service Log Written. Lines:", len(output.splitlines()))

ssh.close()
