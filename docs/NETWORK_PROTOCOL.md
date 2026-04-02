# Network Protocol Specification (Option B: Private Network)

This design places the Backend Server as the gateway for the Zybo Private Network. It ensures total control over addressing, security, and traffic.

## 1. Network Topology

```
[Corp LAN/Internet] <---> (eth0) [Backend Server] (eth1) <---> [Switch] <---> [Zybo 1]
                                                                        <---> [Zybo 2]
                                                                        <---> [Zybo N]
```

- **Backend eth0**: DHCP Client (Gets IP from Corp Network, e.g., 10.x.x.x)
- **Backend eth1**: Static IP (Gateway for Zybos, e.g., **192.168.100.1**)
- **Zybo eth0**: DHCP Client (Gets IP from Backend, e.g., 192.168.100.101)

## 2. IP Allocation Strategy (DHCP)

We will use **`dnsmasq`** on the Backend Server to manage IPs.

### Configuration
- **Subnet**: `192.168.100.0/24`
- **Range**: `192.168.100.100` to `192.168.100.200`
- **Static Leases**: Bind MAC Address to specific IP for consistency.
    ```
    # /etc/dnsmasq.conf
    interface=eth1
    dhcp-range=192.168.100.100,192.168.100.200,12h
    
    # Static Mapping (Hardware Inventory)
    dhcp-host=AA:BB:CC:DD:EE:01,192.168.100.101,zybo-rack-01
    dhcp-host=AA:BB:CC:DD:EE:02,192.168.100.102,zybo-rack-02
    ```

## 3. Communication Protocols

We divide traffic into **Control Plane** (Commands) and **Data Plane** (File Transfer).

### 3.1 Control Plane (Command & Control)
**Protocol**: HTTP REST API + WebSocket
**Direction**: 
- **Zybo -> Backend**: 
    - `POST /api/boards/register`: "I am alive, here is my MAC/IP".
    - `POST /api/boards/heartbeat`: "Still alive".
- **Backend -> Zybo**:
    - **Recommended**: Zybo runs a light **HTTP Agent** (FastAPI/Flask) on port 8000.
    - **Command**: `POST http://192.168.100.101:8000/execute` (Trigger Job)
    - **Command**: `POST http://192.168.100.101:8000/cancel` (Stop Job)
    - **Command**: `POST http://192.168.100.101:8000/restart` (Reboot Board)
    - *(See `zybo_agent_spec.md` for full API details)*

### 3.2 Data Plane (Large File Transfer)
**Protocol**: HTTP Stream or SFTP (SSH)

#### A. Result Upload (Zybo -> Backend)
**Scenario**: Sending recorded binary waveform (100MB+).
**Protocol**: **HTTP Chunked Upload**.
- `PUT http://192.168.100.1/api/files/upload_stream`
- **Why?**: Easier to implement in Python `requests` than managing SSH keys dynamically.

#### B. Firmware Download (Backend -> Zybo)
**Scenario**: Getting new `.bit` or `.elf` file.
**Protocol**: **HTTP Download**.
- `GET http://192.168.100.1/api/files/download/<file_id>`

## 4. Boot Sequence (The "Handshake")

1.  **Power On**: Zybo boots Linux.
2.  **Network Init**: Zybo requests DHCP. Backend gives `192.168.100.101`.
3.  **Agent Start**: `systemd` service starts `zybo_agent.py`.
4.  **Registration**: 
    - Agent sends `POST http://192.168.100.1:8000/api/boards/register`
    - Payload: `{"mac": "AA:...", "ip": "192.168.100.101", "version": "1.0"}`
5.  **Ready**: Backend updates DB status to `ONLINE`.

## 5. Security Rules
- **Firewall (ufw)** on Backend:
    - Allow **Port 8000 (API)** on `eth1` (Zybo Interface).
    - Block **Port 8000** on `eth0` (Corp Interface) if needed (or require Auth).
    - Allow **SSH** on `eth0` for Admin.
