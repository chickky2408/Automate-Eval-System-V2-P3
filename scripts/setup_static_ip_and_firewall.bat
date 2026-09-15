@echo off
echo =======================================================
echo Setting Static IP to 192.168.1.100 on Ethernet...
echo =======================================================

netsh interface ipv4 set address name="Ethernet" static 192.168.1.100 255.255.255.0 192.168.1.1 1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to set static IP. Please run this script as Administrator.
    pause
    exit /b 1
)

echo [OK] Static IP set to 192.168.1.100

echo Setting DNS servers...
netsh interface ipv4 set dns name="Ethernet" static 192.168.1.1
netsh interface ipv4 add dns name="Ethernet" 8.8.8.8 index=2

echo Opening Windows Firewall port 8000 for incoming connections...
netsh advfirewall firewall delete rule name="Eval System Port 8000" >nul 2>&1
netsh advfirewall firewall add rule name="Eval System Port 8000" dir=in action=allow protocol=TCP localport=8000

echo.
echo =======================================================
echo [SUCCESS] Network configured:
echo   IP Address: 192.168.1.100
echo   Netmask:    255.255.255.0
echo   Gateway:    192.168.1.1
echo   Port 8000:  Allowed in Firewall
echo =======================================================
timeout /t 5
