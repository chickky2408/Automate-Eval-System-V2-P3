import asyncio
from db.database import async_session
from db.orm_models import BoardORM, BoardStatusORM
from sqlalchemy import select

async def main():
    async with async_session() as session:
        # Query Board Info
        res = await session.execute(select(BoardORM))
        print("=== Registered Boards (Static Info) ===")
        for row in res.scalars().all():
            print(f"ID={row.id}, Name={row.name}, IP={row.ip_address}, MAC={row.mac_address}")
        
        # Query Dynamic Status / Telemetry
        status_res = await session.execute(select(BoardStatusORM))
        print("\n=== Live Board Status & Telemetry ===")
        for r in status_res.scalars().all():
            print(f"Board ID: {r.board_id}")
            print(f"  State: {r.state}")
            print(f"  CPU Temp: {r.cpu_temp} C")
            print(f"  CPU Load: {r.cpu_load} %")
            print(f"  RAM Usage: {r.ram_usage} %")
            print(f"  FPGA Status: {r.fpga_status}")
            print(f"  ARM Status: {r.arm_status}")
            print(f"  Last Heartbeat: {r.last_heartbeat} UTC")

if __name__ == "__main__":
    asyncio.run(main())

