import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

sftp = ssh.open_sftp()
with sftp.open('/home/petalinux/board_agent/main.py', 'r') as f:
    lines = f.readlines()

for i, l in enumerate(lines):
    if 'resolved_fw_url' in l or 'ExecuteRequest' in l or 'def execute' in l:
        print(f"Line {i+1}: {l.strip()}")
        for j in range(max(0, i-2), min(len(lines), i+8)):
            print(f"  {j+1}: {lines[j].rstrip()}")
        print("-" * 40)

sftp.close()
ssh.close()
