/**
 * livekit.ts — 회의실 실미디어 연결 (C3, D24, G004).
 *
 * 참석 등록(멱등 join) → FastAPI 정본 토큰 발급(POST /api/meetings/{id}/livekit-token) →
 * LiveKit Room 접속. 서버가 발급 주체라 클라이언트가 room/identity를 위조할 수 없다(구 WA 경로 대체).
 *
 * WebRTC 안정화(2026-07-17):
 * - connect 실패 시 Room 내부 리소스(시그널 WS·PeerConnection·디바이스) 즉시 해제 —
 *   미해제 시 재시도할 때마다 소켓/트랙이 누적된다.
 * - 시그널 연결 재시도(maxRetries)로 일시적 네트워크 흔들림에 관대하게.
 */

import { Room } from 'livekit-client';
import { api } from './api';

interface LivekitTokenResp {
  token: string;
  url: string;
  room: string;
}

/** 회의 참석 등록 후 토큰을 받아 LiveKit 룸에 접속. connected Room 반환. */
export async function connectToMeeting(meetingId: string): Promise<Room> {
  // 참석 등록(멱등) — 토큰 발급은 참석자에게만 허용됨.
  await api.post(`/api/meetings/${meetingId}/join`, {});
  const resp = await api.post<LivekitTokenResp>(`/api/meetings/${meetingId}/livekit-token`, {});
  const room = new Room({ adaptiveStream: true, dynacast: true });
  try {
    await room.connect(resp.url, resp.token, { maxRetries: 3 });
  } catch (err) {
    // 실패한 반쪽 연결 정리 — 없으면 join 재시도마다 WS/PC 리소스 누수
    await room.disconnect().catch(() => {});
    throw err;
  }
  return room;
}

export async function disconnectRoom(room: Room | null | undefined): Promise<void> {
  if (room) {
    try {
      await room.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
