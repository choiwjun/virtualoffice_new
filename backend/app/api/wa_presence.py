"""
WorkAdventure Presence 수집 라우터.

WA 스크립팅 API 또는 Room API 웹훅에서 presence 이벤트를 수신 →
wa_event_to_status()로 D13 상태로 변환 → DB 저장 + SSE 브로드캐스트.

평문 비밀번호 로깅 금지. GPS 수집 금지(D20-c).
좌표(x,y,z)는 KPI 미사용·보존정책(D20-a) 주석 처리.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.integrations.workadventure.presence import (
    WaEvent,
    WaEventKind,
    wa_event_to_status,
)
from app.services.presence_store import upsert_presence

router = APIRouter(prefix="/api/wa", tags=["workadventure"])


class WaPresenceEvent(BaseModel):
    """WA presence 이벤트 페이로드.

    employee_id → DB user_id 로 사용 (ERP users.id와 동일).
    office_id/floor_id/x/y/z 는 optional 확장 — 없으면 상태만 갱신.
    GPS 수집 기능 삭제(D20-c): x,y는 WA 존 좌표(픽셀/타일)이며 GPS 절대 금지.
    좌표는 KPI 미사용·보존정책(D20-a).
    """

    employee_id: int
    kind: str                            # WaEventKind 문자열
    zone_name: Optional[str] = None
    variable_name: Optional[str] = None
    variable_value: Optional[str] = None
    # Optional location extension (D20-a: 좌표 KPI 미사용·보존정책)
    office_id: Optional[str] = None      # UUID 문자열 (없으면 갱신 안 함)
    floor_id: Optional[str] = None       # UUID 문자열 (없으면 갱신 안 함)
    x: Optional[float] = None            # WA 존 좌표(타일/픽셀); GPS 금지(D20-c)
    y: Optional[float] = None
    z: Optional[float] = None


class WaPresenceResponse(BaseModel):
    """WA presence 이벤트 처리 결과."""

    employee_id: int
    received_kind: str
    resolved_status: Optional[str]      # D13 status 문자열 또는 None (매핑 없음)
    message: str


@router.post("/presence", response_model=WaPresenceResponse)
async def wa_presence(
    payload: WaPresenceEvent,
    db: AsyncSession = Depends(get_db),
) -> WaPresenceResponse:
    """
    POST /api/wa/presence — WA presence 이벤트 수신·변환·저장.

    WorkAdventure 스크립팅 API 또는 서버 웹훅에서 호출.
    wa_event_to_status()로 D13 상태 변환 후 DB upsert + SSE 브로드캐스트.
    매핑되지 않는 이벤트(resolved=None)는 DB 저장 없이 응답만 반환.
    """
    try:
        kind = WaEventKind(payload.kind)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"알 수 없는 이벤트 종류: {payload.kind!r}",
        )

    event = WaEvent(
        kind=kind,
        zone_name=payload.zone_name,
        variable_name=payload.variable_name,
        variable_value=payload.variable_value,
    )

    resolved = wa_event_to_status(event)

    if resolved is not None:
        # UUID 파싱 (잘못된 값이면 무시하고 None 처리)
        office_uuid: Optional[UUID] = None
        floor_uuid: Optional[UUID] = None
        if payload.office_id:
            try:
                office_uuid = UUID(payload.office_id)
            except ValueError:
                pass
        if payload.floor_id:
            try:
                floor_uuid = UUID(payload.floor_id)
            except ValueError:
                pass

        await upsert_presence(
            db=db,
            user_id=payload.employee_id,   # employee_id → user_id (D3: ERP users.id)
            status=resolved,
            office_id=office_uuid,
            floor_id=floor_uuid,
            x=payload.x,
            y=payload.y,
            z=payload.z,
        )
        await db.commit()

    return WaPresenceResponse(
        employee_id=payload.employee_id,
        received_kind=payload.kind,
        resolved_status=resolved.value if resolved is not None else None,
        message="ok" if resolved is not None else "이벤트가 D13 상태로 매핑되지 않음 (무시)",
    )
