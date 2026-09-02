import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

# Read agent.toml
stdin, stdout, stderr = ssh.exec_command('cat /home/petalinux/board_agent/agent.toml')
content = stdout.read().decode('utf-8')

# Replace backend_url
lines = []
for line in content.splitlines():
    if line.strip().startswith('backend_url'):
        lines.append('backend_url     = "http://192.168.1.103:8000"')
    else:
        lines.append(line)
new_content = '\n'.join(lines)

sftp = ssh.open_sftp()
with sftp.open('/home/petalinux/board_agent/agent.toml', 'w') as f:
    f.write(new_content)
sftp.close()

# Start agent
stdin, stdout, stderr = ssh.exec_command('killall -9 python3 2>/dev/null; nohup python3 /home/petalinux/board_agent/main.py > /tmp/board_agent.log 2>&1 & sleep 3; cat /tmp/board_agent.log')
print('Board Agent Output:\n', stdout.read().decode('utf-8'))
ssh.close()
