import requests

resp = requests.get("http://localhost:8000/api/results")
print("Status:", resp.status_code)
data = resp.json()
print("Total results:", len(data))
for r in data[:10]:
    print(f"ID: {r.get('id')}, Job: {r.get('job_name')}, Waveform: {r.get('waveform_available')}, Waveform file: {r.get('waveform_filename')}")
