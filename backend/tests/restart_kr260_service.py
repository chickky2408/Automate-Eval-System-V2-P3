import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

# Restart the service
stdin, stdout, stderr = ssh.exec_command('echo Sic1219! | sudo -S systemctl restart board-agent')
stdout.channel.recv_exit_status()

# Check status
stdin, stdout, stderr = ssh.exec_command('echo Sic1219! | sudo -S journalctl -u board-agent -n 15 --no-pager')
raw = stdout.read()
print('Service journal logs:\n', raw.decode('utf-8', errors='replace'))
ssh.close()
