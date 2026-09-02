import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

REAL_DIR = "/home/petalinux/fpga_interface/board_agent"

# 1. Update main.py
sftp = ssh.open_sftp()
with sftp.open(f"{REAL_DIR}/main.py", "r") as f:
    main_code = f.read().decode("utf-8")

old_val_err = 'raise ValueError("fw_url or fw_file_id is required")'
new_val_err = 'return ""'
if old_val_err in main_code:
    main_code = main_code.replace(old_val_err, new_val_err)
    print("Patched main.py!")

with sftp.open(f"{REAL_DIR}/main.py", "w") as f:
    f.write(main_code)

# 2. Update runner.py
with sftp.open(f"{REAL_DIR}/runner.py", "r") as f:
    runner_code = f.read().decode("utf-8")

# Make fw_url optional in runner.py
old_block = """            fw_ext = ".app" if (".app" in fw_url.lower() or "app" in fw_url.lower() or ".bin" not in fw_url.lower()) else ".bin"
            fw_path = work / f"firmware{fw_ext}"
            await backend_client.download_asset(fw_url, fw_path)

            stimulus_path = None
            if binary_url:
                # Support .sh (Linux shell / devmem), .ist, .hex, .bin stimulus
                if ".sh" in binary_url.lower():
                    ext = ".sh"
                elif ".ist" in binary_url.lower():
                    ext = ".ist"
                elif ".hex" in binary_url.lower():
                    ext = ".hex"
                else:
                    ext = ".bin"
                stimulus_path = work / f"stimulus{ext}"
                await backend_client.download_asset(binary_url, stimulus_path)

            # Flash FPGA PL Bitstream
            fpga_controller.flash(str(fw_path))"""

new_block = """            fw_path = None
            if fw_url and fw_url.strip():
                fw_ext = ".app" if (".app" in fw_url.lower() or "app" in fw_url.lower() or ".bin" not in fw_url.lower()) else ".bin"
                fw_path = work / f"firmware{fw_ext}"
                await backend_client.download_asset(fw_url, fw_path)
                # Flash FPGA PL Bitstream
                fpga_controller.flash(str(fw_path))

            stimulus_path = None
            if binary_url and binary_url.strip():
                # Support .sh (Linux shell / devmem), .ist, .hex, .bin stimulus
                if ".sh" in binary_url.lower():
                    ext = ".sh"
                elif ".ist" in binary_url.lower():
                    ext = ".ist"
                elif ".hex" in binary_url.lower():
                    ext = ".hex"
                else:
                    ext = ".bin"
                stimulus_path = work / f"stimulus{ext}"
                await backend_client.download_asset(binary_url, stimulus_path)"""

if old_block in runner_code:
    runner_code = runner_code.replace(old_block, new_block)
    print("Patched runner.py!")
else:
    # Alternative replacement
    lines = runner_code.splitlines()
    new_lines = []
    skip = False
    for l in lines:
        if 'fw_ext = ".app"' in l:
            new_lines.extend([
                '            fw_path = None',
                '            if fw_url and str(fw_url).strip() and str(fw_url).lower() != "none":',
                '                fw_ext = ".app" if (".app" in fw_url.lower() or "app" in fw_url.lower() or ".bin" not in fw_url.lower()) else ".bin"',
                '                fw_path = work / f"firmware{fw_ext}"',
                '                await backend_client.download_asset(fw_url, fw_path)',
                '                fpga_controller.flash(str(fw_path))',
            ])
            skip = True
        elif 'fpga_controller.flash(str(fw_path))' in l:
            skip = False
            continue
        elif not skip:
            new_lines.append(l)
    runner_code = '\n'.join(new_lines)
    print("Patched runner.py with line parser!")

with sftp.open(f"{REAL_DIR}/runner.py", "w") as f:
    f.write(runner_code)

# 3. Update agent.toml backend_url
with sftp.open(f"{REAL_DIR}/agent.toml", "r") as f:
    toml_code = f.read().decode("utf-8")

lines = []
for line in toml_code.splitlines():
    if line.strip().startswith("backend_url"):
        lines.append('backend_url     = "http://192.168.1.103:8000"')
    else:
        lines.append(line)

with sftp.open(f"{REAL_DIR}/agent.toml", "w") as f:
    f.write("\n".join(lines))

# 4. Update systemd service
service_file = f"""[Unit]
Description=FPGA Board Agent Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={REAL_DIR}
ExecStart=/usr/bin/python3 {REAL_DIR}/main.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""
with sftp.open('/tmp/board-agent.service', 'w') as f:
    f.write(service_file)
sftp.close()

# Apply systemd
cmds = [
    "echo Sic1219! | sudo -S cp /tmp/board-agent.service /etc/systemd/system/board-agent.service",
    "echo Sic1219! | sudo -S systemctl daemon-reload",
    "echo Sic1219! | sudo -S rm -rf /home/petalinux/fpga_interface/board_agent/__pycache__",
    "echo Sic1219! | sudo -S systemctl restart board-agent",
]
for c in cmds:
    stdin, stdout, stderr = ssh.exec_command(c)
    stdout.channel.recv_exit_status()

print("Deployed and restarted board-agent service at", REAL_DIR)
ssh.close()
