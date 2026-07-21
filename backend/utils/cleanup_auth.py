"""Passcode gate for cleanup endpoints.

A single shared passcode from env ``CLEANUP_PASSCODE`` (no user/role system).
Fail closed: if the env var is unset/blank, cleanup is disabled entirely.
"""
from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException


def require_cleanup_passcode(
    x_cleanup_passcode: Optional[str] = Header(default=None, alias="X-Cleanup-Passcode"),
) -> None:
    """FastAPI dependency: allow the request only with the correct passcode.

    - env unset/blank -> 403 (cleanup disabled)
    - missing/wrong passcode -> 401 (constant-time compare)
    """
    expected = (os.getenv("CLEANUP_PASSCODE", "") or "").strip()
    if not expected:
        raise HTTPException(status_code=403, detail="Cleanup is disabled")
    provided = x_cleanup_passcode or ""
    if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid passcode")
    return None
