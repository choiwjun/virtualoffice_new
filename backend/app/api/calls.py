"""1:1 화상 통화 — 즉석 호출 (09 §3.3 상호작용 · D24 LiveKit).

- POST /api/calls/token   상대와의 1:1 룸 접속 토큰 발급

## 회의(meeting)와 다른 점
회의는 "회의실을 예약하고 명시적으로 입장"하는 모델(D24)이다. 여기는 그 반대 — 옆자리
사람에게 말을 거는 즉석 호출이라 예약도 회의실도 없다. 그래서 `meeting` 행을 만들지 않고
두 사람으로만 결정되는 룸 이름을 쓴다.

## 권한 모델 (신규 테이블 없음)
룸 이름 `call:{작은id}-{큰id}`는 **참여자 2인을 그 자체로 인코딩**한다. 서버는 호출자를
토큰의 identity로 고정하고 상대 id로 룸 이름을 만들기 때문에, **자기가 참여자가 아닌 룸의
토큰은 애초에 발급될 수 없다**. 별도 세션 테이블이 필요 없는 이유다.

토큰만 받아 혼자 룸에 앉아 있는 건 가능하지만 아무것도 얻지 못한다 — 상대는 벨(realtime
`call_invite`)을 수락해야 들어온다. 그리고 **그 벨 경로가 근접 5m를 강제**한다
(realtime/OfficeRoom.handleCallRequest). 즉 "멀리서 몰래 통화 연결"은 성립하지 않는다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from livekit import api as livekit_api
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser, company_scope, get_current_user
from app.db import get_db
from app.models.tables import ErpUser

router = APIRouter(prefix="/api", tags=["calls"])

CALL_PREFIX = "call:"


def call_room(a: int, b: int) -> str:
    """두 사용자의 1:1 통화 룸. 정렬 → 양쪽이 같은 룸으로 수렴한다."""
    lo, hi = (a, b) if a <= b else (b, a)
    return f"{CALL_PREFIX}{lo}-{hi}"


class CallTokenRequest(BaseModel):
    peer_user_id: int


class CallTokenOut(BaseModel):
    token: str
    url: str
    room: str
    peer_user_id: int
    peer_name: str


@router.post("/calls/token", response_model=CallTokenOut)
async def issue_call_token(
    body: CallTokenRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cid: int = Depends(company_scope),
) -> CallTokenOut:
    """POST /api/calls/token — 상대와의 1:1 통화 룸 접속 토큰.

    같은 회사의 활성 사용자여야 한다. identity는 서버가 호출자 id로 고정 —
    클라이언트가 신원이나 룸 이름을 위조할 수 없다.
    """
    if body.peer_user_id == current_user.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot_call_self")

    peer = (
        await db.execute(
            select(ErpUser).where(
                ErpUser.id == body.peer_user_id,
                ErpUser.company_id == cid,
                ErpUser.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if peer is None:
        # 타사·비활성·미존재 동일 응답 — 사용자 탐색 차단.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="employee_not_found")

    room = call_room(current_user.user_id, peer.id)
    token = (
        livekit_api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(str(current_user.user_id))
        .with_name(current_user.email or str(current_user.user_id))
        .with_grants(
            livekit_api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
            )
        )
        .to_jwt()
    )
    return CallTokenOut(
        token=token,
        url=settings.livekit_url,
        room=room,
        peer_user_id=peer.id,
        peer_name=peer.name,
    )
