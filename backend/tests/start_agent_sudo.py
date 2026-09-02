import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

# Kill existing process as sudo
cmd = "echo Sic1219! | sudo -S fuser -k 8000/tcp 2>/dev/null; echo Sic1219! | sudo -S killall -9 python3 uvicorn 2>/dev/null; sleep 2"
stdin, stdout, stderr = ssh.exec_command(cmd)
stdout.channel.recv_exit_status()

# Start board agent with sudo so it has access to /dev/mem and port 8000
start_cmd = "echo Sic1219! | sudo -S nohup /usr/bin/python3 /home/petalinux/board_agent/main.py > /tmp/board_agent.log 2>&1 &"
stdin, stdout, stderr = ssh.exec_command(start_cmd)
time.sleep(4)

# Check log
stdin, stdout, stderr = ssh.exec_command("cat /tmp/board_agent.log")
print("Agent Log:\n", stdout.read().decode('utf-8'))

# Check listening ports
stdin, stdout, stderr = ssh.exec_command("echo Sic1219! | sudo -S netstat -tulpn | grep 8000")
print("Listening ports:\n", stdout.read().decode('utf-8'))

ssh.close()
