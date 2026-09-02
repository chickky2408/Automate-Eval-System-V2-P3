import csv
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np

from services.waveform_file import read_waveform_preview, waveform_csv_text


class TestWaveformFile(unittest.TestCase):
    def test_reads_raw_hdf5_preview_with_downsampling(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "result.h5"
            with h5py.File(path, "w") as h5f:
                h5f.attrs["sample_rate_hz"] = 1000.0
                h5f.create_dataset("raw", data=np.arange(10, dtype="<i2"))

            preview = read_waveform_preview(str(path), max_samples=5)

            self.assertEqual(preview["sample_count"], 10)
            self.assertEqual(preview["sample_rate_hz"], 1000.0)
            self.assertEqual(preview["channels"][0]["name"], "CH1")
            self.assertEqual(preview["channels"][0]["data"], [0, 2, 4, 6, 9])
            self.assertEqual(preview["time_unit"], "s")

    def test_exports_raw_hdf5_to_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "result.h5"
            with h5py.File(path, "w") as h5f:
                h5f.attrs["sample_rate_hz"] = 2.0
                h5f.create_dataset("raw", data=np.array([10, 20, 30], dtype="<i2"))

            text = waveform_csv_text(str(path))
            rows = list(csv.reader(text.splitlines()))

            self.assertEqual(rows[0], ["sample_index", "time_s", "CH1"])
            self.assertEqual(rows[1], ["0", "0", "10"])
            self.assertEqual(rows[2], ["1", "0.5", "20"])
            self.assertEqual(rows[3], ["2", "1", "30"])


if __name__ == "__main__":
    unittest.main()
