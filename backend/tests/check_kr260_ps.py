import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

stdin, stdout, stderr = ssh.exec_command('ps aux')
for l in stdout.read().decode('utf-8').splitlines():
    if 'python' in l or 'uvicorn' in l or 'agent' in l:
        print(l)

ssh.close()
