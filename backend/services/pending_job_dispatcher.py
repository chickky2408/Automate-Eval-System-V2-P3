"""
Pending Job Dispatcher Service
================================
Background service ที่คอยตรวจสอบ pending jobs และเริ่ม run
เมื่อบอร์ดที่ถูกมอบหมาย (requested_board_id) ว่างลง (state = 'online').

Logic หลัก
-----------
1. ทุก POLL_INTERVAL วินาที สแกน job_targets ที่มี:
   - JobORM.state = 'pending'
   - JobTargetORM.status = 'pending'
   - requested_board_id = X (specific) หรือ 'any' (ใครก็ได้)

2. สำหรับแต่ละ target:
   - ถ้า target_type = 'specific' → ตรวจว่า board X มี state = 'online'
   - ถ้า target_type = 'any'      → หา board ใดก็ได้ที่ state = 'online'

3. เมื่อพบบอร์ดว่าง → ส่ง job เข้า execute queue ผ่าน job_queue_service._execute_target()
   แบบ non-blocking (asyncio.create_task) เพื่อไม่บล็อก loop

หมายเหตุ
---------
Service นี้ทำงานเมื่อ job_queue_service._running = True เท่านั้น
(เปิดใช้งานจาก lifespan ใน main.py)
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, and_

from db.database import async_session
from db.orm_models import JobORM, JobTargetORM, BoardStatusORM

logger = logging.getLogger(__name__)

# เวลา poll รอบละกี่วินาที (เพิ่มถ้า load DB สูง)
POLL_INTERVAL: float = 3.0
# ป้องกัน target เดิมถูก dispatch ซ้ำพร้อมกัน
_dispatching: set[str] = set()


class PendingJobDispatcher:
    """Background service: promote pending → running เมื่อบอร์ดพร้อม."""

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._running: bool = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """เริ่ม background loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="pending_job_dispatcher")
        print(f"[PendingDispatcher] Started (poll every {POLL_INTERVAL}s)")

    async def stop(self) -> None:
        """หยุด background loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("[PendingDispatcher] Stopped")

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def _loop(self) -> None:
        # หน่วงนิดหน่อยเพื่อให้ DB init เสร็จก่อน
        await asyncio.sleep(POLL_INTERVAL)
        while self._running:
            try:
                await self._dispatch_ready_targets()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[PendingDispatcher] Unexpected error in dispatch loop")
            await asyncio.sleep(POLL_INTERVAL)

    # ------------------------------------------------------------------
    # Core dispatch logic
    # ------------------------------------------------------------------

    async def _dispatch_ready_targets(self) -> None:
        """
        หา pending targets ที่บอร์ดพร้อมแล้ว แล้ว dispatch แบบ non-blocking.
        """
        # 1. ดึง pending targets ทั้งหมด (JOIN กับ job เพื่อกรอง state=pending)
        async with async_session() as session:
            q = (
                select(JobTargetORM)
                .join(JobORM, JobORM.id == JobTargetORM.job_id)
                .where(
                    and_(
                        JobORM.state == "pending",
                        JobTargetORM.status == "pending",
                    )
                )
                .order_by(JobORM.priority.desc(), JobORM.created_at.asc())
            )
            result = await session.execute(q)
            pending_targets = result.scalars().all()

            if not pending_targets:
                return

            # 2. ดึง board status ทั้งหมดในครั้งเดียว (ลด round-trip)
            board_status_q = select(BoardStatusORM)
            board_result = await session.execute(board_status_q)
            board_rows = board_result.scalars().all()

        # index: board_id → state
        board_state: dict[str, str] = {r.board_id: (r.state or "offline") for r in board_rows}

        # 3. จับคู่ target → board ที่ว่าง
        for target in pending_targets:
            target_id = target.id

            # ข้าม target ที่กำลัง dispatch อยู่แล้ว
            if target_id in _dispatching:
                continue

            assigned_board_id: Optional[str] = None

            if target.target_type == "specific" and target.requested_board_id:
                # ตรวจบอร์ดที่ระบุ
                s = board_state.get(target.requested_board_id, "offline")
                if s == "online":
                    assigned_board_id = target.requested_board_id
            else:
                # target_type = 'any' → หาบอร์ดว่างตัวแรก
                for bid, s in board_state.items():
                    if s == "online":
                        # ตรวจว่าบอร์ดนั้นไม่ถูก lock โดย target อื่นที่กำลัง dispatch
                        if bid not in _dispatching:
                            assigned_board_id = bid
                            break

            if not assigned_board_id:
                # บอร์ดยังไม่ว่าง รอรอบหน้า
                continue

            # 4. Lock ก่อน dispatch
            _dispatching.add(target_id)
            # mark board ชั่วคราวเป็น busy เพื่อป้องกัน race condition
            # กับ target อื่นใน loop เดียวกัน
            board_state[assigned_board_id] = "busy"

            print(
                f"[PendingDispatcher] Dispatching target {target_id} "
                f"(job={target.job_id}) → board {assigned_board_id}"
            )
            asyncio.create_task(
                self._run_target(target_id),
                name=f"dispatch_{target_id}",
            )

    async def _run_target(self, target_id: str) -> None:
        """
        Wrapper รอบ job_queue_service._execute_target():
        - Unlock _dispatching เมื่อเสร็จหรือ error
        - Log ผลลัพธ์
        """
        # import ที่นี่เพื่อหลีกเลี่ยง circular import ตอน module load
        from services.job_queue import job_queue_service

        try:
            await job_queue_service._execute_target(target_id)
            print(f"[PendingDispatcher] Target {target_id} finished")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(f"[PendingDispatcher] Error executing target {target_id}")
        finally:
            _dispatching.discard(target_id)

    # ------------------------------------------------------------------
    # Manual trigger (เรียกได้จาก router เมื่อมี board กลับมา online)
    # ------------------------------------------------------------------

    async def trigger_now(self) -> dict:
        """
        เรียกใช้ manual 1 รอบ dispatch ทันที
        (เช่น เมื่อ heartbeat ของบอร์ดเปลี่ยนจาก offline → online)
        """
        try:
            await self._dispatch_ready_targets()
            return {"triggered": True}
        except Exception as exc:
            logger.exception("[PendingDispatcher] trigger_now error")
            return {"triggered": False, "error": str(exc)}


# Singleton instance
pending_job_dispatcher = PendingJobDispatcher()
