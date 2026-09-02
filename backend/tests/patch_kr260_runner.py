import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.111', port=22, username='petalinux', password='Sic1219!')

# Read runner.py
stdin, stdout, stderr = ssh.exec_command('cat /home/petalinux/board_agent/runner.py')
code = stdout.read().decode('utf-8')

# Fix fw_url check
old_block = """            fw_ext = ".app" if (".app" in fw_url.lower() or "app" in fw_url.lower() or ".bin" not in fw_url.lower()) else ".bin"
            fw_path = work / f"firmware{fw_ext}"
            await backend_client.download_asset(fw_url, fw_path)

            stimulus_path = None
            if binary_url:
                # Support .sh (Linux shell / devmem), .ist, .hex, .bin stimulus
                if ".sh" in binary_url.lower():
                    ext = ".sh"
                elif ".ist" in binary_url.lower():
                    ext = ".ist"
                elif ".hex" in binary_url.lower():
                    ext = ".hex"
                else:
                    ext = ".bin"
                stimulus_path = work / f"stimulus{ext}"
                await backend_client.download_asset(binary_url, stimulus_path)

            # Flash FPGA PL Bitstream
            fpga_controller.flash(str(fw_path))"""

new_block = """            fw_path = None
            if fw_url and fw_url.strip():
                fw_ext = ".app" if (".app" in fw_url.lower() or "app" in fw_url.lower() or ".bin" not in fw_url.lower()) else ".bin"
                fw_path = work / f"firmware{fw_ext}"
                await backend_client.download_asset(fw_url, fw_path)
                # Flash FPGA PL Bitstream
                fpga_controller.flash(str(fw_path))

            stimulus_path = None
            if binary_url and binary_url.strip():
                # Support .sh (Linux shell / devmem), .ist, .hex, .bin stimulus
                if ".sh" in binary_url.lower():
                    ext = ".sh"
                elif ".ist" in binary_url.lower():
                    ext = ".ist"
                elif ".hex" in binary_url.lower():
                    ext = ".hex"
                else:
                    ext = ".bin"
                stimulus_path = work / f"stimulus{ext}"
                await backend_client.download_asset(binary_url, stimulus_path)"""

if old_block in code:
    code = code.replace(old_block, new_block)
    print("Replaced fw_url block successfully!")
else:
    print("Old block not matched exactly, updating with regex or replacement...")
    # Alternative replace
    lines = code.splitlines()
    new_lines = []
    skip = False
    for l in lines:
        if 'fw_ext = ".app"' in l:
            new_lines.extend([
                '            fw_path = None',
                '            if fw_url and str(fw_url).strip() and str(fw_url).lower() != "none":',
                '                fw_ext = ".app" if (".app" in fw_url.lower() or "app" in fw_url.lower() or ".bin" not in fw_url.lower()) else ".bin"',
                '                fw_path = work / f"firmware{fw_ext}"',
                '                await backend_client.download_asset(fw_url, fw_path)',
                '                fpga_controller.flash(str(fw_path))',
            ])
            skip = True
        elif 'fpga_controller.flash(str(fw_path))' in l:
            skip = False
            continue
        elif not skip:
            new_lines.append(l)
    code = '\n'.join(new_lines)

sftp = ssh.open_sftp()
with sftp.open('/home/petalinux/board_agent/runner.py', 'w') as f:
    f.write(code)
sftp.close()

# Restart board-agent service
ssh.exec_command('echo Sic1219! | sudo -S systemctl restart board-agent')
print("Restarted board-agent service!")
ssh.close()
