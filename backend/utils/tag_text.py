"""Shared tag string rules (keep in sync with frontend `MAX_TAG_CHAR_LENGTH` in utils/tagPalette.js)."""

from __future__ import annotations

from typing import Optional

MAX_TAG_CHAR_LENGTH = 10


def clamp_tag_label(part: str) -> str:
    s = (part or "").strip()
    if not s:
        return ""
    return s[:MAX_TAG_CHAR_LENGTH]


def normalize_comma_separated_tags(value: Optional[str]) -> Optional[str]:
    """Clamp each comma-separated token; join with ', '. Empty / whitespace-only -> None."""
    if value is None:
        return None
    parts = [clamp_tag_label(p) for p in str(value).split(",")]
    parts = [p for p in parts if p]
    if not parts:
        return None
    return ", ".join(parts)
