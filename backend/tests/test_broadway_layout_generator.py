import os
import pytest
from services.broadway_layout_generator import BroadwayLayoutGenerator


def test_generate_layout_with_digital_only():
    generator = BroadwayLayoutGenerator()
    fst_path = "/storage/waveforms/actual.fst"
    digital_channels = ["CH0", "CH1", "CH2"]

    gtkw_content = generator.generate_layout(
        dump_path=fst_path,
        digital_channels=digital_channels,
    )

    assert f'[dumpfile] "{fst_path}"' in gtkw_content
    assert "[timestart] 0" in gtkw_content
    for ch in digital_channels:
        assert ch in gtkw_content


def test_generate_layout_with_analog_channels():
    generator = BroadwayLayoutGenerator()
    fst_path = "/storage/waveforms/capture.fst"
    digital_channels = ["CLK", "RESET"]
    analog_channels = [
        {
            "name": "ADC_OUT",
            "channels": ["CH0", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7"],
            "bit_width": 8,
            "format": "analog-step",
            "height": 72,
            "signed": False,
        }
    ]

    gtkw_content = generator.generate_layout(
        dump_path=fst_path,
        digital_channels=digital_channels,
        analog_channels=analog_channels,
    )

    assert f'[dumpfile] "{fst_path}"' in gtkw_content
    assert "CLK" in gtkw_content
    assert "ADC_OUT" in gtkw_content
    # Must include analog formatting flag (@20020 for analog step)
    assert "@20020" in gtkw_content or "analog-step" in gtkw_content


def test_generate_layout_dual_mode_actual_and_golden():
    generator = BroadwayLayoutGenerator()
    actual_path = "/storage/waveforms/actual.fst"
    golden_path = "/storage/waveforms/golden.vcd"
    digital_channels = ["CH0", "CH1"]
    analog_channels = [
        {
            "name": "DAC_IN",
            "channels": ["CH2", "CH3", "CH4", "CH5"],
            "bit_width": 4,
            "format": "analog-step",
            "height": 64,
        }
    ]

    gtkw_content = generator.generate_layout(
        dump_path=actual_path,
        golden_path=golden_path,
        digital_channels=digital_channels,
        analog_channels=analog_channels,
        mode="dual_golden",
    )

    assert f'[dumpfile] "{actual_path}"' in gtkw_content
    # Must declare or reference golden scope/file
    assert "golden" in gtkw_content.lower()
    assert "actual" in gtkw_content.lower()
