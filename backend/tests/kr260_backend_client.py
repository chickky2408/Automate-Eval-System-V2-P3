"""
HTTP client for backend <-> agent communication.

- register()        POST {backend}/api/agent/register
- send_heartbeat()  POST {backend}/api/agent/heartbeat
- download_asset()  GET  {backend}/api/files/{id}/content (URL supplied by /execute)
- post_measurements() POST {backend}/api/boards/{id}/measurements   (tolerant: phase-2 endpoint)
- upload_result()   chunked init/part/complete to result_receiver (node_b protocol)
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Optional

import httpx
import socket
from urllib.parse import urlparse

from config import config

logger = logging.getLogger("board_agent.client")

PART_SIZE = 8 * 1024 * 1024
STREAM_CHUNK = 1 * 1024 * 1024


def resolve_mdns_url(raw_url: str) -> str:
    """Resolve .local mDNS hostnames dynamically via socket.getaddrinfo."""
    try:
        parsed = urlparse(raw_url)
        host = parsed.hostname
        if not host or not host.endswith(".local"):
            return raw_url.rstrip("/")

        # Resolve mDNS hostname via Multicast DNS IPv4 socket lookup
        infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
        if infos:
            ip = infos[0][4][0]
            port_str = f":{parsed.port}" if parsed.port else ""
            scheme = parsed.scheme or "http"
            logger.debug("mDNS resolved %s -> %s", host, ip)
            return f"{scheme}://{ip}{port_str}"
    except Exception as exc:
        logger.debug("Failed mDNS resolution for %s: %s", raw_url, exc)
    return raw_url.rstrip("/")


class BackendClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=30.0)

    @property
    def base_url(self) -> str:
        return resolve_mdns_url(config.backend_url)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _recreate_client(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass
        self._client = httpx.AsyncClient(timeout=30.0)

    def _get_local_ip(self) -> Optional[str]:
        try:
            target_url = self.base_url
            parsed = urlparse(target_url)
            host = parsed.hostname
            if not host:
                return None
            # Standard way to find the local IP that routes to target host
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((host, parsed.port or 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception as exc:
            logger.debug("Failed to detect local IP via socket connect: %s", exc)
            # Standalone Direct LAN fallback: resolve local hostname IP
            try:
                hostname = socket.gethostname()
                return socket.gethostbyname(hostname)
            except Exception:
                return None

    # --- lifecycle ---------------------------------------------------------
    async def register(self) -> bool:
        payload = {
            "board_id": config.board_id,
            "name": config.name,
            "mac_address": config.mac_address,
            "firmware_version": config.firmware_version,
            "model": config.model,
            "tag": config.tag,
            "ip_address": self._get_local_ip(),
        }
        try:
            resp = await self._client.post(f"{config.base_url}/api/agent/register", json=payload)
            resp.raise_for_status()
            logger.info("registered board %s -> %s", config.board_id, resp.json())
            return True
        except httpx.HTTPError as exc:
            logger.warning("register failed: %s", exc)
            return False

    async def send_heartbeat(
        self,
        *,
        cpu_temp: Optional[float],
        cpu_load: float,
        ram_usage: float,
        status: str,
        fpga_status: str,
        arm_status: str,
    ) -> bool:
        payload = {
            "board_id": config.board_id,
            "cpu_temp": cpu_temp if cpu_temp is not None else 0.0,
            "cpu_load": cpu_load,
            "ram_usage": ram_usage,
            "status": status,
            "fpga_status": fpga_status,
            "arm_status": arm_status,
            "ip_address": self._get_local_ip(),
        }
        try:
            resp = await self._client.post(f"{config.base_url}/api/agent/heartbeat", json=payload)
            if resp.status_code == 404:
                logger.info("heartbeat 404 (board unknown) -> re-registering")
                await self.register()
                return False
            resp.raise_for_status()
            return True
        except httpx.HTTPError as exc:
            logger.warning("heartbeat failed: %s -> attempting re-register", exc)
            await self._recreate_client()
            await self.register()
            return False

    # --- assets ------------------------------------------------------------
    async def download_asset(self, url: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        async with self._client.stream("GET", url) as resp:
            resp.raise_for_status()
            with dest.open("wb") as fh:
                async for chunk in resp.aiter_bytes(STREAM_CHUNK):
                    fh.write(chunk)
        logger.info("downloaded %s -> %s (%d bytes)", url, dest.name, dest.stat().st_size)
        return dest

    # --- results -----------------------------------------------------------
    async def post_measurements(self, job_id: str, result_id: str, metadata: dict) -> bool:
        """Send pass/fail + stats. Endpoint is phase-2; tolerate its absence."""
        url = f"{config.base_url}/api/boards/{config.board_id}/measurements"
        body = {"job_id": job_id, "result_id": result_id, **metadata}
        try:
            resp = await self._client.post(url, json=body)
            if resp.status_code == 404:
                logger.warning("measurements endpoint not present yet (404): %s", url)
                return False
            resp.raise_for_status()
            return True
        except httpx.HTTPError as exc:
            logger.warning("post_measurements failed: %s", exc)
            return False

    async def upload_result(self, file_path: Path, target_filename: str) -> dict:
        """
        Chunked upload using the node_b receiver protocol
        (init -> part[/hash] -> complete) with Smart Part Retry.
        """
        receiver = resolve_mdns_url(config.result_receiver_url).rstrip("/")
        total_size = file_path.stat().st_size

        init = await self._client.post(
            f"{receiver}/v1/upload/init",
            json={
                "total_size_bytes": total_size,
                "part_size_bytes": PART_SIZE,
                "target_filename": target_filename,
            },
        )
        init.raise_for_status()
        upload_id = init.json()["upload_id"]

        parts_to_send = []
        with file_path.open("rb") as fh:
            idx = 0
            while True:
                part_bytes = fh.read(PART_SIZE)
                if not part_bytes:
                    break
                parts_to_send.append((idx, part_bytes))
                idx += 1

        for part_index, part in parts_to_send:
            part_hash = hashlib.sha256(part).hexdigest()
            success = False
            for attempt in range(3):
                try:
                    resp = await self._client.put(
                        f"{receiver}/v1/upload/part/{upload_id}/{part_index}",
                        content=part,
                        headers={
                            "Content-Type": "application/octet-stream",
                            "x-part-size": str(len(part)),
                            "x-part-sha256": part_hash,
                        },
                    )
                    resp.raise_for_status()
                    success = True
                    break
                except httpx.HTTPError as exc:
                    logger.warning("part %d upload attempt %d failed: %s", part_index, attempt + 1, exc)
                    # Query backend upload status to check if part was already received
                    try:
                        status_resp = await self._client.get(f"{receiver}/v1/upload/status/{upload_id}")
                        if status_resp.status_code == 200:
                            received_parts = status_resp.json().get("received_parts", [])
                            if part_index in received_parts:
                                logger.info("part %d was already received by backend server; skipping retry", part_index)
                                success = True
                                break
                    except Exception:
                        pass
            if not success:
                raise RuntimeError(f"Failed to upload part {part_index} after 3 attempts")

        done = await self._client.post(
            f"{receiver}/v1/upload/complete/{upload_id}",
            json={"expected_total_size_bytes": total_size, "expected_total_parts": len(parts_to_send)},
        )
        done.raise_for_status()
        result = done.json()
        logger.info("uploaded result %s (%d bytes, %d parts)", target_filename, total_size, len(parts_to_send))
        return result



backend_client = BackendClient()
