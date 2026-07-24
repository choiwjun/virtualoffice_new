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

권한 (06 §3.10 접근 매트릭스, rbac.yaml 정본):
  - compute/finalize: admin | super_admin
  - adjust: admin | super_admin | leader(자기 팀 한정)
  - objections-review: admin | super_admin (08 §7.1: 최종 확정=관리자 — resolve가 확정을 수행하므로 leader ✗)
  - objections(접수): 본인(employee)
  - GET: 본인 or admin/super_admin/leader(자기 팀 한정)
  - leader 팀 스코프는 평가 기간 실소속(user_team_history) 기준 (08 §5.4)

정책 (08 §3.2·§3.3):
  - 조정은 원점수(value) 대비 ±10% 범위 + 조정사유 ≥30자 (백엔드 강제)
  - 이의신청은 공개(admin_reviewed_at ?? created_at) 후 7일 내, 확정 전에만 접수
  - resolve 시 final_score·finalized_at 확정 + ERP push 적재(재조정=재push)
  - 무이의 7일 경과 자동확정은 scheduler의 kpi_auto_finalize 잡이 수행
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

from app.core.deps import (
    ADMIN_ROLES,
    MANAGER_ROLES,
    CurrentUser,
    assert_same_company,
    company_scope,
    get_current_user,
)
from app.db import get_db
from app.models.tables import (
    DailyStatusPush,
    DailyStatusPushStatus,
    DailyStatusPushTarget,
    ErpUser,
    KpiObjectionStatus,
    KpiResult,
    UserTeamHistory,
)
from app.services.kpi_engine import _parse_period, compute_and_upsert_kpi
from app.services.audit import record_audit

router = APIRouter(prefix="/api/kpi-results", tags=["kpi"])

_ADMIN_ONLY = set(ADMIN_ROLES)                          # compute/finalize (06 §3.10: 확정=admin)
_MANAGER_ROLES = set(MANAGER_ROLES)                     # 조회/조정 (leader=팀 한정. 이의검토는 admin 전용)

# 이의신청 창 (08 §3.3: 공개 후 7일)
OBJECTION_WINDOW_DAYS = 7
# 이의신청 카테고리 (08 §3.3 제출 형식)
OBJECTION_CATEGORIES = {"score_basis", "missing_signal", "data_error"}


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
    admin_adjusted_score: float = Field(..., description="관리자 조정 점수 (원점수 ±10% 이내)")
    admin_note: str = Field(..., min_length=30, description="조정 사유 (08 §3.2: 필수 ≥30자)")


class FinalizeRequest(BaseModel):
    pass  # 별도 입력 없음: final_score = admin_adjusted_score ?? value


class EvidenceItem(BaseModel):
    type: str = Field("link", max_length=20)
    url: str = Field(..., max_length=1000)


class ObjectionRequest(BaseModel):
    category: str = Field(..., description="score_basis | missing_signal | data_error (08 §3.3)")
    text: str = Field(..., min_length=10, description="이의신청 내용")
    evidence: Optional[list[EvidenceItem]] = Field(None, description="증거 [{type,url}] (08 §3.3)")


class ObjectionReviewRequest(BaseModel):
    action: str = Field(..., description="'advance' → reviewing, 'resolve' → resolved")
    note: Optional[str] = Field(None, description="처리 메모")
    revised_score: Optional[float] = Field(None, description="재조정 점수 (선택)")


# ──────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ──────────────────────────────────────────────────────────────────────────────

async def _get_result_or_404(db: AsyncSession, result_id: str, user: CurrentUser) -> KpiResult:
    try:
        uid = UUID(result_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    r = await db.get(KpiResult, uid)
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")
    # 타사 평가 결과는 404(존재 은닉, Phase 1c · 22 T0-1 IDOR 차단)
    assert_same_company(user, r.company_id)
    return r


def _check_admin_only(user: CurrentUser) -> None:
    """compute/finalize — admin/super_admin 전용 (06 §3.10: 확정에 leader ✗)."""
    if user.role not in _ADMIN_ONLY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")


def _check_manager(user: CurrentUser) -> None:
    if user.role not in _MANAGER_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")


async def _leader_team_id(db: AsyncSession, user: CurrentUser) -> Optional[int]:
    """leader의 현재 팀 — DB 우선(토큰 team_id는 로그인 시점 고정이라 스테일 가능), 미존재 시 토큰 폴백."""
    row = await db.get(ErpUser, user.user_id)
    if row is not None and row.erp_team_id is not None:
        return row.erp_team_id
    return user.team_id


async def _check_team_scope(
    db: AsyncSession,
    user: CurrentUser,
    target_user_id: int,
    result: Optional[KpiResult] = None,
) -> None:
    """
    leader 팀 스코프 검사 (06 §3.10).

    - result 제공 시: 평가 기간 실소속(user_team_history) 기준 (08 §5.4) —
      대상자가 해당 평가 기간에 leader의 팀에 소속했어야 접근 허용.
      이력 미적재(0행) 환경은 현재 소속(erp_team_id) 폴백.
    - result 미제공(목록 조회 등): 현재 소속 기준.
    """
    if user.role in _ADMIN_ONLY or target_user_id == user.user_id:
        return
    if user.role != "leader":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")

    leader_team = await _leader_team_id(db, user)
    if leader_team is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="team_scope_violation")

    if result is not None:
        try:
            period_type = result.period_type.value if hasattr(result.period_type, "value") else result.period_type
            start, end = _parse_period(period_type, result.period_key)
        except ValueError:
            start = end = None  # 기간 해석 불가 → 현재 소속 폴백
        if start is not None:
            rows = await db.execute(
                select(UserTeamHistory).where(UserTeamHistory.user_id == target_user_id)
            )
            hist = rows.scalars().all()
            if hist:
                start_dt = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
                end_dt = datetime(end.year, end.month, end.day, 23, 59, 59, tzinfo=timezone.utc)
                overlapping = [
                    h for h in hist
                    if _as_utc(h.valid_from) <= end_dt
                    and (h.valid_to is None or _as_utc(h.valid_to) >= start_dt)
                ]
                if any(h.erp_team_id == leader_team for h in overlapping):
                    return
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="team_scope_violation"
                )

    # 현재 소속 폴백 (목록 조회·이력 미적재·기간 해석 불가)
    target = await db.get(ErpUser, target_user_id)
    if target is None or target.erp_team_id != leader_team:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="team_scope_violation")


def _as_utc(dt: datetime) -> datetime:
    """SQLite naive datetime → UTC aware."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _published_at(r: KpiResult) -> datetime:
    """이의신청 창 기산점 = 공개 시점 근사(admin_reviewed_at ?? created_at) — 08 §3.3."""
    return _as_utc(r.admin_reviewed_at or r.created_at)


def _queue_erp_push(db: AsyncSession, r: KpiResult, now: datetime) -> None:
    """확정 점수 ERP push 적재 (D15: 실전송 제외). 재확정 시 재호출=재push(upsert)."""
    db.add(DailyStatusPush(
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
        status=DailyStatusPushStatus.PENDING,
    ))


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
    _check_admin_only(user)

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
    cid: int = Depends(company_scope),
) -> list[KpiResultOut]:
    """
    GET /api/kpi-results — D16 라우팅 (테넌트 스코프):
      - 본인: 자신의 kpi_result만 조회
      - admin/super_admin: user_id 파라미터로 타인 조회 가능(자사 한정)
      - leader: 자기 팀 소속만 타인 조회 가능 (06 §3.10)
    """
    if user.role in _MANAGER_ROLES:
        target_user_id = user_id if user_id is not None else user.user_id
        await _check_team_scope(db, user, target_user_id)
    else:
        # 일반 직원: 본인 것만
        if user_id is not None and user_id != user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
        target_user_id = user.user_id

    # 테넌트 스코프 필터 — 타사 롤업 누출 차단 (Phase 1c · 22 T0-1)
    stmt = select(KpiResult).where(
        KpiResult.company_id == cid,
        KpiResult.user_id == target_user_id,
    )
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
    """GET /api/kpi-results/{id} — 단건 조회 (본인 또는 관리자, leader=팀 한정)."""
    r = await _get_result_or_404(db, result_id, user)
    if r.user_id != user.user_id:
        _check_manager(user)
        await _check_team_scope(db, user, r.user_id, result=r)
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

    - 원점수(value) 대비 ±10% 범위만 허용 (08 §3.2, 백분율 단일 기준)
    - 조정 사유 ≥30자 필수, leader는 자기 팀만
    - admin_adjusted_score 설정. 미조정 시 NULL → value가 유효.
    """
    _check_manager(user)
    r = await _get_result_or_404(db, result_id, user)
    await _check_team_scope(db, user, r.user_id, result=r)

    if r.finalized_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="already_finalized")

    # ±10% 강제 (원점수 0이면 조정 불가 — 0의 ±10%는 0)
    base = float(r.value)
    lo, hi = min(base * 0.9, base * 1.1), max(base * 0.9, base * 1.1)
    if not (lo <= body.admin_adjusted_score <= hi):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="adjusted_score_out_of_range",  # 08 §3.2: value ±10%
        )

    old_value = {
        "admin_adjusted_score": float(r.admin_adjusted_score) if r.admin_adjusted_score is not None else None,
        "value": base,
    }
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
        old_value=old_value,
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

    - admin/super_admin 전용 (06 §3.10)
    - 이의신청 진행 중(submitted/reviewing)이면 409 — resolve로만 확정 가능 (08 §3.3)
    """
    _check_admin_only(user)
    r = await _get_result_or_404(db, result_id, user)

    if r.finalized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_finalized",
        )

    obj_status = r.objection_status.value if hasattr(r.objection_status, "value") else r.objection_status
    if obj_status in ("submitted", "reviewing"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="objection_in_progress")

    now = datetime.now(timezone.utc)
    # final_score = admin_adjusted_score ?? value
    r.final_score = r.admin_adjusted_score if r.admin_adjusted_score is not None else r.value
    r.finalized_at = now
    r.updated_at = now

    _queue_erp_push(db, r, now)  # D15: 실전송 제외 pending 적재

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

    08 §3.3 상태머신 정방향:
    - 본인만 접수 가능
    - 공개(admin_reviewed_at ?? created_at) 후 7일 내, **확정 전**에만 접수
    - objection_status = none → submitted
    """
    r = await _get_result_or_404(db, result_id, user)

    # 본인 확인
    if r.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")

    # 카테고리 검증 (08 §3.3 제출 형식)
    if body.category not in OBJECTION_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="invalid_objection_category",  # score_basis | missing_signal | data_error
        )

    # 확정 후에는 접수 불가 (스펙: 공개 후 7일 창 → 무이의 시 자동확정)
    if r.finalized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="already_finalized",
        )

    # 7일 창 확인 — 기산점 = 공개 시점 (08 §3.3 "[평가 공개] … 공개 후 7일 이내")
    now = datetime.now(timezone.utc)
    deadline = _published_at(r) + timedelta(days=OBJECTION_WINDOW_DAYS)
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
        "kpi_result_id": str(r.id),
        "objection_category": body.category,
        "objection_text": body.text,
        "evidence": [e.model_dump() for e in body.evidence] if body.evidence else [],
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

    08 §3.3: resolve 시 final_score·finalized_at 확정 + ERP push 적재(재조정=재push).
    admin/super_admin 전용 (rbac.yaml·08 §7.1: 재검토·확정=관리자 —
    resolve가 final_score·finalized_at 확정을 수행하므로 leader 허용 시 확정 우회 경로가 됨).
    """
    _check_admin_only(user)
    r = await _get_result_or_404(db, result_id, user)

    now = datetime.now(timezone.utc)
    obj_status = r.objection_status
    if hasattr(obj_status, "value"):
        obj_status = obj_status.value

    old_value = {
        "objection_status": obj_status,
        "final_score": float(r.final_score) if r.final_score is not None else None,
    }

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

        # 재조정 점수 선택적 — ±10% 한도는 이의 재조정에도 동일 적용 (08 §3.2)
        if body.revised_score is not None:
            base = float(r.value)
            lo, hi = min(base * 0.9, base * 1.1), max(base * 0.9, base * 1.1)
            if not (lo <= body.revised_score <= hi):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="adjusted_score_out_of_range",
                )
            r.admin_adjusted_score = Decimal(str(body.revised_score))
            r.admin_user_id = user.user_id
            r.admin_reviewed_at = now
            if body.note:
                r.admin_note = body.note

        # 08 §3.3: resolved 시 final_score·finalized_at 확정 → push (정정 시 재push)
        r.final_score = r.admin_adjusted_score if r.admin_adjusted_score is not None else r.value
        r.finalized_at = now
        _queue_erp_push(db, r, now)

    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="action must be 'advance' or 'resolve'",
        )

    r.updated_at = now
    await db.commit()
    await db.refresh(r)
    await record_audit(
        db,
        user_id=user.user_id,
        action=f"kpi_objection_{body.action}",  # kpi_objection_advance | kpi_objection_resolve
        entity_type="kpi_result",
        entity_id=str(r.id),
        old_value=old_value,
        new_value={
            "objection_status": r.objection_status.value if hasattr(r.objection_status, "value") else r.objection_status,
            "final_score": float(r.final_score) if r.final_score is not None else None,
            "note": body.note,
        },
    )
    return _to_out(r)


class ObjectionOut(BaseModel):
    result_id: str
    metric: str
    period_type: str
    period_key: str
    objection_status: str
    category: Optional[str] = None
    text: Optional[str] = None
    evidence: Optional[list[dict]] = None
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
    """이의신청 내역 조회 (본인 또는 관리자, leader=팀 한정). 없으면 objection_status=none."""
    r = await _get_result_or_404(db, result_id, user)
    if r.user_id != user.user_id:
        _check_manager(user)
        await _check_team_scope(db, user, r.user_id)

    obj_status = r.objection_status.value if hasattr(r.objection_status, "value") else r.objection_status
    detail = r.objection_detail or {}
    # 구 포맷(category/text/evidence 문자열) 호환 폴백
    raw_evidence = detail.get("evidence")
    if isinstance(raw_evidence, str):
        raw_evidence = [{"type": "link", "url": raw_evidence}]
    return ObjectionOut(
        result_id=str(r.id),
        metric=r.metric,
        period_type=r.period_type.value if hasattr(r.period_type, "value") else r.period_type,
        period_key=r.period_key,
        objection_status=obj_status,
        category=detail.get("objection_category") or detail.get("category"),
        text=detail.get("objection_text") or detail.get("text"),
        evidence=raw_evidence,
        submitted_at=r.objection_submitted_at.isoformat() if r.objection_submitted_at else None,
        resolved_at=r.objection_resolved_at.isoformat() if r.objection_resolved_at else None,
        admin_note=r.admin_note,
        final_score=float(r.final_score) if r.final_score is not None else None,
    )
