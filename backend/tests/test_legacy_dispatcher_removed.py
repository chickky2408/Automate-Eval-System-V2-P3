"""
Regression test for PROJECT.md B4.1: JobQueueService._process_queue was a second
dispatch loop polling the same "pending" job_targets as PendingJobDispatcher, but
sharing none of its locks (_dispatching / _dispatching_boards live only in
pending_job_dispatcher.py). Since POST /api/jobs/start (no job id) started that
loop, running it alongside the always-on PendingJobDispatcher could dispatch the
same target twice onto two different boards. The loop, its start()/stop() methods,
and the two routes are removed -- PendingJobDispatcher is now the only dispatcher.
"""
import os
os.environ["USE_SQLITE_DEMO"] = "1"

import pytest
from fastapi.testclient import TestClient

from services.job_queue import job_queue_service


def test_job_queue_service_has_no_legacy_loop():
    assert not hasattr(job_queue_service, "start")
    assert not hasattr(job_queue_service, "stop")
    assert not hasattr(job_queue_service, "_process_queue")
    # _execute_target is the shared work function -- still used by
    # pending_job_dispatcher.py, must remain.
    assert hasattr(job_queue_service, "_execute_target")


def test_legacy_queue_start_stop_routes_removed():
    from main import app
    client = TestClient(app)
    # "/api/jobs/start" and "/api/jobs/stop" no longer have a dedicated POST route.
    # They now fall through to the generic "/{job_id}" routes (GET/PUT/PATCH/DELETE,
    # treating "start"/"stop" as a job_id) -> 405 Method Not Allowed, not the queue
    # loop starting. Confirms the routes are gone rather than merely broken.
    assert client.post("/api/jobs/start").status_code == 405
    assert client.post("/api/jobs/stop").status_code == 405
