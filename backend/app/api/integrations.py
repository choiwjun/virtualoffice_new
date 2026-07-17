"""
본인 외부 계정 연동 (D31 — opt-in, KPI 화면 §개인 연동).

GET    /api/integrations                  — 내 연동 목록
PUT    /api/integrations/{provider}       — 연동/갱신 (계정 실검증 + 초기 활동 동기화)
POST   /api/integrations/{provider}/sync  — 활동 재동기화
DELETE /api/integrations/{provider}       — 연동 해제

원칙:
- 항상 본인 것만 (user_id = 토큰 sub). 타인 조회 API 없음 — 개인 연동은 본인 화면 전용.
- access_token은 응답에 절대 포함하지 않는다(has_token만).
- 활동 요약은 표시용 — KPI 정량식(08 §1.2) 미반영.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import IntegrationProvider, UserIntegration
from app.services import integrations as svc
from app.services.integrations import IntegrationError

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


class IntegrationOut(BaseModel):
    provider: str
    account: str
    verified: bool
    has_token: bool
    last_synced_at: Optional[str]
    activity: Optional[dict[str, Any]]
    connected_at: Optional[str]


class IntegrationUpsert(BaseModel):
    account: str = Field(..., min_length=1, max_length=255)
    token: Optional[str] = Field(None, max_length=512, description="개인 액세스 토큰(선택, figma는 검증에 필수)")


def _to_out(row: UserIntegration) -> IntegrationOut:
    return IntegrationOut(
        provider=row.provider.value,
        account=row.account,
        verified=row.verified,
        has_token=bool(row.access_token),
        last_synced_at=row.last_synced_at.isoformat() if row.last_synced_at else None,
        activity=row.activity,
        connected_at=row.created_at.isoformat() if row.created_at else None,
    )


def _provider_or_404(provider: str) -> IntegrationProvider:
    try:
        return IntegrationProvider(provider)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown provider: {provider} (github|figma)",
        )


async def _get_row(
    db: AsyncSession, user_id: int, provider: IntegrationProvider
) -> Optional[UserIntegration]:
    return (
        await db.execute(
            select(UserIntegration).where(
                UserIntegration.user_id == user_id,
                UserIntegration.provider == provider,
            )
        )
    ).scalar_one_or_none()


async def _sync_activity(row: UserIntegration) -> None:
    """공급자별 활동 수집 → row.activity/last_synced_at 갱신. 실패는 IntegrationError로 전파."""
    if row.provider == IntegrationProvider.GITHUB:
        row.activity = await svc.fetch_github_activity(row.account, row.access_token)
    else:  # FIGMA — 토큰 없으면 수집 불가(연동 상태만 유지)
        if not row.access_token:
            return
        row.activity = await svc.fetch_figma_activity(row.access_token)
    row.last_synced_at = datetime.now(timezone.utc)


@router.get("", response_model=list[IntegrationOut])
async def list_my_integrations(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[IntegrationOut]:
    """GET /api/integrations — 내 연동 목록(본인 전용)."""
    rows = (
        await db.execute(
            select(UserIntegration).where(UserIntegration.user_id == current_user.user_id)
        )
    ).scalars().all()
    return [_to_out(r) for r in rows]


@router.put("/{provider}", response_model=IntegrationOut)
async def upsert_integration(
    provider: str,
    body: IntegrationUpsert,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IntegrationOut:
    """PUT /api/integrations/{provider} — 연동/갱신. 공급자 API로 실검증 후 저장 + 초기 동기화."""
    prov = _provider_or_404(provider)

    verified = False
    profile: Optional[dict[str, Any]] = None
    try:
        if prov == IntegrationProvider.GITHUB:
            profile = await svc.verify_github(body.account, body.token)
            verified = True
        elif body.token:  # FIGMA + 토큰 → 실검증
            profile = await svc.verify_figma(body.token)
            verified = True
        # FIGMA + 토큰 없음 → 검증 불가, 계정명만 저장(verified=False)
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    row = await _get_row(db, current_user.user_id, prov)
    if row is None:
        row = UserIntegration(user_id=current_user.user_id, provider=prov, account=body.account)
        db.add(row)
    row.account = (profile or {}).get("login") or (profile or {}).get("handle") or body.account
    if body.token is not None:
        row.access_token = body.token or None
    row.verified = verified

    if verified:
        try:
            await _sync_activity(row)
        except IntegrationError:
            pass  # 초기 동기화 실패는 연동 자체를 막지 않음(sync로 재시도)

    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.post("/{provider}/sync", response_model=IntegrationOut)
async def sync_integration(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IntegrationOut:
    """POST /api/integrations/{provider}/sync — 활동 재동기화."""
    prov = _provider_or_404(provider)
    row = await _get_row(db, current_user.user_id, prov)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration not connected")
    try:
        await _sync_activity(row)
    except IntegrationError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_integration(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """DELETE /api/integrations/{provider} — 연동 해제(토큰 포함 즉시 삭제)."""
    prov = _provider_or_404(provider)
    row = await _get_row(db, current_user.user_id, prov)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="integration not connected")
    await db.delete(row)
    await db.commit()
