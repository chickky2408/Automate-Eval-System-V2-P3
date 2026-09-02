import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

stdin, stdout, stderr = ssh.exec_command('fuser 8000/tcp ; ps aux | grep python')
print('Ports & Processes on KR260:\n', stdout.read().decode('utf-8'))
ssh.close()
