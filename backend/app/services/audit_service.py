"""
감사 로그 생산자 헬퍼 (B-14, D20).

@SPEC 04-data-model.md §2.6 (audit_log), 00-decisions.md D20 (컴플라이언스, audit_log 5년 보존)

도메인 API의 감사 대상 액션에서 호출해 ``AuditLog`` 레코드를 **현재 트랜잭션에 stage**한다.
이 헬퍼는 절대 commit/flush하지 않는다 — 호출자가 도메인 뮤테이션과 함께 commit하므로
감사 기록은 대상 액션과 **원자적으로** 지속된다(뮤테이션이 롤백되면 감사도 롤백).

감사 대상 액션 어휘(tables.AuditLog 도크스트링과 일치):
- seat_assigned / seat_unassigned
- meeting_created / meeting_cancelled
- kpi_adjusted / kpi_finalized / kpi_objection_submitted
- office_layout_deployed
(recording_started/stopped 는 LiveKit 런타임 부재로 환경차단 — G011 B-03/B-09, 여기서 미배선)

JSON(JSONB) 직렬화 안전을 위해 old_value/new_value 딕셔너리에는 원시 JSON 타입만 담는다:
Decimal/datetime/UUID/Enum 은 호출부에서 float/isoformat 문자열/str/.value 로 변환한다.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import Request

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import AuditLog


def record_audit(
    db: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: Any,
    user_id: Optional[int] = None,
    old_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    request: Optional[Request] = None,
) -> AuditLog:
    """감사 로그를 현재 세션에 add(stage)한다. commit은 호출자 책임.

    반환값은 stage된 ``AuditLog`` 인스턴스(테스트/후속 참조용). ``entity_id`` 는
    항상 문자열로 정규화한다(모델 컬럼 String(255)).
    """
    if request is not None:
        if ip_address is None:
            ip_address = request.client.host if request.client else None
        if user_agent is None:
            _ua = request.headers.get("user-agent")
            user_agent = _ua[:500] if _ua else None
    log = AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        old_value=old_value,
        new_value=new_value,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(log)
    return log
