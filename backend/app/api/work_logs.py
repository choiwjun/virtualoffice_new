"""
업무 로그 CRUD + 요약 API (운영 허브 Lane A, G001).

POST   /api/work-logs                   — 생성
GET    /api/work-logs                   — 목록 (본인 또는 관리자, 필터 지원)
GET    /api/work-logs/summary           — 기간·카테고리 집계
GET    /api/work-logs/{id}              — 단건
PATCH  /api/work-logs/{id}             — 수정 (completed 전이 시 completed_at 기록)
DELETE /api/work-logs/{id}             — 삭제 (정책: STARTED만 허용)

정책 정합:
- 04-data-model §2.3 WorkLog 스키마
- D14-a: status=completed가 KPI 산출 대상, result_url 충실도 반영
- D18: 완료 업무 로그는 KPI 평가 근거로 영구 보존 → DELETE 불허
- D19: UTC 저장
권한: 본인 CRUD, 관리자(role=admin/leader) 타인 조회.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import WorkLog, WorkLogStatus

router = APIRouter(prefix="/api", tags=["work-logs"])

ADMIN_ROLES = {"admin", "super_admin", "leader"}


# ---------------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------------

class WorkLogCreate(BaseModel):
    work_date: date
    title: str
    status: WorkLogStatus = WorkLogStatus.STARTED
    user_id: Optional[int] = None           # 관리자만 타인 지정 가능
    category: Optional[str] = None
    goal: Optional[str] = None
    est_minutes: Optional[int] = None
    actual_minutes: Optional[int] = None
    result_url: Optional[str] = None
    next_action: Optional[str] = None
    result_description: Optional[str] = None
    related_project: Optional[str] = None
    url: Optional[str] = None


class WorkLogUpdate(BaseModel):
    title: Optional[str] = None
    work_date: Optional[date] = None
    category: Optional[str] = None
    goal: Optional[str] = None
    est_minutes: Optional[int] = None
    actual_minutes: Optional[int] = None
    result_url: Optional[str] = None
    next_action: Optional[str] = None
    status: Optional[WorkLogStatus] = None
    result_description: Optional[str] = None
    related_project: Optional[str] = None
    url: Optional[str] = None


class WorkLogOut(BaseModel):
    id: str
    user_id: int
    work_date: date
    category: Optional[str]
    title: str
    goal: Optional[str]
    est_minutes: Optional[int]
    actual_minutes: Optional[int]
    status: str
    result_url: Optional[str]
    next_action: Optional[str]
    result_description: Optional[str]
    related_project: Optional[str]
    url: Optional[str]
    completed_at: Optional[str]
    created_at: str
    updated_at: str

    @classmethod
    def from_orm(cls, w: WorkLog) -> "WorkLogOut":
        return cls(
            id=str(w.id),
            user_id=w.user_id,
            work_date=w.work_date,
            category=w.category,
            title=w.title,
            goal=w.goal,
            est_minutes=w.est_minutes,
            actual_minutes=w.actual_minutes,
            status=w.status.value,
            result_url=w.result_url,
            next_action=w.next_action,
            result_description=w.result_description,
            related_project=w.related_project,
            url=w.url,
            completed_at=w.completed_at.isoformat() if w.completed_at else None,
            created_at=w.created_at.isoformat(),
            updated_at=w.updated_at.isoformat(),
        )


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

async def _get_or_404(db: AsyncSession, work_log_id: str) -> WorkLog:
    try:
        uid = UUID(work_log_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid work_log_id",
        )
    result = await db.execute(select(WorkLog).where(WorkLog.id == uid))
    wl = result.scalar_one_or_none()
    if wl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="work_log_not_found",
        )
    return wl


def _check_read_permission(current_user: CurrentUser, wl: WorkLog) -> None:
    """본인 또는 관리자만 조회."""
    if wl.user_id != current_user.user_id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient_permissions",
        )


def _check_own_or_admin(current_user: CurrentUser, wl: WorkLog) -> None:
    """본인 또는 관리자만 수정/삭제."""
    if wl.user_id != current_user.user_id and current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient_permissions",
        )


def _period_key(d: date, period_type: str) -> str:
    """날짜를 집계 기간 키로 변환."""
    if period_type == "daily":
        return d.strftime("%Y-%m-%d")
    elif period_type == "weekly":
        iso = d.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    elif period_type == "monthly":
        return d.strftime("%Y-%m")
    elif period_type == "yearly":
        return d.strftime("%Y")
    return d.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# 엔드포인트 (순서 중요: /summary는 /{id} 앞에 선언)
# ---------------------------------------------------------------------------

@router.post(
    "/work-logs",
    response_model=WorkLogOut,
    status_code=status.HTTP_201_CREATED,
    summary="업무 로그 생성",
)
async def create_work_log(
    body: WorkLogCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkLogOut:
    """POST /api/work-logs — 업무 로그 생성.

    - user_id 미지정: 현재 사용자 소유.
    - user_id 타인 지정: 관리자(admin/leader)만 허용.
    - status=completed로 생성 시 completed_at 자동 기록 (D14-a).
    """
    # 대상 사용자 결정
    if body.user_id is not None and body.user_id != current_user.user_id:
        if current_user.role not in ADMIN_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="insufficient_permissions",
            )
        target_uid = body.user_id
    else:
        target_uid = current_user.user_id

    now = datetime.now(timezone.utc)
    completed_at: Optional[datetime] = now if body.status == WorkLogStatus.COMPLETED else None

    wl = WorkLog(
        user_id=target_uid,
        work_date=body.work_date,
        category=body.category,
        title=body.title,
        goal=body.goal,
        est_minutes=body.est_minutes,
        actual_minutes=body.actual_minutes,
        status=body.status,
        result_url=body.result_url,
        next_action=body.next_action,
        result_description=body.result_description,
        related_project=body.related_project,
        url=body.url,
        completed_at=completed_at,
    )
    db.add(wl)
    await db.flush()
    await db.commit()
    await db.refresh(wl)
    return WorkLogOut.from_orm(wl)


@router.get(
    "/work-logs/summary",
    summary="업무 로그 기간·카테고리 집계",
)
async def get_work_log_summary(
    period_type: str = Query("monthly", description="daily | weekly | monthly | yearly"),
    start_date: Optional[date] = Query(None, description="조회 시작일 (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="조회 종료일 (YYYY-MM-DD)"),
    user_id: Optional[int] = Query(None, description="관리자만 타인 조회 가능"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """GET /api/work-logs/summary — 기간 daily/weekly/monthly/yearly + 카테고리 분포 집계."""
    if period_type not in ("daily", "weekly", "monthly", "yearly"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid period_type: must be daily|weekly|monthly|yearly",
        )

    # 대상 사용자 결정
    if current_user.role not in ADMIN_ROLES:
        if user_id is not None and user_id != current_user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")
        target_uid: Optional[int] = current_user.user_id
    else:
        target_uid = user_id  # None이면 전체 사용자

    q = select(WorkLog)
    if target_uid is not None:
        q = q.where(WorkLog.user_id == target_uid)
    if start_date:
        q = q.where(WorkLog.work_date >= start_date)
    if end_date:
        q = q.where(WorkLog.work_date <= end_date)
    q = q.order_by(WorkLog.work_date)

    result = await db.execute(q)
    logs = result.scalars().all()

    # 기간별 집계 (Python-level, SQLite/PostgreSQL 양쪽 호환)
    periods: dict[str, dict[str, Any]] = {}
    for wl in logs:
        pk = _period_key(wl.work_date, period_type)
        if pk not in periods:
            periods[pk] = {
                "period": pk,
                "total_count": 0,
                "completed_count": 0,
                "started_count": 0,
                "total_est_minutes": 0,
                "total_actual_minutes": 0,
                "categories": defaultdict(int),
            }
        p = periods[pk]
        p["total_count"] += 1
        if wl.status == WorkLogStatus.COMPLETED:
            p["completed_count"] += 1
        else:
            p["started_count"] += 1
        p["total_est_minutes"] += wl.est_minutes or 0
        p["total_actual_minutes"] += wl.actual_minutes or 0
        cat = wl.category or "uncategorized"
        p["categories"][cat] += 1

    # defaultdict → 일반 dict 직렬화
    result_periods = []
    for pk in sorted(periods.keys()):
        entry = dict(periods[pk])
        entry["categories"] = dict(entry["categories"])
        result_periods.append(entry)

    return {
        "period_type": period_type,
        "user_id": target_uid,
        "periods": result_periods,
    }


@router.get(
    "/work-logs",
    response_model=list[WorkLogOut],
    summary="업무 로그 목록",
)
async def list_work_logs(
    start_date: Optional[date] = Query(None, description="조회 시작일"),
    end_date: Optional[date] = Query(None, description="조회 종료일"),
    category: Optional[str] = Query(None, description="카테고리 필터"),
    status_filter: Optional[str] = Query(None, alias="status", description="started | completed"),
    user_id: Optional[int] = Query(None, description="관리자만 타인 조회 가능"),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WorkLogOut]:
    """GET /api/work-logs — 업무 로그 목록.

    - 비관리자: 본인 로그만 조회 (user_id 파라미터 무시하거나 본인만 허용).
    - 관리자(admin/leader): user_id 지정 시 해당 사용자, 미지정 시 전체.
    """
    if current_user.role not in ADMIN_ROLES:
        if user_id is not None and user_id != current_user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions")
        target_uid: Optional[int] = current_user.user_id
    else:
        target_uid = user_id  # None → 전체

    q = select(WorkLog)
    if target_uid is not None:
        q = q.where(WorkLog.user_id == target_uid)
    if start_date:
        q = q.where(WorkLog.work_date >= start_date)
    if end_date:
        q = q.where(WorkLog.work_date <= end_date)
    if category:
        q = q.where(WorkLog.category == category)
    if status_filter:
        try:
            s = WorkLogStatus(status_filter)
            q = q.where(WorkLog.status == s)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invalid status: must be started|completed",
            )

    q = q.order_by(WorkLog.work_date.desc(), WorkLog.created_at.desc())
    result = await db.execute(q)
    logs = result.scalars().all()
    return [WorkLogOut.from_orm(wl) for wl in logs]


@router.get(
    "/work-logs/{work_log_id}",
    response_model=WorkLogOut,
    summary="업무 로그 단건 조회",
)
async def get_work_log(
    work_log_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkLogOut:
    """GET /api/work-logs/{id} — 단건 조회 (본인 또는 관리자)."""
    wl = await _get_or_404(db, work_log_id)
    _check_read_permission(current_user, wl)
    return WorkLogOut.from_orm(wl)


@router.patch(
    "/work-logs/{work_log_id}",
    response_model=WorkLogOut,
    summary="업무 로그 수정",
)
async def update_work_log(
    work_log_id: str,
    body: WorkLogUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkLogOut:
    """PATCH /api/work-logs/{id} — 필드 수정.

    - completed 전이 시 completed_at 자동 기록 (D14-a).
    - started로 역전환 시 completed_at 초기화.
    """
    wl = await _get_or_404(db, work_log_id)
    _check_own_or_admin(current_user, wl)

    update_data = body.model_dump(exclude_unset=True)
    prev_status = wl.status

    for field, val in update_data.items():
        setattr(wl, field, val)

    # completed 전이 감지
    if "status" in update_data:
        new_status = wl.status  # 이미 setattr 적용됨
        if new_status == WorkLogStatus.COMPLETED and prev_status != WorkLogStatus.COMPLETED:
            wl.completed_at = datetime.now(timezone.utc)
        elif new_status != WorkLogStatus.COMPLETED:
            # 완료 취소 → completed_at 초기화
            wl.completed_at = None

    await db.flush()
    await db.commit()
    await db.refresh(wl)
    return WorkLogOut.from_orm(wl)


@router.delete(
    "/work-logs/{work_log_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="업무 로그 삭제",
)
async def delete_work_log(
    work_log_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """DELETE /api/work-logs/{id} — 삭제.

    정책 결정:
    - STARTED(미완료) 로그: 삭제 허용 (초안 정리 목적).
    - COMPLETED 로그: 삭제 불허 (409). D14-a에 따라 완료 업무는 KPI 산출
      근거이며 D18(평가 근거 영구 보존) 원칙상 제거할 수 없음.
    - 권한: 본인 또는 관리자(admin/leader). 관리자도 완료 로그 삭제 불가.
    """
    wl = await _get_or_404(db, work_log_id)
    _check_own_or_admin(current_user, wl)

    if wl.status == WorkLogStatus.COMPLETED:
        # D14-a / D18: 완료 업무 로그는 KPI 산출 근거 — 영구 보존 원칙 위반 방지
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="cannot_delete_completed_work_log",
        )

    await db.delete(wl)
    await db.commit()
