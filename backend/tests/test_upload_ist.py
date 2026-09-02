import requests

url = "http://localhost:8000/api/files/upload"
file_path = "d:/siliconcraft/eval_system/V2/fpga_interface/fpga_drive_example/instructions.ist"

with open(file_path, "rb") as f:
    files = {"file": ("instructions.ist", f, "application/octet-stream")}
    data = {"tags": "example,ist"}
    resp = requests.post(url, files=files, data=data)
    print("Upload status:", resp.status_code)
    print("Upload body:", resp.json())
