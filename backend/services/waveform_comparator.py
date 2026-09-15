"""
Waveform Comparator Service (SPEC-0002 & ADR-0002 Implementation)
-----------------------------------------------------------------
Provides:
1. DigitalWaveformComparator engine with Trigger Alignment, 10-Point Majority Voting XOR, and Edge F1.
2. extract_mismatch_zones(): Clusters contiguous sample mismatches into bounding intervals.
3. WaveformComparatorService: Coordinates comparison, formats unified diff payloads, and persists/loads .diff.json.lz4 artifacts.
"""

from dataclasses import dataclass, field
import datetime
import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

try:
    import lz4.frame as lz4_frame
except ImportError:
    lz4_frame = None


@dataclass
class ComparisonConfig:
    """Configuration parameters for digital waveform verification."""
    sample_rate_hz: float = 1.0e8          # Default: 100 MHz (10 ns period)
    sync_channel: str = "CH0"               # Channel used to anchor t=0
    sync_edge: str = "rising"               # "rising" or "falling"
    tolerance_samples: int = 1              # Slack window (e.g. ±1 sample = ±10 ns)
    channel_mask: Optional[List[str]] = None  # None = verify all channels
    time_window_us: Optional[Tuple[float, float]] = None  # (start_us, end_us) or None
    f1_pass_threshold: float = 99.0         # Minimum F1 % required for PASS
    xor_pass_threshold: float = 100.0       # Minimum Sample XOR % required for STRICT PASS
    eval_mode: str = "DUAL"                 # "DUAL", "EDGE_F1", "STRICT_XOR", "STROBE_XOR", "MAJORITY_XOR"
    require_zero_mismatch: bool = False     # If True, any bit mismatch fails
    strobe_clock_channel: Optional[str] = None  # e.g. "CH1" for Clock-Synchronous Strobing
    strobe_sub_points: int = 10              # Number of sub-points between rising edge to rising edge
    strobe_eval_point: Optional[int] = None # Specific point 0..9 (or None for best/optimal phase)
    majority_threshold: float = 0.5         # Fraction of sub-points to resolve majority logic (default: > 50%)


@dataclass
class ChannelDiffDetail:
    """Detailed verification metrics for a single digital channel."""
    channel_name: str
    f1_score: float
    sample_xor_score: float                 # Percentage of matching samples (0.0% - 100.0%)
    precision: float
    recall: float
    true_positives: int
    false_positives: int
    false_negatives: int
    mismatched_samples: int
    first_mismatch_time_us: Optional[float]
    expected_edge_count: int
    actual_edge_count: int
    majority_xor_score: Optional[float] = None  # Match % of cycle majority votes


@dataclass
class ComparisonResult:
    """Comprehensive verdict and diagnostic metrics of the comparison."""
    passed: bool
    status_label: str                       # "PASS", "PASS_WITH_JITTER", "MARGINAL", "FAIL", "TRIGGER_ERROR", "TRUNCATED"
    f1_score: float = 0.0                   # Overall edge similarity (0.0% to 100.0%)
    sample_xor_score: float = 0.0           # Overall sample grid accuracy (0.0% to 100.0%)
    precision: float = 0.0                  # TP / (TP + FP)
    recall: float = 0.0                     # TP / (TP + FN)
    total_true_positives: int = 0
    total_false_positives: int = 0
    total_false_negatives: int = 0
    total_samples_compared: int = 0
    total_mismatched_samples: int = 0
    first_mismatch_time_us: Optional[float] = None
    sync_offset_samples: int = 0
    sync_offset_us: float = 0.0
    channel_results: Dict[str, ChannelDiffDetail] = field(default_factory=dict)
    strobe_scores: Dict[int, float] = field(default_factory=dict)
    strobe_best_point: Optional[int] = None
    strobe_xor_score: Optional[float] = None
    majority_xor_score: Optional[float] = None
    majority_total_cycles: int = 0
    majority_matched_cycles: int = 0
    majority_avg_confidence: float = 0.0
    channel_majority_scores: Dict[str, float] = field(default_factory=dict)
    error_message: Optional[str] = None
    execution_time_ms: float = 0.0


def find_first_edge(signal: np.ndarray, edge_type: str = "rising") -> Optional[int]:
    if len(signal) < 2:
        return None
    diff = np.diff(signal.astype(np.int8))
    if edge_type == "rising":
        indices = np.where(diff > 0)[0]
    elif edge_type == "falling":
        indices = np.where(diff < 0)[0]
    else:
        indices = np.where(diff != 0)[0]

    if len(indices) > 0:
        return int(indices[0] + 1)
    return None


def extract_edges(signal: np.ndarray) -> np.ndarray:
    if len(signal) < 2:
        return np.array([], dtype=np.int64)
    diff = np.diff(signal.astype(np.int8))
    return np.where(diff != 0)[0] + 1


def match_edges_f1(
    exp_edges: np.ndarray,
    act_edges: np.ndarray,
    tolerance: int
) -> Tuple[int, int, int]:
    if len(exp_edges) == 0 and len(act_edges) == 0:
        return 0, 0, 0
    if len(exp_edges) == 0:
        return 0, len(act_edges), 0
    if len(act_edges) == 0:
        return 0, 0, len(exp_edges)

    matched_act = np.zeros(len(act_edges), dtype=bool)
    tp = 0
    act_idx = 0
    num_act = len(act_edges)

    for exp_pos in exp_edges:
        window_start = exp_pos - tolerance
        window_end = exp_pos + tolerance

        while act_idx < num_act and act_edges[act_idx] < window_start:
            act_idx += 1

        best_match = -1
        search_idx = act_idx
        min_distance = tolerance + 1

        while search_idx < num_act and act_edges[search_idx] <= window_end:
            if not matched_act[search_idx]:
                dist = abs(act_edges[search_idx] - exp_pos)
                if dist < min_distance:
                    min_distance = dist
                    best_match = search_idx
            search_idx += 1

        if best_match != -1:
            matched_act[best_match] = True
            tp += 1

    fn = len(exp_edges) - tp
    fp = len(act_edges) - tp
    return tp, fp, fn


class DigitalWaveformComparator:
    """Layered Dual-Stage Digital Waveform Comparison Engine."""

    def __init__(self, config: Optional[ComparisonConfig] = None):
        self.config = config or ComparisonConfig()

    def compare(
        self,
        expected: Dict[str, np.ndarray],
        actual: Dict[str, np.ndarray],
    ) -> ComparisonResult:
        t_start = time.perf_counter()
        cfg = self.config
        time_step_s = 1.0 / cfg.sample_rate_hz
        time_step_us = time_step_s * 1e6

        if cfg.sync_channel not in expected:
            return ComparisonResult(
                passed=False,
                status_label="CONFIG_ERROR",
                error_message=f"Sync channel '{cfg.sync_channel}' not found in Expected model",
                execution_time_ms=(time.perf_counter() - t_start) * 1000,
            )

        if cfg.sync_channel not in actual:
            return ComparisonResult(
                passed=False,
                status_label="TRIGGER_ERROR",
                error_message=f"Sync channel '{cfg.sync_channel}' not found in Actual capture",
                execution_time_ms=(time.perf_counter() - t_start) * 1000,
            )

        exp_trigger_idx = find_first_edge(expected[cfg.sync_channel], cfg.sync_edge)
        act_trigger_idx = find_first_edge(actual[cfg.sync_channel], cfg.sync_edge)

        if act_trigger_idx is None:
            return ComparisonResult(
                passed=False,
                status_label="TRIGGER_ERROR",
                error_message=f"Trigger edge not found on sync channel ({cfg.sync_channel})",
                execution_time_ms=(time.perf_counter() - t_start) * 1000,
            )

        if exp_trigger_idx is None:
            exp_trigger_idx = 0

        sync_offset_samples = act_trigger_idx - exp_trigger_idx
        sync_offset_us = sync_offset_samples * time_step_us

        target_channels = [
            ch for ch in expected.keys()
            if ch in actual and (cfg.channel_mask is None or ch in cfg.channel_mask)
        ]

        if not target_channels:
            return ComparisonResult(
                passed=False,
                status_label="CONFIG_ERROR",
                sync_offset_samples=sync_offset_samples,
                sync_offset_us=sync_offset_us,
                error_message="No overlapping channels matched the channel mask filter",
                execution_time_ms=(time.perf_counter() - t_start) * 1000,
            )

        aligned_exp = {}
        aligned_act = {}

        min_act_remaining = min(len(actual[ch]) - act_trigger_idx for ch in target_channels)
        min_exp_remaining = min(len(expected[ch]) - exp_trigger_idx for ch in target_channels)

        if min_act_remaining < min_exp_remaining:
            return ComparisonResult(
                passed=False,
                status_label="TRUNCATED",
                total_samples_compared=min_act_remaining,
                total_mismatched_samples=min_exp_remaining - min_act_remaining,
                first_mismatch_time_us=min_act_remaining * time_step_us,
                sync_offset_samples=sync_offset_samples,
                sync_offset_us=sync_offset_us,
                error_message=f"Actual capture ended prematurely ({min_act_remaining} < {min_exp_remaining} samples)",
                execution_time_ms=(time.perf_counter() - t_start) * 1000,
            )

        compare_length = min(min_exp_remaining, min_act_remaining)

        if cfg.time_window_us is not None:
            w_start_us, w_end_us = cfg.time_window_us
            w_start_samp = max(0, int(w_start_us / time_step_us))
            w_end_samp = min(compare_length, int(w_end_us / time_step_us))
            window_slice = slice(w_start_samp, w_end_samp)
        else:
            window_slice = slice(0, compare_length)

        for ch in target_channels:
            aligned_exp[ch] = expected[ch][exp_trigger_idx : exp_trigger_idx + compare_length][window_slice]
            aligned_act[ch] = actual[ch][act_trigger_idx : act_trigger_idx + compare_length][window_slice]

        # Ensure strobe clock channel is sliced if present
        if cfg.strobe_clock_channel and cfg.strobe_clock_channel in expected and cfg.strobe_clock_channel in actual:
            if cfg.strobe_clock_channel not in aligned_exp:
                aligned_exp[cfg.strobe_clock_channel] = expected[cfg.strobe_clock_channel][exp_trigger_idx : exp_trigger_idx + compare_length][window_slice]
                aligned_act[cfg.strobe_clock_channel] = actual[cfg.strobe_clock_channel][act_trigger_idx : act_trigger_idx + compare_length][window_slice]

        num_samples = len(next(iter(aligned_exp.values())))

        total_tp = 0
        total_fp = 0
        total_fn = 0
        total_mismatch_samples = 0
        earliest_mismatch_time_us: Optional[float] = None
        channel_details = {}

        for ch in target_channels:
            exp_ch = aligned_exp[ch].astype(np.uint8)
            act_ch = aligned_act[ch].astype(np.uint8)

            diff_mask = np.bitwise_xor(exp_ch, act_ch)
            ch_mismatches = int(np.count_nonzero(diff_mask))
            total_mismatch_samples += ch_mismatches

            ch_first_mismatch: Optional[float] = None
            if ch_mismatches > 0:
                first_idx = int(np.where(diff_mask)[0][0])
                first_us = first_idx * time_step_us
                ch_first_mismatch = first_us
                if earliest_mismatch_time_us is None or first_us < earliest_mismatch_time_us:
                    earliest_mismatch_time_us = first_us

            ch_sample_score = (1.0 - (ch_mismatches / num_samples)) * 100.0 if num_samples > 0 else 100.0

            exp_e = extract_edges(exp_ch)
            act_e = extract_edges(act_ch)
            tp, fp, fn = match_edges_f1(exp_e, act_e, cfg.tolerance_samples)

            total_tp += tp
            total_fp += fp
            total_fn += fn

            precision = (tp / (tp + fp) * 100.0) if (tp + fp) > 0 else (100.0 if len(act_e) == 0 else 0.0)
            recall = (tp / (tp + fn) * 100.0) if (tp + fn) > 0 else (100.0 if len(exp_e) == 0 else 0.0)
            f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

            channel_details[ch] = ChannelDiffDetail(
                channel_name=ch,
                f1_score=f1,
                sample_xor_score=ch_sample_score,
                precision=precision,
                recall=recall,
                true_positives=tp,
                false_positives=fp,
                false_negatives=fn,
                mismatched_samples=ch_mismatches,
                first_mismatch_time_us=ch_first_mismatch,
                expected_edge_count=len(exp_e),
                actual_edge_count=len(act_e)
            )

        overall_precision = (total_tp / (total_tp + total_fp) * 100.0) if (total_tp + total_fp) > 0 else 100.0
        overall_recall = (total_tp / (total_tp + total_fn) * 100.0) if (total_tp + total_fn) > 0 else 100.0
        overall_f1 = (2 * overall_precision * overall_recall / (overall_precision + overall_recall)) if (overall_precision + overall_recall) > 0 else 0.0

        total_grid_points = num_samples * len(target_channels)
        overall_sample_score = (1.0 - (total_mismatch_samples / total_grid_points)) * 100.0 if total_grid_points > 0 else 100.0

        # Clock-Synchronous Strobing & Majority Voting XOR
        strobe_scores: Dict[int, float] = {}
        strobe_best_pt: Optional[int] = None
        strobe_best_score: Optional[float] = None
        majority_xor_score: Optional[float] = None
        majority_total_cycles = 0
        majority_matched_cycles = 0
        majority_avg_confidence = 0.0
        channel_majority_scores: Dict[str, float] = {}

        if cfg.strobe_clock_channel and cfg.strobe_clock_channel in aligned_act:
            clk_signal = aligned_act[cfg.strobe_clock_channel].astype(np.int8)
            clk_diff = np.diff(clk_signal)
            rising_edges = np.where(clk_diff > 0)[0] + 1

            if len(rising_edges) >= 2:
                n_sub = max(2, cfg.strobe_sub_points)
                point_match_counts = {p: 0 for p in range(n_sub)}
                point_total_evals = {p: 0 for p in range(n_sub)}

                channel_cycle_matches = {ch: 0 for ch in target_channels}
                cycle_confidence_list = []
                num_cycles = len(rising_edges) - 1
                majority_total_cycles = num_cycles * len(target_channels)

                for c_idx in range(num_cycles):
                    c_start = rising_edges[c_idx]
                    c_end = rising_edges[c_idx + 1]
                    c_len = c_end - c_start
                    if c_len < n_sub:
                        continue

                    strobe_indices = [int(c_start + (p * c_len / n_sub)) for p in range(n_sub)]

                    for ch in target_channels:
                        exp_ch = aligned_exp[ch]
                        act_ch = aligned_act[ch]

                        exp_samples = exp_ch[strobe_indices]
                        act_samples = act_ch[strobe_indices]

                        for p in range(n_sub):
                            if exp_samples[p] == act_samples[p]:
                                point_match_counts[p] += 1
                            point_total_evals[p] += 1

                        exp_vote_ones = np.count_nonzero(exp_samples)
                        act_vote_ones = np.count_nonzero(act_samples)

                        exp_resolved = 1 if (exp_vote_ones / n_sub) > cfg.majority_threshold else 0
                        act_resolved = 1 if (act_vote_ones / n_sub) > cfg.majority_threshold else 0

                        vote_majority = max(act_vote_ones, n_sub - act_vote_ones)
                        confidence_pct = (vote_majority / n_sub) * 100.0
                        cycle_confidence_list.append(confidence_pct)

                        if exp_resolved == act_resolved:
                            channel_cycle_matches[ch] += 1
                            majority_matched_cycles += 1

                for p in range(n_sub):
                    if point_total_evals[p] > 0:
                        strobe_scores[p] = (point_match_counts[p] / point_total_evals[p]) * 100.0
                    else:
                        strobe_scores[p] = 0.0

                if strobe_scores:
                    strobe_best_pt = max(strobe_scores, key=strobe_scores.get)
                    strobe_best_score = strobe_scores[strobe_best_pt]

                if cfg.strobe_eval_point is not None and cfg.strobe_eval_point in strobe_scores:
                    strobe_best_pt = cfg.strobe_eval_point
                    strobe_best_score = strobe_scores[cfg.strobe_eval_point]

                if majority_total_cycles > 0:
                    majority_xor_score = (majority_matched_cycles / majority_total_cycles) * 100.0
                if cycle_confidence_list:
                    majority_avg_confidence = float(np.mean(cycle_confidence_list))

                for ch in target_channels:
                    c_score = (channel_cycle_matches[ch] / num_cycles) * 100.0 if num_cycles > 0 else 100.0
                    channel_majority_scores[ch] = c_score
                    if ch in channel_details:
                        channel_details[ch].majority_xor_score = c_score

        # Determine Verdict
        passed = False
        status_label = "FAIL"

        if cfg.eval_mode == "MAJORITY_XOR":
            active_score = majority_xor_score if majority_xor_score is not None else overall_f1
            if active_score >= cfg.f1_pass_threshold:
                passed = True
                status_label = "PASS" if active_score == 100.0 else "PASS_WITH_JITTER"
            elif active_score >= 85.0:
                passed = False
                status_label = "MARGINAL"
            else:
                passed = False
                status_label = "FAIL"
        elif cfg.eval_mode == "STROBE_XOR":
            active_score = strobe_best_score if strobe_best_score is not None else overall_f1
            if active_score >= cfg.xor_pass_threshold:
                passed = True
                status_label = "PASS"
            elif active_score >= cfg.f1_pass_threshold:
                passed = True
                status_label = "PASS_WITH_JITTER"
            else:
                passed = False
                status_label = "FAIL"
        elif cfg.eval_mode == "STRICT_XOR":
            if total_mismatch_samples == 0:
                passed = True
                status_label = "PASS"
            else:
                passed = False
                status_label = "FAIL"
        else: # "DUAL" or "EDGE_F1"
            if total_mismatch_samples == 0 and overall_f1 >= cfg.f1_pass_threshold:
                passed = True
                status_label = "PASS"
            elif overall_f1 >= cfg.f1_pass_threshold:
                passed = True
                status_label = "PASS_WITH_JITTER"
            elif overall_f1 >= 85.0:
                passed = False
                status_label = "MARGINAL"
            else:
                passed = False
                status_label = "FAIL"

        return ComparisonResult(
            passed=passed,
            status_label=status_label,
            f1_score=overall_f1,
            sample_xor_score=overall_sample_score,
            precision=overall_precision,
            recall=overall_recall,
            total_true_positives=total_tp,
            total_false_positives=total_fp,
            total_false_negatives=total_fn,
            total_samples_compared=num_samples,
            total_mismatched_samples=total_mismatch_samples,
            first_mismatch_time_us=earliest_mismatch_time_us,
            sync_offset_samples=sync_offset_samples,
            sync_offset_us=sync_offset_us,
            channel_results=channel_details,
            strobe_scores=strobe_scores,
            strobe_best_point=strobe_best_pt,
            strobe_xor_score=strobe_best_score,
            majority_xor_score=majority_xor_score,
            majority_total_cycles=majority_total_cycles,
            majority_matched_cycles=majority_matched_cycles,
            majority_avg_confidence=majority_avg_confidence,
            channel_majority_scores=channel_majority_scores,
            execution_time_ms=(time.perf_counter() - t_start) * 1000,
        )


def extract_mismatch_zones(
    channel_id: str,
    exp_arr: np.ndarray,
    act_arr: np.ndarray,
    sample_rate_hz: float,
    max_zones: int = 100
) -> List[Dict[str, Any]]:
    """
    Scans expected vs actual arrays and clusters contiguous mismatches
    into bounded time intervals [start_sample, end_sample].
    """
    min_len = min(len(exp_arr), len(act_arr))
    if min_len == 0:
        return []

    e_slice = exp_arr[:min_len].astype(np.uint8)
    a_slice = act_arr[:min_len].astype(np.uint8)
    diff_mask = np.bitwise_xor(e_slice, a_slice)
    mismatch_indices = np.where(diff_mask)[0]

    if len(mismatch_indices) == 0:
        return []

    zones = []
    current_start = mismatch_indices[0]
    current_end = current_start + 1

    for idx in mismatch_indices[1:]:
        if idx == current_end:
            current_end = idx + 1
        else:
            # Commit current zone
            zones.append((current_start, current_end))
            current_start = idx
            current_end = idx + 1
            if len(zones) >= max_zones:
                break

    if len(zones) < max_zones:
        zones.append((current_start, current_end))

    time_step_s = 1.0 / sample_rate_hz
    result = []

    for s_idx, e_idx in zones:
        duration_ns = (e_idx - s_idx) * time_step_s * 1e9
        start_time_us = (s_idx * time_step_s) * 1e6
        end_time_us = (e_idx * time_step_s) * 1e6

        exp_slice = exp_arr[s_idx:e_idx]
        act_slice = act_arr[s_idx:e_idx]

        if np.all(exp_slice == 1) and np.all(act_slice == 0):
            discrepancy_type = "DROPPED_PULSE"
        elif np.all(exp_slice == 0) and np.all(act_slice == 1):
            discrepancy_type = "NOISE_GLITCH"
        else:
            discrepancy_type = "PHASE_SKEW"

        result.append({
            "channel_id": channel_id,
            "start_sample": int(s_idx),
            "end_sample": int(e_idx),
            "start_time_us": round(float(start_time_us), 4),
            "end_time_us": round(float(end_time_us), 4),
            "duration_ns": round(float(duration_ns), 2),
            "discrepancy_type": discrepancy_type
        })

    return result


def parse_vcd_to_signals(vcd_path: str, sample_rate_hz: float = 1.0e8) -> Dict[str, np.ndarray]:
    """
    Parses a VCD file into a dictionary of digital channel arrays {channel_name: np.ndarray(uint8)}.
    Handles 1-bit wire definitions and timestamped state transitions.
    """
    symbol_to_channel = {}
    channel_transitions = {}
    
    with open(vcd_path, "r", encoding="utf-8", errors="ignore") as f:
        in_definitions = True
        current_time = 0

        for line in f:
            line = line.strip()
            if not line:
                continue

            if in_definitions:
                if line.startswith("$var"):
                    parts = line.split()
                    if len(parts) >= 5:
                        sym = parts[3]
                        ch_name = parts[4].upper()
                        symbol_to_channel[sym] = ch_name
                        channel_transitions[sym] = []
                elif line.startswith("$enddefinitions"):
                    in_definitions = False
                continue

            if line.startswith("#"):
                try:
                    current_time = int(line[1:].strip())
                except ValueError:
                    pass
            elif line.startswith("$dumpvars") or line.startswith("$end"):
                continue
            else:
                val_char = line[0]
                if val_char in ("0", "1"):
                    sym = line[1:].strip()
                    if sym in symbol_to_channel:
                        channel_transitions[sym].append((current_time, int(val_char)))
                elif val_char in ("b", "B"):
                    parts = line[1:].split()
                    if len(parts) == 2:
                        val_str, sym = parts
                        if sym in symbol_to_channel:
                            channel_transitions[sym].append((current_time, 1 if "1" in val_str else 0))

    if not symbol_to_channel:
        return {}

    max_time = 0
    for transitions in channel_transitions.values():
        if transitions:
            max_time = max(max_time, transitions[-1][0])

    total_samples = max(max_time + 1, 10)
    signals = {}

    for sym, ch_name in symbol_to_channel.items():
        arr = np.zeros(total_samples, dtype=np.uint8)
        transitions = channel_transitions.get(sym, [])
        if not transitions:
            signals[ch_name] = arr
            continue

        prev_t = 0
        prev_v = 0
        for t, v in transitions:
            if t > prev_t:
                arr[prev_t:t] = prev_v
            prev_t = t
            prev_v = v
        arr[prev_t:] = prev_v
        signals[ch_name] = arr

    return signals


class WaveformComparatorService:
    """Manages digital waveform comparison, unified diff generation, and artifact persistence."""

    def __init__(self, storage_dir: Optional[str] = None):
        from services.file_store import file_store
        self.storage_dir = storage_dir or file_store.resolve_path("uploads/DIFF")
        os.makedirs(self.storage_dir, exist_ok=True)

    def compare_and_build_diff(
        self,
        result_id: str,
        expected_signals: Optional[Dict[str, np.ndarray]] = None,
        actual_signals: Optional[Dict[str, np.ndarray]] = None,
        expected_vcd_path: Optional[str] = None,
        actual_vcd_path: Optional[str] = None,
        config: Optional[ComparisonConfig] = None,
        channel_colors: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Runs digital verification and formats unified diff JSON payload."""
        cfg = config or ComparisonConfig()

        if expected_signals is None and expected_vcd_path:
            expected_signals = parse_vcd_to_signals(expected_vcd_path, sample_rate_hz=cfg.sample_rate_hz)
        if actual_signals is None and actual_vcd_path:
            actual_signals = parse_vcd_to_signals(actual_vcd_path, sample_rate_hz=cfg.sample_rate_hz)

        expected_signals = expected_signals or {}
        actual_signals = actual_signals or {}

        # If sync_channel is not in expected_signals, pick the first common channel
        if cfg.sync_channel not in expected_signals:
            common = [c for c in expected_signals if c in actual_signals]
            if common:
                cfg.sync_channel = common[0]

        # Auto-detect clock channel if not configured
        if cfg.strobe_clock_channel is None:
            for ch in expected_signals:
                if any(kw in ch.upper() for kw in ("CLK", "SCLK", "CLOCK")):
                    cfg.strobe_clock_channel = ch
                    break
            if cfg.strobe_clock_channel is None and "CH1" in expected_signals and cfg.sync_channel != "CH1":
                cfg.strobe_clock_channel = "CH1"

        comparator = DigitalWaveformComparator(cfg)
        res = comparator.compare(expected_signals, actual_signals)

        colors = channel_colors or {
            "CH0": "#38bdf8", "CH1": "#10b981", "CH2": "#818cf8", "CH3": "#f59e0b",
            "CH4": "#fb923c", "CH5": "#ec4899", "CH6": "#a855f7", "CH7": "#06b6d4"
        }

        # Determine channels to display
        channels_payload = []
        all_mismatch_zones = []

        total_samples = 0
        for ch, exp_arr in expected_signals.items():
            if ch in actual_signals:
                act_arr = actual_signals[ch]
                total_samples = max(total_samples, len(exp_arr), len(act_arr))

                # Extract mismatch zones
                zones = extract_mismatch_zones(
                    channel_id=ch,
                    exp_arr=exp_arr,
                    act_arr=act_arr,
                    sample_rate_hz=cfg.sample_rate_hz,
                    max_zones=50
                )
                all_mismatch_zones.extend(zones)

                channels_payload.append({
                    "id": ch,
                    "name": ch,
                    "color": colors.get(ch, "#94a3b8"),
                    "actual_data": act_arr.tolist() if len(act_arr) <= 20000 else act_arr[::max(1, len(act_arr)//20000)].tolist(),
                    "expected_data": exp_arr.tolist() if len(exp_arr) <= 20000 else exp_arr[::max(1, len(exp_arr)//20000)].tolist()
                })

        majority_score_val = res.majority_xor_score if res.majority_xor_score is not None else res.sample_xor_score

        diff_payload = {
            "result_id": result_id,
            "verification_status": res.status_label,
            "scores": {
                "f1_score": round(res.f1_score, 2),
                "sample_xor_score": round(res.sample_xor_score, 2),
                "majority_score": round(majority_score_val, 2) if majority_score_val is not None else None,
                "majority_avg_confidence": round(res.majority_avg_confidence, 2) if res.majority_avg_confidence else None
            },
            "summary": {
                "overall_pass": res.passed,
                "status_label": res.status_label,
                "avg_f1_score": round(res.f1_score, 2),
                "avg_sample_xor_score": round(res.sample_xor_score, 2),
                "avg_majority_score": round(majority_score_val, 2) if majority_score_val is not None else None,
                "total_mismatch_zones": len(all_mismatch_zones)
            },
            "time_unit": "us",
            "sample_rate_mhz": cfg.sample_rate_hz / 1e6,
            "total_samples": total_samples,
            "channels": channels_payload,
            "mismatch_zones": all_mismatch_zones
        }

        return diff_payload

    def save_diff_artifact(self, result_id: str, diff_payload: Dict[str, Any]) -> str:
        """Saves compressed .diff.json.lz4 or .diff.json artifact."""
        now = datetime.datetime.now(datetime.timezone.utc)
        target_dir = os.path.join(self.storage_dir, str(now.year), f"{now.month:02d}")
        os.makedirs(target_dir, exist_ok=True)

        raw_json = json.dumps(diff_payload).encode("utf-8")
        if lz4_frame:
            file_path = os.path.join(target_dir, f"{result_id}.diff.json.lz4")
            with open(file_path, "wb") as f:
                f.write(lz4_frame.compress(raw_json))
        else:
            file_path = os.path.join(target_dir, f"{result_id}.diff.json")
            with open(file_path, "wb") as f:
                f.write(raw_json)

        return file_path

    def load_diff_artifact(self, result_id: str) -> Optional[Dict[str, Any]]:
        """Finds and loads the diff artifact for a given result_id."""
        for root, _, files in os.walk(self.storage_dir):
            for f in files:
                if f.startswith(result_id) and (".diff.json" in f):
                    file_path = os.path.join(root, f)
                    if f.endswith(".lz4") and lz4_frame:
                        with open(file_path, "rb") as fp:
                            decompressed = lz4_frame.decompress(fp.read())
                            return json.loads(decompressed.decode("utf-8"))
                    else:
                        with open(file_path, "r", encoding="utf-8") as fp:
                            return json.load(fp)
        return None


# Global singleton instance for backend services
waveform_comparator_service = WaveformComparatorService()
