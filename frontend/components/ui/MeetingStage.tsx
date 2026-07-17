'use client';

/**
 * MeetingStage — 회의 화상 그리드(C3 화상 표시). 연결된 LiveKit Room의 참가자별
 * 카메라/화면공유 비디오 트랙을 <video>에 attach하고, 원격 오디오를 <audio>로 재생한다.
 * MediaBar(컨트롤)만 있고 화상이 안 보이던 결함(2026-07-17 다중접속 QA 실측) 수리.
 */

import { useEffect, useReducer, useRef } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Participant, Room, TrackPublication } from 'livekit-client';

/** Room 이벤트로 참가자/트랙이 바뀔 때 리렌더를 유발하는 리비전 카운터. */
function useRoomRevision(room: Room | null): number {
  const [rev, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!room) return;
    const events: RoomEvent[] = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ];
    events.forEach((e) => room.on(e, bump));
    return () => { events.forEach((e) => room.off(e, bump)); };
  }, [room]);
  return rev;
}

function initial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function ParticipantTile({ participant, isLocal, rev }: { participant: Participant; isLocal: boolean; rev: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const attachedVideo = useRef<Track | null>(null);
  const attachedAudio = useRef<Track | null>(null);

  // 카메라(없으면 화면공유) 비디오 트랙 attach — 트랙이 실제로 바뀔 때만 재부착(rev 잦은 변화에도 안정).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const camPub = participant.getTrackPublication(Track.Source.Camera);
    const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
    const pub: TrackPublication | undefined =
      screenPub?.track && !screenPub.isMuted ? screenPub : camPub;
    const track = pub && !pub.isMuted ? pub.track ?? null : null;
    if (track === attachedVideo.current) return;
    if (attachedVideo.current) attachedVideo.current.detach(el);
    attachedVideo.current = track;
    if (track) {
      track.attach(el);
      void el.play?.().catch(() => {});
    }
  }, [participant, rev]);

  // 원격 오디오 재생(본인 오디오는 에코 방지로 재생 안 함).
  useEffect(() => {
    const el = audioRef.current;
    if (!el || isLocal) return;
    const micPub = participant.getTrackPublication(Track.Source.Microphone);
    const track = micPub?.track ?? null;
    if (track === attachedAudio.current) return;
    if (attachedAudio.current) attachedAudio.current.detach(el);
    attachedAudio.current = track;
    if (track) {
      track.attach(el);
      void el.play?.().catch(() => {});
    }
  }, [participant, isLocal, rev]);

  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
  const videoOn = (!!camPub?.track && !camPub.isMuted) || (!!screenPub?.track && !screenPub.isMuted);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  const micOn = !!micPub?.track && !micPub.isMuted;
  const speaking = participant.isSpeaking;
  const name = participant.name || participant.identity || '참가자';

  return (
    <div
      className="relative rounded-lg overflow-hidden bg-[#0a1428] flex-shrink-0"
      style={{ width: 160, height: 96, outline: speaking ? '2px solid #22C55E' : '1px solid rgba(255,255,255,.12)' }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-cover"
        style={{ display: videoOn ? 'block' : 'none', transform: isLocal ? 'scaleX(-1)' : undefined }}
      />
      {!isLocal && <audio ref={audioRef} autoPlay />}
      {!videoOn && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-primary/80 text-white flex items-center justify-center text-sm font-bold">
            {initial(name)}
          </div>
        </div>
      )}
      <div className="absolute left-1 bottom-1 right-1 flex items-center gap-1">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white bg-black/55 truncate max-w-[100px]">
          {name}{isLocal ? ' (나)' : ''}
        </span>
        <span
          className="ml-auto w-4 h-4 rounded-full flex items-center justify-center text-[9px]"
          style={{ background: micOn ? 'rgba(34,197,94,.85)' : 'rgba(239,68,68,.85)', color: '#fff' }}
          title={micOn ? '마이크 켜짐' : '마이크 꺼짐'}
        >
          {micOn ? '🎤' : '🔇'}
        </span>
      </div>
    </div>
  );
}

export function MeetingStage({ room }: { room: Room | null }) {
  const rev = useRoomRevision(room);
  if (!room) return null;
  const participants: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];

  return (
    <div className="flex items-center gap-2 px-2 py-2 rounded-xl bg-bg-surface/85 border border-border-subtle shadow-lg max-w-[70vw] overflow-x-auto">
      {participants.map((p) => (
        <ParticipantTile key={p.sid || p.identity} participant={p} isLocal={p === room.localParticipant} rev={rev} />
      ))}
    </div>
  );
}
