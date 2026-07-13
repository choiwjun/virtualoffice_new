"""
커뮤니케이션(채널 채팅) API (06-screens 좌내비 '커뮤니케이션').

GET  /api/chat/channels   — 내가 참여 가능한 채널 목록
GET  /api/chat/messages   — 채널 메시지 조회 (폴링: after 커서 지원)
POST /api/chat/messages   — 채널 메시지 전송

스코프 (06-screens §2: 본격 채팅은 P7 고도화 — MVP는 채널 메시지 + 폴링):
- 채널 키 파생: 'general'(전사) | 'team:{erp_team_id}'(소속 팀)
- 접근: general=전 직원, team:{id}=해당 팀원 또는 admin/super_admin
- 메시지 불변(수정·삭제 없음), user_name은 erp_user LEFT JOIN (없으면 email/'user {id}' 폴백)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import ChatMessage, ErpUser

router = APIRouter(prefix="/api", tags=["chat"])

ADMIN_ROLES = {"admin", "super_admin"}

GENERAL_CHANNEL = "general"
TEAM_PREFIX = "team:"
MAX_CONTENT_LEN = 2000


# ---------------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------------

class ChannelOut(BaseModel):
    id: str
    label: str


class MessageCreate(BaseModel):
    channel: str = Field(min_length=1, max_length=50)
    content: str = Field(min_length=1, max_length=MAX_CONTENT_LEN)


class MessageOut(BaseModel):
    id: str
    channel: str
    user_id: int
    user_name: str
    content: str
    created_at: str


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _check_channel_access(current_user: CurrentUser, channel: str) -> None:
    """채널 접근 권한: general=전 직원, team:{id}=팀원 또는 admin/super_admin."""
    if channel == GENERAL_CHANNEL:
        return
    if channel.startswith(TEAM_PREFIX):
        raw = channel[len(TEAM_PREFIX):]
        if not raw.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_channel")
        if current_user.role in ADMIN_ROLES:
            return
        if current_user.team_id is not None and int(raw) == current_user.team_id:
            return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_channel_member")
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_channel")


def _display_name(user: Optional[ErpUser], user_id: int, email: Optional[str] = None) -> str:
    if user is not None and user.name:
        return user.name
    if email:
        return email.split("@")[0]
    return f"user {user_id}"


def _to_out(m: ChatMessage, user: Optional[ErpUser]) -> MessageOut:
    return MessageOut(
        id=str(m.id),
        channel=m.channel,
        user_id=m.user_id,
        user_name=_display_name(user, m.user_id),
        content=m.content,
        created_at=m.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# 엔드포인트
# ---------------------------------------------------------------------------

@router.get(
    "/chat/channels",
    response_model=list[ChannelOut],
    summary="참여 가능한 채널 목록",
)
async def list_channels(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ChannelOut]:
    """GET /api/chat/channels — general + 소속 팀 채널.

    팀명 전용 테이블 부재(directory.py: erp_team_id 파생) → 라벨은 '팀 채널'로 고정.
    """
    channels = [ChannelOut(id=GENERAL_CHANNEL, label="전체")]
    if current_user.team_id is not None:
        channels.append(ChannelOut(id=f"{TEAM_PREFIX}{current_user.team_id}", label="팀 채널"))
    return channels


@router.get(
    "/chat/messages",
    response_model=list[MessageOut],
    summary="채널 메시지 조회",
)
async def list_messages(
    channel: str = Query(..., min_length=1, max_length=50),
    after: Optional[str] = Query(None, description="이 ISO 시각 이후 메시지만 (폴링 커서)"),
    limit: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """GET /api/chat/messages — 최신 limit개(시간 오름차순). after 지정 시 증분 조회."""
    _check_channel_access(current_user, channel)

    q = (
        select(ChatMessage, ErpUser)
        .outerjoin(ErpUser, ChatMessage.user_id == ErpUser.id)
        .where(ChatMessage.channel == channel)
    )

    if after:
        try:
            after_dt = datetime.fromisoformat(after)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_after_cursor")
        if after_dt.tzinfo is None:
            after_dt = after_dt.replace(tzinfo=timezone.utc)
        q = q.where(ChatMessage.created_at > after_dt).order_by(ChatMessage.created_at.asc()).limit(limit)
        rows = (await db.execute(q)).all()
    else:
        # 최신 limit개를 desc로 뽑아 asc로 반환
        q = q.order_by(ChatMessage.created_at.desc()).limit(limit)
        rows = list(reversed((await db.execute(q)).all()))

    return [_to_out(m, u) for m, u in rows]


@router.post(
    "/chat/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="채널 메시지 전송",
)
async def create_message(
    body: MessageCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    """POST /api/chat/messages — 채널에 메시지 전송 (본인 명의)."""
    _check_channel_access(current_user, body.channel)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty_content")

    msg = ChatMessage(
        id=uuid4(),
        channel=body.channel,
        user_id=current_user.user_id,
        content=content,
        created_at=datetime.now(timezone.utc),
    )
    db.add(msg)
    await db.flush()
    await db.commit()
    await db.refresh(msg)

    r = await db.execute(select(ErpUser).where(ErpUser.id == current_user.user_id))
    user = r.scalar_one_or_none()
    out = _to_out(msg, user)
    if user is None and current_user.email:
        out.user_name = _display_name(None, current_user.user_id, current_user.email)
    return out
