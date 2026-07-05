"""
KPI 평가 API (G008) — 조회, 관리자 조정, 확정, 이의신청.

@SPEC docs/planning/00-decisions.md D14(KPI 로직), D14-e(결정론 점수), D15(이의신청), D16(롱포맷 스키마)
@SPEC docs/planning/08-kpi-logic.md
@SPEC docs/api/management-api.yaml (KPI 평가 섹션) — 경로는 모델/스토리 정본 우선(아래 참고)

경로 규약(계약 테스트 기준, root prefix 없음 — meetings.py/worklogs.py와 동일 이탈 근거,
외부 공개 시 Caddy /api/*→/*, D21-r):
- GET  /kpi-results                       목록(필터: user_id, period, period_type, period_key, metric)
- GET  /kpi-results/{id}                  상세
- PUT  /kpi-results/{id}/adjust           관리자 조정
- POST /kpi-results/{id}/confirm          확정 (관리자)
- POST /kpi-results/{id}/objections       이의신청 제출 (본인만)
- GET  /kpi-results/{id}/ai-draft         AI 초안 조회
- GET  /kpi/metrics                       metric 어휘사전(8개)
- POST /kpi/aggregate                     분기 집계 (관리자 동기 트리거, D14-e/D16/D17) — 실 cron 상시발화·ERP push는 환경차단(G011)

**이의신청 상태머신 설계 근거 (D15, 모델 4상태: none/submitted/reviewing/resolved)**:
이 스토리의 엔드포인트 목록에는 별도 "재검토 시작"/"재검토 완료" 액션이 없다(계약 #8 aggregate
제외 나머지 7개 한정). 계약 #11(test_kpi_objection_workflow)이 none→submitted→reviewing→resolved
4단계 전이를 모두 요구하므로, 이미 존재하는 관리자 액션(adjust/confirm)에 상태 전이를 위임한다:
  - submit(POST objections):      none      → submitted (직원 본인)
  - adjust(PUT .../adjust):       submitted → reviewing  (관리자가 점수를 재검토·조정하는 행위 자체가
                                                            "재검토 착수"의 자연스러운 신호)
  - confirm(POST .../confirm):    submitted|reviewing → resolved (확정 시점에 미해결 이의신청을
                                                            관리자 검토 완료로 간주해 함께 종결)
새 엔드포인트를 늘리지 않고도 4상태 전이를 모두 커버하며, 각 전이가 실제 관리자 행위(조정/확정)와
1:1 대응해 감사 추적이 단순해진다.
"""

import logging
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.models.tables import (
    ActionItem,
    ErpUser,
    KpiObjectionStatus,
    KpiPeriodType,
    KpiResult,
    KpiSource,
    MeetingMinute,
    WorkLog,
)
from app.services.kpi_scoring import (
    METRIC_VOCABULARY,
    aggregate_user_period,
    period_key_to_range,
)
from app.services.audit_service import record_audit
from app.services.kpi_push import push_confirmed_kpi_to_erp
from app.services.notification_service import record_notification

router = APIRouter(tags=["kpi"])

logger = logging.getLogger(__name__)

_ADMIN_ROLES = ("admin", "super_admin")
# D15: 평가 공개 후 이의신청 유예기간. kpi_result에 별도 published_at 컬럼이 없어(04-data-model.md
# 정본 스키마에 미포함) created_at(레코드 생성 = 평가 산출/공개 시점 대용)을 기준시각으로 삼는다.
_OBJECTION_GRACE_DAYS = 7


# ── 스키마 ────────────────────────────────────────────────
class AdjustRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    admin_adjusted_score: Decimal
    admin_note: Optional[str] = None


class ObjectionSubmitRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    category: str
    text: str
    evidence: Optional[str] = None


def _kpi_result_out(kr: KpiResult) -> dict:
    return {
        "kpi_result_id": str(kr.id),
        "user_id": kr.user_id,
        "period_type": kr.period_type.value,
        "period_key": kr.period_key,
        "metric": kr.metric,
        "value": float(kr.value),
        "unit": kr.unit,
        "source": kr.source.value,
        "ai_draft": kr.ai_draft,
        "ai_draft_generated_at": kr.ai_draft_generated_at.isoformat() if kr.ai_draft_generated_at else None,
        "ai_model": kr.ai_model,
        "admin_adjusted_score": float(kr.admin_adjusted_score) if kr.admin_adjusted_score is not None else None,
        "admin_note": kr.admin_note,
        "admin_user_id": kr.admin_user_id,
        "admin_reviewed_at": kr.admin_reviewed_at.isoformat() if kr.admin_reviewed_at else None,
        "objection_status": kr.objection_status.value,
        "objection_detail": kr.objection_detail,
        "objection_submitted_at": kr.objection_submitted_at.isoformat() if kr.objection_submitted_at else None,
        "objection_resolved_at": kr.objection_resolved_at.isoformat() if kr.objection_resolved_at else None,
        "final_score": float(kr.final_score) if kr.final_score is not None else None,
        "finalized_at": kr.finalized_at.isoformat() if kr.finalized_at else None,
        "note": kr.note,
        "pushed_to_erp": kr.pushed_to_erp,
        "pushed_at": kr.pushed_at.isoformat() if kr.pushed_at else None,
    }


def _parse_kpi_result_id(kpi_result_id: str) -> UUID:
    """수동 UUID 파싱: 타입검증 422 대신 404로 통일(계약, meetings.py/worklogs.py와 동일)."""
    try:
        return UUID(kpi_result_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="kpi_result_not_found")


async def _get_kpi_result(db: AsyncSession, kpi_result_id: str) -> KpiResult:
    parsed = _parse_kpi_result_id(kpi_result_id)
    kr = await db.get(KpiResult, parsed)
    if kr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="kpi_result_not_found")
    return kr


async def _team_user_ids(db: AsyncSession, team_id: Optional[int]) -> list[int]:
    if team_id is None:
        return []
    rows = (
        await db.execute(select(ErpUser.id).where(ErpUser.erp_team_id == team_id))
    ).scalars().all()
    return list(rows)


async def _authorize_read(db: AsyncSession, kr: KpiResult, current_user: CurrentUser) -> None:
    """조회 RBAC: employee 본인 / leader 팀 / admin 전체. 위반 시 404(존재 미노출)."""
    if current_user.role in _ADMIN_ROLES:
        return
    if kr.user_id == current_user.user_id:
        return
    if current_user.role == "leader":
        team_ids = await _team_user_ids(db, current_user.team_id)
        if kr.user_id in team_ids:
            return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="kpi_result_not_found")


def _parse_period(period: str) -> tuple[KpiPeriodType, str]:
    """'YYYY-Q#' → quarterly, 'YYYY-MM-DD' → daily. 그 외 400."""
    if "-Q" in period:
        return KpiPeriodType.QUARTERLY, period
    try:
        datetime.strptime(period, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_period")
    return KpiPeriodType.DAILY, period


# ── 목록/상세 ─────────────────────────────────────────────
@router.get("/kpi-results")
async def list_kpi_results(
    period: Optional[str] = Query(default=None),
    period_type: Optional[KpiPeriodType] = Query(default=None),
    period_key: Optional[str] = Query(default=None),
    metric: Optional[str] = Query(default=None),
    user_id: Optional[int] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    is_admin = current_user.role in _ADMIN_ROLES
    is_leader = current_user.role == "leader"

    if user_id is not None and user_id != current_user.user_id and not is_admin:
        if not (is_leader and user_id in await _team_user_ids(db, current_user.team_id)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")

    stmt = select(KpiResult)
    if user_id is not None:
        stmt = stmt.where(KpiResult.user_id == user_id)
    elif is_admin:
        pass  # 전체 조회 허용
    elif is_leader:
        team_ids = await _team_user_ids(db, current_user.team_id)
        stmt = stmt.where(KpiResult.user_id.in_(team_ids or [-1]))
    else:
        stmt = stmt.where(KpiResult.user_id == current_user.user_id)

    if period is not None:
        p_type, p_key = _parse_period(period)
        stmt = stmt.where(KpiResult.period_type == p_type, KpiResult.period_key == p_key)
    if period_type is not None:
        stmt = stmt.where(KpiResult.period_type == period_type)
    if period_key is not None:
        stmt = stmt.where(KpiResult.period_key == period_key)
    if metric is not None:
        stmt = stmt.where(KpiResult.metric == metric)

    rows = (await db.execute(stmt)).scalars().all()
    return {"kpi_results": [_kpi_result_out(kr) for kr in rows], "total": len(rows)}


@router.get("/kpi-results/{kpi_result_id}")
async def get_kpi_result(
    kpi_result_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    kr = await _get_kpi_result(db, kpi_result_id)
    await _authorize_read(db, kr, current_user)
    return _kpi_result_out(kr)


# ── 관리자 조정/확정 ──────────────────────────────────────
@router.put("/kpi-results/{kpi_result_id}/adjust")
async def adjust_kpi_result(
    kpi_result_id: str,
    body: AdjustRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_role("admin", "super_admin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    kr = await _get_kpi_result(db, kpi_result_id)
    prev_adjusted_score = kr.admin_adjusted_score

    # 확정 후 조정 차단(D15): 값 괴리 방지 — 재조정이 필요하면 재확정 없이는 불가능.
    if kr.finalized_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="kpi_already_finalized")

    if body.admin_adjusted_score < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_adjusted_score")

    now = datetime.now(timezone.utc)

    kr.admin_adjusted_score = body.admin_adjusted_score
    kr.admin_note = body.admin_note
    kr.admin_user_id = current_user.user_id
    kr.admin_reviewed_at = now

    # D15 상태머신: 이의신청이 제출된 상태에서 관리자가 조정을 검토하면 "재검토 중"으로 전이.
    if kr.objection_status == KpiObjectionStatus.SUBMITTED:
        kr.objection_status = KpiObjectionStatus.REVIEWING

    record_audit(
        db,
        action="kpi_adjusted",
        entity_type="kpi_result",
        entity_id=kr.id,
        user_id=current_user.user_id,
        old_value={
            "admin_adjusted_score": float(prev_adjusted_score)
            if prev_adjusted_score is not None
            else None
        },
        new_value={
            "admin_adjusted_score": float(body.admin_adjusted_score),
            "objection_status": kr.objection_status.value,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(kr)
    return _kpi_result_out(kr)


@router.post("/kpi-results/{kpi_result_id}/confirm")
async def confirm_kpi_result(
    kpi_result_id: str,
    request: Request,
    current_user: CurrentUser = Depends(require_role("admin", "super_admin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    kr = await _get_kpi_result(db, kpi_result_id)

    # 멱등: 이미 확정된 결과를 다시 confirm해도 200 (재확정으로 값이 바뀌지 않음).
    if kr.finalized_at is not None:
        return _kpi_result_out(kr)

    now = datetime.now(timezone.utc)

    # D15: 미검토(submitted) 이의신청은 확정을 막는다 — 관리자가 먼저 adjust로 재검토(reviewing)에
    # 착수해야 확정 가능(submit → adjust(reviewing) → confirm(resolved) 순서 강제).
    if kr.objection_status == KpiObjectionStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="objection_pending_review")

    # reviewing(관리자가 이미 재검토 착수)이면 확정 시점에 검토 완료로 간주해 종결.
    if kr.objection_status == KpiObjectionStatus.REVIEWING:
        kr.objection_status = KpiObjectionStatus.RESOLVED
        kr.objection_resolved_at = now

    kr.admin_user_id = current_user.user_id
    kr.admin_reviewed_at = now
    kr.final_score = kr.admin_adjusted_score if kr.admin_adjusted_score is not None else kr.value
    kr.finalized_at = now

    record_audit(
        db,
        action="kpi_finalized",
        entity_type="kpi_result",
        entity_id=kr.id,
        user_id=current_user.user_id,
        new_value={
            "final_score": float(kr.final_score) if kr.final_score is not None else None,
            "objection_status": kr.objection_status.value,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(kr)

    # D17: kpi_erp_push_enabled가 True면 확정 직후 best-effort로 backfill을 시도한다.
    # 실패해도 confirm 자체는 이미 커밋되어 있으므로 API 응답에 영향을 주지 않는다(다음 backfill
    # 실행에서 pushed_to_erp=False인 채로 재시도됨 — 멱등).
    if settings.kpi_erp_push_enabled:
        try:
            await push_confirmed_kpi_to_erp(db)
            await db.commit()
            await db.refresh(kr)
        except Exception as exc:  # noqa: BLE001 - 푸시 실패는 confirm 응답을 막지 않는다.
            logger.warning("confirm_kpi_result: ERP push backfill 실패(non-fatal)", exc_info=True)
            # P7-R3-T3: 실패 관측 — 푸시 트랜잭션 롤백 후 별도로 알림 적재(confirm은 이미 커밋됨).
            try:
                await db.rollback()
                await record_notification(
                    db,
                    category="kpi_push_failure",
                    severity="error",
                    title="KPI ERP push 실패",
                    message=str(exc),
                    context={"kpi_result_id": str(kr.id)},
                )
                await db.commit()
            except Exception:  # noqa: BLE001
                logger.warning("confirm_kpi_result: 실패 알림 적재 실패(non-fatal)", exc_info=True)

    return _kpi_result_out(kr)


# ── 이의신청 ──────────────────────────────────────────────
@router.post("/kpi-results/{kpi_result_id}/objections", status_code=status.HTTP_201_CREATED)
async def submit_kpi_objection(
    kpi_result_id: str,
    body: ObjectionSubmitRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    kr = await _get_kpi_result(db, kpi_result_id)
    if kr.user_id != current_user.user_id:
        # 본인만 제출 가능. 존재 자체는 이미 알려주지 않는 편이 안전하나(worklogs.py 패턴은 404),
        # 이의신청은 "본인 소유 자원에 대한 권한 없음"이 명확한 액션이라 403으로 의도를 드러낸다.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_owner")

    if kr.objection_status != KpiObjectionStatus.NONE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="objection_already_submitted")

    # D15 유예기간: 공개(대용: created_at) 후 7일 초과 시 신규 제출 거부.
    # SQLite(테스트)는 DateTime(timezone=True)여도 round-trip 시 tzinfo를 보존하지 않아
    # naive datetime으로 돌아올 수 있음 → 비교 전 UTC로 정규화(meetings.py _ensure_utc와 동일 패턴).
    created_at = kr.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    deadline = created_at + timedelta(days=_OBJECTION_GRACE_DAYS)
    now = datetime.now(timezone.utc)
    if deadline < now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="objection_grace_period_expired")

    kr.objection_status = KpiObjectionStatus.SUBMITTED
    kr.objection_submitted_at = now
    kr.objection_detail = {
        "category": body.category,
        "text": body.text,
        "evidence": body.evidence,
        "submitted_at": now.isoformat(),
    }

    record_audit(
        db,
        action="kpi_objection_submitted",
        entity_type="kpi_result",
        entity_id=kr.id,
        user_id=current_user.user_id,
        new_value={
            "category": body.category,
            "objection_status": KpiObjectionStatus.SUBMITTED.value,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(kr)
    return _kpi_result_out(kr)


@router.get("/kpi-results/{kpi_result_id}/ai-draft")
async def get_kpi_ai_draft(
    kpi_result_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    kr = await _get_kpi_result(db, kpi_result_id)
    await _authorize_read(db, kr, current_user)
    return {
        "ai_draft": kr.ai_draft,
        "ai_draft_generated_at": kr.ai_draft_generated_at.isoformat() if kr.ai_draft_generated_at else None,
        "ai_model": kr.ai_model,
    }


# ── 메트릭 어휘/집계 ──────────────────────────────────────
@router.get("/kpi/metrics")
async def list_kpi_metric_vocabulary(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return {"metrics": list(METRIC_VOCABULARY)}


async def _period_participant_ids(
    db: AsyncSession, period_type: KpiPeriodType, period_key: str
) -> list[int]:
    """지정 기간에 KPI 신호(work_log/meeting_minute/action_item)가 있는 사용자 id 집합.

    created_at 계열은 반개구간 [start, end+1일)로, work_date/due_date(Date)는 폐구간 [start, end]으로
    비교한다(aggregate_user_period와 동일 규약).
    """
    start, end = period_key_to_range(period_type, period_key)
    end_exclusive = datetime.combine(end + timedelta(days=1), time.min)
    ids: set[int] = set()
    ids.update(
        (
            await db.execute(
                select(WorkLog.user_id).distinct().where(
                    WorkLog.work_date >= start, WorkLog.work_date <= end
                )
            )
        ).scalars().all()
    )
    ids.update(
        (
            await db.execute(
                select(MeetingMinute.created_by).distinct().where(
                    MeetingMinute.created_at >= start,
                    MeetingMinute.created_at < end_exclusive,
                )
            )
        ).scalars().all()
    )
    ids.update(
        (
            await db.execute(
                select(ActionItem.assignee_user_id).distinct().where(
                    ActionItem.due_date >= start, ActionItem.due_date <= end
                )
            )
        ).scalars().all()
    )
    ids.discard(None)
    return sorted(ids)


@router.post("/kpi/aggregate")
async def trigger_kpi_aggregate(
    period: Optional[str] = Query(default=None),
    current_user: CurrentUser = Depends(require_role("admin", "super_admin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    분기별 KPI 집계 (관리자 동기 트리거, D14-e/D16/D17).

    지정 분기(period=YYYY-Q#)에 KPI 신호가 있는 사용자별로 결정론 metric(1~7)을
    aggregate_user_period로 산출해 quarterly KpiResult(metric 롱포맷)를 멱등 upsert한다
    (uq_kpi_result_metric 기준: 재호출 시 값만 갱신, 행 중복 없음).

    범위: 실 cron 스케줄 상시 발화(18:00/21:00/매시/00:00 KST)는 환경차단(G011 B-16)이며 이
    엔드포인트는 admin 동기 트리거만 제공한다. quarterly_total(metric #8)은 compute_kpi_metrics
    범위 밖이라 여기서도 산출하지 않는다. ERP push(pushed_to_erp)는 B-12/B-19(ERP 라이브 DB) 환경차단.
    """
    if not period:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period_required")
    period_type, period_key = _parse_period(period)
    if period_type != KpiPeriodType.QUARTERLY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="quarterly_period_required"
        )
    try:
        # 유효 분기 검증(예: 2026-Q9·malformed → 400, period_key_to_range ValueError 500 누출 방지)
        period_key_to_range(period_type, period_key)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_period")

    user_ids = await _period_participant_ids(db, period_type, period_key)
    aggregated_users = 0
    aggregated_metrics = 0
    for uid in user_ids:
        metrics = await aggregate_user_period(db, uid, period_type, period_key)
        for metric, value in metrics.items():
            existing = (
                await db.execute(
                    select(KpiResult).where(
                        KpiResult.user_id == uid,
                        KpiResult.period_type == period_type,
                        KpiResult.period_key == period_key,
                        KpiResult.metric == metric,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                # 확정된 평가 행(D15)은 잠금 — 재집계로 value를 덮어쓰지 않는다(값 괴리 방지).
                if existing.finalized_at is not None:
                    continue
                existing.value = value
            else:
                db.add(
                    KpiResult(
                        user_id=uid,
                        period_type=period_type,
                        period_key=period_key,
                        metric=metric,
                        value=value,
                        source=KpiSource.VIRTUAL_OFFICE,
                    )
                )
            aggregated_metrics += 1
        aggregated_users += 1

    await db.commit()
    return {
        "status": "completed",
        "period": period,
        "period_type": period_type.value,
        "period_key": period_key,
        "aggregated_users": aggregated_users,
        "aggregated_metrics": aggregated_metrics,
    }
