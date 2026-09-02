import asyncio
import uuid
import datetime
import numpy as np
import os

from services.result_store import ResultStore
from models.result import TestResult, WaveformData, WaveformChannel

async def seed_waveform():
    store = ResultStore()
    
    # Generate realistic digital / analog waveforms for 8 channels
    n_samples = 3000
    t = np.linspace(0, 0.001, n_samples)
    
    channels = [
        WaveformChannel(name="CH1", data=(np.sin(2 * np.pi * 10000 * t) > 0).astype(float).tolist(), color="#3b82f6"),  # CLK
        WaveformChannel(name="CH2", data=((np.sin(2 * np.pi * 5000 * t) + np.random.normal(0, 0.05, n_samples)) > 0).astype(float).tolist(), color="#10b981"),  # TX_DATA
        WaveformChannel(name="CH3", data=((np.sin(2 * np.pi * 5000 * (t - 0.0001)) + np.random.normal(0, 0.05, n_samples)) > 0).astype(float).tolist(), color="#f59e0b"),  # RX_DATA
        WaveformChannel(name="CH4", data=(np.sin(2 * np.pi * 2500 * t) > 0.3).astype(float).tolist(), color="#ef4444"),  # EN_STROBE
        WaveformChannel(name="CH5", data=(np.sin(2 * np.pi * 1250 * t) * 0.8 + 1.65).tolist(), color="#8b5cf6"),  # AMS_VCCINT (Analog)
        WaveformChannel(name="CH6", data=(np.cos(2 * np.pi * 800 * t) * 0.5 + 3.3).tolist(), color="#06b6d4"),  # VCC_AUX (Analog)
        WaveformChannel(name="CH7", data=(np.sin(2 * np.pi * 20000 * t) > 0).astype(float).tolist(), color="#ec4899"),  # SPI_MISO
        WaveformChannel(name="CH8", data=(np.sin(2 * np.pi * 1000 * t) > 0.8).astype(float).tolist(), color="#14b8a6"),  # IRQ_LINE
    ]
    
    wf = WaveformData(
        channels=channels,
        time_unit="s",
        total_duration=0.001
    )
    
    result_id = str(uuid.uuid4())[:8]
    test_result = TestResult(
        id=result_id,
        job_id="job-kr260-ist-01",
        job_name="UART_Loopback_v2 (instructions.ist)",
        board_id="kr260-28d429",
        board_name="KR260-Fleet-01",
        passed=True,
        started_at=datetime.datetime.utcnow() - datetime.timedelta(seconds=5),
        completed_at=datetime.datetime.utcnow(),
        duration_seconds=4.82,
        vcd_filename="instructions.ist",
        firmware_filename="fpga_bitstream.bin",
        packet_count=1024,
        crc_errors=0,
        console_log="[KR260] DMA Transfer Started\n[KR260] Executed 1024 vectors from instructions.ist\n[KR260] Capture Completed: 3000 samples @ 4MHz\n[KR260] CRC Check: 0 Errors (PASS)",
        waveform_available=True,
        waveform_filename=f"{result_id}_waveform.h5"
    )
    
    await store.add_result(test_result, waveform=wf, console_log=test_result.console_log)
    print(f"Successfully seeded waveform result: ID={result_id}")

if __name__ == "__main__":
    asyncio.run(seed_waveform())
