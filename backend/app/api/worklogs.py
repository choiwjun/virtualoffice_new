"""
업무기록(Work Log) API — D14 업무결과 충실도 기록.

@SPEC docs/planning/00-decisions.md D14(업무결과/충실도), D17(일일 마감 18:00 KST)
@SPEC docs/api/management-api.yaml /work-logs

경로 규약: 계약 테스트 경로(root prefix 없음, /work-logs). 외부 공개 시 Caddy /api/*→/* (D21-r).
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import WorkLog, WorkLogStatus

router = APIRouter(tags=["work-logs"])

# D17: 일일 마감 18:00 KST. 18:00 이후 활동은 익일 귀속.
KST = timezone(timedelta(hours=9))
_DAILY_CUTOFF_HOUR = 18
_ADMIN_ROLES = ("admin", "super_admin")


def work_log_date_for(now_utc: datetime) -> date:
    """D17 일일 마감 규칙: KST 기준 18:00 이후 활동은 익일 업무일로 귀속."""
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    kst = now_utc.astimezone(KST)
    day = kst.date()
    if kst.hour >= _DAILY_CUTOFF_HOUR:
        day = day + timedelta(days=1)
    return day


# ── 스키마 ────────────────────────────────────────────────
class WorkLogCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: str
    goal: Optional[str] = None
    # 계약 어휘 'result' 와 OpenAPI 'result_description' 둘 다 수용(드롭 방지) → 모델 result_description.
    result_description: Optional[str] = Field(
        default=None, validation_alias=AliasChoices("result_description", "result")
    )
    result_url: Optional[str] = None
    next_action: Optional[str] = None
    category: Optional[str] = None
    related_project: Optional[str] = None
    url: Optional[str] = None
    est_minutes: Optional[int] = None
    actual_minutes: Optional[int] = None
    status: WorkLogStatus = WorkLogStatus.STARTED
    work_date: Optional[date] = None


class WorkLogUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: Optional[str] = None
    goal: Optional[str] = None
    result_description: Optional[str] = Field(
        default=None, validation_alias=AliasChoices("result_description", "result")
    )
    result_url: Optional[str] = None
    next_action: Optional[str] = None
    category: Optional[str] = None
    related_project: Optional[str] = None
    url: Optional[str] = None
    est_minutes: Optional[int] = None
    actual_minutes: Optional[int] = None
    status: Optional[WorkLogStatus] = None


def _work_log_out(wl: WorkLog) -> dict:
    return {
        "work_log_id": str(wl.id),
        "user_id": wl.user_id,
        "work_date": wl.work_date.isoformat() if wl.work_date else None,
        "title": wl.title,
        "goal": wl.goal,
        "result": wl.result_description,
        "result_description": wl.result_description,
        "result_url": wl.result_url,
        "next_action": wl.next_action,
        "category": wl.category,
        "related_project": wl.related_project,
        "url": wl.url,
        "est_minutes": wl.est_minutes,
        "actual_minutes": wl.actual_minutes,
        "status": wl.status.value,
    }


def _parse_work_log_id(work_log_id: str) -> UUID:
    """수동 UUID 파싱: 타입검증 422 대신 404로 통일(계약)."""
    try:
        return UUID(work_log_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="work_log_not_found")


async def _get_work_log(db: AsyncSession, work_log_id: str) -> WorkLog:
    parsed = _parse_work_log_id(work_log_id)
    wl = await db.get(WorkLog, parsed)
    if wl is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="work_log_not_found")
    return wl


def _parse_period(period: str) -> tuple[date, date]:
    """'YYYY-MM' → [해당 월 1일, 다음 달 1일) 반개구간."""
    try:
        year_s, month_s = period.split("-")
        year, month = int(year_s), int(month_s)
        start = date(year, month, 1)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_period")
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


@router.post("/work-logs", status_code=status.HTTP_201_CREATED)
async def create_work_log(
    body: WorkLogCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if body.work_date is not None:
        # 04-data-model.md:976 앱 레이어 규칙: 사용자 지정 work_date의 미래 날짜 금지.
        today_kst = datetime.now(timezone.utc).astimezone(KST).date()
        if body.work_date > today_kst:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="work_date_in_future")
        work_date = body.work_date
    else:
        # 미지정 시 D17 마감 컷오프로 산출(18:00 KST 이후 익일 귀속) — 시스템 산출값은 미래검증 예외.
        work_date = work_log_date_for(datetime.now(timezone.utc))
    wl = WorkLog(
        user_id=current_user.user_id,
        work_date=work_date,
        title=body.title,
        goal=body.goal,
        result_description=body.result_description,
        result_url=body.result_url,
        next_action=body.next_action,
        category=body.category,
        related_project=body.related_project,
        url=body.url,
        est_minutes=body.est_minutes,
        actual_minutes=body.actual_minutes,
        status=body.status,
    )
    db.add(wl)
    await db.commit()
    await db.refresh(wl)
    return _work_log_out(wl)


@router.get("/work-logs")
async def list_work_logs(
    period: Optional[str] = Query(default=None),
    user_id: Optional[int] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    is_admin = current_user.role in _ADMIN_ROLES
    # RBAC: 관리자만 타인 기록 조회 가능. 그 외는 본인 기록만.
    if user_id is not None and user_id != current_user.user_id and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
    target_user = user_id if user_id is not None else current_user.user_id

    stmt = select(WorkLog).where(WorkLog.user_id == target_user)
    if period is not None:
        start, end = _parse_period(period)
        stmt = stmt.where(WorkLog.work_date >= start, WorkLog.work_date < end)
    stmt = stmt.order_by(WorkLog.work_date.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return {"work_logs": [_work_log_out(w) for w in rows]}


@router.get("/work-logs/{work_log_id}")
async def get_work_log(
    work_log_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    wl = await _get_work_log(db, work_log_id)
    if wl.user_id != current_user.user_id and current_user.role not in _ADMIN_ROLES:
        # 존재 미노출: 타인 기록 접근은 404로 통일.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="work_log_not_found")
    return _work_log_out(wl)


@router.put("/work-logs/{work_log_id}")
async def update_work_log(
    work_log_id: str,
    body: WorkLogUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    wl = await _get_work_log(db, work_log_id)
    # 수정 권한: 작성자 본인만(D18 근거 무결성). 그 외 403.
    if wl.user_id != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_author")

    if body.title is not None:
        wl.title = body.title
    if body.goal is not None:
        wl.goal = body.goal
    if body.result_description is not None:
        wl.result_description = body.result_description
    if body.result_url is not None:
        wl.result_url = body.result_url
    if body.next_action is not None:
        wl.next_action = body.next_action
    if body.category is not None:
        wl.category = body.category
    if body.related_project is not None:
        wl.related_project = body.related_project
    if body.url is not None:
        wl.url = body.url
    if body.est_minutes is not None:
        wl.est_minutes = body.est_minutes
    if body.actual_minutes is not None:
        wl.actual_minutes = body.actual_minutes
    if body.status is not None:
        wl.status = body.status

    await db.commit()
    await db.refresh(wl)
    return _work_log_out(wl)


@router.delete("/work-logs/{work_log_id}")
async def delete_work_log(
    work_log_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    wl = await _get_work_log(db, work_log_id)
    # 삭제 권한: 작성자 본인 또는 관리자.
    if wl.user_id != current_user.user_id and current_user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
    await db.delete(wl)
    await db.commit()
    return {"status": "deleted"}
