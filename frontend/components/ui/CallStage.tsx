'use client';

/**
 * CallStage — 1:1 즉석 통화 화면 (09 §3.3 상호작용 · D24 LiveKit).
 *
 * 회의(MeetingStage)는 회의실 예약 모델의 다자 화면이고, 이쪽은 옆자리 사람에게 말 거는
 * 즉석 통화라 **작은 플로팅 창**으로 띄운다 — 사무실 씬을 가리지 않아야 "옆에서 잠깐
 * 이야기한다"는 맥락이 유지된다.
 *
 * 미디어 트랙 부착은 LiveKit SDK가 준 MediaStreamTrack을 <video>/<audio>에 직접 붙인다.
 * 마이크·카메라 권한 거부는 통화 자체를 막지 않는다(상대 소리는 들린다).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RoomEvent,
  Track,
  type RemoteTrack,
  type Room,
  type RemoteParticipant,
} from 'livekit-client';
import { connectToCall, disconnectRoom } from '@/lib/livekit';
import { ApiError } from '@/lib/api';

export function CallStage({
  peerUserId,
  peerName,
  onEnd,
  onError,
}: {
  peerUserId: string;
  peerName: string;
  onEnd: () => void;
  onError: (message: string) => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [peerJoined, setPeerJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const attach = useCallback((track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video && videoRef.current) {
      track.attach(videoRef.current);
      setPeerJoined(true);
    } else if (track.kind === Track.Kind.Audio && audioRef.current) {
      track.attach(audioRef.current);
      setPeerJoined(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const room = await connectToCall(peerUserId);
        if (cancelled) {
          await disconnectRoom(room);
          return;
        }
        roomRef.current = room;
        setConnected(true);

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => attach(track));
        room.on(RoomEvent.ParticipantDisconnected, (_p: RemoteParticipant) => {
          // 상대가 끊으면 통화 종료 — 혼자 남은 창을 계속 띄우지 않는다.
          if (room.numParticipants <= 1) onEnd();
        });
        room.on(RoomEvent.Disconnected, () => onEnd());

        // 이미 붙어 있는 트랙(먼저 들어온 상대) 부착
        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track) attach(pub.track as RemoteTrack);
          });
        });

        // 마이크·카메라 — 권한 거부는 통화를 막지 않는다(수신은 가능).
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          setMicOn(false);
        }
        try {
          await room.localParticipant.setCameraEnabled(true);
          const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
          if (camPub?.track && selfVideoRef.current) camPub.track.attach(selfVideoRef.current);
        } catch {
          setCamOn(false);
        }
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof ApiError ? err.message : '통화에 연결하지 못했습니다');
        }
      }
    })();
    return () => {
      cancelled = true;
      void disconnectRoom(roomRef.current);
      roomRef.current = null;
    };
    // peerUserId가 바뀌면 새 통화 — 그 외 콜백 변화로 재연결하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerUserId]);

  // 통화 시간 표시
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [connected]);

  async function toggleMic() {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    const next = !micOn;
    try {
      await lp.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch {
      /* 권한 없음 — 상태 유지 */
    }
  }

  async function toggleCam() {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    const next = !camOn;
    try {
      await lp.setCameraEnabled(next);
      setCamOn(next);
      const pub = lp.getTrackPublication(Track.Source.Camera);
      if (next && pub?.track && selfVideoRef.current) pub.track.attach(selfVideoRef.current);
    } catch {
      /* 권한 없음 */
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div
      role="dialog"
      aria-label={`${peerName} 님과 통화 중`}
      className="absolute right-4 top-20 w-[300px] rounded-2xl overflow-hidden shadow-2xl vo-modal-panel"
      style={{ background: 'rgba(7,16,29,.97)', border: '1px solid rgba(255,255,255,.16)', zIndex: 24000 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 h-9 border-b border-white/10">
        <span className="text-[12px] font-semibold text-white truncate">{peerName}</span>
        <span className="text-[11px] text-white/50 tabular-nums">
          {connected ? mmss : '연결 중…'}
        </span>
      </div>

      <div className="relative bg-black" style={{ aspectRatio: '4 / 3' }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        {!peerJoined && (
          <div className="absolute inset-0 grid place-items-center text-[12px] text-white/60">
            {connected ? '상대 연결을 기다리는 중…' : '연결 중…'}
          </div>
        )}
        {/* 내 화면 미리보기(PiP) */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={selfVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute right-2 bottom-2 w-[76px] rounded-md border border-white/20 object-cover"
          style={{ aspectRatio: '4 / 3', display: camOn ? 'block' : 'none' }}
        />
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} autoPlay />

      <div className="flex items-center justify-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={toggleMic}
          aria-pressed={micOn}
          title={micOn ? '마이크 끄기' : '마이크 켜기'}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white border border-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
          style={{ background: micOn ? 'transparent' : 'rgba(239,68,68,.25)' }}
        >
          {micOn ? '🎙 마이크' : '🔇 음소거'}
        </button>
        <button
          type="button"
          onClick={toggleCam}
          aria-pressed={camOn}
          title={camOn ? '카메라 끄기' : '카메라 켜기'}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white border border-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
          style={{ background: camOn ? 'transparent' : 'rgba(239,68,68,.25)' }}
        >
          {camOn ? '📹 카메라' : '📵 꺼짐'}
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
          style={{ background: 'rgb(var(--color-danger))' }}
        >
          종료
        </button>
      </div>
    </div>
  );
}
