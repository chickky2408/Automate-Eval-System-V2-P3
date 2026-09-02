import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

# Upload metrics.py
sftp = ssh.open_sftp()
sftp.put('d:/siliconcraft/eval_system/V2/fpga_interface/board_agent/metrics.py', '/home/petalinux/board_agent/metrics.py')
sftp.close()

# Restart service
stdin, stdout, stderr = ssh.exec_command('echo Sic1219! | sudo -S systemctl restart board-agent')
stdout.channel.recv_exit_status()

# Check journal logs
stdin, stdout, stderr = ssh.exec_command('echo Sic1219! | sudo -S journalctl -u board-agent -n 10 --no-pager')
raw = stdout.read()
print('Journal logs:\n', raw.decode('utf-8', errors='replace'))
ssh.close()
