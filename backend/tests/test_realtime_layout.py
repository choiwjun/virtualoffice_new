"""
이동서버용 층 레이아웃 조회 테스트 (05 → FloorLayout 매핑).

검증:
1. 내부 토큰 없음/오류 → 401/403
2. deployed 레이아웃 없음 → 404
3. deployed 레이아웃 → bounds/seats/rooms/walls 매핑 정확
"""

from __future__ import annotations

from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables import OfficeLayout, OfficeLayoutStatus

_HDR = {"Authorization": f"Bearer {settings.internal_api_token}"}

_JSON = {
    "dimensions": {"width_m": 30.0, "height_m": 20.0},
    "seats": [
        {"seat_id": "S_001", "seat_type": "fixed", "coords": {"x": 3.5, "y": 2.0}},
        {"seat_id": "S_002", "seat_type": "free", "coords": {"x": 5.0, "y": 2.0}},
    ],
    "rooms": [
        {
            "room_id": "R_001", "type": "meeting", "capacity": 6, "max_concurrent_users": 4,
            "coords": {"x": 25.0, "y": 10.0, "width": 6.0, "height": 4.5},
            "glass_walls": [{"start": {"x": 25.0, "y": 14.5}, "end": {"x": 31.0, "y": 14.5}}],
        }
    ],
    "colliders": [{"shape": "box", "box": {"x": 10.0, "y": 0.0, "width": 0.2, "height": 8.0}}],
}


class TestRealtimeFloorLayout:
    async def test_requires_internal_token(self, async_client: AsyncClient):
        r = await async_client.get(f"/api/realtime/floor-layout?office_id={uuid4()}&floor_id={uuid4()}")
        assert r.status_code == 401

    async def test_404_when_no_deployed(self, async_client: AsyncClient):
        r = await async_client.get(
            f"/api/realtime/floor-layout?office_id={uuid4()}&floor_id={uuid4()}", headers=_HDR
        )
        assert r.status_code == 404

    async def test_maps_deployed_layout(self, async_client: AsyncClient, db_session: AsyncSession):
        oid, fid = uuid4(), uuid4()
        db_session.add(
            OfficeLayout(office_id=oid, floor_id=fid, version=1, status=OfficeLayoutStatus.DEPLOYED, json=_JSON)
        )
        await db_session.commit()

        r = await async_client.get(
            f"/api/realtime/floor-layout?office_id={oid}&floor_id={fid}", headers=_HDR
        )
        assert r.status_code == 200
        data = r.json()

        assert data["bounds"] == {"x": 0.0, "y": 0.0, "w": 30.0, "h": 20.0}

        assert len(data["seats"]) == 2
        s1 = next(s for s in data["seats"] if s["seatId"] == "S_001")
        assert s1["type"] == "fixed" and s1["x"] == 3.5 and s1["y"] == 2.0
        s2 = next(s for s in data["seats"] if s["seatId"] == "S_002")
        assert s2["type"] == "flex"  # 'free' → flex

        assert len(data["meetingZones"]) == 1
        z = data["meetingZones"][0]
        assert z["roomId"] == "R_001"
        assert z["bounds"] == {"x": 25.0, "y": 10.0, "w": 6.0, "h": 4.5}
        assert z["capacity"] == 4  # max_concurrent_users 우선

        # box collider(4변) + glass wall(1) = 5
        assert len(data["walls"]) == 5
        assert any(w.get("glass") is True for w in data["walls"])
