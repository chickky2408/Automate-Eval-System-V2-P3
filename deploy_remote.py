#!/usr/bin/env python3
"""
Deploy Remote Script for Automate-Eval-System-V2-P3
--------------------------------------------------
Automates remote deployment of the Central Platform (FastAPI Backend,
PostgreSQL, and React Frontend) to a target server via SSH & Docker Compose.

Usage:
    python deploy_remote.py
    python deploy_remote.py --host 192.168.1.200 --user ubuntu
    python deploy_remote.py --host 192.168.1.200 --user ubuntu --key ~/.ssh/id_rsa
"""

import argparse
import getpass
import os
import sys
import time
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("[ERROR] 'paramiko' library is required. Install it using: pip install paramiko")
    sys.exit(1)

DEFAULT_REPO = "https://github.com/chickky2408/Automate-Eval-System-V2-P3.git"
DEFAULT_BRANCH = "main"
DEFAULT_REMOTE_DIR = "~/Automate-Eval-System-V2-P3"
DEFAULT_COMPOSE_FILE = "docker-compose.prod.yml"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Deploy Automate-Eval-System-V2-P3 Central Server to a remote machine via SSH."
    )
    parser.add_argument("--host", help="Target server IP or hostname (e.g. 192.168.1.200)")
    parser.add_argument("--port", type=int, default=22, help="SSH port (default: 22)")
    parser.add_argument("--user", help="SSH username (e.g. ubuntu, root)")
    parser.add_argument("--password", help="SSH password (if omitted and no key provided, will prompt)")
    parser.add_argument("--key", help="Path to SSH private key file (e.g. ~/.ssh/id_rsa)")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help="Remote directory path (default: ~/Automate-Eval-System-V2-P3)")
    parser.add_argument("--repo", default=DEFAULT_REPO, help=f"Git repository URL (default: {DEFAULT_REPO})")
    parser.add_argument("--branch", default=DEFAULT_BRANCH, help=f"Git branch to deploy (default: {DEFAULT_BRANCH})")
    parser.add_argument("--compose-file", default=DEFAULT_COMPOSE_FILE, help=f"Compose file to run (default: {DEFAULT_COMPOSE_FILE})")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild Docker images without cache")
    parser.add_argument("--skip-pull", action="store_true", help="Skip git pull on remote server")
    return parser.parse_args()


def run_remote_command(ssh, cmd, title=None, check=True, print_output=True):
    if title:
        print(f"\n---> {title}")
    print(f"     [CMD] {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)

    output_lines = []
    # Stream output in real-time
    while True:
        line = stdout.readline()
        if not line:
            break
        output_lines.append(line)
        if print_output:
            print(f"     {line.rstrip()}")

    exit_status = stdout.channel.recv_exit_status()
    err_output = stderr.read().decode("utf-8", errors="replace").strip()

    if err_output and print_output and exit_status != 0:
        print(f"     [STDERR] {err_output}")

    if check and exit_status != 0:
        raise RuntimeError(f"Command failed with exit code {exit_status}: {cmd}\n{err_output}")

    return exit_status, "".join(output_lines), err_output


def main():
    args = parse_args()

    print("=" * 65)
    print("🚀 AUTOMATE EVAL SYSTEM V2 - REMOTE CENTRAL SERVER DEPLOYMENT")
    print("=" * 65)

    # 1. Resolve connection parameters
    host = args.host or os.getenv("DEPLOY_REMOTE_HOST")
    if not host:
        host = input("Enter target server IP / Hostname: ").strip()
        if not host:
            print("[ERROR] Server host cannot be empty.")
            sys.exit(1)

    user = args.user or os.getenv("DEPLOY_REMOTE_USER")
    if not user:
        user = input(f"Enter SSH username [default: root]: ").strip() or "root"

    key_path = args.key or os.getenv("DEPLOY_REMOTE_KEY")
    password = args.password or os.getenv("DEPLOY_REMOTE_PASSWORD")

    if not key_path and not password:
        password = getpass.getpass(f"Enter SSH password for {user}@{host} (or press Enter if using SSH Agent/Keys): ")
        if not password:
            password = None

    print(f"\n[INFO] Target Server: {user}@{host}:{args.port}")
    print(f"[INFO] Deploy Directory: {args.remote_dir}")
    print(f"[INFO] Target Branch: {args.branch}")
    print(f"[INFO] Compose File: {args.compose_file}")

    # 2. Establish SSH connection
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = {
        "hostname": host,
        "port": args.port,
        "username": user,
        "timeout": 15,
    }
    if key_path:
        connect_kwargs["key_filename"] = os.path.expanduser(key_path)
    if password:
        connect_kwargs["password"] = password

    print("\n[Step 1/5] Connecting to target server via SSH...")
    try:
        ssh.connect(**connect_kwargs)
        print("✅ SSH Connection established successfully.")
    except Exception as e:
        print(f"❌ Failed to connect to {host}: {e}")
        sys.exit(1)

    try:
        # 3. Verify server prerequisites (Docker, Docker Compose, Git)
        print("\n[Step 2/5] Checking remote dependencies (Docker & Git)...")
        exit_code, out_docker, _ = run_remote_command(ssh, "docker --version", check=False)
        if exit_code != 0:
            print("❌ Docker is not installed on the remote server.")
            print("   Please install Docker on the server: 'curl -fsSL https://get.docker.com | sh'")
            sys.exit(1)

        exit_code, out_compose, _ = run_remote_command(ssh, "docker compose version", check=False)
        if exit_code != 0:
            # Check legacy docker-compose
            exit_code_legacy, _, _ = run_remote_command(ssh, "docker-compose --version", check=False)
            if exit_code_legacy != 0:
                print("❌ Docker Compose is not installed on the remote server.")
                print("   Please install Docker Compose plugin: 'sudo apt-get install docker-compose-plugin'")
                sys.exit(1)

        exit_code, out_git, _ = run_remote_command(ssh, "git --version", check=False)
        if exit_code != 0:
            print("❌ Git is not installed on the remote server.")
            print("   Please install Git: 'sudo apt-get install git'")
            sys.exit(1)

        print("✅ Prerequisites verified: Docker, Compose, and Git are available.")

        # 4. Clone or update repository on target server
        print("\n[Step 3/5] Setting up / Syncing repository on remote server...")
        check_dir_cmd = f"test -d {args.remote_dir}/.git"
        is_git_repo, _, _ = run_remote_command(ssh, check_dir_cmd, check=False, print_output=False)

        if is_git_repo != 0:
            print(f"   Repository not found at {args.remote_dir}. Cloning from {args.repo}...")
            clone_cmd = f"git clone -b {args.branch} {args.repo} {args.remote_dir}"
            run_remote_command(ssh, clone_cmd, title="Cloning Repository")
        else:
            if not args.skip_pull:
                print(f"   Repository exists at {args.remote_dir}. Pulling latest changes from branch '{args.branch}'...")
                pull_cmds = (
                    f"cd {args.remote_dir} && "
                    f"git fetch origin && "
                    f"git checkout {args.branch} && "
                    f"git pull origin {args.branch}"
                )
                run_remote_command(ssh, pull_cmds, title="Pulling Latest Code")
            else:
                print("   Skipping git pull as requested (--skip-pull).")

        # 5. Build and Launch Docker Compose stack
        print("\n[Step 4/5] Launching Central Platform Docker stack...")
        rebuild_flag = "--no-cache" if args.rebuild else ""
        build_up_cmd = (
            f"cd {args.remote_dir} && "
            f"docker compose -f {args.compose_file} up --build -d {rebuild_flag}"
        )
        run_remote_command(ssh, build_up_cmd, title=f"Starting Docker Compose ({args.compose_file})")

        # 6. Verify Health & Output Info
        print("\n[Step 5/5] Verifying service status and health...")
        print("   Waiting 5 seconds for backend and PostgreSQL to initialize...")
        time.sleep(5)

        ps_cmd = f"cd {args.remote_dir} && docker compose -f {args.compose_file} ps"
        _, ps_out, _ = run_remote_command(ssh, ps_cmd, title="Container Status")

        # Check health endpoint via curl on remote localhost
        health_cmd = "curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/api/health || curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/"
        _, status_code, _ = run_remote_command(ssh, health_cmd, check=False, print_output=False)
        status_code = status_code.strip()

        print("\n" + "=" * 65)
        print("🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!")
        print("=" * 65)
        print(f"📍 Central Platform Web Dashboard: http://{host}:8000")
        print(f"📍 Central Platform REST API:       http://{host}:8000/docs")
        print(f"📍 Local Server Health Check Code:  {status_code or 'N/A'}")
        print("\n💡 Important Reminder for FPGA Fleet:")
        print(f"   Ensure KR260/Edge board agents have their 'backend_url' pointing to:")
        print(f"   backend_url = \"http://{host}:8000\" (in agent.toml)")
        print("=" * 65)

    except Exception as e:
        print(f"\n❌ Deployment failed: {e}")
        sys.exit(1)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
