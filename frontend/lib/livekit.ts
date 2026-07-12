/**
 * livekit.ts — 회의실 실미디어 연결 (C3, D24, G004).
 *
 * 참석 등록(멱등 join) → FastAPI 정본 토큰 발급(POST /api/meetings/{id}/livekit-token) →
 * LiveKit Room 접속. 서버가 발급 주체라 클라이언트가 room/identity를 위조할 수 없다(구 WA 경로 대체).
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
  await room.connect(resp.url, resp.token);
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
