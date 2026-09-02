import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

REAL_DIR = "/home/petalinux/fpga_interface/board_agent"

sftp = ssh.open_sftp()
with sftp.open(f"{REAL_DIR}/backend_client.py", "r") as f:
    code = f.read().decode("utf-8")

old_upload = """    async def upload_result(self, file_path: Path, target_filename: str) -> dict:
        \"\"\"
        Chunked upload using the node_b receiver protocol
        (init -> part[/hash] -> complete) with Smart Part Retry.
        \"\"\"
        receiver = resolve_mdns_url(config.result_receiver_url).rstrip("/")"""

new_upload = """    async def upload_result(self, file_path: Path, target_filename: str, receiver_url: Optional[str] = None) -> dict:
        \"\"\"
        Chunked upload using the node_b receiver protocol
        (init -> part[/hash] -> complete) with Smart Part Retry.
        \"\"\"
        raw_receiver = receiver_url or config.result_receiver_url or config.base_url
        raw_receiver = str(raw_receiver).strip().rstrip("/")
        if not raw_receiver.startswith("http://") and not raw_receiver.startswith("https://"):
            raw_receiver = f"http://{raw_receiver}"
        receiver = resolve_mdns_url(raw_receiver).rstrip("/")"""

if old_upload in code:
    code = code.replace(old_upload, new_upload)
    print("Patched upload_result in backend_client.py!")
else:
    # Replace def upload_result line
    lines = code.splitlines()
    new_lines = []
    for l in lines:
        if "def upload_result(" in l:
            new_lines.append("    async def upload_result(self, file_path: Path, target_filename: str, receiver_url: Optional[str] = None) -> dict:")
        elif "receiver = resolve_mdns_url(config.result_receiver_url)" in l:
            new_lines.extend([
                "        raw_receiver = receiver_url or config.result_receiver_url or config.base_url",
                "        raw_receiver = str(raw_receiver).strip().rstrip('/')",
                "        if not raw_receiver.startswith('http://') and not raw_receiver.startswith('https://'):",
                "            raw_receiver = f'http://{raw_receiver}'",
                "        receiver = resolve_mdns_url(raw_receiver).rstrip('/')",
            ])
        else:
            new_lines.append(l)
    code = "\n".join(new_lines)
    print("Patched upload_result via line parser!")

with sftp.open(f"{REAL_DIR}/backend_client.py", "w") as f:
    f.write(code)

sftp.close()

# Restart service
ssh.exec_command("echo Sic1219! | sudo -S systemctl restart board-agent")
print("Restarted board-agent on KR260!")
ssh.close()
