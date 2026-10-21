"""
Surfer Session Manager Service.

Replaces GTKWave Broadway with self-hosted Surfer WASM.

Architecture:
  - Stateless: no process spawning, no port pool.
  - Each "session" is just a URL record:
      embed_url → /api/v1/waveform/sessions/{id}/embed
      which redirects to: /surfer/?load_url=<FST_EXPORT_URL>
  - Surfer WASM is served as static files from /surfer/ (mounted in main.py).
  - FST files are served via GET /api/results/{id}/export?format=fst.

Advantages over Broadway:
  - Works on any OS (no X11 / broadwayd dependency).
  - Zero resource per session (runs 100% in browser WASM).
  - Supports FST natively (Surfer's Rust parser via WASM).
  - No gtkwave / broadwayd install needed in container.
"""

import time
import uuid
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SurferSession:
    session_id: str
    result_id: str
    fst_url: str          # relative URL to the FST file
    surfer_direct_url: str  # /surfer/?load_url=<encoded_fst_url>
    embed_url: str        # /api/v1/waveform/sessions/{id}/embed  (for API responses)
    status: str = "ready"
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)

    # Kept for API compatibility with the old BroadwaySession callers
    port: int = 0
    display_num: int = 0
    process: None = None
    layout_path: Optional[str] = None


class SurferSessionManager:
    """
    Stateless waveform session manager backed by Surfer WASM.

    Sessions are pure data records; no OS processes are spawned.
    GC via cleanup_inactive_sessions() mirrors the Broadway API so callers
    (e.g. the watchdog) don't need changes.
    """

    def __init__(
        self,
        surfer_base_path: str = "/surfer",
        inactivity_timeout_seconds: int = 900,   # 15 minutes
        api_prefix: str = "/api/results",
    ):
        self.surfer_base_path = surfer_base_path.rstrip("/")
        self.inactivity_timeout_seconds = inactivity_timeout_seconds
        self.api_prefix = api_prefix
        self.sessions: dict[str, SurferSession] = {}

    # ------------------------------------------------------------------
    # Public API (same surface as BroadwaySessionManager)
    # ------------------------------------------------------------------

    def create_session(
        self,
        result_id: str,
        dump_path: str,                         # kept for signature compat; ignored
        golden_path: Optional[str] = None,       # reserved: future dual-golden
        digital_channels=None,                   # ignored (Surfer has its own UI)
        analog_channels=None,                    # ignored
        mode: str = "actual_only",
        fst_url: Optional[str] = None,           # override auto-generated FST URL
    ) -> SurferSession:
        """
        Create a new Surfer WASM session for result_id.

        fst_url — if provided, used directly.
        Otherwise auto-derived as: /api/results/{result_id}/export?format=fst
        """
        session_id = str(uuid.uuid4())

        resolved_fst_url = fst_url or f"{self.api_prefix}/{result_id}/export?format=fst"
        encoded_fst = urllib.parse.quote(resolved_fst_url, safe="")
        surfer_direct = f"{self.surfer_base_path}/?load_url={encoded_fst}"

        session = SurferSession(
            session_id=session_id,
            result_id=result_id,
            fst_url=resolved_fst_url,
            surfer_direct_url=surfer_direct,
            embed_url=f"/api/v1/waveform/sessions/{session_id}/embed",
        )
        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[SurferSession]:
        return self.sessions.get(session_id)

    def heartbeat(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session:
            return False
        session.last_activity = time.time()
        return True

    def terminate_session(self, session_id: str) -> bool:
        session = self.sessions.pop(session_id, None)
        return session is not None

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


# Global singleton — drop-in replacement for broadway_session_manager
surfer_session_manager = SurferSessionManager()
