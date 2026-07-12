"""
KPI 결과 API (Lane C — G003)

엔드포인트:
  POST /api/kpi-results/compute         — 관리자 수동 트리거
  GET  /api/kpi-results                 — 본인(self) 또는 관리자(all)
  GET  /api/kpi-results/{id}            — 단건 조회
  POST /api/kpi-results/{id}/adjust     — 관리자 점수 조정
  POST /api/kpi-results/{id}/finalize   — 확정 (final_score + daily_status_push 적재)
  POST /api/kpi-results/{id}/objections — 이의신청 접수
  POST /api/kpi-results/{id}/objections/review — 이의신청 검토·처리

권한:
  - compute/adjust/finalize/objections-review: admin | leader
  - objections(접수): 본인(employee)
  - GET: 본인 or admin/leader
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushStatus,
    DailyStatusPushTarget,
    KpiObjectionStatus,
    KpiResult,
)
from app.services.kpi_engine import compute_and_upsert_kpi
from app.services.audit import record_audit

router = APIRouter(prefix="/api/kpi-results", tags=["kpi"])

_ADMIN_ROLES = {"admin", "leader"}


# ──────────────────────────────────────────────────────────────────────────────
# 스키마
# ──────────────────────────────────────────────────────────────────────────────

class KpiResultOut(BaseModel):
    id: str
    user_id: int
    period_type: str
    period_key: str
    metric: str
    value: float
    unit: Optional[str]
    source: str
    ai_draft: Optional[Any]
    admin_adjusted_score: Optional[float]
    admin_note: Optional[str]
    admin_user_id: Optional[int]
    admin_reviewed_at: Optional[datetime]
    objection_status: str
    objection_detail: Optional[Any]
    objection_submitted_at: Optional[datetime]
    objection_resolved_at: Optional[datetime]
    final_score: Optional[float]
    finalized_at: Optional[datetime]
    note: Optional[str]
    pushed_to_erp: bool
    pushed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


def _to_out(r: KpiResult) -> KpiResultOut:
    return KpiResultOut(
        id=str(r.id),
        user_id=r.user_id,
        period_type=r.period_type.value if hasattr(r.period_type, "value") else r.period_type,
        period_key=r.period_key,
        metric=r.metric,
        value=float(r.value),
        unit=r.unit,
        source=r.source.value if hasattr(r.source, "value") else r.source,
        ai_draft=r.ai_draft,
        admin_adjusted_score=float(r.admin_adjusted_score) if r.admin_adjusted_score is not None else None,
        admin_note=r.admin_note,
        admin_user_id=r.admin_user_id,
        admin_reviewed_at=r.admin_reviewed_at,
        objection_status=r.objection_status.value if hasattr(r.objection_status, "value") else r.objection_status,
        objection_detail=r.objection_detail,
        objection_submitted_at=r.objection_submitted_at,
        objection_resolved_at=r.objection_resolved_at,
        final_score=float(r.final_score) if r.final_score is not None else None,
        finalized_at=r.finalized_at,
        note=r.note,
        pushed_to_erp=r.pushed_to_erp,
        pushed_at=r.pushed_at,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


class ComputeRequest(BaseModel):
    user_id: int
    period_type: str  # "daily" | "quarterly"
    period_key: str   # "2026-07-01" | "2026-Q3"


class ComputeResponse(BaseModel):
    computed: int
    results: list[KpiResultOut]


class AdjustRequest(BaseModel):
    admin_adjusted_score: float = Field(..., description="관리자 조정 점수")
    admin_note: str = Field(..., min_length=1, description="조정 사유 (≥30자 권장)")


class FinalizeRequest(BaseModel):
    pass  # 별도 입력 없음: final_score = admin_adjusted_score ?? value


class ObjectionRequest(BaseModel):
    category: str = Field(..., description="이의신청 카테고리")
    text: str = Field(..., min_length=10, description="이의신청 내용")
    evidence: Optional[str] = Field(None, description="증거/근거 링크")


class ObjectionReviewRequest(BaseModel):
    action: str = Field(..., description="'advance' → reviewing, 'resolve' → resolved")
    note: Optional[str] = Field(None, description="처리 메모")
    revised_score: Optional[float] = Field(None, description="재조정 점수 (선택)")


# ──────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ──────────────────────────────────────────────────────────────────────────────

async def _get_result_or_404(db: AsyncSession, result_id: str) -> KpiResult:
    try:
        uid = UUID(result_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    r = await db.get(KpiResult, uid)
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    return r


def _check_admin(user: CurrentUser) -> None:
    if user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")


# ──────────────────────────────────────────────────────────────────────────────
# 엔드포인트
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/compute", response_model=ComputeResponse, status_code=200)
async def compute_kpi_results(
    body: ComputeRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ComputeResponse:
    """
    POST /api/kpi-results/compute — 관리자 수동 KPI 계산 트리거.

    period_type: "daily" | "quarterly"
    period_key: "2026-07-01" | "2026-Q3"

    결정론적 엔진으로 계산 후 kpi_result 롱포맷 upsert.
    스케줄러(D17) 대체용 수동 엔드포인트.
    """
    _check_admin(user)

    if body.period_type not in ("daily", "quarterly"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="period_type must be 'daily' or 'quarterly'",
        )

    try:
        results = await compute_and_upsert_kpi(
            db, body.user_id, body.period_type, body.period_key
        )
        await db.commit()
        for r in results:
            await db.refresh(r)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    return ComputeResponse(computed=len(results), results=[_to_out(r) for r in results])


@router.get("", response_model=list[KpiResultOut])
async def list_kpi_results(
    user_id: Optional[int] = Query(None, description="대상 user_id (관리자 전용)"),
    period_type: Optional[str] = Query(None),
    period_key: Optional[str] = Query(None),
    metric: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[KpiResultOut]:
    """
    GET /api/kpi-results — D16 라우팅:
      - 본인: 자신의 kpi_result만 조회
      - 관리자(admin|leader): user_id 파라미터로 타인 조회 가능
    """
    if user.role in _ADMIN_ROLES:
        target_user_id = user_id if user_id is not None else user.user_id
    else:
        # 일반 직원: 본인 것만
        if user_id is not None and user_id != user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
        target_user_id = user.user_id

    stmt = select(KpiResult).where(KpiResult.user_id == target_user_id)
    if period_type:
        stmt = stmt.where(KpiResult.period_type == period_type)
    if period_key:
        stmt = stmt.where(KpiResult.period_key == period_key)
    if metric:
        stmt = stmt.where(KpiResult.metric == metric)

    result = await db.execute(stmt.order_by(KpiResult.period_key.desc(), KpiResult.metric))
    return [_to_out(r) for r in result.scalars().all()]


@router.get("/{result_id}", response_model=KpiResultOut)
async def get_kpi_result(
    result_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> KpiResultOut:
    """GET /api/kpi-results/{id} — 단건 조회."""
    r = await _get_result_or_404(db, result_id)
    if user.role not in _ADMIN_ROLES and r.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
    return _to_out(r)


@router.post("/{result_id}/adjust", response_model=KpiResultOut)
async def adjust_kpi_result(
    result_id: str,
    body: AdjustRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> KpiResultOut:
    """
    POST /api/kpi-results/{id}/adjust — 관리자 점수 조정.

    admin_adjusted_score 설정. 미조정 시 NULL → value가 유효.
    조정 시 audit_log 생성은 후속(현재는 admin_reviewed_at/admin_user_id로 추적).
    """
    _check_admin(user)
    r = await _get_result_or_404(db, result_id)

    r.admin_adjusted_score = Decimal(str(body.admin_adjusted_score))
    r.admin_note = body.admin_note
    r.admin_user_id = user.user_id
    r.admin_reviewed_at = datetime.now(timezone.utc)
    r.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(r)
    await record_audit(
        db,
        user_id=user.user_id,
        action="kpi_adjusted",
        entity_type="kpi_result",
        entity_id=str(r.id),
        new_value={"admin_adjusted_score": float(body.admin_adjusted_score), "admin_note": body.admin_note},
    )
    return _to_out(r)


@router.post("/{result_id}/finalize", response_model=KpiResultOut)
async def finalize_kpi_result(
    result_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> KpiResultOut:
    """
    POST /api/kpi-results/{id}/finalize — 확정.

    final_score = admin_adjusted_score ?? value
    finalized_at 설정.
    daily_status_push target=erp_kpi_results status=pending 적재 (실전송 제외 — D15).
    """
    _check_admin(user)
    r = await _get_result_or_404(db, result_id)

    if r.finalized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_finalized",
        )

    now = datetime.now(timezone.utc)
    # final_score = admin_adjusted_score ?? value
    r.final_score = r.admin_adjusted_score if r.admin_adjusted_score is not None else r.value
    r.finalized_at = now
    r.updated_at = now

    # D15: daily_status_push target=erp_kpi_results 적재 (실전송 제외)
    push = DailyStatusPush(
        user_id=r.user_id,
        push_date=now.date(),
        target=DailyStatusPushTarget.ERP_KPI_RESULTS,
        payload={
            "kpi_result_id": str(r.id),
            "user_id": r.user_id,
            "period_type": r.period_type.value if hasattr(r.period_type, "value") else r.period_type,
            "period_key": r.period_key,
            "metric": r.metric,
            "final_score": float(r.final_score),
            "finalized_at": now.isoformat(),
        },
        status=DailyStatusPushStatus.PENDING,  # 실전송은 feature-flag off
    )
    db.add(push)

    await db.commit()
    await db.refresh(r)
    await record_audit(
        db,
        user_id=user.user_id,
        action="kpi_finalized",
        entity_type="kpi_result",
        entity_id=str(r.id),
        new_value={"final_score": float(r.final_score)},
    )
    return _to_out(r)


@router.post("/{result_id}/objections", response_model=KpiResultOut)
async def submit_objection(
    result_id: str,
    body: ObjectionRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> KpiResultOut:
    """
    POST /api/kpi-results/{id}/objections — 이의신청 접수 (none → submitted).

    - 본인만 접수 가능
    - finalized_at 설정 후 7일 창 내에서만 접수
    - objection_status = none → submitted
    """
    r = await _get_result_or_404(db, result_id)

    # 본인 확인
    if r.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")

    # finalized_at 확인
    if r.finalized_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="not_finalized_yet",
        )

    # 7일 창 확인 (SQLite는 naive datetime 반환 → UTC로 처리)
    now = datetime.now(timezone.utc)
    finalized = r.finalized_at
    if finalized.tzinfo is None:
        finalized = finalized.replace(tzinfo=timezone.utc)
    deadline = finalized + timedelta(days=7)
    if now > deadline:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="objection_window_expired",
        )

    # 상태 확인
    obj_status = r.objection_status
    if hasattr(obj_status, "value"):
        obj_status = obj_status.value
    if obj_status != "none":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"objection already in state: {obj_status}",
        )

    r.objection_status = KpiObjectionStatus.SUBMITTED
    r.objection_submitted_at = now
    r.objection_detail = {
        "category": body.category,
        "text": body.text,
        "evidence": body.evidence,
        "submitted_at": now.isoformat(),
    }
    r.updated_at = now

    await db.commit()
    await db.refresh(r)
    await record_audit(
        db,
        user_id=user.user_id,
        action="kpi_objection_submitted",
        entity_type="kpi_result",
        entity_id=str(r.id),
        new_value={"category": body.category},
    )
    return _to_out(r)


@router.post("/{result_id}/objections/review", response_model=KpiResultOut)
async def review_objection(
    result_id: str,
    body: ObjectionReviewRequest,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> KpiResultOut:
    """
    POST /api/kpi-results/{id}/objections/review — 이의신청 검토·처리 (D15 상태머신).

    action = "advance": submitted → reviewing
    action = "resolve": reviewing → resolved (+ final_score 재조정 선택)
    """
    _check_admin(user)
    r = await _get_result_or_404(db, result_id)

    now = datetime.now(timezone.utc)
    obj_status = r.objection_status
    if hasattr(obj_status, "value"):
        obj_status = obj_status.value

    if body.action == "advance":
        if obj_status != "submitted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"cannot advance from state: {obj_status}",
            )
        r.objection_status = KpiObjectionStatus.REVIEWING

    elif body.action == "resolve":
        if obj_status != "reviewing":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"cannot resolve from state: {obj_status}",
            )
        r.objection_status = KpiObjectionStatus.RESOLVED
        r.objection_resolved_at = now

        # 재조정 점수 선택적
        if body.revised_score is not None:
            r.admin_adjusted_score = Decimal(str(body.revised_score))
            r.final_score = Decimal(str(body.revised_score))
            r.admin_user_id = user.user_id
            r.admin_reviewed_at = now
            if body.note:
                r.admin_note = body.note

    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="action must be 'advance' or 'resolve'",
        )

    r.updated_at = now
    await db.commit()
    await db.refresh(r)
    return _to_out(r)


class ObjectionOut(BaseModel):
    result_id: str
    metric: str
    period_type: str
    period_key: str
    objection_status: str
    category: Optional[str] = None
    text: Optional[str] = None
    evidence: Optional[str] = None
    submitted_at: Optional[str] = None
    resolved_at: Optional[str] = None
    admin_note: Optional[str] = None
    final_score: Optional[float] = None


@router.get("/{result_id}/objections", response_model=ObjectionOut)
async def get_objection(
    result_id: str,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ObjectionOut:
    """이의신청 내역 조회 (본인 또는 관리자). 없으면 objection_status=none."""
    r = await _get_result_or_404(db, result_id)
    if user.role not in _ADMIN_ROLES and r.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")

    obj_status = r.objection_status.value if hasattr(r.objection_status, "value") else r.objection_status
    detail = r.objection_detail or {}
    return ObjectionOut(
        result_id=str(r.id),
        metric=r.metric,
        period_type=r.period_type.value if hasattr(r.period_type, "value") else r.period_type,
        period_key=r.period_key,
        objection_status=obj_status,
        category=detail.get("category"),
        text=detail.get("text"),
        evidence=detail.get("evidence"),
        submitted_at=r.objection_submitted_at.isoformat() if r.objection_submitted_at else None,
        resolved_at=r.objection_resolved_at.isoformat() if r.objection_resolved_at else None,
        admin_note=r.admin_note,
        final_score=float(r.final_score) if r.final_score is not None else None,
    )
