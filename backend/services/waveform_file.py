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
    sample_rate = float(h5f.attrs.get("sample_rate_hz", h5f.attrs.get("fs", 1.0)) or 1.0)

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

    if "channels" in h5f:
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

    raise WaveformFormatError("Unsupported HDF5 waveform schema")


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
    chunk_size_samples: int = 1024 * 1024
) -> int:
    """
    High-Speed Streaming BIN to VCD Converter using NumPy vectorization.
    """
    if not os.path.exists(bin_filepath):
        raise FileNotFoundError(f"Input file not found: {bin_filepath}")

    if os.path.exists(vcd_filepath):
        try:
            os.remove(vcd_filepath)
        except Exception:
            pass

    file_size = os.path.getsize(bin_filepath)
    if stride_bytes < word_size_bytes:
        stride_bytes = word_size_bytes

    total_available_samples = file_size // stride_bytes
    target_samples = min(total_available_samples, max_samples) if max_samples is not None else total_available_samples
    total_bits = word_size_bytes * 8

    if channel_names is None or len(channel_names) == 0:
        channel_names = ["CH0", "CH1", "CH2"]

    num_channels = min(len(channel_names), total_bits)
    active_channels = channel_names[:num_channels]
    sig_chars = [vcd_id_char(i) for i in range(num_channels)]
    channel_mask = np.uint64((1 << num_channels) - 1)

    open_fn = gzip.open if use_gzip or vcd_filepath.endswith(".gz") else open

    if word_size_bytes == 1:
        np_dtype = np.uint8
    elif word_size_bytes == 2:
        np_dtype = np.uint16
    elif word_size_bytes == 4:
        np_dtype = np.uint32
    else:
        np_dtype = np.uint64

    bit_str_0 = [f"0{sig_chars[i]}\n" for i in range(num_channels)]
    bit_str_1 = [f"1{sig_chars[i]}\n" for i in range(num_channels)]

    processed_samples = 0
    prev_states = [None] * num_channels
    prev_word = None
    global_ts = 0

    os.makedirs(os.path.dirname(os.path.abspath(vcd_filepath)), exist_ok=True)

    with open(bin_filepath, "rb") as bin_f, open_fn(vcd_filepath, "w", encoding="utf-8", buffering=4*1024*1024) as vcd:
        vcd.write(f"$date\n   {time.strftime('%Y-%m-%d %H:%M:%S')}\n$end\n")
        vcd.write("$version\n   SiliconCraft Accelerated BIN-to-VCD Engine v2.1\n$end\n")
        vcd.write(f"$timescale\n   {timescale}\n$end\n")
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
                    ts = global_ts + int(s_off)
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

        vcd.write(f"#{global_ts}\n")

    return processed_samples
