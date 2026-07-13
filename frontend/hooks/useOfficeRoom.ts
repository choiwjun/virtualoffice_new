'use client';

/**
 * useOfficeRoom — 2.5D OfficeViewport용 Colyseus 연결 훅 (C2).
 *
 * 로그인 사용자로 realtime OfficeRoom에 접속. 서버 미기동/실패 시 status='error'로
 * graceful degradation(뷰포트는 로컬 이동 폴백). players는 ref(mutable)로 노출 → rAF 루프가 imperative 소비.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { getUser, getToken } from '@/lib/auth';
import {
  createOfficeConnection,
  type ConnStatus,
  type NetPlayer,
  type OfficeConnection,
  type MeetingEntryResult,
} from '@/lib/realtime';

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:2567';
const OFFICE_ID = process.env.NEXT_PUBLIC_OFFICE_ID ?? 'office-demo';
const FLOOR_ID = process.env.NEXT_PUBLIC_FLOOR_ID ?? 'floor-1';

export interface UseOfficeRoom {
  status: ConnStatus;
  /** 현재 방의 sessionId 목록(입장/퇴장 시에만 변경) — 아바타 mount/unmount 구동. */
  roster: string[];
  /** 서버 권위 플레이어(20Hz in-place 갱신). rAF 루프에서 .current로 읽는다. */
  playersRef: MutableRefObject<Map<string, NetPlayer>>;
  /** 본인 sessionId. */
  selfIdRef: MutableRefObject<string>;
  /** 로컬 이동 의도 전송(서버 좌표 x,y 미터). */
  requestMove: (x: number, y: number) => void;
  /** 회의 명시입장(D24) 요청 — 서버가 2m 근접+정원 검증 후 onMeetingEntry로 응답. */
  enterMeeting: (roomId: string) => void;
}

export function useOfficeRoom(
  enabled = true,
  onMeetingEntry?: (r: MeetingEntryResult) => void,
): UseOfficeRoom {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [roster, setRoster] = useState<string[]>([]);
  const connRef = useRef<OfficeConnection | null>(null);
  const playersRef = useRef<Map<string, NetPlayer>>(new Map());
  const selfIdRef = useRef<string>('');
  const onMeetingEntryRef = useRef(onMeetingEntry);
  onMeetingEntryRef.current = onMeetingEntry;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const user = getUser();
    const join = {
      userId: String(user?.id ?? 'guest'),
      name: user?.name ?? 'Guest',
      officeId: OFFICE_ID,
      floorId: FLOOR_ID,
      jwt: getToken() ?? undefined,
    };

    createOfficeConnection(REALTIME_URL, join, {
      onStatus: (s) => { if (!cancelled) setStatus(s); },
      onRoster: (ids) => { if (!cancelled) setRoster(ids); },
      onMeetingEntry: (r) => { if (!cancelled) onMeetingEntryRef.current?.(r); },
    })
      .then((conn) => {
        if (cancelled) { conn.leave(); return; }
        connRef.current = conn;
        playersRef.current = conn.players;
        selfIdRef.current = conn.selfSessionId;
      })
      .catch(() => { if (!cancelled) setStatus('error'); });

    return () => {
      cancelled = true;
      connRef.current?.leave();
      connRef.current = null;
      playersRef.current = new Map();
      setRoster([]);
    };
  }, [enabled]);

  const requestMove = useCallback((x: number, y: number) => {
    connRef.current?.requestMove(x, y);
  }, []);

  const enterMeeting = useCallback((roomId: string) => {
    connRef.current?.enterMeeting(roomId);
  }, []);

  return { status, roster, playersRef, selfIdRef, requestMove, enterMeeting };
}
