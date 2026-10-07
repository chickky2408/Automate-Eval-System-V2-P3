import pytest
import time
from services.broadway_session_manager import BroadwaySessionManager


def test_session_creation_and_retrieval():
    manager = BroadwaySessionManager(port_start=8085, port_end=8090)
    session = manager.create_session(
        result_id="RES-001",
        dump_path="/tmp/test.fst",
        mode="actual_only",
        analog_channels=[{"name": "ADC", "channels": ["CH0", "CH1"], "format": "analog-step"}],
    )

    assert session.session_id is not None
    assert session.result_id == "RES-001"
    assert session.port >= 8085 and session.port <= 8090
    assert session.status in ("ready", "spawning")
    assert "/api/v1/waveform/sessions" in session.embed_url

    retrieved = manager.get_session(session.session_id)
    assert retrieved is not None
    assert retrieved.session_id == session.session_id


def test_port_pool_allocation_and_release():
    manager = BroadwaySessionManager(port_start=8085, port_end=8086)
    s1 = manager.create_session(result_id="RES-1", dump_path="/tmp/1.fst")
    s2 = manager.create_session(result_id="RES-2", dump_path="/tmp/2.fst")
    assert s1.port != s2.port

    # Pool exhausted
    with pytest.raises(RuntimeError, match="No available display ports"):
        manager.create_session(result_id="RES-3", dump_path="/tmp/3.fst")

    # Release s1 and allocate again
    manager.terminate_session(s1.session_id)
    s3 = manager.create_session(result_id="RES-3", dump_path="/tmp/3.fst")
    assert s3.port == s1.port


def test_session_heartbeat_and_timeout():
    manager = BroadwaySessionManager(inactivity_timeout_seconds=1)
    s = manager.create_session(result_id="RES-1", dump_path="/tmp/1.fst")
    
    assert manager.heartbeat(s.session_id) is True
    # Simulate time lapse
    s.last_activity = time.time() - 2
    cleaned_count = manager.cleanup_inactive_sessions()
    assert cleaned_count == 1
    assert manager.get_session(s.session_id) is None
