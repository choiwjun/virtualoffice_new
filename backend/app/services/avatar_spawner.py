"""
아바타 시작 위치 매핑 (P2-R3-T1).

배정 좌석(seat.assigned_user_id) → 3D 씬 좌표(coords)로 변환. 좌석 미배정 시 로비/기본
스폰으로 폴백한다. 좌표계는 2D top_left 미터(D25) — Godot 임포트가 3D로 변환.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Seat

# 로비 기본 스폰(레이아웃 spawn_default 부재 시 폴백). 2D top_left 미터.
LOBBY_FALLBACK = {"x": 1.0, "y": 1.0, "facing": 0.0}


async def get_spawn_location(db: AsyncSession, user_id: int) -> dict[str, Any]:
    """user_id의 배정 좌석 좌표를 스폰 위치로 반환. 미배정 시 로비 폴백.

    반환: {source: seat|lobby, x, y, facing, seat_number?}
    """
    seat = (
        await db.execute(
            select(Seat).where(Seat.assigned_user_id == user_id).order_by(Seat.seat_number)
        )
    ).scalars().first()
    if seat is not None and isinstance(seat.coords, dict):
        c = seat.coords
        return {
            "source": "seat",
            "x": float(c.get("x", 0.0)),
            "y": float(c.get("y", 0.0)),
            "facing": float(c.get("facing", 0.0) or 0.0),
            "seat_number": seat.seat_number,
        }
    return {"source": "lobby", **LOBBY_FALLBACK}
