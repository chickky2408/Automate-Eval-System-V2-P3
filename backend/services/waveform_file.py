from __future__ import annotations

import csv
import gzip
import io
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import h5py
import numpy as np


class WaveformFormatError(ValueError):
    pass


def _format_number(value: float) -> str:
    return f"{value:.12g}"


def _downsample_indices(sample_count: int, max_samples: int) -> np.ndarray:
    if sample_count <= 0:
        return np.array([], dtype=np.int64)
    limit = max(1, int(max_samples or sample_count))
    if sample_count <= limit:
        return np.arange(sample_count, dtype=np.int64)
    return np.linspace(0, sample_count - 1, num=limit, dtype=np.int64)


def _read_channels(h5f: h5py.File) -> Tuple[List[Tuple[str, np.ndarray]], float]:
    """Extract (name, data) channels from an HDF5 waveform file.

    Prefers the "channels" group (per-bit signals extracted at the same
    stride/byte-offset as the VCD logic trace) over the flat "raw" dataset
    (the unfiltered AXI-beat capture, kept for back-compat/export). A file
    written before "channels" existed has only "raw" and is unaffected by
    this ordering; a file with both (every capture going forward) now
    resolves to the filtered per-channel view instead of the raw blob.
    """
    sample_rate = float(h5f.attrs.get("sample_rate_hz", h5f.attrs.get("fs", 1.0)) or 1.0)

    if "channels" in h5f and len(h5f["channels"]) > 0:
        channels = []
        group = h5f["channels"]
        for index, name in enumerate(group.keys()):
            dataset = group[name]
            data = np.asarray(dataset)
            if data.ndim == 1:
                channels.append((str(name) or f"CH{index + 1}", data))
            elif data.ndim == 2 and data.shape[1] >= 2:
                channels.append((str(name) or f"CH{index + 1}", data[:, -1]))
            else:
                raise WaveformFormatError(f"Unsupported channel waveform dimensions: {name}")
        if channels:
            return channels, sample_rate

    if "raw" in h5f:
        raw = h5f["raw"]
        data = np.asarray(raw)
        raw_sample_rate = raw.attrs.get("sample_rate_hz", raw.attrs.get("fs", None))
        if raw_sample_rate is not None:
            sample_rate = float(raw_sample_rate or sample_rate)
        if data.ndim == 1:
            return [("CH1", data)], sample_rate
        if data.ndim == 2:
            if data.shape[0] <= data.shape[1]:
                return [(f"CH{i + 1}", data[i]) for i in range(data.shape[0])], sample_rate
            return [(f"CH{i + 1}", data[:, i]) for i in range(data.shape[1])], sample_rate
        raise WaveformFormatError("Unsupported raw waveform dimensions")

    raise WaveformFormatError("Unsupported HDF5 waveform schema")


DEFAULT_CHANNEL_COLORS = [
    "#10b981", "#3b82f6", "#f59e0b", "#ef4444",
    "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"
]


def read_waveform_full_or_downsampled(
    path: str, max_samples: Optional[int] = 100000
) -> Dict[str, Any]:
    """Read waveform data from HDF5 file with optional downsampling.

    Supports both the hierarchical "channels" group and flat "raw" captures.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    with h5py.File(path, "r") as h5f:
        time_unit = str(h5f.attrs.get("time_unit", "us"))
        channels, sample_rate = _read_channels(h5f)
        sample_count = max((len(data) for _, data in channels), default=0)

        total_duration = float(h5f.attrs.get("total_duration", 0.0))
        if total_duration <= 0.0 and sample_rate > 0:
            total_duration = sample_count / sample_rate

        # Check for per-channel color attribute if "channels" group exists
        colors_map = {}
        if "channels" in h5f and len(h5f["channels"]) > 0:
            grp = h5f["channels"]
            for k in grp.keys():
                c = grp[k].attrs.get("color")
                if c:
                    colors_map[k] = str(c)

        if max_samples and max_samples > 0 and sample_count > max_samples:
            indices = _downsample_indices(sample_count, max_samples)
        else:
            indices = None

        result_channels = []
        for idx, (name, data) in enumerate(channels):
            color = colors_map.get(name) or DEFAULT_CHANNEL_COLORS[idx % len(DEFAULT_CHANNEL_COLORS)]
            if indices is not None:
                safe_indices = indices[indices < len(data)]
                selected = data[safe_indices]
            else:
                selected = data

            if np.issubdtype(selected.dtype, np.integer):
                data_list = [int(x) for x in selected.tolist()]
            else:
                data_list = [float(x) for x in selected.tolist()]

            result_channels.append({
                "name": name,
                "color": color,
                "data": data_list,
            })

        return {
            "channels": result_channels,
            "time_unit": time_unit,
            "total_duration": total_duration,
            "sample_rate_hz": sample_rate,
        }


def read_waveform_preview(path: str, max_samples: int = 2000) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    with h5py.File(path, "r") as h5f:
        channels, sample_rate = _read_channels(h5f)
        sample_count = max((len(data) for _, data in channels), default=0)
        indices = _downsample_indices(sample_count, max_samples)
        preview_channels = []
        for name, data in channels:
            safe_indices = indices[indices < len(data)]
            preview_channels.append(
                {
                    "name": name,
                    "data": [int(x) if np.issubdtype(data.dtype, np.integer) else float(x) for x in data[safe_indices].tolist()],
                }
            )
        return {
            "channels": preview_channels,
            "time_unit": "s",
            "sample_rate_hz": sample_rate,
            "sample_count": sample_count,
            "preview_count": int(len(indices)),
            "total_duration": (sample_count / sample_rate) if sample_rate else 0.0,
        }


def waveform_csv_text(path: str) -> str:
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    with h5py.File(path, "r") as h5f:
        channels, sample_rate = _read_channels(h5f)
        sample_count = max((len(data) for _, data in channels), default=0)
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["sample_index", "time_s", *[name for name, _ in channels]])
        for index in range(sample_count):
            row = [str(index), _format_number(index / sample_rate if sample_rate else 0.0)]
            for _, data in channels:
                if index < len(data):
                    value = data[index]
                    row.append(str(int(value)) if np.issubdtype(data.dtype, np.integer) else _format_number(float(value)))
                else:
                    row.append("")
            writer.writerow(row)
        return output.getvalue()


def vcd_id_char(idx: int) -> str:
    """Generate printable VCD identifier symbol (!, \", #, $, ...)."""
    charset = [chr(c) for c in range(33, 127)]
    if idx < len(charset):
        return charset[idx]
    out = ""
    base = len(charset)
    n = idx
    while True:
        out = charset[n % base] + out
        n //= base
        if n == 0:
            break
    return out


def convert_bin_to_vcd(
    bin_filepath: str,
    vcd_filepath: str,
    channel_names: Optional[List[str]] = None,
    word_size_bytes: int = 1,
    stride_bytes: int = 1,
    byte_offset: int = 0,
    timescale: str = "10 ns",
    max_samples: Optional[int] = None,
    use_gzip: bool = False,
    chunk_size_samples: int = 1024 * 1024,
    bus_mode: bool = False,
    bus_width: int = 16,
    bus_name: str = "monitor_data",
    ts_scale: int = 1,
) -> int:
    """
    High-Speed Streaming BIN to VCD Converter using NumPy vectorization.

    When bus_mode=True the output is a single N-bit VCD bus signal
    (e.g. ``monitor_data [15:0]``) instead of individual 1-bit channels.
    The bus width is determined by ``bus_width`` (default 16-bit).
    word_size_bytes is automatically set to ``bus_width // 8`` in bus_mode.

    ts_scale: multiply every timestamp by this factor so the unit matches
    the chosen timescale.  Example: sampling at 100 MHz (10 ns/sample)
    with timescale="1 ps" → ts_scale=10000 so each step = 10 000 ps = 10 ns.
    """
    if not os.path.exists(bin_filepath):
        raise FileNotFoundError(f"Input file not found: {bin_filepath}")

    if os.path.exists(vcd_filepath):
        try:
            os.remove(vcd_filepath)
        except Exception:
            pass

    file_size = os.path.getsize(bin_filepath)

    # Bus mode overrides word_size_bytes
    if bus_mode:
        word_size_bytes = max(1, bus_width // 8)

    if stride_bytes < word_size_bytes:
        stride_bytes = word_size_bytes

    total_available_samples = file_size // stride_bytes
    target_samples = min(total_available_samples, max_samples) if max_samples is not None else total_available_samples
    total_bits = word_size_bytes * 8

    open_fn = gzip.open if use_gzip or vcd_filepath.endswith(".gz") else open

    if word_size_bytes == 1:
        np_dtype = np.uint8
    elif word_size_bytes == 2:
        np_dtype = np.uint16
    elif word_size_bytes == 4:
        np_dtype = np.uint32
    else:
        np_dtype = np.uint64

    processed_samples = 0
    prev_word = None
    global_ts = 0

    os.makedirs(os.path.dirname(os.path.abspath(vcd_filepath)), exist_ok=True)

    with open(bin_filepath, "rb") as bin_f, open_fn(vcd_filepath, "w", encoding="utf-8", buffering=4*1024*1024) as vcd:
        vcd.write(f"$date\n   {time.strftime('%Y-%m-%d %H:%M:%S')}\n$end\n")
        vcd.write("$version\n   SiliconCraft Accelerated BIN-to-VCD Engine v2.1\n$end\n")
        vcd.write(f"$timescale\n   {timescale}\n$end\n")

        if bus_mode:
            # --- Bus mode: single N-bit bus signal ---
            bus_id = "!"
            vcd.write("$scope module testbench $end\n")
            vcd.write("$scope module _dut_if $end\n")
            vcd.write(f"$var reg {bus_width} {bus_id} {bus_name} [{bus_width - 1}:0] $end\n")
            vcd.write("$upscope $end\n")
            vcd.write("$upscope $end\n")
            vcd.write("$enddefinitions $end\n")
            vcd.write("$dumpvars\n")

            while processed_samples < target_samples:
                count_to_read = min(chunk_size_samples, target_samples - processed_samples)

                if stride_bytes == word_size_bytes and byte_offset == 0:
                    words = np.fromfile(bin_f, dtype=np_dtype, count=count_to_read)
                else:
                    raw_bytes = np.fromfile(bin_f, dtype=np.uint8, count=count_to_read * stride_bytes)
                    if len(raw_bytes) == 0:
                        break
                    actual_samples = len(raw_bytes) // stride_bytes
                    raw_bytes = raw_bytes[:actual_samples * stride_bytes].reshape(actual_samples, stride_bytes)
                    extracted = raw_bytes[:, byte_offset:byte_offset + word_size_bytes]
                    words = extracted.copy().view(dtype=np_dtype).reshape(-1)

                if len(words) == 0:
                    break

                if prev_word is None:
                    first_val = int(words[0])
                    bin_str = format(first_val, f'0{bus_width}b')
                    vcd.write(f"b{bin_str} {bus_id}\n")
                    vcd.write("$end\n")
                    prev_word = first_val

                diff_mask = np.empty(len(words), dtype=bool)
                diff_mask[0] = (int(words[0]) != prev_word)
                if len(words) > 1:
                    diff_mask[1:] = (words[1:] != words[:-1])

                change_indices = np.flatnonzero(diff_mask)
                if len(change_indices) > 0:
                    change_words = words[change_indices]
                    lines = []
                    for s_off, val in zip(change_indices, change_words):
                        ts = (global_ts + int(s_off)) * ts_scale
                        bin_str = format(int(val), f'0{bus_width}b')
                        lines.append(f"#{ts}\nb{bin_str} {bus_id}\n")
                        if len(lines) >= 10000:
                            vcd.write("".join(lines))
                            lines.clear()
                    if lines:
                        vcd.write("".join(lines))

                prev_word = int(words[-1])
                global_ts += len(words)
                processed_samples += len(words)

        else:
            # --- Legacy channel mode: individual 1-bit wire per channel ---
            if channel_names is None or len(channel_names) == 0:
                channel_names = ["CH0", "CH1", "CH2"]

            num_channels = min(len(channel_names), total_bits)
            active_channels = channel_names[:num_channels]
            sig_chars = [vcd_id_char(i) for i in range(num_channels)]
            channel_mask = np.uint64((1 << num_channels) - 1)
            bit_str_0 = [f"0{sig_chars[i]}\n" for i in range(num_channels)]
            bit_str_1 = [f"1{sig_chars[i]}\n" for i in range(num_channels)]
            prev_states = [None] * num_channels

            vcd.write("$scope module fpga_capture $end\n")
            for idx in range(num_channels):
                vcd.write(f"$var wire 1 {sig_chars[idx]} {active_channels[idx]} $end\n")
            vcd.write("$upscope $end\n")
            vcd.write("$enddefinitions $end\n")
            vcd.write("$dumpvars\n")

            while processed_samples < target_samples:
                count_to_read = min(chunk_size_samples, target_samples - processed_samples)

                if stride_bytes == word_size_bytes and byte_offset == 0:
                    words = np.fromfile(bin_f, dtype=np_dtype, count=count_to_read)
                else:
                    raw_bytes = np.fromfile(bin_f, dtype=np.uint8, count=count_to_read * stride_bytes)
                    if len(raw_bytes) == 0:
                        break
                    actual_samples = len(raw_bytes) // stride_bytes
                    raw_bytes = raw_bytes[:actual_samples * stride_bytes].reshape(actual_samples, stride_bytes)
                    extracted = raw_bytes[:, byte_offset:byte_offset + word_size_bytes]
                    words = extracted.copy().view(dtype=np_dtype).reshape(-1)

                if len(words) == 0:
                    break

                words = words & channel_mask

                if prev_word is None:
                    first_val = int(words[0])
                    for bit_idx in range(num_channels):
                        bit_val = (first_val >> bit_idx) & 1
                        prev_states[bit_idx] = bit_val
                        vcd.write(bit_str_1[bit_idx] if bit_val else bit_str_0[bit_idx])
                    vcd.write("$end\n")
                    prev_word = first_val

                diff_mask = np.empty(len(words), dtype=bool)
                diff_mask[0] = (words[0] != prev_word)
                if len(words) > 1:
                    diff_mask[1:] = (words[1:] != words[:-1])

                change_indices = np.flatnonzero(diff_mask)
                if len(change_indices) > 0:
                    change_words = words[change_indices]
                    lines = []
                    for s_off, val in zip(change_indices, change_words):
                        val_int = int(val)
                        ts = (global_ts + int(s_off)) * ts_scale
                        c_lines = []
                        for b_idx in range(num_channels):
                            b_val = (val_int >> b_idx) & 1
                            if prev_states[b_idx] != b_val:
                                prev_states[b_idx] = b_val
                                c_lines.append(bit_str_1[b_idx] if b_val else bit_str_0[b_idx])
                        if c_lines:
                            lines.append(f"#{ts}\n" + "".join(c_lines))
                        if len(lines) >= 10000:
                            vcd.write("".join(lines))
                            lines.clear()
                    if lines:
                        vcd.write("".join(lines))
                        lines.clear()

                prev_word = int(words[-1])
                global_ts += len(words)
                processed_samples += len(words)

        vcd.write(f"#{global_ts * ts_scale}\n")

    return processed_samples


def trim_bin_beats(
    raw_bin_path: str,
    output_bin_path: str,
    stride_bytes: int = 16,
    keep_bytes: int = 13,
    chunk_size_beats: int = 1024 * 1024
) -> int:
    """
    Trims raw fixed-stride binary beats (e.g. 16-byte AXI beats) down to keep_bytes
    (e.g. 13 bytes by dropping bytes 13-15).
    Streams using NumPy chunks with low constant memory (< 20MB).
    """
    if not os.path.exists(raw_bin_path):
        raise FileNotFoundError(f"Input file not found: {raw_bin_path}")

    os.makedirs(os.path.dirname(os.path.abspath(output_bin_path)), exist_ok=True)
    total_written = 0

    with open(raw_bin_path, "rb") as src, open(output_bin_path, "wb") as dst:
        while True:
            raw_bytes = np.fromfile(src, dtype=np.uint8, count=chunk_size_beats * stride_bytes)
            if len(raw_bytes) == 0:
                break
            num_beats = len(raw_bytes) // stride_bytes
            if num_beats == 0:
                dst.write(raw_bytes[:min(len(raw_bytes), keep_bytes)].tobytes())
                total_written += min(len(raw_bytes), keep_bytes)
                break
            beats = raw_bytes[:num_beats * stride_bytes].reshape(num_beats, stride_bytes)
            trimmed = beats[:, :keep_bytes]
            trimmed_bytes = trimmed.tobytes()
            dst.write(trimmed_bytes)
            total_written += len(trimmed_bytes)

            remainder = len(raw_bytes) - (num_beats * stride_bytes)
            if remainder > 0:
                rem_bytes = raw_bytes[num_beats * stride_bytes: num_beats * stride_bytes + min(remainder, keep_bytes)]
                dst.write(rem_bytes.tobytes())
                total_written += len(rem_bytes)

    return total_written
