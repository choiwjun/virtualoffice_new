'use client';

/**
 * useOfficeRoom — 2.5D OfficeViewport용 Colyseus 연결 훅 (C2).
 *
 * 로그인 사용자로 realtime OfficeRoom에 접속. 서버 미기동/실패 시 status='error'로
 * graceful degradation(뷰포트는 로컬 이동 폴백). players는 ref(mutable)로 노출 → rAF 루프가 imperative 소비.
 * 비정상 끊김은 연결 모듈이 지수 백오프로 자동 재연결(§5.3) — 세션 교체는 onSelf로 selfIdRef 갱신.
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
  /** 본인 sessionId(재연결 시 교체될 수 있음). */
  selfIdRef: MutableRefObject<string>;
  /** 로컬 이동 의도 전송(서버 좌표 x,y 미터). */
  requestMove: (x: number, y: number) => void;
  /** 경유지 경로 이동(A* 결과, 미터) — 유리벽 문 개구부 통과용. */
  requestPath: (points: Array<{ x: number; y: number }>) => void;
  /** 회의 명시입장(D24) 요청 — 서버가 2m 근접+정원 검증 후 onMeetingEntry로 응답. */
  enterMeeting: (roomId: string) => void;
  /** 내 프레즌스 상태 수동 전환(06 §1.2) — room.send('status_change'). */
  setStatus: (status: string, dnd?: boolean) => void;
  /** 재연결 포기(오프라인 폴백) 후 수동 재시도 — "다시 연결" 버튼(§5.3). */
  reconnect: () => void;
}

export function useOfficeRoom(
  enabled = true,
  onMeetingEntry?: (r: MeetingEntryResult) => void,
  onLayoutUpdated?: () => void,
): UseOfficeRoom {
  const [status, setConnStatus] = useState<ConnStatus>('connecting');
  const [roster, setRoster] = useState<string[]>([]);
  // 초기 접속 자체가 실패(conn 없음)한 경우 "다시 연결"이 훅 전체를 재시도.
  const [retry, setRetry] = useState(0);
  const connRef = useRef<OfficeConnection | null>(null);
  const playersRef = useRef<Map<string, NetPlayer>>(new Map());
  const selfIdRef = useRef<string>('');
  const onMeetingEntryRef = useRef(onMeetingEntry);
  onMeetingEntryRef.current = onMeetingEntry;
  const onLayoutUpdatedRef = useRef(onLayoutUpdated);
  onLayoutUpdatedRef.current = onLayoutUpdated;

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
      onStatus: (s) => { if (!cancelled) setConnStatus(s); },
      onRoster: (ids) => { if (!cancelled) setRoster(ids); },
      onMeetingEntry: (r) => { if (!cancelled) onMeetingEntryRef.current?.(r); },
      onSelf: (id) => { if (!cancelled) selfIdRef.current = id; },
      onLayoutUpdated: () => { if (!cancelled) onLayoutUpdatedRef.current?.(); },
    })
      .then((conn) => {
        if (cancelled) { conn.leave(); return; }
        connRef.current = conn;
        playersRef.current = conn.players;
        selfIdRef.current = conn.selfSessionId;
      })
      .catch(() => { if (!cancelled) setConnStatus('error'); });

    return () => {
      cancelled = true;
      connRef.current?.leave();
      connRef.current = null;
      playersRef.current = new Map();
      setRoster([]);
    };
  }, [enabled, retry]);

  const requestMove = useCallback((x: number, y: number) => {
    connRef.current?.requestMove(x, y);
  }, []);

  const requestPath = useCallback((points: Array<{ x: number; y: number }>) => {
    connRef.current?.requestPath(points);
  }, []);

  const enterMeeting = useCallback((roomId: string) => {
    connRef.current?.enterMeeting(roomId);
  }, []);

  const setStatus = useCallback((s: string, dnd?: boolean) => {
    connRef.current?.setStatus(s, dnd);
  }, []);

  const reconnect = useCallback(() => {
    if (connRef.current) connRef.current.reconnect();
    else setRetry((n) => n + 1); // 최초 접속 실패(conn 미생성) → 훅 재실행으로 재시도
  }, []);

  return { status, roster, playersRef, selfIdRef, requestMove, requestPath, enterMeeting, setStatus, reconnect };
}
