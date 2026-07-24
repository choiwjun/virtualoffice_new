"""
Presence 서비스: DB upsert + 실시간 pub/sub 이벤트 발행.

D13(presence 7종), D19(UTC 저장).
좌표 x,y,z는 KPI 미사용·보존 정책(D20-a): 수집 허용하나 KPI 산출에 미사용.
GPS 수집 기능 삭제(D20-c): 위치는 WA 존 좌표만, GPS/lat/lng 절대 수집 금지.

인메모리 pub/sub(단일 프로세스 로컬 범위).
프로덕션에서는 Redis Pub/Sub으로 교체 필요 (TODO: production Redis pub/sub).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import DEFAULT_COMPANY_ID, ErpUser, Presence, PresenceStatus


# ---------------------------------------------------------------------------
# 인메모리 pub/sub
# 단일 프로세스 로컬 범위 전용. 다중 워커/프로세스 환경에서는 Redis 필요.
# TODO: production — replace with Redis Pub/Sub (e.g. aioredis subscribe)
# ---------------------------------------------------------------------------

class _PresencePubSub:
    """asyncio.Queue 팬아웃 pub/sub (단일 프로세스 전용)."""

    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        """새 구독 큐 반환. 호출자는 사용 후 unsubscribe() 필수."""
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        """구독 해제 (SSE 연결 종료 시 호출)."""
        self._queues.discard(q)

    async def publish(self, event: dict) -> None:
        """모든 구독 큐에 이벤트 팬아웃. QueueFull 구독자는 제거."""
        dead: set[asyncio.Queue] = set()
        for q in list(self._queues):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.add(q)
        self._queues -= dead

    def subscriber_count(self) -> int:
        """현재 구독자 수 (모니터링/디버그용)."""
        return len(self._queues)


# 모듈 수준 싱글턴 (단일 프로세스 내 공유)
presence_pubsub = _PresencePubSub()


# ---------------------------------------------------------------------------
# DB upsert
# ---------------------------------------------------------------------------

async def upsert_presence(
    db: AsyncSession,
    user_id: int,
    status: PresenceStatus,
    office_id: Optional[UUID] = None,
    floor_id: Optional[UUID] = None,
    x: Optional[float] = None,  # 좌표는 KPI 미사용·보존정책(D20-a); GPS 금지(D20-c)
    y: Optional[float] = None,
    z: Optional[float] = None,
) -> Presence:
    """
    Presence 레코드 upsert (PK = user_id).

    - 신규 레코드: INSERT (제공된 필드로 생성; 위치 없으면 None)
    - 기존 레코드: UPDATE status + last_activity_at;
                   office_id/floor_id/x/y/z는 제공된 경우만 갱신.
    - D19: UTC 저장.
    - 저장 후 presence_pubsub에 이벤트 발행 → SSE 구독자 팬아웃.
    """
    now = datetime.now(timezone.utc)

    # 테넌트 스코프: 내부 write 경로는 JWT가 아니라 user_id를 신뢰 → 그 user의 회사로 파생
    # (company_scope 의존성을 강제하지 않는다, Phase 1c · 22 T0-1). 미존재 시 기본 테넌트(1).
    erp_user = await db.get(ErpUser, user_id)
    derived_company_id = erp_user.company_id if erp_user is not None else DEFAULT_COMPANY_ID

    result = await db.execute(
        select(Presence).where(Presence.user_id == user_id)
    )
    existing = result.scalar_one_or_none()

    if existing is None:
        presence = Presence(
            user_id=user_id,
            company_id=derived_company_id,
            status=status,
            office_id=office_id,
            floor_id=floor_id,
            x=x,
            y=y,
            z=z,
            last_activity_at=now,
            updated_at=now,
        )
        db.add(presence)
        await db.flush()
        record = presence
    else:
        existing.company_id = derived_company_id
        existing.status = status
        existing.last_activity_at = now
        existing.updated_at = now
        if office_id is not None:
            existing.office_id = office_id
        if floor_id is not None:
            existing.floor_id = floor_id
        if x is not None:
            existing.x = x
        if y is not None:
            existing.y = y
        if z is not None:
            existing.z = z
        await db.flush()
        record = existing

    # 실시간 이벤트 발행 (SSE 구독자 팬아웃)
    await presence_pubsub.publish(
        {
            "user_id": user_id,
            "status": status.value,
            "updated_at": now.isoformat(),
        }
    )

    return record
