"""
Broadway Layout Generator Service.

Generates GTKWave layout template (.gtkw) files dynamically to:
1. Pre-populate digital and multi-bit signals.
2. Reconstruct designated analog buses into Analog Step format (@20020).
3. Align Actual hardware capture and Expected golden reference side-by-side.
"""

from typing import Any, Dict, List, Optional


class BroadwayLayoutGenerator:
    """Generates .gtkw template files for GTKWave Broadway sessions."""

    def generate_layout(
        self,
        dump_path: str,
        golden_path: Optional[str] = None,
        digital_channels: Optional[List[str]] = None,
        analog_channels: Optional[List[Dict[str, Any]]] = None,
        mode: str = "actual_only",
    ) -> str:
        """
        Synthesizes the .gtkw layout content string.
        """
        digital_channels = digital_channels or []
        analog_channels = analog_channels or []

        lines: List[str] = [
            "[*]",
            "[*] SiliconCraft Broadway GTKWave Layout",
            "[*]",
            f'[dumpfile] "{dump_path}"',
            "[timestart] 0",
            "[size] 1920 1080",
            "[pos] -1 -1",
            "*-16.000000 0 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1 -1",
        ]

        if mode == "dual_golden" and golden_path:
            lines.append(f'[*] [golden_reference] "{golden_path}"')
            lines.append("[treeopen] actual.")
            lines.append("[treeopen] golden.")

        # Digital channels
        for ch in digital_channels:
            if mode == "dual_golden" and golden_path:
                lines.append(f"actual.{ch}")
                lines.append(f"golden.{ch}")
            else:
                lines.append(ch)

        # Analog channels
        for ana in analog_channels:
            name = ana.get("name", "ANALOG_BUS")
            channels = ana.get("channels", [])
            height = ana.get("height", 72)
            fmt = ana.get("format", "analog-step")

            # In GTKWave:
            # @20020 = Analog Step format with standard height
            # Height and trace scaling can be noted
            lines.append(f"[*] Analog Channel: {name} ({fmt}, height={height}px)")
            lines.append("@20020")
            if mode == "dual_golden" and golden_path:
                lines.append(f"actual.{name}")
                lines.append(f"golden.{name}")
            else:
                lines.append(name)
            if channels:
                member_str = " ".join(channels)
                lines.append(f"+{{{name}}} {member_str}")

        lines.append("[pattern_trace] 1")
        lines.append("[pattern_trace] 0")
        return "\n".join(lines) + "\n"
