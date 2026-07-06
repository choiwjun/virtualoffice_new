"""
Presence 매핑 단위 테스트 — backend/app/integrations/workadventure/presence.py

범위:
  - D13 7종 상태 전체 커버 (OFFLINE ~ EXTERNAL)
  - WA 이벤트 → D13 상태 변환 (wa_event_to_status)
  - D13 상태 → WA 액션 변환 (status_to_wa_action, build_wa_variable_payload)
  - FOCUS/EXTERNAL scripting API 변수 표현 확인
  - GPS 코드 없음 확인 (D20-c)
  - 존 이름 상수와 presence.py 사용 일관성

참조: 00-decisions.md D13, D20-c, D24, D26
"""

import pytest

from app.integrations.workadventure.presence import (
    VARIABLE_PRESENCE,
    ZONE_DESK,
    ZONE_FOCUS_ROOM,
    ZONE_MEETING_ROOM,
    PresenceStatus,
    WaEvent,
    WaEventKind,
    WaStateAction,
    build_wa_variable_payload,
    status_to_wa_action,
    summarize_mapping,
    wa_event_to_status,
)


# ---------------------------------------------------------------------------
# D13 7종 상태 존재 확인
# ---------------------------------------------------------------------------

class TestPresenceStatusEnum:
    def test_all_seven_statuses_defined(self):
        statuses = {s.value for s in PresenceStatus}
        assert statuses == {"offline", "online", "working", "meeting", "focus", "away", "external"}

    def test_status_count_is_seven(self):
        assert len(PresenceStatus) == 7


# ---------------------------------------------------------------------------
# WA 이벤트 → D13 상태 변환 (wa_event_to_status)
# ---------------------------------------------------------------------------

class TestWaEventToStatus:
    def test_connect_maps_to_online(self):
        event = WaEvent(kind=WaEventKind.CONNECT)
        assert wa_event_to_status(event) == PresenceStatus.ONLINE

    def test_disconnect_maps_to_offline(self):
        event = WaEvent(kind=WaEventKind.DISCONNECT)
        assert wa_event_to_status(event) == PresenceStatus.OFFLINE

    def test_enter_desk_maps_to_working(self):
        event = WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_DESK)
        assert wa_event_to_status(event) == PresenceStatus.WORKING

    def test_enter_meeting_room_maps_to_meeting(self):
        """D24: 회의실 존 진입 = 명시 입장 = MEETING 확정."""
        event = WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_MEETING_ROOM)
        assert wa_event_to_status(event) == PresenceStatus.MEETING

    def test_enter_focus_room_maps_to_focus(self):
        event = WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_FOCUS_ROOM)
        assert wa_event_to_status(event) == PresenceStatus.FOCUS

    def test_leave_desk_maps_to_online(self):
        event = WaEvent(kind=WaEventKind.LEAVE_ZONE, zone_name=ZONE_DESK)
        assert wa_event_to_status(event) == PresenceStatus.ONLINE

    def test_leave_meeting_room_maps_to_online(self):
        event = WaEvent(kind=WaEventKind.LEAVE_ZONE, zone_name=ZONE_MEETING_ROOM)
        assert wa_event_to_status(event) == PresenceStatus.ONLINE

    def test_leave_focus_room_maps_to_online(self):
        event = WaEvent(kind=WaEventKind.LEAVE_ZONE, zone_name=ZONE_FOCUS_ROOM)
        assert wa_event_to_status(event) == PresenceStatus.ONLINE

    def test_variable_focus_maps_to_focus(self):
        """scripting API 변수 "focus" → FOCUS."""
        event = WaEvent(
            kind=WaEventKind.VARIABLE,
            variable_name=VARIABLE_PRESENCE,
            variable_value="focus",
        )
        assert wa_event_to_status(event) == PresenceStatus.FOCUS

    def test_variable_external_maps_to_external(self):
        """scripting API 변수 "external" → EXTERNAL."""
        event = WaEvent(
            kind=WaEventKind.VARIABLE,
            variable_name=VARIABLE_PRESENCE,
            variable_value="external",
        )
        assert wa_event_to_status(event) == PresenceStatus.EXTERNAL

    def test_variable_clear_maps_to_online(self):
        """scripting API 변수 빈 문자열 클리어 → ONLINE."""
        event = WaEvent(
            kind=WaEventKind.VARIABLE,
            variable_name=VARIABLE_PRESENCE,
            variable_value="",
        )
        assert wa_event_to_status(event) == PresenceStatus.ONLINE

    def test_unknown_zone_returns_none(self):
        """매핑 없는 존 이벤트 → None (무시)."""
        event = WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name="unknown_zone_xyz")
        assert wa_event_to_status(event) is None

    def test_unknown_variable_returns_none(self):
        """매핑 없는 변수 이벤트 → None."""
        event = WaEvent(
            kind=WaEventKind.VARIABLE,
            variable_name="some_other_variable",
            variable_value="anything",
        )
        assert wa_event_to_status(event) is None

    def test_unknown_variable_value_returns_none(self):
        """presence_status 변수지만 알 수 없는 값 → None."""
        event = WaEvent(
            kind=WaEventKind.VARIABLE,
            variable_name=VARIABLE_PRESENCE,
            variable_value="invalid_status",
        )
        assert wa_event_to_status(event) is None


# ---------------------------------------------------------------------------
# D13 상태 → WA 액션 변환 (status_to_wa_action)
# ---------------------------------------------------------------------------

class TestStatusToWaAction:
    def test_all_statuses_have_action(self):
        """D13 7종 모두 WaStateAction을 반환해야 함."""
        for status in PresenceStatus:
            action = status_to_wa_action(status)
            assert isinstance(action, WaStateAction)

    def test_focus_sets_variable(self):
        action = status_to_wa_action(PresenceStatus.FOCUS)
        assert action.set_variable is not None
        name, value = action.set_variable
        assert name == VARIABLE_PRESENCE
        assert value == "focus"

    def test_external_sets_variable(self):
        action = status_to_wa_action(PresenceStatus.EXTERNAL)
        assert action.set_variable is not None
        name, value = action.set_variable
        assert name == VARIABLE_PRESENCE
        assert value == "external"

    def test_online_clears_variable(self):
        action = status_to_wa_action(PresenceStatus.ONLINE)
        assert action.set_variable is not None
        name, value = action.set_variable
        assert name == VARIABLE_PRESENCE
        assert value == ""

    def test_working_no_variable(self):
        """WORKING은 존 이벤트로 자동 전이 — 별도 변수 설정 없음."""
        action = status_to_wa_action(PresenceStatus.WORKING)
        assert action.set_variable is None

    def test_meeting_no_variable(self):
        """MEETING은 회의실 존 진입으로 자동 전이 — 별도 변수 설정 없음."""
        action = status_to_wa_action(PresenceStatus.MEETING)
        assert action.set_variable is None

    def test_offline_has_notification(self):
        action = status_to_wa_action(PresenceStatus.OFFLINE)
        assert action.notify_message is not None

    def test_away_has_notification(self):
        """AWAY는 백엔드 타이머 기반 — 알림 메시지 있어야 함."""
        action = status_to_wa_action(PresenceStatus.AWAY)
        assert action.notify_message is not None


# ---------------------------------------------------------------------------
# WA variable payload 생성 (build_wa_variable_payload)
# ---------------------------------------------------------------------------

class TestBuildWaVariablePayload:
    def test_focus_payload(self):
        payload = build_wa_variable_payload(PresenceStatus.FOCUS)
        assert payload == {"name": VARIABLE_PRESENCE, "value": "focus"}

    def test_external_payload(self):
        payload = build_wa_variable_payload(PresenceStatus.EXTERNAL)
        assert payload == {"name": VARIABLE_PRESENCE, "value": "external"}

    def test_online_payload_clears(self):
        payload = build_wa_variable_payload(PresenceStatus.ONLINE)
        assert payload == {"name": VARIABLE_PRESENCE, "value": ""}

    def test_working_no_payload(self):
        """WORKING은 존 이벤트 기반 — payload 없음."""
        assert build_wa_variable_payload(PresenceStatus.WORKING) is None

    def test_meeting_no_payload(self):
        assert build_wa_variable_payload(PresenceStatus.MEETING) is None

    def test_offline_no_payload(self):
        assert build_wa_variable_payload(PresenceStatus.OFFLINE) is None

    def test_away_no_payload(self):
        """AWAY는 서버 측 감지 — 클라이언트 변수 설정 없음."""
        assert build_wa_variable_payload(PresenceStatus.AWAY) is None


# ---------------------------------------------------------------------------
# 매핑 요약 (summarize_mapping)
# ---------------------------------------------------------------------------

class TestSummarizeMapping:
    def test_summary_covers_all_statuses(self):
        rows = summarize_mapping()
        status_values = {r["d13_status"] for r in rows}
        all_values = {s.value for s in PresenceStatus}
        assert status_values == all_values

    def test_summary_row_structure(self):
        rows = summarize_mapping()
        for row in rows:
            assert "d13_status" in row
            assert "wa_trigger_expressions" in row
            assert "wa_action_variable" in row
            assert "wa_notify" in row

    def test_focus_summary_mentions_variable(self):
        rows = {r["d13_status"]: r for r in summarize_mapping()}
        focus = rows["focus"]
        assert focus["wa_action_variable"] is not None
        assert "focus" in focus["wa_action_variable"]

    def test_external_summary_mentions_variable(self):
        rows = {r["d13_status"]: r for r in summarize_mapping()}
        external = rows["external"]
        assert external["wa_action_variable"] is not None
        assert "external" in external["wa_action_variable"]


# ---------------------------------------------------------------------------
# D20-c GPS 금지 확인 — 소스 파일에 GPS 관련 심볼 없음
# ---------------------------------------------------------------------------

class TestNoGpsCode:
    def test_no_gps_import_in_module(self):
        """D20-c: presence.py에 GPS 관련 코드(import/식별자) 없음 — 정책 주석은 허용."""
        import ast
        import inspect
        import app.integrations.workadventure.presence as mod
        source = inspect.getsource(mod)
        tree = ast.parse(source)
        # GPS 관련 모듈 import 금지
        gps_import_names = {"gps", "geopy", "geolocation", "geocoder"}
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in getattr(node, "names", []):
                    assert alias.name.lower() not in gps_import_names, (
                        f"GPS 모듈 import 발견 — D20-c 위반: {alias.name}"
                    )
                mod_name = getattr(node, "module", "") or ""
                assert mod_name.lower() not in gps_import_names, (
                    f"GPS 모듈 from-import 발견 — D20-c 위반: {mod_name}"
                )
        # GPS 관련 식별자 금지
        gps_id_names = {"latitude", "longitude", "lat_lng", "get_location", "get_coordinates"}
        for node in ast.walk(tree):
            if isinstance(node, (ast.Name, ast.Attribute, ast.FunctionDef, ast.AsyncFunctionDef)):
                name = getattr(node, "id", None) or getattr(node, "attr", None) or getattr(node, "name", None)
                if name and name.lower() in gps_id_names:
                    raise AssertionError(f"GPS 식별자 '{name}' 발견 — D20-c 위반")


# ---------------------------------------------------------------------------
# D24 근접 대화 vs 명시 입장 확인
# ---------------------------------------------------------------------------

class TestD24MeetingIntent:
    def test_meeting_room_zone_entry_is_explicit_meeting(self):
        """D24: 회의실 존 진입(onEnterZone)은 명시 입장 = MEETING 확정."""
        event = WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_MEETING_ROOM)
        result = wa_event_to_status(event)
        assert result == PresenceStatus.MEETING

    def test_desk_zone_is_not_meeting(self):
        """좌석 존 진입은 MEETING이 아님."""
        event = WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_DESK)
        result = wa_event_to_status(event)
        assert result == PresenceStatus.WORKING
        assert result != PresenceStatus.MEETING


# ---------------------------------------------------------------------------
# WaEvent 불변성 확인
# ---------------------------------------------------------------------------

class TestWaEventImmutable:
    def test_wa_event_is_frozen(self):
        event = WaEvent(kind=WaEventKind.CONNECT)
        with pytest.raises(Exception):
            event.kind = WaEventKind.DISCONNECT  # type: ignore[misc]
