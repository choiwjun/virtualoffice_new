"""
WorkAdventure Presence 수집 라우터.

WA 스크립팅 API 또는 Room API 웹훅에서 presence 이벤트를 수신 →
wa_event_to_status()로 D13 상태로 변환 → DB 기록 (Phase 2+ 완전 구현).

현재 단계: 이벤트 수신 + 변환 + 응답 반환 (DB 기록은 TODO Phase 2).
"""

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.integrations.workadventure.presence import (
    WaEvent,
    WaEventKind,
    wa_event_to_status,
)

router = APIRouter(prefix="/api/wa", tags=["workadventure"])


class WaPresenceEvent(BaseModel):
    """WA presence 이벤트 페이로드."""
    employee_id: int
    kind: str                           # WaEventKind 문자열
    zone_name: Optional[str] = None
    variable_name: Optional[str] = None
    variable_value: Optional[str] = None


class WaPresenceResponse(BaseModel):
    """WA presence 이벤트 처리 결과."""
    employee_id: int
    received_kind: str
    resolved_status: Optional[str]      # D13 status 문자열 또는 None (매핑 없음)
    message: str


@router.post("/presence", response_model=WaPresenceResponse)
async def wa_presence(payload: WaPresenceEvent) -> WaPresenceResponse:
    """
    POST /api/wa/presence — WA presence 이벤트 수신·변환.

    WorkAdventure 스크립팅 API 또는 서버 웹훅에서 호출.
    presence.py의 wa_event_to_status()를 사용해 D13 상태로 변환.

    Phase 2+: DB PresenceLog 기록, SSE 브로드캐스트 추가.
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

    # TODO(Phase 2): resolved 상태를 DB PresenceLog에 기록
    # await log_presence(db, payload.employee_id, resolved)

    return WaPresenceResponse(
        employee_id=payload.employee_id,
        received_kind=payload.kind,
        resolved_status=resolved.value if resolved is not None else None,
        message="ok" if resolved is not None else "이벤트가 D13 상태로 매핑되지 않음 (무시)",
    )
