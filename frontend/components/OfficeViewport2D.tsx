'use client';

/**
 * OfficeViewport2D — 2.5D 고정 카메라 가상오피스 뷰포트.
 *
 * 렌더 = DOM 합성: 클린 플레이트(배경) + 방 라벨/글로우 + 아바타 스프라이트 레이어.
 * 아바타 위치는 realtime(Colyseus) 서버 권위 상태를 rAF 루프가 imperative하게 소비
 * (20Hz setState 재렌더 회피 — playersRef 패턴은 useOfficeRoom 참조).
 * 서버 미기동 시 로컬 이동 폴백(본인 아바타만, 동일 속도 모델 1.4m/s).
 *
 * 좌표계: 내부 시뮬레이션은 미터(서버와 동일), 화면 배치 직전에만 정규→px 변환.
 * 정본: lib/office2d.ts (씬), realtime/README.md (프로토콜).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUser } from '@/lib/auth';
import { useOfficeRoom } from '@/hooks/useOfficeRoom';
import {
  AVATAR_ANIM,
  AvatarState,
  CharacterId,
  PLATE_URL,
  PLATE_W,
  PLATE_H,
  ROOMS,
  SPAWNS,
  avatarHeightFrac,
  characterFor,
  clampToWalkable,
  isWalkable,
  frameUrl,
  metersToNorm,
  normToMeters,
  pointInPolygon,
  polygonCentroid,
  type Vec2,
} from '@/lib/office2d';

const MAX_SPEED_MPS = 1.4; // realtime config와 동일(로컬 폴백용)
const LERP_RATE = 8; // 표시 위치가 서버 위치를 따라가는 속도(1/s)
const WALK_EPS_MPS = 0.08; // 이 속도 이상이면 walk 애니

interface AvatarVisual {
  root: HTMLDivElement;
  /** 코드 모션(바운스/기울임) 래퍼 — 상태 전환 시 클래스만 교체. */
  motion: HTMLDivElement;
  img: HTMLImageElement;
  /** 표시 위치(미터) — 서버 위치로 보간. */
  disp: Vec2;
  /** 마지막 표시 위치(속도/방향 추정용). */
  prev: Vec2;
  state: AvatarState;
  frame: number;
  frameAcc: number;
  facing: 1 | -1;
  char: CharacterId;
}

/** 로스터 항목(React 셸 렌더용 최소 정보). */
interface ShellInfo {
  key: string;
  char: CharacterId;
  name: string;
  isSelf: boolean;
}

export default function OfficeViewport2D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const { status, roster, playersRef, selfIdRef, requestMove } = useOfficeRoom(true);

  const me = useMemo(() => getUser(), []);
  const myName = me?.name ?? 'Guest';
  const myChar = characterFor(String(me?.id ?? 'guest'));

  // 서버 오프라인 폴백(본인만 로컬 시뮬레이션).
  const offline = status === 'error' || status === 'disconnected';
  const localRef = useRef<{ pos: Vec2; dest: Vec2 | null }>({
    pos: normToMeters(SPAWNS.lobby),
    dest: null,
  });

  // 방 라벨 클릭 글로우.
  const [glowRoom, setGlowRoom] = useState<string | null>(null);

  // ── 스테이지 크기(contain fit) ─────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const scale = Math.min(cw / PLATE_W, ch / PLATE_H);
      setStage({ w: Math.round(PLATE_W * scale), h: Math.round(PLATE_H * scale) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 아바타 셸 목록(React 렌더) ─────────────────────────────────────────
  const shells: ShellInfo[] = useMemo(() => {
    if (offline || roster.length === 0) {
      // 오프라인(또는 아직 미접속): 본인 로컬 아바타만.
      return offline ? [{ key: '__local__', char: myChar, name: myName, isSelf: true }] : [];
    }
    const players = playersRef.current;
    return roster.map((sid) => {
      const p = players.get(sid);
      return {
        key: sid,
        char: characterFor(p?.userId ?? sid),
        name: p?.name ?? '…',
        isSelf: sid === selfIdRef.current,
      };
    });
    // playersRef/selfIdRef는 ref — roster 변경 시점에만 재계산하면 충분.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, offline, myChar, myName]);

  // 아바타 DOM 레지스트리(rAF 루프가 갱신).
  const visualsRef = useRef<Map<string, AvatarVisual>>(new Map());

  const registerAvatar = useCallback(
    (key: string, char: CharacterId) => (el: HTMLDivElement | null) => {
      const visuals = visualsRef.current;
      if (!el) {
        visuals.delete(key);
        return;
      }
      const motion = el.querySelector<HTMLDivElement>('.vo-motion');
      const img = el.querySelector('img');
      if (!motion || !img) return;
      const start =
        key === '__local__'
          ? { ...localRef.current.pos }
          : (() => {
              const p = playersRef.current.get(key);
              return p ? { x: p.x, y: p.y } : normToMeters(SPAWNS.lobby);
            })();
      visuals.set(key, {
        root: el,
        motion,
        img: img as HTMLImageElement,
        disp: { ...start },
        prev: { ...start },
        state: 'idle',
        frame: 0,
        frameAcc: 0,
        facing: 1,
        char,
      });
    },
    // playersRef는 ref라 안정적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 프레임 프리로드(등장한 캐릭터만).
  useEffect(() => {
    const chars = new Set(shells.map((s) => s.char));
    chars.forEach((c) => {
      (['idle', 'walk'] as AvatarState[]).forEach((st) => {
        for (let f = 0; f < AVATAR_ANIM[st].frames; f++) {
          const im = new Image();
          im.src = frameUrl(c, st, f);
        }
      });
    });
  }, [shells]);

  // ── rAF 시뮬레이션/렌더 루프 ───────────────────────────────────────────
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w: sw, h: sh } = stageRef.current;
      const visuals = visualsRef.current;

      // 로컬 폴백 이동 통합(서버와 동일 속도 모델).
      if (offlineRef.current) {
        const L = localRef.current;
        if (L.dest) {
          const dx = L.dest.x - L.pos.x;
          const dy = L.dest.y - L.pos.y;
          const d = Math.hypot(dx, dy);
          if (d < 0.05) L.dest = null;
          else {
            const step = Math.min(d, MAX_SPEED_MPS * dt);
            const next = { x: L.pos.x + (dx / d) * step, y: L.pos.y + (dy / d) * step };
            // 서버와 동일 규칙: 가구/경계에 막히면 정지(직선 이동만, 경로탐색 없음).
            if (isWalkable(metersToNorm(next))) {
              L.pos = next;
            } else {
              L.dest = null;
            }
          }
        }
      }

      if (sw > 0) {
        visuals.forEach((v, key) => {
          // 목표 위치(미터): 서버 권위 or 로컬.
          let target: Vec2 | null = null;
          if (key === '__local__') {
            target = localRef.current.pos;
          } else {
            const p = playersRef.current.get(key);
            if (p) target = { x: p.x, y: p.y };
          }
          if (!target) return;

          // 표시 위치 보간.
          const k = Math.min(1, LERP_RATE * dt);
          v.disp.x += (target.x - v.disp.x) * k;
          v.disp.y += (target.y - v.disp.y) * k;

          // 속도로 idle/walk + 방향 판정.
          const vx = (v.disp.x - v.prev.x) / Math.max(dt, 1e-4);
          const vy = (v.disp.y - v.prev.y) / Math.max(dt, 1e-4);
          const speed = Math.hypot(vx, vy);
          const nextState: AvatarState = speed > WALK_EPS_MPS ? 'walk' : 'idle';
          if (Math.abs(vx) > 0.05) v.facing = vx < 0 ? -1 : 1;
          if (nextState !== v.state) {
            v.state = nextState;
            v.frame = 0;
            v.frameAcc = 0;
            v.motion.className = `vo-motion vo-anim-${nextState}`;
          }
          v.prev = { ...v.disp };

          // 프레임 애니.
          const anim = AVATAR_ANIM[v.state];
          v.frameAcc += dt;
          const frameDur = 1 / anim.fps;
          if (v.frameAcc >= frameDur) {
            v.frameAcc %= frameDur;
            v.frame = (v.frame + 1) % anim.frames;
            v.img.src = frameUrl(v.char, v.state, v.frame);
          }

          // 화면 배치. 높이는 깊이(원근) 기반 — 뒤쪽일수록 작게.
          const n = metersToNorm(v.disp);
          const px = n.x * sw;
          const py = n.y * sh;
          v.root.style.left = `${px}px`;
          v.root.style.top = `${py}px`;
          v.root.style.zIndex = String(Math.round(n.y * 10000));
          v.img.style.height = `${avatarHeightFrac(n.y, v.state) * sh}px`;
          v.img.style.transform = `scaleX(${v.facing})`;
        });
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // playersRef/localRef는 ref — 루프는 마운트당 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 클릭 이동 ──────────────────────────────────────────────────────────
  const handleStageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const n: Vec2 = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      const clamped = clampToWalkable(n);
      const m = normToMeters(clamped);
      if (offlineRef.current) localRef.current.dest = m;
      else requestMove(m.x, m.y);
      // 방 폴리곤 안 클릭이면 글로우도.
      const room = ROOMS.find((rm) => pointInPolygon(n, rm.polygon));
      if (room) setGlowRoom(room.id);
    },
    [requestMove],
  );

  // ── 연결 상태 칩 ───────────────────────────────────────────────────────
  const statusChip =
    status === 'connected'
      ? { text: '실시간 연결됨', color: '#22C55E' }
      : status === 'connecting' || status === 'reconnecting'
        ? { text: '이동서버 연결 중…', color: '#F59E0B' }
        : { text: '오프라인 모드 (로컬 이동)', color: '#64748B' };

  const glowRect = useMemo(() => {
    const room = ROOMS.find((r) => r.id === glowRoom);
    if (!room) return null;
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }, [glowRoom]);

  return (
    <div ref={containerRef} className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {/* 스테이지 = 플레이트 비율 고정(contain) */}
      <div
        className="relative select-none"
        style={{ width: stage.w, height: stage.h, cursor: 'pointer' }}
        onClick={handleStageClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={PLATE_URL}
          alt="가상오피스 평면"
          draggable={false}
          className="absolute inset-0 w-full h-full"
        />

        {/* 방 클릭 글로우 (overlay-tokens.activeGlow) */}
        {glowRect && (
          <div
            className="absolute pointer-events-none transition-opacity duration-300"
            style={{
              left: `${glowRect.left * 100}%`,
              top: `${glowRect.top * 100}%`,
              width: `${glowRect.w * 100}%`,
              height: `${glowRect.h * 100}%`,
              border: '3px solid #2E7BFF',
              borderRadius: 10,
              boxShadow: '0 0 18px #2E7BFF, inset 0 0 18px rgba(46,123,255,.25)',
              zIndex: 20000,
            }}
          />
        )}

        {/* 방 라벨 (overlay-tokens.roomLabel) */}
        {ROOMS.map((room) => {
          const c = polygonCentroid(room.polygon);
          return (
            <button
              key={room.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setGlowRoom((cur) => (cur === room.id ? null : room.id));
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 px-3 py-1.5 rounded-[14px] text-[12px] font-bold text-white"
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                background: 'rgba(7,14,27,.88)',
                border: '1px solid rgba(255,255,255,.14)',
                zIndex: 21000,
              }}
            >
              {room.label}
            </button>
          );
        })}

        {/* 아바타 레이어 */}
        {shells.map((s) => (
          <div
            key={s.key}
            ref={registerAvatar(s.key, s.char)}
            className="absolute pointer-events-none"
            style={{ transform: 'translate(-50%, -100%)', willChange: 'left, top' }}
          >
            {/* 접지 그림자 */}
            <div
              className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2"
              style={{
                width: '58%',
                height: 12,
                borderRadius: '50%',
                background: 'radial-gradient(ellipse, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 70%)',
              }}
            />
            {/* 코드 모션 래퍼(바운스) 안에 프레임 이미지 — flip(scaleX)은 img, 바운스는 래퍼로 분리 */}
            <div className="vo-motion vo-anim-idle">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={frameUrl(s.char, 'idle', 0)}
                alt={s.name}
                draggable={false}
                style={{ display: 'block', transformOrigin: '50% 100%' }}
              />
            </div>
            {/* 이름표 */}
            <div
              className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold text-white flex items-center gap-1"
              style={{
                top: -20,
                background: 'rgba(7,16,29,.92)',
                border: s.isSelf ? '1px solid #3B5BFE' : '1px solid rgba(255,255,255,.14)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#38D67A' }} />
              {s.name}
              {s.isSelf ? ' (나)' : ''}
            </div>
          </div>
        ))}

        {/* 연결 상태 칩 */}
        <div
          className="absolute left-3 top-3 px-2.5 py-1 rounded-lg text-[10px] font-medium tracking-wide flex items-center gap-1.5 pointer-events-none"
          style={{ background: 'rgba(13,27,54,.78)', backdropFilter: 'blur(6px)', zIndex: 22000 }}
        >
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: statusChip.color }} />
          <span className="text-text-secondary">{statusChip.text}</span>
        </div>
      </div>
    </div>
  );
}
