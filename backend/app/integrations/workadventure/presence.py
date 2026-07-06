"""
Presence 상태 매핑 — D13 7종 ↔ WorkAdventure 이벤트/변수.

[매핑 설계]

D13 확정 7종 상태:
  OFFLINE  : 로그아웃 (WA 소켓 연결 없음)
  ONLINE   : 오피스 로그인, 대기 (WA 연결됨, 존 없음)
  WORKING  : 좌석에서 업무 (WA 존 이벤트: "desk" 존 진입)
  MEETING  : 회의실 입장 (WA 존 이벤트: "meeting_room" 존 진입, D24 명시 입장)
  FOCUS    : 집중 모드 (WA scripting API 변수 "presence_status" = "focus")
  AWAY     : 일시 자리 비움 (백엔드 5분 타이머 + WA 비활성 감지)
  EXTERNAL : 외근/출장/재택 수동 전환 (WA scripting API 변수 "presence_status" = "external")

WorkAdventure 상태 표현 메커니즘:
  ① 연결 이벤트 (소켓 수준)
     - onConnect(player)  → ONLINE 전이
     - onDisconnect(player) → OFFLINE 전이
  ② 존 이벤트 (지도 레이어 기반)
     - onEnterZone("desk")         → WORKING 전이
     - onLeaveZone("desk")         → ONLINE 복귀
     - onEnterZone("meeting_room") → MEETING 전이  (D24: 명시 입장 = 존 진입 = 확정 이벤트)
     - onLeaveZone("meeting_room") → ONLINE 복귀
     - onEnterZone("focus_room")   → FOCUS 전이 (존이 있을 경우 대안)
  ③ Scripting API 변수 (플레이어 커스텀 상태)
     - WA.state.saveVariable("presence_status", "focus")    → FOCUS
     - WA.state.saveVariable("presence_status", "external") → EXTERNAL
     - WA.state.saveVariable("presence_status", "")         → 클리어 → 이전 이벤트 기반 상태로
  ④ AWAY 자동 전이
     - WorkAdventure 자체 AWAY 타이머 없음
     - 백엔드: Room API로 플레이어 목록 주기 조회(또는 WS 이벤트) + 5분 무활동 감지
     - 구현 위치: services/presence_scheduler.py (미구현 — Phase 2)

GPS 코드 금지 (D20-c) — 위치/GPS 기반 로직 작성 금지.

D24 근접 대화 vs 명시 입장:
  - 근접 대화(bubble) : WA 네이티브 — 별도 상태 매핑 없음 (허용 상태로만 표시)
  - 명시 입장(회의실)  : 존 진입 이벤트 → MEETING 확정 (D24 정신)

참조:
  - 00-decisions.md: D13(presence 7종), D20-c(GPS 폐기), D24(회의 명시 입장), D26(WorkAdventure)
  - WorkAdventure Scripting API: https://docs.workadventu.re/map-building/scripting-api/
  - WorkAdventure Room API: https://docs.workadventu.re/developer/room-api/
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# D13 확정 7종 상태 (models/tables.py PresenceStatus와 동기화)
# ---------------------------------------------------------------------------

class PresenceStatus(str, Enum):
    """D13 확정 7종 presence 상태."""
    OFFLINE  = "offline"   # 로그아웃
    ONLINE   = "online"    # 앱 실행, 오피스 로그인
    WORKING  = "working"   # 좌석에서 업무
    MEETING  = "meeting"   # 회의실 입장
    FOCUS    = "focus"     # 집중 모드
    AWAY     = "away"      # 일시 자리 비움 (자동 전이 5분)
    EXTERNAL = "external"  # 외근/출장/재택 (수동 전환)


# ---------------------------------------------------------------------------
# WorkAdventure 이벤트/변수 표현 타입
# ---------------------------------------------------------------------------

class WaEventKind(str, Enum):
    """WorkAdventure 이벤트 종류."""
    CONNECT    = "connect"       # 소켓 연결 (플레이어 입장)
    DISCONNECT = "disconnect"    # 소켓 해제 (플레이어 퇴장)
    ENTER_ZONE = "enter_zone"    # 플레이어가 존 진입
    LEAVE_ZONE = "leave_zone"    # 플레이어가 존 이탈
    VARIABLE   = "variable"      # WA.state.saveVariable 변경 이벤트
    IDLE       = "idle"          # 클라이언트 5분 무입력 감지 → AWAY (D13)


@dataclass(frozen=True)
class WaEvent:
    """WorkAdventure 에서 발생한 이벤트 표현."""
    kind: WaEventKind
    zone_name: Optional[str] = None        # ENTER_ZONE / LEAVE_ZONE 시 존 이름
    variable_name: Optional[str] = None    # VARIABLE 이벤트 시 변수 이름
    variable_value: Optional[str] = None   # VARIABLE 이벤트 시 변수 값


@dataclass(frozen=True)
class WaStateAction:
    """D13 → WA 전이 시 실행할 WorkAdventure 액션."""
    # Scripting API 변수 설정 (None이면 설정 없음)
    set_variable: Optional[tuple[str, str]] = None  # (name, value)
    # 클라이언트에 보낼 안내 메시지 (None이면 없음)
    notify_message: Optional[str] = None


# ---------------------------------------------------------------------------
# 존 이름 상수 (map_generator.py 와 동기화 필수)
# ---------------------------------------------------------------------------

ZONE_DESK         = "desk"          # 개인 좌석 존
ZONE_MEETING_ROOM = "meeting_room"  # 회의실 존
ZONE_FOCUS_ROOM   = "focus_room"    # 집중실 존 (선택적)

VARIABLE_PRESENCE = "presence_status"   # WA.state 커스텀 변수 키


# ---------------------------------------------------------------------------
# 이벤트 → D13 상태 매핑 테이블
# ---------------------------------------------------------------------------

# (WaEventKind, zone_name, variable_value) → PresenceStatus
# zone_name=None 이면 모든 존에 적용, variable_value=None 이면 값 무관
_EVENT_TO_STATUS: list[tuple[WaEvent, PresenceStatus]] = [
    # 소켓 연결/해제
    (WaEvent(kind=WaEventKind.CONNECT),    PresenceStatus.ONLINE),
    (WaEvent(kind=WaEventKind.DISCONNECT), PresenceStatus.OFFLINE),
    # 존 진입
    (WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_DESK),         PresenceStatus.WORKING),
    (WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_MEETING_ROOM), PresenceStatus.MEETING),
    (WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name=ZONE_FOCUS_ROOM),   PresenceStatus.FOCUS),
    # 존 이탈 → ONLINE 복귀
    (WaEvent(kind=WaEventKind.LEAVE_ZONE, zone_name=ZONE_DESK),         PresenceStatus.ONLINE),
    (WaEvent(kind=WaEventKind.LEAVE_ZONE, zone_name=ZONE_MEETING_ROOM), PresenceStatus.ONLINE),
    (WaEvent(kind=WaEventKind.LEAVE_ZONE, zone_name=ZONE_FOCUS_ROOM),   PresenceStatus.ONLINE),
    # scripting API 변수 → FOCUS / EXTERNAL
    (WaEvent(kind=WaEventKind.VARIABLE, variable_name=VARIABLE_PRESENCE, variable_value="focus"),    PresenceStatus.FOCUS),
    (WaEvent(kind=WaEventKind.VARIABLE, variable_name=VARIABLE_PRESENCE, variable_value="external"), PresenceStatus.EXTERNAL),
    # 변수 클리어 → ONLINE (이후 위치 기반 존 이벤트가 재정의)
    (WaEvent(kind=WaEventKind.VARIABLE, variable_name=VARIABLE_PRESENCE, variable_value=""),         PresenceStatus.ONLINE),
    # 클라이언트 유휴 감지 → AWAY (D13: 5분 무입력, presence.js 클라이언트 송신)
    (WaEvent(kind=WaEventKind.IDLE), PresenceStatus.AWAY),
]


# ---------------------------------------------------------------------------
# D13 상태 → WorkAdventure 액션 매핑 테이블
# ---------------------------------------------------------------------------
# FOCUS / EXTERNAL은 scripting API 변수로 표현.
# WORKING / MEETING / AWAY 는 WA 이벤트 수신으로만 발생하므로 역방향 직접 지시 없음.

_STATUS_TO_WA_ACTION: dict[PresenceStatus, WaStateAction] = {
    PresenceStatus.OFFLINE: WaStateAction(
        notify_message="오프라인 상태로 전환됩니다.",
    ),
    PresenceStatus.ONLINE: WaStateAction(
        set_variable=(VARIABLE_PRESENCE, ""),
    ),
    PresenceStatus.WORKING: WaStateAction(
        # 좌석 존 진입으로 자동 전이 — 별도 변수 불필요
    ),
    PresenceStatus.MEETING: WaStateAction(
        # 회의실 존 진입으로 자동 전이 (D24: 명시 입장 확인)
    ),
    PresenceStatus.FOCUS: WaStateAction(
        set_variable=(VARIABLE_PRESENCE, "focus"),
    ),
    PresenceStatus.AWAY: WaStateAction(
        # 백엔드 5분 타이머 → Room API로 플레이어 상태 갱신
        # 클라이언트 scripting API 직접 지시 없음 (서버 측 감지)
        notify_message="5분 이상 비활성 상태입니다.",
    ),
    PresenceStatus.EXTERNAL: WaStateAction(
        set_variable=(VARIABLE_PRESENCE, "external"),
    ),
}


# ---------------------------------------------------------------------------
# 변환 함수
# ---------------------------------------------------------------------------

def wa_event_to_status(event: WaEvent) -> Optional[PresenceStatus]:
    """
    WorkAdventure 이벤트 → D13 presence 상태 변환.

    반환값 None: 매핑되지 않은 이벤트 (무시).

    사용 예:
        event = WaEvent(kind=WaEventKind.ENTER_ZONE, zone_name="desk")
        status = wa_event_to_status(event)  # PresenceStatus.WORKING
    """
    for candidate, status in _EVENT_TO_STATUS:
        if candidate.kind != event.kind:
            continue
        if candidate.zone_name is not None and candidate.zone_name != event.zone_name:
            continue
        if candidate.variable_name is not None and candidate.variable_name != event.variable_name:
            continue
        if candidate.variable_value is not None and candidate.variable_value != event.variable_value:
            continue
        return status
    return None


def status_to_wa_action(status: PresenceStatus) -> WaStateAction:
    """
    D13 presence 상태 → WorkAdventure 실행 액션 변환.

    반환된 WaStateAction.set_variable이 있으면 WA scripting API 변수를 설정.
    반환된 WaStateAction.notify_message가 있으면 클라이언트에 알림.

    사용 예:
        action = status_to_wa_action(PresenceStatus.FOCUS)
        # action.set_variable = ("presence_status", "focus")
        # → WA 클라이언트에서: WA.state.saveVariable("presence_status", "focus")
    """
    return _STATUS_TO_WA_ACTION[status]


def build_wa_variable_payload(status: PresenceStatus) -> Optional[dict[str, str]]:
    """
    D13 상태 → WA.state.saveVariable() 페이로드 딕셔너리.

    scripting API 변수가 필요 없는 상태(WORKING, MEETING 등)는 None 반환.

    사용 예:
        payload = build_wa_variable_payload(PresenceStatus.EXTERNAL)
        # {"name": "presence_status", "value": "external"}
        # → Room API: POST /room/{room_id}/variable 또는 WS 전송
    """
    action = _STATUS_TO_WA_ACTION[status]
    if action.set_variable is None:
        return None
    name, value = action.set_variable
    return {"name": name, "value": value}


def summarize_mapping() -> list[dict]:
    """
    전체 매핑 요약 (디버그/문서화용).
    각 D13 상태의 WA 표현 방식을 딕셔너리 목록으로 반환.
    """
    rows = []
    for status in PresenceStatus:
        action = _STATUS_TO_WA_ACTION[status]
        wa_expressions = []

        # 이 status를 유발하는 WA 이벤트 찾기
        trigger_events = [
            e for e, s in _EVENT_TO_STATUS if s == status
        ]
        for e in trigger_events:
            if e.kind in (WaEventKind.ENTER_ZONE, WaEventKind.LEAVE_ZONE):
                wa_expressions.append(f"{e.kind.value}({e.zone_name})")
            elif e.kind == WaEventKind.VARIABLE:
                wa_expressions.append(
                    f'WA.state["{e.variable_name}"] = "{e.variable_value}"'
                )
            else:
                wa_expressions.append(e.kind.value)

        rows.append({
            "d13_status": status.value,
            "wa_trigger_expressions": wa_expressions,
            "wa_action_variable": (
                f'{action.set_variable[0]}={action.set_variable[1]!r}'
                if action.set_variable else None
            ),
            "wa_notify": action.notify_message,
        })
    return rows
