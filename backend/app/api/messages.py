"""
회의 채팅 메시지 API (P5-R3-T3).

- GET  /meetings/{meeting_id}/messages   메시지 목록(시간순)
- POST /meetings/{meeting_id}/messages   메시지 전송

경로 규약: root prefix 없음(meetings.py와 동일 계약, Caddy /api/*→/*, D21-r).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, get_current_user
from app.db import get_db
from app.models.tables import Meeting, Message

router = APIRouter(tags=["messages"])


class MessageCreate(BaseModel):
    content: str


def _out(m: Message) -> dict:
    return {
        "message_id": str(m.id),
        "meeting_id": str(m.meeting_id),
        "user_id": m.user_id,
        "content": m.content,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _parse(meeting_id: str) -> UUID:
    try:
        return UUID(meeting_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="meeting_not_found")


async def _meeting_or_404(db: AsyncSession, meeting_id: str) -> Meeting:
    m = await db.get(Meeting, _parse(meeting_id))
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="meeting_not_found")
    return m


@router.get("/meetings/{meeting_id}/messages")
async def list_messages(
    meeting_id: str,
    db: AsyncSession = Depends(get_db),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    m = await _meeting_or_404(db, meeting_id)
    rows = (
        await db.execute(
            select(Message).where(Message.meeting_id == m.id).order_by(Message.created_at)
        )
    ).scalars().all()
    return {"messages": [_out(r) for r in rows]}


@router.post("/meetings/{meeting_id}/messages", status_code=status.HTTP_201_CREATED)
async def create_message(
    meeting_id: str,
    body: MessageCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    m = await _meeting_or_404(db, meeting_id)
    if not body.content.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty_message")
    msg = Message(meeting_id=m.id, user_id=current_user.user_id, content=body.content)
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return _out(msg)
