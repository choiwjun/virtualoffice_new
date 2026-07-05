"""P5-R4 슬라이스: 회의록 초안 로직·누락률·LiveKit 룸·Egress 스텁."""

from app.services import egress_service, livekit_service, stt_service
from app.services.minute_drafter import draft_from_transcript, pseudonymize_speaker, to_stt_draft_text


def test_minute_drafter_extracts_decisions_and_actions():
    segments = [
        {"speaker": 3, "text": "다음 배포 일정을 금요일로 확정합니다."},
        {"speaker": "user:7", "text": "김철수가 QA 문서를 내일까지 정리하기로 했습니다."},
        {"speaker": 3, "text": "그냥 잡담입니다."},
    ]
    draft = draft_from_transcript(segments)
    assert any("확정" in d for d in draft["decisions"])
    assert len(draft["action_items"]) == 1
    ai = draft["action_items"][0]
    assert ai["owner"] == "EMP-7" and ai["due"] is not None  # '내일' 기한 추출
    # D20 가명처리: 발화자는 사번 형태만
    assert draft["speakers"] == sorted({"EMP-3", "EMP-7"})
    # 초안 텍스트 렌더
    text = to_stt_draft_text(draft)
    assert "[결정사항]" in text and "[액션아이템]" in text


def test_pseudonymize_speaker():
    assert pseudonymize_speaker(5) == "EMP-5"
    assert pseudonymize_speaker("user:12") == "EMP-12"
    assert pseudonymize_speaker("호스트") == "호스트"


def test_stt_miss_rate():
    ref = [{"speaker": 1, "text": "A"}, {"speaker": 2, "text": "B"}, {"speaker": 3, "text": "C"}]
    hyp = [{"speaker": 1, "text": "A"}, {"speaker": 2, "text": "B"}]  # C 누락
    assert stt_service.measure_miss_rate(ref, hyp) == round(1 / 3, 4)
    assert stt_service.measure_miss_rate([], hyp) == 0.0
    assert stt_service.is_engine_configured() is False


async def test_stt_transcribe_stub_returns_empty():
    assert await stt_service.transcribe("audio-ref") == []


async def test_livekit_room_stub():
    c = await livekit_service.create_room("meeting-x")
    assert c["created"] is True and c["live"] is False
    d = await livekit_service.delete_room("meeting-x")
    assert d["deleted"] is True and d["live"] is False


async def test_egress_stub():
    s = await egress_service.start_egress("meeting-x", consented_identities=["EMP-1"])
    assert s["live"] is False and s["consented"] == ["EMP-1"]
    st = await egress_service.stop_egress(s["egress_id"])
    assert st["stopped"] is True and st["live"] is False
