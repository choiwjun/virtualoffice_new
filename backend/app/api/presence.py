"""
실시간 프레즌스 배치 수신 (D3, 서버간 write path).

POST /api/presence/batch — Colyseus 이동서버가 1~5초마다 변경된 프레즌스를 배치 전송.
FastAPI만 DB에 쓴다(Colyseus는 메모리 권위, D3). 인증 = 내부 서버간 토큰(Bearer).
정본: 15-realtime-server-spec §6, 09-realtime-collaboration §5, 04-data-model §2.4.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.tables import PresenceStatus
from app.services.presence_store import upsert_presence

router = APIRouter(prefix="/api/presence", tags=["presence"])


class PresenceRecordIn(BaseModel):
    userId: str
    officeId: Optional[str] = None
    floorId: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    status: str
    seatId: Optional[str] = None
    timestamp: Optional[int] = None


class PresenceBatchIn(BaseModel):
    records: list[PresenceRecordIn]


class PresenceBatchOut(BaseModel):
    accepted: int
    skipped: int


async def require_internal(authorization: Optional[str] = Header(None)) -> None:
    """서버간 내부 토큰 검증(Bearer). 이동서버 → FastAPI presence write 전용."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing internal token")
    token = authorization.split(" ", 1)[1]
    if token != settings.internal_api_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "invalid internal token")


def _parse_uuid(v: Optional[str]) -> Optional[UUID]:
    if not v:
        return None
    try:
        return UUID(v)
    except (ValueError, TypeError):
        return None


@router.post("/batch", response_model=PresenceBatchOut)
async def presence_batch(
    body: PresenceBatchIn,
    _: None = Depends(require_internal),
    db: AsyncSession = Depends(get_db),
) -> PresenceBatchOut:
    """
    프레즌스 배치 upsert. 레코드별로:
    - userId(ERP user.id) 비숫자 → skip (데모/게스트).
    - status 7종(D13) 외 → skip.
    - office/floor는 UUID 파싱 실패 시 None(데모 문자열 키 등).
    """
    accepted = 0
    skipped = 0
    for rec in body.records:
        try:
            uid = int(rec.userId)
        except (ValueError, TypeError):
            skipped += 1
            continue
        try:
            st = PresenceStatus(rec.status)
        except ValueError:
            skipped += 1
            continue
        await upsert_presence(
            db,
            user_id=uid,
            status=st,
            office_id=_parse_uuid(rec.officeId),
            floor_id=_parse_uuid(rec.floorId),
            x=rec.x,
            y=rec.y,
        )
        accepted += 1
    await db.commit()
    return PresenceBatchOut(accepted=accepted, skipped=skipped)
