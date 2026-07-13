from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ADMIN_ROLES, CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import (
    Meeting,
    MeetingParticipant,
    RecordingConsent,
    RecordingConsentType,
)

router = APIRouter(prefix="/api", tags=["consent"])

_ADMIN_ROLES = ADMIN_ROLES  # deps 단일 정의 (qa#17)


class ConsentIn(BaseModel):
    consent_type: RecordingConsentType
    granted: bool


class ConsentOut(BaseModel):
    meeting_id: str
    user_id: int
    consent_type: str
    granted: bool
    created_at: str


class ParticipantConsentOut(BaseModel):
    user_id: int
    recording: Optional[bool] = None
    stt: Optional[bool] = None
    recording_created_at: Optional[str] = None
    stt_created_at: Optional[str] = None


async def _get_meeting_or_404(meeting_id: str, db: AsyncSession) -> Meeting:
    try:
        mid = UUID(meeting_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid meeting_id",
        )
    result = await db.execute(select(Meeting).where(Meeting.id == mid))
    meeting = result.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="meeting_not_found",
        )
    return meeting


def _consent_out(consent: RecordingConsent) -> ConsentOut:
    return ConsentOut(
        meeting_id=str(consent.meeting_id),
        user_id=consent.user_id,
        consent_type=consent.consent_type.value,
        granted=consent.granted,
        created_at=consent.created_at.isoformat(),
    )


@router.post(
    "/meetings/{meeting_id}/consent",
    response_model=ConsentOut,
    status_code=status.HTTP_201_CREATED,
)
async def upsert_consent(
    meeting_id: str,
    body: ConsentIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ConsentOut:
    meeting = await _get_meeting_or_404(meeting_id, db)
    result = await db.execute(
        select(RecordingConsent).where(
            RecordingConsent.meeting_id == meeting.id,
            RecordingConsent.user_id == current_user.user_id,
            RecordingConsent.consent_type == body.consent_type,
        )
    )
    consent = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if consent is None:
        consent = RecordingConsent(
            meeting_id=meeting.id,
            user_id=current_user.user_id,
            consent_type=body.consent_type,
            granted=body.granted,
            created_at=now,
        )
        db.add(consent)
    else:
        consent.granted = body.granted
        consent.created_at = now

    await db.flush()
    await db.commit()
    await db.refresh(consent)
    return _consent_out(consent)


@router.get(
    "/meetings/{meeting_id}/consent",
    response_model=list[ParticipantConsentOut],
)
async def list_consent(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ParticipantConsentOut]:
    meeting = await _get_meeting_or_404(meeting_id, db)
    is_host_or_admin = current_user.role in _ADMIN_ROLES or meeting.host_user_id == current_user.user_id

    participants_result = await db.execute(
        select(MeetingParticipant.user_id)
        .where(MeetingParticipant.meeting_id == meeting.id)
        .order_by(MeetingParticipant.user_id)
    )
    participant_ids = list(participants_result.scalars().all())

    # D20-b: 참석자 본인은 자기 동의 상태를 조회할 수 있어야 함 (새로고침 후 배지 유지)
    if not is_host_or_admin:
        if current_user.user_id not in participant_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="insufficient_permissions",
            )
        participant_ids = [current_user.user_id]  # 본인 것만 반환
    if not participant_ids:
        return []

    consents_result = await db.execute(
        select(RecordingConsent).where(
            RecordingConsent.meeting_id == meeting.id,
            RecordingConsent.user_id.in_(participant_ids),
        )
    )
    by_user: dict[int, ParticipantConsentOut] = {
        user_id: ParticipantConsentOut(user_id=user_id) for user_id in participant_ids
    }
    for consent in consents_result.scalars().all():
        row = by_user[consent.user_id]
        match consent.consent_type:
            case RecordingConsentType.RECORDING:
                row.recording = consent.granted
                row.recording_created_at = consent.created_at.isoformat()
            case RecordingConsentType.STT:
                row.stt = consent.granted
                row.stt_created_at = consent.created_at.isoformat()
    return list(by_user.values())
