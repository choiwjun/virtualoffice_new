"""
presence batch 엔드포인트 테스트 (D3, Colyseus→FastAPI write path).

검증:
1. 내부 토큰 없음 → 401
2. 잘못된 토큰 → 403
3. 유효 토큰 → upsert + persist, accepted 카운트
4. 비숫자 userId / 잘못된 status → skip 카운트
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables import Presence

_HDR = {"Authorization": f"Bearer {settings.internal_api_token}"}
_REC = {"userId": "1", "status": "working", "x": 3.0, "y": 4.0, "seatId": "", "timestamp": 0}


class TestPresenceBatch:
    async def test_requires_internal_token(self, async_client: AsyncClient):
        r = await async_client.post("/api/presence/batch", json={"records": [_REC]})
        assert r.status_code == 401

    async def test_rejects_wrong_token(self, async_client: AsyncClient):
        r = await async_client.post(
            "/api/presence/batch",
            json={"records": [_REC]},
            headers={"Authorization": "Bearer nope"},
        )
        assert r.status_code == 403

    async def test_accepts_and_persists(
        self, async_client: AsyncClient, db_session: AsyncSession
    ):
        r = await async_client.post("/api/presence/batch", json={"records": [_REC]}, headers=_HDR)
        assert r.status_code == 200
        assert r.json() == {"accepted": 1, "skipped": 0}

        row = (
            await db_session.execute(select(Presence).where(Presence.user_id == 1))
        ).scalar_one_or_none()
        assert row is not None
        assert row.status.value == "working"

    async def test_skips_non_numeric_and_bad_status(self, async_client: AsyncClient):
        recs = [
            {"userId": "guest", "status": "online"},  # 비숫자 userId → skip
            {"userId": "2", "status": "bogus"},        # 잘못된 status → skip
            {"userId": "3", "status": "online"},        # 정상
        ]
        r = await async_client.post("/api/presence/batch", json={"records": recs}, headers=_HDR)
        assert r.status_code == 200
        assert r.json() == {"accepted": 1, "skipped": 2}
