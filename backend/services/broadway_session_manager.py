"""
Broadway Session Manager Service.

Manages headless GTKWave Broadway sessions:
- Display port pool management (:10 to :50 mapping to ports 8085-8120)
- Process spawning and lifecycle tracking
- Inactivity watchdog auto-cleanup (default 15 minutes)
"""

import os
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from services.broadway_layout_generator import BroadwayLayoutGenerator


@dataclass
class BroadwaySession:
    session_id: str
    result_id: str
    port: int
    display_num: int
    dump_path: str
    layout_path: Optional[str]
    status: str
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    process: Optional[Any] = None
    embed_url: str = ""


class BroadwaySessionManager:
    """Manages containerized / headless GTKWave Broadway sessions."""

    def __init__(
        self,
        port_start: int = 8085,
        port_end: int = 8120,
        inactivity_timeout_seconds: int = 900,  # 15 minutes
        layout_generator: Optional[BroadwayLayoutGenerator] = None,
    ):
        self.port_start = port_start
        self.port_end = port_end
        self.inactivity_timeout_seconds = inactivity_timeout_seconds
        self.layout_generator = layout_generator or BroadwayLayoutGenerator()
        self.sessions: Dict[str, BroadwaySession] = {}
        self.allocated_ports: set[int] = set()

    def _allocate_port(self) -> int:
        for port in range(self.port_start, self.port_end + 1):
            if port not in self.allocated_ports:
                self.allocated_ports.add(port)
                return port
        raise RuntimeError("No available display ports in pool")

    def create_session(
        self,
        result_id: str,
        dump_path: str,
        golden_path: Optional[str] = None,
        digital_channels: Optional[List[str]] = None,
        analog_channels: Optional[List[Dict[str, Any]]] = None,
        mode: str = "actual_only",
    ) -> BroadwaySession:
        port = self._allocate_port()
        display_num = port - 8080  # e.g. 8085 -> display :5
        session_id = str(uuid.uuid4())

        # Generate temporary layout file
        layout_content = self.layout_generator.generate_layout(
            dump_path=dump_path,
            golden_path=golden_path,
            digital_channels=digital_channels,
            analog_channels=analog_channels,
            mode=mode,
        )
        layout_path = f"/tmp/gtkw_{session_id}.gtkw" if os.name != "nt" else os.path.join(os.environ.get("TEMP", "."), f"gtkw_{session_id}.gtkw")
        try:
            with open(layout_path, "w", encoding="utf-8") as f:
                f.write(layout_content)
        except Exception:
            layout_path = None

        embed_url = f"/api/v1/waveform/sessions/{session_id}/embed"

        proc = None
        # In Linux container with broadwayd and gtkwave installed
        if shutil.which("broadwayd") and shutil.which("gtkwave"):
            try:
                env = os.environ.copy()
                env["GDK_BACKEND"] = "broadway"
                env["BROADWAY_DISPLAY"] = f":{display_num}"
                cmd = ["gtkwave", dump_path]
                if layout_path:
                    cmd.append(layout_path)
                proc = subprocess.Popen(cmd, env=env)
            except Exception:
                proc = None

        session = BroadwaySession(
            session_id=session_id,
            result_id=result_id,
            port=port,
            display_num=display_num,
            dump_path=dump_path,
            layout_path=layout_path,
            status="ready",
            process=proc,
            embed_url=embed_url,
        )
        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[BroadwaySession]:
        return self.sessions.get(session_id)

    def heartbeat(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False
        session.last_activity = time.time()
        return True

    def terminate_session(self, session_id: str) -> bool:
        session = self.sessions.pop(session_id, None)
        if not session:
            return False
        self.allocated_ports.discard(session.port)
        if session.process:
            try:
                session.process.terminate()
            except Exception:
                pass
        if session.layout_path and os.path.exists(session.layout_path):
            try:
                os.remove(session.layout_path)
            except Exception:
                pass
        return True

    def cleanup_inactive_sessions(self) -> int:
        now = time.time()
        to_remove = [
            sid
            for sid, sess in self.sessions.items()
            if (now - sess.last_activity) >= self.inactivity_timeout_seconds
        ]
        for sid in to_remove:
            self.terminate_session(sid)
        return len(to_remove)


# Global singleton instance for application use
broadway_session_manager = BroadwaySessionManager()
