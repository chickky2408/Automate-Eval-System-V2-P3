import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

# Restart the service or kill old process
stdin, stdout, stderr = ssh.exec_command('echo Sic1219! | sudo -S systemctl status board-agent || echo Sic1219! | sudo -S systemctl list-unit-files | grep agent')
print('Systemd status:\n', stdout.read().decode('utf-8'))
ssh.close()
