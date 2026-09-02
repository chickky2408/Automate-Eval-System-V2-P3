import paramiko
import re

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

sftp = ssh.open_sftp()
with sftp.open('/home/petalinux/board_agent/main.py', 'r') as f:
    code = f.read().decode('utf-8')

print("Searching for resolved_fw_url in main.py...")
# Replace resolved_fw_url definition
old_fn = """    def resolved_fw_url(self) -> str:
        if self.fw_url:
            return self.fw_url
        if self.fw_file_id:
            return f"{config.base_url}/api/files/{self.fw_file_id}/content"
        raise ValueError("fw_url or fw_file_id is required")"""

new_fn = """    def resolved_fw_url(self) -> str:
        if self.fw_url:
            return self.fw_url
        if self.fw_file_id:
            return f"{config.base_url}/api/files/{self.fw_file_id}/content"
        return "" """

if old_fn in code:
    code = code.replace(old_fn, new_fn)
    print("Exact match replaced!")
else:
    code = re.sub(
        r'def resolved_fw_url\(self\)[^:]*:\s+if self\.fw_url:\s+return self\.fw_url\s+if self\.fw_file_id:\s+return f"[^"]+"\s+raise ValueError\([^)]+\)',
        'def resolved_fw_url(self) -> str:\n        if self.fw_url:\n            return self.fw_url\n        if self.fw_file_id:\n            return f"{config.base_url}/api/files/{self.fw_file_id}/content"\n        return ""',
        code
    )
    print("Regex replaced!")

with sftp.open('/home/petalinux/board_agent/main.py', 'w') as f:
    f.write(code)

sftp.close()

# Restart service
ssh.exec_command('echo Sic1219! | sudo -S systemctl restart board-agent')
print("Restarted board-agent!")
ssh.close()
