# 06. Deployment Guide

## 1. Hardware Requirements

### A. Recommended Spec (Production / >50 Boards)
*   **CPU**: Intel Core i7/i9 (Gen 12+) or AMD Ryzen 7/9. High clock speed is preferred for HDF5 conversion.
*   **RAM**: 32GB - 64GB (DDR4/DDR5). Functions as a critical write buffer for incoming high-bandwidth streams.
*   **Storage (Critical)**:
    *   **OS/DB**: 500GB NVMe SSD.
    *   **Data**: **2TB - 4TB NVMe SSD** (Gen 4). **DO NOT use HDD** for data; high random IOPS are required for concurrent writes.
*   **Network**: 2x 1Gbps LAN or 1x 2.5Gbps. (Port 1: Corporate, Port 2: Zybo Private Network).

### B. Minimum Spec (Development / <10 Boards)
*   **CPU**: Intel Core i5 or Ryzen 5.
*   **RAM**: 16GB.
*   **Storage**: 1TB NVMe SSD.

## 2. Backend Server Setup (Private Network)

### A. Network Interface Config (`netplan`)
The server needs two interfaces: `eth0` (Corp/Internet) and `eth1` (Zybo Farm).

```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
    eth1:
      dhcp4: no
      addresses:
        - 192.168.100.1/24
```

### B. DHCP Server (`dnsmasq`)
Install: `sudo apt install dnsmasq`

Config `/etc/dnsmasq.conf`:
```ini
interface=eth1
dhcp-range=192.168.100.100,192.168.100.200,12h
dhcp-option=3,192.168.100.1 # Gateway

# Static Leases (Inventory)
dhcp-host=AA:BB:CC:00:00:01,192.168.100.101,zybo-01
dhcp-host=AA:BB:CC:00:00:02,192.168.100.102,zybo-02
```

### C. Time Synchronization (NTP)
Since boards have no internet, the Backend must serve as the NTP Server.

1. **Install Chrony**: `sudo apt install chrony`
2. **Config (`/etc/chrony/chrony.conf`)**:
   ```ini
   # Allow private network to query
   allow 192.168.100.0/24
   local stratum 10
   ```
3. **Restart**: `sudo systemctl restart chrony`
4. **Zybo Config**:
   Update `dhcp-option` in `dnsmasq.conf`:
   ```ini
   dhcp-option=42,192.168.100.1 # NTP Server Option
   ```

## 3. Database Setup (PostgreSQL)

1. **Install**: `sudo apt install postgresql postgresql-contrib`
2. **Create DB**:
    ```bash
    sudo -u postgres psql
    CREATE DATABASE eval_system;
    CREATE USER eval_admin WITH PASSWORD 'secure_pass';
    GRANT ALL PRIVILEGES ON DATABASE eval_system TO eval_admin;
    ```
3. **Migration**: Run `alembic upgrade head` from backend folder.

## 4. Application Startup

### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 3000 --reload
```

### Frontend
```bash
cd frontend
npm install
npm run build
# Serve 'dist' folder via Nginx or python http.server
```

## 5. Zybo Agent Installation

1. **Copy Agent**: `scp -r zybo_agent/ root@192.168.100.101:/opt/`
2. **Install Service**:
    ```bash
    cp /opt/zybo_agent/zybo-agent.service /etc/systemd/system/
    systemctl enable zybo-agent
    systemctl start zybo-agent
    ```

## 6. Maintenance & Auto-Backup

To ensure data safety, configure an automated daily backup.

### A. Backup Script (`backup.sh`)
Create this script in `/root/scripts/backup.sh` and `chmod +x` it.

```bash
#!/bin/bash
# Configuration
BACKUP_DIR="/mnt/external_drive/backups" # Mount your NAS/USB here
DATE=$(date +%Y%m%d)
DB_USER="eval_admin"
DB_NAME="eval_system"
STORAGE_DIR="/var/lib/eval_system/storage"

echo "[Start] Backup for $DATE"

# 1. Backup Database (SQL Dump + Gzip)
pg_dump -U $DB_USER $DB_NAME | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"
echo " - Database dumped"

# 2. Backup HDF5 Files (Rsync for speed)
# -a: archive mode, -v: verbose
rsync -av $STORAGE_DIR "$BACKUP_DIR/files/"
echo " - Files synced"

# 3. Cleanup Old Backups (>30 Days)
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +30 -delete
echo " - Old backups cleaned"
```

### B. Scheduling (Cron)
Run `crontab -e` and add the line to run daily at 03:00 AM:

```bash
0 3 * * * /bin/bash /root/scripts/backup.sh >> /var/log/backup.log 2>&1
```
