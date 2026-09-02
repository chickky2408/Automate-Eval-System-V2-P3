"""
Agent configuration.

Resolved from (highest precedence first):
  1. Environment variables
  2. agent.toml in this directory
  3. Built-in defaults

Run on a real KR260 board with DRY_RUN=0; run on a dev PC with DRY_RUN=1
to stub out FPGA flashing and use the software signal simulator.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:  # Python 3.11+ has tomllib in stdlib; PetaLinux images usually ship 3.10/3.12
    import tomllib  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - fallback when tomllib missing
    tomllib = None  # type: ignore

CONFIG_PATH = Path(__file__).resolve().parent / "agent.toml"


def _read_mac_address() -> Optional[str]:
    """Best-effort MAC of the primary interface (eth0 first, then any non-loopback)."""
    net = Path("/sys/class/net")
    if not net.is_dir():
        return None
    candidates = []
    for iface in sorted(net.iterdir()):
        if iface.name == "lo":
            continue
        addr_file = iface / "address"
        try:
            mac = addr_file.read_text().strip()
        except OSError:
            continue
        if not mac or mac == "00:00:00:00:00:00":
            continue
        candidates.append((iface.name, mac))
    if not candidates:
        return None
    for name, mac in candidates:
        if name.startswith("eth") or name.startswith("en"):
            return mac
    return candidates[0][1]


def _load_toml() -> dict:
    if not CONFIG_PATH.is_file():
        return {}
    if tomllib is not None:
        try:
            with CONFIG_PATH.open("rb") as fh:
                return tomllib.load(fh)
        except Exception:
            pass
    
    # Simple line-by-line fallback parser for Python 3.9 (no external dependencies)
    res = {}
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.split("#", 1)[0].strip()  # strip comments
                if not line or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                elif v.lower() in ("true", "yes", "on"):
                    v = True
                elif v.lower() in ("false", "no", "off"):
                    v = False
                else:
                    try:
                        if "." in v:
                            v = float(v)
                        else:
                            v = int(v)
                    except ValueError:
                        pass
                res[k] = v
    except Exception:
        pass
    return res


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class AgentConfig:
    board_id: str
    name: str
    backend_url: str
    agent_port: int
    heartbeat_interval: float
    model: str
    tag: Optional[str]
    firmware_version: str
    mac_address: Optional[str]
    dry_run: bool
    work_dir: str
    # Result upload target. Defaults to the backend; a standalone node_b_receiver
    # can be pointed at instead for phase-1 testing.
    result_receiver_url: str

    @property
    def base_url(self) -> str:
        return self.backend_url.rstrip("/")


def load_config() -> AgentConfig:
    toml = _load_toml()

    def pick(env: str, key: str, default):
        if os.getenv(env) is not None:
            return os.getenv(env)
        if key in toml:
            return toml[key]
        return default

    mac = pick("AGENT_MAC", "mac_address", None) or _read_mac_address()
    # Stable-ish default board id from MAC so re-registration keeps the same row.
    default_board_id = f"kr260-{mac.replace(':', '')[-6:]}" if mac else f"kr260-{uuid.getnode():x}"
    board_id = str(pick("BOARD_ID", "board_id", default_board_id))

    backend_url = str(pick("BACKEND_URL", "backend_url", "http://127.0.0.1:8000"))

    return AgentConfig(
        board_id=board_id,
        name=str(pick("BOARD_NAME", "name", board_id)),
        backend_url=backend_url,
        agent_port=int(pick("AGENT_PORT", "agent_port", 8000)),
        heartbeat_interval=float(pick("HEARTBEAT_INTERVAL", "heartbeat_interval", 5.0)),
        model=str(pick("BOARD_MODEL", "model", "kr260")),
        tag=(pick("BOARD_TAG", "tag", None) or None),
        firmware_version=str(pick("AGENT_FW_VERSION", "firmware_version", "agent-0.1.0")),
        mac_address=mac,
        dry_run=_env_bool("DRY_RUN", bool(toml.get("dry_run", True))),
        work_dir=str(pick("AGENT_WORK_DIR", "work_dir", "/dev/shm/board_agent")),
        result_receiver_url=str(pick("RESULT_RECEIVER_URL", "result_receiver_url", backend_url)),
    )


config = load_config()
