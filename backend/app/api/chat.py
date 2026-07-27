"""
커뮤니케이션(채널 채팅) API (06-screens 좌내비 '커뮤니케이션').

GET  /api/chat/channels   — 내가 참여 가능한 채널 목록
GET  /api/chat/messages   — 채널 메시지 조회 (폴링: after 커서 지원)
POST /api/chat/messages   — 채널 메시지 전송

스코프 (06-screens §2: 본격 채팅은 P7 고도화 — MVP는 채널 메시지 + 폴링):
- 채널 키 파생: 'general'(전사) | 'team:{erp_team_id}'(소속 팀) | 'dm:{작은id}-{큰id}'(1:1)
- 접근: general=전 직원, team:{id}=해당 팀원 또는 admin/super_admin, dm=**당사자 2인만**

DM 설계 노트:
- 채널 id는 두 user_id를 정렬해 만든다 → A→B와 B→A가 같은 채널로 수렴(중복 대화 방지).
- **admin도 열람 불가.** 팀 채널은 감독 목적으로 admin을 허용하지만 1:1 대화는 사적 통신이라
  같은 규칙을 적용하면 사찰이 된다. 당사자만 통과시킨다.
- 거리 제약 없음 — 채팅은 비동기라 "가까이 가야 말 건다"가 오히려 방해다.
  (통화는 반대로 근접 5m 제약 — realtime OfficeRoom이 강제한다.)
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

from app.core.deps import (
    ADMIN_ROLES as _DEPS_ADMIN_ROLES,
    CurrentUser,
    company_scope,
    get_current_user,
)
from app.db import get_db
from app.models.tables import ChatMessage, ErpUser

router = APIRouter(prefix="/api", tags=["chat"])

ADMIN_ROLES = _DEPS_ADMIN_ROLES  # deps 단일 정의 (qa#17)

GENERAL_CHANNEL = "general"
TEAM_PREFIX = "team:"
DM_PREFIX = "dm:"
MAX_CONTENT_LEN = 2000


def dm_channel(a: int, b: int) -> str:
    """두 사용자의 1:1 채널 id. 정렬해서 만들기 때문에 A→B와 B→A가 같은 채널이 된다."""
    lo, hi = (a, b) if a <= b else (b, a)
    return f"{DM_PREFIX}{lo}-{hi}"


def dm_members(channel: str) -> Optional[tuple[int, int]]:
    """'dm:1-2' → (1, 2). 형식이 아니면 None."""
    if not channel.startswith(DM_PREFIX):
        return None
    raw = channel[len(DM_PREFIX):]
    parts = raw.split("-")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        return None
    return int(parts[0]), int(parts[1])


# ---------------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------------

class ChannelOut(BaseModel):
    id: str
    label: str
    kind: str = "channel"
    """'channel' | 'dm' — 프론트가 목록에서 1:1 대화를 구분해 표시한다."""
    peer_user_id: Optional[int] = None
    """dm일 때 상대방 user_id (아바타·프로필 연결용)."""


class DmOpenRequest(BaseModel):
    user_id: int


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
    """채널 접근 권한: general=전 직원, team:{id}=팀원 또는 admin, dm=당사자 2인만."""
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
    if channel.startswith(DM_PREFIX):
        members = dm_members(channel)
        if members is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_channel")
        # admin 예외 없음 — 1:1 대화는 사적 통신이라 감독 권한으로 열람하면 사찰이 된다.
        if current_user.user_id not in members:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_channel_member")
        return
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
    db: AsyncSession = Depends(get_db),
    cid: int = Depends(company_scope),
) -> list[ChannelOut]:
    """GET /api/chat/channels — general + 소속 팀 채널 + 내가 참여한 1:1 대화.

    팀명 전용 테이블 부재(directory.py: erp_team_id 파생) → 라벨은 '팀 채널'로 고정.
    DM은 메시지가 오간 채널만 나온다(빈 대화는 목록을 어지럽힌다 — 열면 그때 생긴다).
    """
    channels = [ChannelOut(id=GENERAL_CHANNEL, label="전체")]
    if current_user.team_id is not None:
        channels.append(ChannelOut(id=f"{TEAM_PREFIX}{current_user.team_id}", label="팀 채널"))

    # 내가 속한 dm 채널 = 채널명에 내 id가 들어간 것. 메시지가 있는 것만 수집한다.
    rows = (
        await db.execute(
            select(ChatMessage.channel)
            .where(ChatMessage.company_id == cid, ChatMessage.channel.startswith(DM_PREFIX))
            .distinct()
        )
    ).scalars().all()
    peers: list[int] = []
    for ch in rows:
        m = dm_members(ch)
        if m and current_user.user_id in m:
            peers.append(m[0] if m[1] == current_user.user_id else m[1])
    if peers:
        names = {
            u.id: u.name
            for u in (
                await db.execute(select(ErpUser).where(ErpUser.id.in_(peers)))
            ).scalars().all()
        }
        for pid in sorted(set(peers)):
            channels.append(
                ChannelOut(
                    id=dm_channel(current_user.user_id, pid),
                    label=names.get(pid, f"user {pid}"),
                    kind="dm",
                    peer_user_id=pid,
                )
            )
    return channels


@router.post("/chat/dm", response_model=ChannelOut, summary="1:1 대화 열기")
async def open_dm(
    body: DmOpenRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cid: int = Depends(company_scope),
) -> ChannelOut:
    """POST /api/chat/dm — 상대 user_id로 1:1 채널을 연다(없으면 채널 id만 확정, 행 생성 없음).

    같은 회사의 활성 사용자여야 한다 — 타사 사용자와의 대화는 테넌트 경계를 넘는다.
    본인과의 대화는 막는다(메모장 용도는 별개 기능).
    """
    if body.user_id == current_user.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot_dm_self")
    peer = (
        await db.execute(
            select(ErpUser).where(
                ErpUser.id == body.user_id,
                ErpUser.company_id == cid,
                ErpUser.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if peer is None:
        # 타사·비활성·미존재를 동일 응답으로 — 사용자 존재 여부 탐색을 막는다.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="employee_not_found")
    return ChannelOut(
        id=dm_channel(current_user.user_id, peer.id),
        label=peer.name,
        kind="dm",
        peer_user_id=peer.id,
    )


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
    cid: int = Depends(company_scope),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """GET /api/chat/messages — 최신 limit개(시간 오름차순, 테넌트 스코프). after 지정 시 증분 조회."""
    _check_channel_access(current_user, channel)

    q = (
        select(ChatMessage, ErpUser)
        .outerjoin(ErpUser, ChatMessage.user_id == ErpUser.id)
        .where(ChatMessage.company_id == cid, ChatMessage.channel == channel)
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
    cid: int = Depends(company_scope),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    """POST /api/chat/messages — 채널에 메시지 전송 (본인 명의). company_id=호출자 테넌트."""
    _check_channel_access(current_user, body.channel)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty_content")

    msg = ChatMessage(
        id=uuid4(),
        company_id=cid,
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
