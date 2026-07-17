'use client';

// design-style-analysis §4 — 미디어 컨트롤 바
// C3: 연결된 LiveKit 룸이 있으면 마이크·카메라·화면공유를 실제 제어, 없으면 비활성(대기).

import { useCallback, useEffect, useState } from 'react';
import type { Room } from 'livekit-client';

interface MediaBarProps {
  /** 연결된 LiveKit 룸. 없으면 컨트롤 비활성(회의 미입장). */
  room?: Room | null;
  /** 통화 종료(나가기). */
  onLeave?: () => void;
  className?: string;
}

function CtrlBtn({
  active,
  danger,
  disabled,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const base =
    'flex items-center justify-center w-10 h-10 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan';
  const color = disabled
    ? 'bg-bg-surface-raised text-text-muted opacity-40 cursor-not-allowed'
    : danger
      ? 'bg-status-meeting text-white'
      : active
        ? 'bg-bg-surface-raised text-text-primary'
        : 'bg-[rgba(239,68,68,0.18)] text-status-meeting';

  return (
    <button
      className={[base, color].join(' ')}
      aria-label={label}
      aria-pressed={active}
      title={label}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function MediaBar({ room, onLeave, className = '' }: MediaBarProps) {
  const connected = !!room;
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [shareOn, setShareOn] = useState(false);

  // 룸 연결/해제·로컬트랙 발행 이벤트 시 권위 상태(localParticipant.is*Enabled)로 동기화.
  // 토글 promise가 시그널 재접속과 겹쳐 거부돼도(발행은 재개 후 완료될 수 있음) UI가 실상태를 따른다(2026-07-17 실측).
  useEffect(() => {
    if (!room) {
      setMicOn(false);
      setCamOn(false);
      setShareOn(false);
      return;
    }
    const lp = room.localParticipant;
    const sync = () => {
      setMicOn(lp.isMicrophoneEnabled);
      setCamOn(lp.isCameraEnabled);
      setShareOn(lp.isScreenShareEnabled);
    };
    sync();
    room.on('localTrackPublished', sync);
    room.on('localTrackUnpublished', sync);
    return () => {
      room.off('localTrackPublished', sync);
      room.off('localTrackUnpublished', sync);
    };
  }, [room]);

  const toggleMic = useCallback(async () => {
    if (!room) return;
    const lp = room.localParticipant;
    try {
      await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
    } catch {
      // 재접속 경합 등 — 발행이 재개 후 완료되면 localTrackPublished 이벤트가 상태를 맞춘다
    } finally {
      setMicOn(lp.isMicrophoneEnabled);
    }
  }, [room]);

  const toggleCam = useCallback(async () => {
    if (!room) return;
    const lp = room.localParticipant;
    try {
      await lp.setCameraEnabled(!lp.isCameraEnabled);
    } catch {
      // 상동
    } finally {
      setCamOn(lp.isCameraEnabled);
    }
  }, [room]);

  const toggleShare = useCallback(async () => {
    if (!room) return;
    const lp = room.localParticipant;
    try {
      await lp.setScreenShareEnabled(!lp.isScreenShareEnabled);
    } catch {
      // 상동
    } finally {
      setShareOn(lp.isScreenShareEnabled);
    }
  }, [room]);

  return (
    <div
      className={[
        'inline-flex items-center gap-2 px-4 py-2 rounded-full',
        'bg-bg-surface border border-border-subtle shadow-lg',
        className,
      ].join(' ')}
      role="toolbar"
      aria-label="미디어 컨트롤"
    >
      {/* 마이크 */}
      <CtrlBtn active={micOn} disabled={!connected} onClick={toggleMic} label={micOn ? '마이크 켜짐' : '마이크 음소거'} icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M10 12a3 3 0 003-3V5a3 3 0 00-6 0v4a3 3 0 003 3z" />
          <path fillRule="evenodd" d="M5 9a1 1 0 012 0 3 3 0 006 0 1 1 0 112 0 5 5 0 01-4 4.9V16h2a1 1 0 110 2H7a1 1 0 110-2h2v-2.1A5.001 5.001 0 015 9z" clipRule="evenodd" />
        </svg>
      } />
      {/* 카메라 */}
      <CtrlBtn active={camOn} disabled={!connected} onClick={toggleCam} label={camOn ? '카메라 켜짐' : '카메라 꺼짐'} icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12 2l4-2v8l-4-2V8z" />
        </svg>
      } />
      {/* 화면공유 */}
      <CtrlBtn active={shareOn} disabled={!connected} onClick={toggleShare} label="화면 공유" icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm2 0v6h10V5H5zm5 8a1 1 0 011 1v1h1a1 1 0 110 2H8a1 1 0 110-2h1v-1a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      } />
      {/* 구분선 */}
      <span className="w-px h-6 bg-border-subtle mx-1" />
      {/* 나가기 */}
      <CtrlBtn active={false} danger disabled={!connected} onClick={onLeave} label="통화 종료" icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
        </svg>
      } />
    </div>
  );
}
