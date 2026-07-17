/**
 * livekit.test.ts — WebRTC 안정화: 회의 연결 수명주기 단위 검증.
 * - connect 실패 시 반쪽 연결(Room 내부 WS/PC) 해제 보장 (리소스 누수 방지)
 * - 토큰 발급 전 참석 등록(join) 순서 보장 (D24)
 * - disconnectRoom 멱등/무해성
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { connectMock, disconnectMock, roomCtor, postMock } = vi.hoisted(() => {
  const connectMock = vi.fn();
  const disconnectMock = vi.fn();
  return {
    connectMock,
    disconnectMock,
    roomCtor: vi.fn(() => ({ connect: connectMock, disconnect: disconnectMock })),
    postMock: vi.fn(),
  };
});

vi.mock('livekit-client', () => ({ Room: roomCtor }));
vi.mock('../lib/api', () => ({ api: { post: postMock } }));

import { connectToMeeting, disconnectRoom } from '../lib/livekit';

beforeEach(() => {
  connectMock.mockReset().mockResolvedValue(undefined);
  disconnectMock.mockReset().mockResolvedValue(undefined);
  roomCtor.mockClear();
  postMock.mockReset().mockResolvedValue({ token: 't', url: 'ws://lk', room: 'r1' });
});

describe('connectToMeeting', () => {
  it('joins (idempotent) before requesting the token, then connects', async () => {
    const room = await connectToMeeting('m1');
    expect(postMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/meetings/m1/join',
      '/api/meetings/m1/livekit-token',
    ]);
    expect(connectMock).toHaveBeenCalledWith('ws://lk', 't', { maxRetries: 3 });
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(room).toBeTruthy();
  });

  it('releases the half-open room when connect fails', async () => {
    connectMock.mockRejectedValue(new Error('ice failed'));
    await expect(connectToMeeting('m1')).rejects.toThrow('ice failed');
    // 핵심: 실패한 Room이 disconnect로 정리되어야 재시도 시 리소스가 누적되지 않는다
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('still throws the original error even if cleanup disconnect also fails', async () => {
    connectMock.mockRejectedValue(new Error('ice failed'));
    disconnectMock.mockRejectedValue(new Error('already closed'));
    await expect(connectToMeeting('m1')).rejects.toThrow('ice failed');
  });

  it('does not construct a Room when join/token issuance fails', async () => {
    postMock.mockRejectedValue(new Error('403 not a participant'));
    await expect(connectToMeeting('m1')).rejects.toThrow('403');
    expect(roomCtor).not.toHaveBeenCalled();
  });
});

describe('disconnectRoom', () => {
  it('is a no-op for null/undefined', async () => {
    await expect(disconnectRoom(null)).resolves.toBeUndefined();
    await expect(disconnectRoom(undefined)).resolves.toBeUndefined();
  });

  it('swallows disconnect errors (idempotent leave)', async () => {
    disconnectMock.mockRejectedValue(new Error('already disconnected'));
    const fakeRoom = { disconnect: disconnectMock } as unknown as import('livekit-client').Room;
    await expect(disconnectRoom(fakeRoom)).resolves.toBeUndefined();
  });
});
