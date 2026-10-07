"""Map uploaded filenames to stored `FileType` enum (VCD, EROM, ULP, TXT, …) for the files table."""
from __future__ import annotations

import os


def classify_file_type_from_filename(filename: str) -> str:
    """
    Return a FileType enum name matching Core File Taxonomy:
    - Input:
      * Test Stimulus: .ist (mapped to VCD for test case execution)
      * Golden Waveform: .vcd
      * Main Firmware: .erom, .bin (mapped to EROM)
      * ULP Firmware: .ulp, .lin (mapped to ULP)
      * Config / Commands: .txt
    """
    ext = (os.path.splitext(filename or "")[1] or "").lstrip(".").lower()
    if ext in ("ist", "vcd"):
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
