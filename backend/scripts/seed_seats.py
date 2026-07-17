#!/usr/bin/env python
"""
개발용 좌석·회의실 시드 — layout.json 좌석 앵커로 워크스테이션 8석 + HORIZON 회의존 2실(room) 생성.

사용:
    cd backend
    DATABASE_URL=sqlite+aiosqlite:///./dev_qa.db ./.venv/Scripts/python.exe scripts/seed_seats.py

- Office(본사)/Floor(1층) get-or-create
- WS-A1 → alice(1001) 고정 배정, WS-B1 → bob(1002) 고정 배정, 나머지 자율석(free)
- coords = layout.json 정규 좌표 × [20, 11.256] 미터 (lib/office2d.ts 좌표계약과 동일)
- 멱등: (floor, seat_number) upsert. 운영 DB에 실행 금지.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

# backend/ 를 sys.path에 추가 (스크립트 직접 실행 지원)
_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./dev.db")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.models.tables import (  # noqa: E402
    Base, Floor, Office, Room, RoomStatus, RoomType, Seat, SeatStatus, SeatType,
)

DATABASE_URL = os.environ["DATABASE_URL"]
LAYOUT_PATH = _ROOT.parent / "tools" / "asset-gen" / "out" / "layout.json"

# 좌표계약(lib/office2d.ts SCENE_W_M/SCENE_H_M과 동일해야 함)
SCENE_W_M = 20.0
SCENE_H_M = (941 / 1672) * 20.0

# 고정 배정: 좌석번호 → erp_user.id (seed_dev.py 계정)
FIXED_ASSIGN = {"WS-A1": 1001, "WS-B1": 1002}  # alice, bob

# HORIZON 회의존(realtime FloorLayoutProvider meetingZones와 동일 bbox 미터·roomId)
MEETING_ROOMS = [
    {"name": "Board Room", "livekit_room": "boardroom", "capacity": 8,
     "coords": {"x": 12.87, "y": 5.52, "width": 5.79, "height": 2.90}},
    {"name": "Meeting Room", "livekit_room": "meeting-a", "capacity": 4,
     "coords": {"x": 10.61, "y": 7.69, "width": 4.03, "height": 2.01}},
]


async def main() -> None:
    layout = json.loads(LAYOUT_PATH.read_text(encoding="utf-8"))
    anchors = layout.get("seats", [])
    if not anchors:
        raise SystemExit(f"layout.json에 seats가 없습니다 — tools/asset-gen에서 `node generate.js plate` 재생성 필요 ({LAYOUT_PATH})")

    print(f"DB: {DATABASE_URL}")
    print(f"layout: {LAYOUT_PATH} (seats {len(anchors)})")

    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        office = (
            await db.execute(select(Office).where(Office.name == "본사"))
        ).scalar_one_or_none()
        if office is None:
            office = Office(company_id=1, name="본사", description="dev seed")
            db.add(office)
            await db.flush()
            print(f"  [NEW] office 본사 ({office.id})")

        floor = (
            await db.execute(
                select(Floor).where(Floor.office_id == office.id, Floor.level == 1)
            )
        ).scalar_one_or_none()
        if floor is None:
            floor = Floor(office_id=office.id, level=1, name="1층")
            db.add(floor)
            await db.flush()
            print(f"  [NEW] floor 1층 ({floor.id})")

        created = 0
        updated = 0
        for a in anchors:
            num = a["seatNumber"]
            coords = {
                "x": round(a["x"] * SCENE_W_M, 3),
                "y": round(a["y"] * SCENE_H_M, 3),
                "facing": 0,
            }
            uid = FIXED_ASSIGN.get(num)
            row = (
                await db.execute(
                    select(Seat).where(Seat.floor_id == floor.id, Seat.seat_number == num)
                )
            ).scalar_one_or_none()
            if row is None:
                db.add(
                    Seat(
                        floor_id=floor.id,
                        type=SeatType.FIXED if uid else SeatType.FREE,
                        assigned_user_id=uid,
                        coords=coords,
                        status=SeatStatus.OCCUPIED if uid else SeatStatus.AVAILABLE,
                        seat_number=num,
                    )
                )
                created += 1
                print(f"  [NEW] {num} {coords}" + (f" → user {uid}" if uid else " (free)"))
            else:
                row.coords = coords
                if uid is not None:
                    row.type = SeatType.FIXED
                    row.assigned_user_id = uid
                    row.status = SeatStatus.OCCUPIED
                updated += 1
                print(f"  [UPD] {num} {coords}" + (f" → user {uid}" if uid else ""))

        # 회의실(room) — 회의실예약 화면·D24 명시입장이 참조. (floor, name) 멱등 upsert.
        for spec in MEETING_ROOMS:
            room = (
                await db.execute(
                    select(Room).where(Room.floor_id == floor.id, Room.name == spec["name"])
                )
            ).scalar_one_or_none()
            if room is None:
                db.add(
                    Room(
                        floor_id=floor.id,
                        type=RoomType.MEETING,
                        name=spec["name"],
                        capacity=spec["capacity"],
                        coords=spec["coords"],
                        livekit_room=spec["livekit_room"],
                        status=RoomStatus.ACTIVE,
                    )
                )
                created += 1
                print(f"  [NEW] room {spec['name']} (정원 {spec['capacity']})")
            else:
                room.capacity = spec["capacity"]
                room.coords = spec["coords"]
                room.livekit_room = spec["livekit_room"]
                updated += 1
                print(f"  [UPD] room {spec['name']}")

        await db.commit()

    await engine.dispose()
    print(f"완료: {created}개 생성, {updated}개 갱신")


if __name__ == "__main__":
    asyncio.run(main())
