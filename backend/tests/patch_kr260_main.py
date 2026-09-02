import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

stdin, stdout, stderr = ssh.exec_command('cat /home/petalinux/board_agent/main.py')
code = stdout.read().decode('utf-8')

# Replace raise ValueError("fw_url or fw_file_id is required") with return ""
old_part = 'raise ValueError("fw_url or fw_file_id is required")'
new_part = 'return ""'

if old_part in code:
    code = code.replace(old_part, new_part)
    print("Replaced fw_url requirement in main.py successfully!")
else:
    print("Could not find exact text, check lines...")

sftp = ssh.open_sftp()
with sftp.open('/home/petalinux/board_agent/main.py', 'w') as f:
    f.write(code)
sftp.close()

# Restart board-agent service
ssh.exec_command('echo Sic1219! | sudo -S systemctl restart board-agent')
print("Restarted board-agent service on KR260!")
ssh.close()
