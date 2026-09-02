import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

stdin, stdout, stderr = ssh.exec_command("echo Sic1219! | sudo -S grep -rn 'fw_url or fw_file_id' /home /root /tmp /opt /usr /var 2>/dev/null")
output = stdout.read().decode('utf-8', errors='replace')
print("Grep results:\n", output)

ssh.close()
