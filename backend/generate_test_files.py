import os
from pathlib import Path

BASE_DIR = Path("sample_files")   # โฟลเดอร์ปลายทาง
NUM_SETS = 20                     # อยากได้กี่ชุด TC0001..TC00NN

BASE_DIR.mkdir(exist_ok=True)

for i in range(1, NUM_SETS + 1):
    tc_id = f"TC{str(i).zfill(4)}"

    # VCD
    vcd_path = BASE_DIR / f"{tc_id}.vcd"
    vcd_path.write_text(f"""$date
    Today
$end
$version
    Dummy VCD for {tc_id}
$end
$scope module top $end
$var wire 1 ! clk $end
$upscope $end
$enddefinitions $end
#0
0!
#10
1!
""")

    # EROM (BIN) – แค่ dummy binary ก็พอ
    erom_path = BASE_DIR / f"{tc_id}_erom_1.erom"
    erom_path.write_bytes(os.urandom(256))  # 256 bytes random

    # ULP (LIN/TXT) – text file
    ulp_path = BASE_DIR / f"{tc_id}_ulp_1.ulp"
    ulp_path.write_text(f"""# ULP script for {tc_id}
# This is dummy content for demo / dev.
STEP 1: INIT
STEP 2: RUN
STEP 3: CHECK
""")

    # MDI (test text file)
    mdi_path = BASE_DIR / f"{tc_id}_mdi_1.txt"
    mdi_path.write_text(f"""# MDI test file for {tc_id}
COMMAND: RUN {tc_id}
""")

print(f"Generated {NUM_SETS} sets of VCD/EROM/ULP/MDI under {BASE_DIR.resolve()}")