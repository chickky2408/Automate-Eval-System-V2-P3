"""Map uploaded filenames to stored `FileType` enum (VCD, EROM, ULP, TXT, …) for the files table."""
from __future__ import annotations

import os


def classify_file_type_from_filename(filename: str) -> str:
    """
    Return a FileType enum name: VCD, EROM, ULP, TXT, SCRIPT, or OTHER.
    EROM: .erom, .bin, .hex, .elf — ULP: .ulp, .lin — TXT: .txt
    """
    ext = (os.path.splitext(filename or "")[1] or "").lstrip(".").lower()
    if ext == "vcd":
        return "VCD"
    if ext in ("erom", "bin", "hex", "elf"):
        return "EROM"
    if ext in ("ulp", "lin"):
        return "ULP"
    if ext == "txt":
        return "TXT"
    if ext in ("sh", "bash", "zsh", "py", "ps1", "bat", "cmd", "pl", "csh"):
        return "SCRIPT"
    return "OTHER"
