"""
Presence SSE 스트림 엔드포인트.

GET /api/wa/presence/stream — 클라이언트가 presence 변경을 실시간 구독.
인메모리 pub/sub(asyncio.Queue 팬아웃, 단일 프로세스 로컬 범위).

단일 프로세스 로컬 범위 전용.
TODO: production — replace with Redis Pub/Sub for multi-process/worker support.
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.services.presence_store import presence_pubsub

router = APIRouter(prefix="/api/wa", tags=["presence-stream"])

_KEEPALIVE_TIMEOUT = 30.0  # seconds


async def _event_stream(q: asyncio.Queue) -> AsyncGenerator[str, None]:
    """
    큐에서 presence 이벤트를 읽어 SSE 형식으로 yield.
    30초 내 이벤트 없으면 keepalive 주석 줄 전송.
    """
    while True:
        try:
            event = await asyncio.wait_for(q.get(), timeout=_KEEPALIVE_TIMEOUT)
            yield f"data: {json.dumps(event)}\n\n"
        except asyncio.TimeoutError:
            yield ": keepalive\n\n"
        except asyncio.CancelledError:
            break


@router.get("/presence/stream")
async def presence_stream() -> StreamingResponse:
    """
    GET /api/wa/presence/stream — Server-Sent Events 스트림.

    presence 상태가 변경될 때마다 다음 형식의 이벤트를 전송:
      data: {"user_id": <int>, "status": "<str>", "updated_at": "<ISO8601>"}

    단일 프로세스 인메모리 pub/sub(로컬 범위 전용).
    클라이언트는 EventSource 또는 fetch+ReadableStream으로 구독.
    """
    q = presence_pubsub.subscribe()

    async def generator() -> AsyncGenerator[str, None]:
        try:
            async for chunk in _event_stream(q):
                yield chunk
        finally:
            presence_pubsub.unsubscribe(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
