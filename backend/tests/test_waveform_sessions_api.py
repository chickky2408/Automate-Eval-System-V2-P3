import pytest
from fastapi.testclient import TestClient
from main import app
from services.broadway_session_manager import broadway_session_manager


@pytest.fixture
def client():
    return TestClient(app)


def test_create_and_delete_waveform_session(client):
    payload = {
        "result_id": "RES-TEST-001",
        "mode": "actual_only",
    }
    response = client.post("/api/v1/waveform/sessions", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    assert data["status"] == "ready"
    assert "embed_url" in data

    session_id = data["session_id"]

    # Check status endpoint
    status_res = client.get(f"/api/v1/waveform/sessions/{session_id}/status")
    assert status_res.status_code == 200
    assert status_res.json()["session_id"] == session_id

    # Delete endpoint
    del_res = client.delete(f"/api/v1/waveform/sessions/{session_id}")
    assert del_res.status_code == 200
    assert del_res.json()["success"] is True

    # Check deleted
    status_res_after = client.get(f"/api/v1/waveform/sessions/{session_id}/status")
    assert status_res_after.status_code == 404
