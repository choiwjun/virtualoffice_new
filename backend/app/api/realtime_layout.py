"""
이동서버(Colyseus)용 층 레이아웃 조회 (서버간).

GET /api/realtime/floor-layout?office_id=&floor_id=
 — 해당 office/floor의 **deployed** office_layout(05 스키마)을 realtime FloorLayout 형태
   {bounds, walls, seats, meetingZones}로 매핑해 반환. 없으면 404(이동서버는 데모 층 폴백).

매핑을 백엔드에서 수행하는 이유: 05 스키마 지식이 여기 있고, 이동서버는 얇게 유지(D3).
인증 = 내부 서버간 토큰(presence batch와 동일). 정본: 05-office-layout-schema, 15-realtime §4.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.presence import require_internal
from app.db import get_db
from app.models.tables import OfficeLayout, OfficeLayoutStatus

router = APIRouter(prefix="/api/realtime", tags=["realtime-layout"])


def _f(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def map_floor_layout(layout_json: dict, office_id: str, floor_id: str) -> dict:
    """05 office_layout JSON → realtime FloorLayout {bounds, walls, seats, meetingZones}."""
    dims = layout_json.get("dimensions") or {}
    bounds = {"x": 0.0, "y": 0.0, "w": _f(dims.get("width_m"), 20.0), "h": _f(dims.get("height_m"), 15.0)}

    seats = []
    for s in layout_json.get("seats") or []:
        c = s.get("coords") or {}
        seats.append({
            "seatId": s.get("seat_id", ""),
            "x": _f(c.get("x")),
            "y": _f(c.get("y")),
            "type": "fixed" if s.get("seat_type") == "fixed" else "flex",
        })

    zones = []
    for r in layout_json.get("rooms") or []:
        c = r.get("coords") or {}
        zones.append({
            "roomId": r.get("room_id", ""),
            "bounds": {"x": _f(c.get("x")), "y": _f(c.get("y")), "w": _f(c.get("width")), "h": _f(c.get("height"))},
            "capacity": int(r.get("max_concurrent_users") or r.get("capacity") or 0),
        })

    walls: list[dict] = []
    for col in layout_json.get("colliders") or []:
        if col.get("shape") == "box":
            b = col.get("box") or {}
            x, y, w, h = _f(b.get("x")), _f(b.get("y")), _f(b.get("width")), _f(b.get("height"))
            walls += [
                {"x1": x, "y1": y, "x2": x + w, "y2": y},
                {"x1": x + w, "y1": y, "x2": x + w, "y2": y + h},
                {"x1": x + w, "y1": y + h, "x2": x, "y2": y + h},
                {"x1": x, "y1": y + h, "x2": x, "y2": y},
            ]
        elif col.get("shape") == "polygon":
            pts = col.get("polygon") or []
            n = len(pts)
            for i in range(n):
                a, b = pts[i], pts[(i + 1) % n]
                walls.append({"x1": _f(a.get("x")), "y1": _f(a.get("y")), "x2": _f(b.get("x")), "y2": _f(b.get("y"))})
    # 회의실 유리벽(glass=True → 이동은 막고 LOS는 통과, 15-realtime §5)
    for r in layout_json.get("rooms") or []:
        for gw in r.get("glass_walls") or []:
            st, en = gw.get("start") or {}, gw.get("end") or {}
            walls.append({"x1": _f(st.get("x")), "y1": _f(st.get("y")), "x2": _f(en.get("x")), "y2": _f(en.get("y")), "glass": True})

    return {"officeId": office_id, "floorId": floor_id, "bounds": bounds, "walls": walls, "seats": seats, "meetingZones": zones}


@router.get("/floor-layout")
async def realtime_floor_layout(
    office_id: str = Query(...),
    floor_id: str = Query(...),
    _: None = Depends(require_internal),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """deployed 레이아웃을 FloorLayout 형태로 반환. 없거나 id가 UUID 아니면 404."""
    try:
        oid, fid = UUID(office_id), UUID(floor_id)
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no deployed layout (non-UUID ids)")
    row = (
        await db.execute(
            select(OfficeLayout)
            .where(
                OfficeLayout.office_id == oid,
                OfficeLayout.floor_id == fid,
                OfficeLayout.status == OfficeLayoutStatus.DEPLOYED,
            )
            .order_by(OfficeLayout.version.desc())
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no deployed layout")
    return map_floor_layout(row.json, office_id, floor_id)
