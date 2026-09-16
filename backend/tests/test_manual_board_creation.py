"""
Regression test for a security-audit finding (2026-09-16): POST /api/boards
(the UI's "add board manually" feature) crashed with an unhandled 500 on
every call. board_manager.create_board() always returns a (BoardInfo, bool)
tuple (confirmed by its return-type annotation and both return statements),
and routers/agent.py's /register handler correctly unpacks it, but
routers/boards.py's create_board() handler assigned the raw tuple to `board`
and passed it straight to _board_to_fe(board), which does board.status.state
-- AttributeError: 'tuple' object has no attribute 'status'.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import pytest


@pytest.mark.asyncio
async def test_manual_board_creation_succeeds():
    from db.database import init_db
    await init_db()
    from main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.post("/api/boards", json={"name": "manual-audit-board", "model": "Zybo"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "manual-audit-board"
    assert "id" in body
