"""첫실행 온보딩 상태 — Phase 5 (24-spec Phase 5 · 23 E6).

- GET   /api/onboarding    첫실행 상태 (인증)
- PATCH /api/onboarding    체크리스트 숨김(admin, 회사 단위) · 투어 완료(본인)

## 왜 체크리스트를 저장하지 않는가
"좌석 배치함"을 플래그로 저장하면 좌석을 다 지워도 true가 남는다. 세 항목 모두 **조회
시점에 실측**해서 파생한다. 저장하는 건 사람의 의사표시(`dismissed`·`tour_completed`)뿐이다.

부수 효과로 **이미 셋업된 기존 회사는 체크리스트가 자동으로 숨는다** — 좌석·공지·인원이
이미 있어 세 항목이 전부 true이기 때문이다(스테일 유도 없음).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ADMIN_ROLES, CurrentUser, company_scope, get_current_user
from app.db import get_db
from app.models.tables import AuthToken, Company, ErpUser, Notice, Seat

router = APIRouter(prefix="/api", tags=["onboarding"])


class ChecklistOut(BaseModel):
    seat_placed: bool
    """좌석 배치 — 회사에 좌석이 하나라도 있는가."""
    notice_posted: bool
    """공지 작성 — 회사 공지가 하나라도 있는가."""
    team_invited: bool
    """팀 초대 — 자기 말고 다른 활성 멤버가 있거나, 초대 링크를 발급한 적이 있는가."""


class OnboardingOut(BaseModel):
    checklist: ChecklistOut
    completed: bool
    """세 항목 전부 완료."""
    dismissed: bool
    """admin이 체크리스트를 접었는가 (회사 단위)."""
    tour_done: bool
    """본인이 최초 투어를 봤는가 (유저 단위)."""
    can_manage: bool
    """체크리스트를 보여줄 대상인가 — 일반 직원에게는 무의미하므로 admin만 true."""


class OnboardingPatch(BaseModel):
    dismissed: Optional[bool] = None
    tour_done: Optional[bool] = None


async def _count(db: AsyncSession, model, *conditions) -> int:
    return (
        await db.execute(select(func.count()).select_from(model).where(*conditions))
    ).scalar_one()


async def _build(db: AsyncSession, user: CurrentUser, cid: int) -> OnboardingOut:
    company = (await db.execute(select(Company).where(Company.id == cid))).scalar_one_or_none()
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="company_not_found")

    seat_placed = await _count(db, Seat, Seat.company_id == cid) > 0
    # 공지는 soft-delete(D18)라 지워진 것도 행은 남는다. 체크리스트는 "지금 사무실이 갖춰졌나"를
    # 말하므로 **살아 있는 공지**만 센다 — 지웠다면 항목도 다시 풀려야 한다.
    notice_posted = (
        await _count(db, Notice, Notice.company_id == cid, Notice.is_active.is_(True)) > 0
    )

    active_members = await _count(
        db, ErpUser, ErpUser.company_id == cid, ErpUser.is_active.is_(True)
    )
    # 초대 링크를 발급했다면 아직 수락 전이어도 "초대했다"로 본다 — 사람을 부른 행위는 끝났다.
    invites_issued = await _count(db, AuthToken, AuthToken.company_id == cid) > 0
    team_invited = active_members > 1 or invites_issued

    checklist = ChecklistOut(
        seat_placed=seat_placed, notice_posted=notice_posted, team_invited=team_invited
    )
    me = (await db.execute(select(ErpUser).where(ErpUser.id == user.user_id))).scalar_one_or_none()

    return OnboardingOut(
        checklist=checklist,
        completed=seat_placed and notice_posted and team_invited,
        dismissed=bool(company.onboarding_dismissed),
        tour_done=bool(me.tour_completed) if me is not None else False,
        can_manage=user.role in ADMIN_ROLES,
    )


@router.get("/onboarding", response_model=OnboardingOut)
async def get_onboarding(
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    cid: int = Depends(company_scope),
) -> OnboardingOut:
    """첫실행 상태. 전 역할이 호출한다(투어는 전원 1회, 체크리스트는 admin만 노출)."""
    return await _build(db, user, cid)


@router.patch("/onboarding", response_model=OnboardingOut)
async def update_onboarding(
    body: OnboardingPatch,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    cid: int = Depends(company_scope),
) -> OnboardingOut:
    """체크리스트 숨김(admin) · 투어 완료 표시(본인).

    `dismissed`는 회사 전체 admin이 공유하는 상태라 admin만 바꿀 수 있다.
    `tour_done`은 본인 것이므로 전 역할이 바꾼다.
    """
    if body.dismissed is not None:
        if user.role not in ADMIN_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="insufficient_permissions"
            )
        company = (await db.execute(select(Company).where(Company.id == cid))).scalar_one_or_none()
        if company is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="company_not_found")
        company.onboarding_dismissed = body.dismissed

    if body.tour_done is not None:
        me = (
            await db.execute(select(ErpUser).where(ErpUser.id == user.user_id))
        ).scalar_one_or_none()
        if me is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
        me.tour_completed = body.tour_done

    await db.commit()
    return await _build(db, user, cid)
