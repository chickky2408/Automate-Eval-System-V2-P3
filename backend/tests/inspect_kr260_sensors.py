import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

check_cmd = '''
echo "=== THERMAL ZONES ==="
ls -la /sys/class/thermal/
cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null || echo "No thermal_zone*/temp"

echo "=== HWMON / IIO SENSORS ==="
ls -la /sys/class/hwmon/ 2>/dev/null
cat /sys/class/hwmon/hwmon*/temp*_input 2>/dev/null || echo "No hwmon temp input"
ls -la /sys/bus/iio/devices/ 2>/dev/null
cat /sys/bus/iio/devices/iio:device*/in_temp* 2>/dev/null || echo "No iio temp"

echo "=== PROC STAT ==="
cat /proc/stat | head -n 3
'''
stdin, stdout, stderr = ssh.exec_command(check_cmd)
raw = stdout.read()
print(raw.decode('utf-8', errors='replace'))
ssh.close()
