/**
 * livekit-meeting.js — 회의실 zone D24 명시적 입장 + LiveKit 토큰 요청
 *
 * 정본: 00-decisions.md D24 (회의 입장 = 명시적 입장 확인)
 *   - 자동 연결 금지: onEnterZone 에서 바로 LiveKit 에 연결하지 않는다.
 *   - 명시적 흐름: 존 진입 → 팝업 표시 → 사용자 클릭 → 토큰 요청 → LiveKit 연결.
 *
 * WA scripting API 참조: https://docs.workadventu.re/map-building/scripting/
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D24 명시적 입장 흐름 다이어그램:
 *
 *   [사용자] → meeting_room zone 진입
 *         ↓ onEnterZone
 *   WA.ui.openPopup("입장하시겠습니까?") 표시     ← 자동 연결 금지
 *         ↓ 사용자 "입장" 클릭
 *   fetch POST /api/wa/livekit-token {user_id, email, room_name, meeting_id}
 *         ↓ 토큰 수신
 *   WA.openCoWebsite("https://livekit-url/?token=JWT")  또는
 *   WA.openModal 로 iframe 에 LiveKit 클라이언트 로드
 *         ↓ 사용자 이탈
 *   onLeaveZone → popup 닫기 + 연결 해제
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 이 스크립트는 맵 TMJ의 최상위 'script' 프로퍼티에 URL로 지정:
 *   { "name": "script", "type": "string", "value": "<backend_url>/wa_maps/scripts/livekit-meeting.js" }
 *
 * 의존: presence.js 와 함께 사용 (같은 맵에 스크립트 다중 등록 불가 — 합치거나 import 사용)
 *
 * ⚠️ WA 소스 수정 금지 (D26) — scripting API / iframe 만 사용.
 */

/// <reference types="@workadventure/iframe-api-typings" />

// ── 상수 ────────────────────────────────────────────────────────────────────

/** WA zone 이름 (map_generator.py / presence.js 와 동기화 필수) */
const ZONE_MEETING_ROOM = "meeting_room";

/** FastAPI 백엔드 엔드포인트 (상대경로 — WA 호스트와 동일 오리진) */
const LIVEKIT_TOKEN_URL = "/api/wa/livekit-token";

/** WA.state 변수: 현재 활성 회의실 이름 */
const STATE_ACTIVE_MEETING_ROOM = "active_meeting_room";

// ── 유틸 ────────────────────────────────────────────────────────────────────

/**
 * LiveKit 토큰 발급 요청.
 * D24: 사용자가 명시적으로 입장을 확인한 후에만 호출된다.
 *
 * @param {number} userId   - erp_user.id
 * @param {string} email    - 표시용
 * @param {string} roomName - LiveKit room 이름 (= WA zone 이름 기반)
 * @param {string} meetingId - meeting UUID
 * @returns {Promise<{token: string, room_name: string, participant_id: string}>}
 */
async function fetchLiveKitToken(userId, email, roomName, meetingId) {
  const resp = await fetch(LIVEKIT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      email: email,
      room_name: roomName,
      meeting_id: meetingId,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`LiveKit 토큰 발급 실패 (${resp.status}): ${err.detail ?? "알 수 없는 오류"}`);
  }
  return resp.json();
}

// ── 메인 로직 ────────────────────────────────────────────────────────────────

WA.onInit().then(async () => {
  /**
   * 회의실 zone 진입 이벤트.
   *
   * D24 핵심: onEnterZone 에서 바로 LiveKit 에 연결하지 않는다.
   * 팝업을 표시하고 사용자의 명시적 확인을 기다린다.
   */
  WA.room.onEnterZone(ZONE_MEETING_ROOM, () => {
    // D24: 자동 연결 금지 — 팝업으로 명시적 입장 확인
    const popup = WA.ui.openPopup(
      "meeting-entry-popup",   // popupName (맵 TMJ의 popup object name과 일치시킬 것)
      "회의실에 입장하시겠습니까?\n(카메라/마이크 사용 동의 포함)",
      [
        {
          label: "입장",
          className: "success",
          callback: async (popupRef) => {
            popupRef.close();

            // 플레이어 정보 조회
            const playerState = await WA.player.state.loadVariable("erp_user_id");
            const playerEmail = WA.player.name ?? "unknown@local";
            const userId = typeof playerState === "number" ? playerState : 0;

            // 활성 회의: WA.state 변수에서 meeting_id 조회 (map_generator가 zone 프로퍼티로 주입)
            const meetingId = await WA.state.loadVariable(`meeting_id_${ZONE_MEETING_ROOM}`)
              ?? "00000000-0000-0000-0000-000000000000";

            try {
              const { token, room_name } = await fetchLiveKitToken(
                userId,
                playerEmail,
                ZONE_MEETING_ROOM,
                String(meetingId),
              );

              // WA.state에 활성 회의실 기록
              WA.state.saveVariable(STATE_ACTIVE_MEETING_ROOM, room_name);

              // LiveKit 클라이언트를 iframe(co-website)으로 열기.
              // WA 자체 Jitsi/LiveKit 내장 연결 대신 iframe 사용 → 자동 연결 방지(D24).
              // Phase 2+: livekit-client.js 기반 완전 통합.
              const livekitIframeUrl =
                `/livekit-room.html?token=${encodeURIComponent(token)}&room=${encodeURIComponent(room_name)}`;
              WA.nav.openCoWebsite(livekitIframeUrl, true);
            } catch (e) {
              WA.ui.openPopup(
                "meeting-error-popup",
                `회의실 입장 오류: ${e.message}`,
                [{ label: "확인", className: "normal", callback: (p) => p.close() }],
              );
            }
          },
        },
        {
          label: "취소",
          className: "normal",
          callback: (popupRef) => {
            popupRef.close();
          },
        },
      ],
    );
  });

  /**
   * 회의실 zone 이탈 이벤트.
   * 활성 회의실 상태 초기화. 실제 LiveKit 연결 해제는 co-website 닫기로 처리.
   */
  WA.room.onLeaveZone(ZONE_MEETING_ROOM, () => {
    WA.state.saveVariable(STATE_ACTIVE_MEETING_ROOM, null);
    // co-website는 WA.nav.closeCoWebsite() 또는 사용자가 직접 닫기
  });
});
