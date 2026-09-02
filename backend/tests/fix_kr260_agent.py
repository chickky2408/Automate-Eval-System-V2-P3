import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

# Check what is using port 8000 or running python
stdin, stdout, stderr = ssh.exec_command('fuser 8000/tcp; ps aux | grep -E "python|uvicorn|main.py"')
print("Running processes:\n", stdout.read().decode('utf-8'))

# Kill anything on port 8000 and kill python3
stdin, stdout, stderr = ssh.exec_command('fuser -k 8000/tcp 2>/dev/null; killall -9 python3 uvicorn 2>/dev/null; sleep 1; fuser 8000/tcp')
print("After kill:\n", stdout.read().decode('utf-8'))

ssh.close()
