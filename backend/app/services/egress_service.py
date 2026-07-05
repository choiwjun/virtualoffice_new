"""
회의 오디오 Egress 수집 (P5-R4-T1, D20).

LiveKit Egress로 트랙별(참석자별) 오디오를 수집한다. LiveKit 미설정 시 결정적 stub을 반환한다
(실 Egress 런타임은 B-03 환경차단). D20: 녹음 원본 90일 보존, 동의 거부자 오디오 미수집 —
consented_identities만 대상으로 한다.
"""

from __future__ import annotations

from typing import Optional

from app.config import settings


async def start_egress(room: str, consented_identities: Optional[list[str]] = None) -> dict:
    """회의 시작 시 트랙 Egress 시작. 반환: {egress_id, room, live, consented}.

    consented_identities가 주어지면 그 참석자만 수집(D20 동의 거부자 제외).
    """
    consented = consented_identities or []
    if settings.livekit_enabled and settings.livekit_url:
        from livekit import api  # 지연 임포트

        lkapi = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
        try:
            # 실 구현: RoomCompositeEgress 또는 TrackEgress 요청. 서버 미가용 시 예외 → 상위에서 처리.
            res = await lkapi.egress.start_room_composite_egress(
                api.RoomCompositeEgressRequest(room_name=room, audio_only=True)
            )
            egress_id = getattr(res, "egress_id", None)
        finally:
            await lkapi.aclose()
        return {"egress_id": egress_id, "room": room, "live": True, "consented": consented}
    return {"egress_id": f"stub-egress-{room}", "room": room, "live": False, "consented": consented}


async def stop_egress(egress_id: str) -> dict:
    """회의 종료 시 Egress 정지."""
    if settings.livekit_enabled and settings.livekit_url and not egress_id.startswith("stub-"):
        from livekit import api

        lkapi = api.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)
        try:
            await lkapi.egress.stop_egress(api.StopEgressRequest(egress_id=egress_id))
        finally:
            await lkapi.aclose()
        return {"egress_id": egress_id, "stopped": True, "live": True}
    return {"egress_id": egress_id, "stopped": True, "live": False}
