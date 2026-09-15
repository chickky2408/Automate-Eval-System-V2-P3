"""
TDD Unit Tests for Waveform Comparator Service and Diff Artifact Generation.
Tests Seam 1: Digital comparison calculation, mismatch clustering, and artifact persistence.
"""

import os
import json
import numpy as np
import pytest
from services.waveform_comparator import (
    WaveformComparatorService,
    ComparisonConfig,
    extract_mismatch_zones
)

def test_extract_mismatch_zones_clusters_errors():
    """Verify consecutive mismatch samples are clustered into discrete time-bounded zones."""
    # 100 samples at 100 MHz (10ns / 0.01us per sample)
    exp = np.zeros(100, dtype=np.uint8)
    exp[20:40] = 1 # Pulse from sample 20 to 40 (0.2us to 0.4us)

    act = exp.copy()
    act[25:35] = 0 # Dropped pulse inside 25..35 (10 samples error)
    act[70:75] = 1 # Glitch pulse at 70..75 (5 samples error)

    zones = extract_mismatch_zones(
        channel_id="CH3_MOSI",
        exp_arr=exp,
        act_arr=act,
        sample_rate_hz=1e8
    )

    assert len(zones) == 2
    
    # First zone: dropped pulse
    z1 = zones[0]
    assert z1["channel_id"] == "CH3_MOSI"
    assert z1["start_sample"] == 25
    assert z1["end_sample"] == 35
    assert pytest.approx(z1["start_time_us"], rel=1e-3) == 0.25
    assert pytest.approx(z1["end_time_us"], rel=1e-3) == 0.35
    assert pytest.approx(z1["duration_ns"], rel=1e-3) == 100.0
    assert z1["discrepancy_type"] == "DROPPED_PULSE"

    # Second zone: glitch
    z2 = zones[1]
    assert z2["channel_id"] == "CH3_MOSI"
    assert z2["start_sample"] == 70
    assert z2["end_sample"] == 75
    assert z2["discrepancy_type"] == "NOISE_GLITCH"

def test_comparator_service_run_and_artifact_roundtrip(tmp_path):
    """Verify comparator service runs dual comparison and persists/loads diff artifact."""
    service = WaveformComparatorService(storage_dir=str(tmp_path))

    # Setup clock and data
    num_samples = 200
    clk = ((np.arange(num_samples) % 10) < 5).astype(np.uint8)
    exp_data = np.zeros(num_samples, dtype=np.uint8)
    exp_data[30:70] = 1
    exp_data[110:150] = 1

    # Actual data with 2 samples delay (+20ns delay on 100MHz clock)
    act_data = np.zeros(num_samples, dtype=np.uint8)
    act_data[32:72] = 1
    act_data[112:152] = 1

    exp_dict = {"CH0_TRIG": clk, "CH1_CLK": clk, "CH2_DATA": exp_data}
    act_dict = {"CH0_TRIG": clk, "CH1_CLK": clk, "CH2_DATA": act_data}

    cfg = ComparisonConfig(
        sample_rate_hz=1e8,
        sync_channel="CH0_TRIG",
        strobe_clock_channel="CH1_CLK",
        eval_mode="DUAL",
        tolerance_samples=3
    )

    diff_payload = service.compare_and_build_diff(
        result_id="res-unit-test-101",
        expected_signals=exp_dict,
        actual_signals=act_dict,
        config=cfg
    )

    assert diff_payload["result_id"] == "res-unit-test-101"
    assert diff_payload["verification_status"] in ("PASS", "PASS_WITH_JITTER")
    assert diff_payload["scores"]["majority_score"] == 100.0
    assert diff_payload["scores"]["f1_score"] == 100.0
    assert "channels" in diff_payload
    assert "mismatch_zones" in diff_payload

    # Save artifact
    artifact_path = service.save_diff_artifact("res-unit-test-101", diff_payload)
    assert os.path.exists(artifact_path)

    # Load artifact back
    loaded_payload = service.load_diff_artifact("res-unit-test-101")
    assert loaded_payload is not None
    assert loaded_payload["result_id"] == "res-unit-test-101"
    assert loaded_payload["scores"]["majority_score"] == 100.0
