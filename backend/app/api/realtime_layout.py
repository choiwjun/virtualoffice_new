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

    spawn = None
    sd = layout_json.get("spawn_default") or {}
    want = sd.get("spawn_id")
    for sp in layout_json.get("spawn_points") or []:
        if want is None or sp.get("spawn_id") == want:
            c = sp.get("coords") or {}
            spawn = {"x": _f(c.get("x")), "y": _f(c.get("y"))}
            break
    if spawn is None and seats:
        spawn = {"x": seats[0]["x"], "y": seats[0]["y"]}

    out = {"officeId": office_id, "floorId": floor_id, "bounds": bounds, "walls": walls, "seats": seats, "meetingZones": zones}
    if spawn is not None:
        out["spawn"] = spawn
    return out


@router.get("/floor-layout")
async def realtime_floor_layout(
    office_id: str = Query(...),
    floor_id: str = Query(...),
    _: None = Depends(require_internal),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """deployed 레이아웃을 FloorLayout 형태로 반환.

    office/floor id가 UUID면 해당 층의 deployed 버전을 우선 사용한다. 매칭 배포본이 없거나
    id가 비-UUID(데모 'office-demo'/'floor-1' 등)면 **최신 deployed 배포본으로 폴백**한다 —
    이동서버(realtime)가 데모 id로도 배포된 배치의 충돌/경계를 쓰게 해 프론트 벡터 렌더와
    지오메트리를 일치시킨다(단일 오피스 dev 기준). 배포본이 하나도 없으면 404(→씬 폴백)."""
    row = None
    try:
        oid, fid = UUID(office_id), UUID(floor_id)
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
    except (ValueError, TypeError):
        row = None
    if row is None:
        # 비-UUID id이거나 해당 층 배포본 없음 → 최신 deployed 폴백(단일테넌트 dev).
        row = (
            await db.execute(
                select(OfficeLayout)
                .where(OfficeLayout.status == OfficeLayoutStatus.DEPLOYED)
                .order_by(OfficeLayout.version.desc())
            )
        ).scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no deployed layout")
    return map_floor_layout(row.json, office_id, floor_id)
