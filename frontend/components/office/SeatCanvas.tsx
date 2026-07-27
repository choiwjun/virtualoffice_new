'use client';

/**
 * SeatCanvas — 좌석 배치 제도판.
 *
 * 설계 의도: 이 화면을 쓰는 사람은 CAD 경험 없는 총무 담당자다. 그래서 개발자 도구가 아니라
 * **책상 위에 펼친 사무실 도면**처럼 보여야 한다.
 *  - 사무실 경계만 종이(따뜻한 오프화이트)로 칠하고 바깥은 어두운 책상으로 둔다.
 *    "여기까지가 우리 사무실"이 설명 없이 읽힌다. (이전엔 격자가 화면 끝까지 깔려
 *     좌석 11개가 왼쪽 위 구석에 몰린 빈 화면으로 보였다.)
 *  - 격자는 1m 보조선 + 5m 주선. 눈대중으로 거리를 잴 수 있어야 자리 간격을 잡는다.
 *  - 좌석은 번호가 먼저 읽히는 작은 칩. 이전엔 96×64 카드에 영어 enum 3줄(free/available)이라
 *    11석에도 답답했다. 상태는 색과 범례로 옮겼다.
 *  - 확대/이동은 부모가 scale·offset으로 제어한다(전체 보기 기본). 화면에 다 안 들어오면
 *    아래쪽 자리가 잘려 "자리가 사라졌다"로 읽힌다.
 */

import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva';
import { seatStyle } from './seatStyles';

export interface SeatBox {
  id: string;
  label: string;
  x: number;
  y: number;
  status: string;
  type: string;
  local?: boolean;
}

export interface ShapeBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  color?: string;
}

export type ShapeKind = 'room' | 'zone' | 'wall';
export type Selection = { kind: 'seat' | ShapeKind; id: string } | null;

/* ── 제도판 팔레트 — 무채색은 종이 쪽으로 살짝 따뜻하게 틴트(순백/순흑 금지) ── */
export const PAPER = '#F7F5F1';
const GRID_MINOR = '#E8E4DC';
const GRID_MAJOR = '#D3CCC0';
const EDGE = '#A79E8D';
const INK = '#2B2721';
const INK_SOFT = '#7A736A';
const SELECT = '#2F5BD0';

/** 좌석 칩 — 번호가 읽히는 최소 크기(≈1.2m, 실제 책상 폭과 비슷). */
const W = 62;
const H = 42;

export default function SeatCanvas({
  seats,
  rooms = [],
  zones = [],
  walls = [],
  width,
  height,
  pxPerMeter = 50,
  boundsW,
  boundsH,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  onPan,
  onMove,
  onDelete,
  onMoveShape,
  onSelect,
  selected,
}: {
  seats: SeatBox[];
  rooms?: ShapeBox[];
  zones?: ShapeBox[];
  walls?: ShapeBox[];
  /** 보이는 영역 크기(px). */
  width: number;
  height: number;
  /** 1미터가 몇 픽셀인지 — 격자 간격의 근거. */
  pxPerMeter?: number;
  /** 사무실 크기(m). 이 사각형이 곧 종이. */
  boundsW: number;
  boundsH: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  onPan?: (x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDelete?: (id: string) => void;
  onMoveShape?: (kind: ShapeKind, id: string, x: number, y: number) => void;
  onSelect?: (sel: Selection) => void;
  selected?: Selection;
}) {
  const isSel = (kind: string, id: string) => selected?.kind === kind && selected?.id === id;

  const LW = boundsW * pxPerMeter;
  const LH = boundsH * pxPerMeter;
  /** 선 두께는 확대해도 굵어지지 않아야 도면답다. */
  const hair = 1 / scale;

  // 1m 보조선 + 5m 주선. 격자가 곧 자(尺)다.
  const minor: number[][] = [];
  const major: number[][] = [];
  for (let m = 1; m * pxPerMeter < LW; m++) {
    const x = m * pxPerMeter;
    (m % 5 === 0 ? major : minor).push([x, 0, x, LH]);
  }
  for (let m = 1; m * pxPerMeter < LH; m++) {
    const y = m * pxPerMeter;
    (m % 5 === 0 ? major : minor).push([0, y, LW, y]);
  }

  const shapeLayer = (kind: ShapeKind, items: ShapeBox[], fill: string, stroke: string) =>
    items.map((s) => (
      <Group
        key={`${kind}-${s.id}`}
        x={s.x}
        y={s.y}
        draggable
        onClick={() => onSelect?.({ kind, id: s.id })}
        onTap={() => onSelect?.({ kind, id: s.id })}
        onDragEnd={(e) => onMoveShape?.(kind, s.id, Math.round(e.target.x()), Math.round(e.target.y()))}
      >
        <Rect
          width={s.w}
          height={s.h}
          cornerRadius={kind === 'wall' ? 0 : 3}
          fill={s.color ? `${s.color}1A` : fill}
          stroke={isSel(kind, s.id) ? SELECT : s.color ?? stroke}
          strokeWidth={isSel(kind, s.id) ? 2.5 * hair : 1.5 * hair}
          dash={kind === 'zone' ? [7 * hair, 5 * hair] : undefined}
        />
        {s.label && (
          <Text x={6} y={6} text={s.label} fontSize={11} fontStyle="bold" fill={stroke} />
        )}
      </Group>
    ));

  return (
    <Stage
      width={width}
      height={height}
      scaleX={scale}
      scaleY={scale}
      x={offsetX}
      y={offsetY}
      draggable={!!onPan}
      onDragEnd={(e) => {
        // 좌석/도형 드래그는 자식 Group이 소화한다. 여기 오는 건 빈 공간 드래그(화면 이동)뿐.
        if (e.target === e.currentTarget) onPan?.(e.target.x(), e.target.y());
      }}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) onSelect?.(null);
      }}
    >
      {/* 종이(사무실 경계) + 격자 */}
      <Layer listening={false}>
        <Rect
          width={LW}
          height={LH}
          fill={PAPER}
          shadowColor="#000000"
          shadowOpacity={0.4}
          shadowBlur={24 * hair}
          shadowOffsetY={6 * hair}
        />
        {minor.map((pts, i) => (
          <Line key={`n${i}`} points={pts} stroke={GRID_MINOR} strokeWidth={hair} />
        ))}
        {major.map((pts, i) => (
          <Line key={`m${i}`} points={pts} stroke={GRID_MAJOR} strokeWidth={hair} />
        ))}
        <Rect width={LW} height={LH} stroke={EDGE} strokeWidth={1.5 * hair} />
      </Layer>

      <Layer>{shapeLayer('zone', zones, '#3B82F615', '#2563EB')}</Layer>
      <Layer>{shapeLayer('room', rooms, '#7C3AED12', '#6D3FD1')}</Layer>
      <Layer>{shapeLayer('wall', walls, '#6B5B4A', '#5A4C3D')}</Layer>

      {/* 좌석 — 번호 우선, 상태는 색(범례 참조), 고정석만 작은 표식 */}
      <Layer>
        {seats.map((s) => {
          const st = seatStyle(s.status);
          const sel = isSel('seat', s.id);
          const fixed = s.type === 'fixed';
          return (
            <Group
              key={s.id}
              x={s.x}
              y={s.y}
              draggable
              onClick={() => onSelect?.({ kind: 'seat', id: s.id })}
              onTap={() => onSelect?.({ kind: 'seat', id: s.id })}
              onDragEnd={(e) => onMove(s.id, Math.round(e.target.x()), Math.round(e.target.y()))}
              onDblClick={() => onDelete?.(s.id)}
              onDblTap={() => onDelete?.(s.id)}
            >
              {sel && (
                <Rect
                  x={-4}
                  y={-4}
                  width={W + 8}
                  height={H + 8}
                  cornerRadius={9}
                  stroke={SELECT}
                  strokeWidth={2 * hair}
                />
              )}
              <Rect
                width={W}
                height={H}
                cornerRadius={6}
                fill={st.fill}
                stroke={st.stroke}
                strokeWidth={(sel ? 2 : 1.5) * hair}
                shadowColor="#2B2721"
                shadowOpacity={0.1}
                shadowBlur={3 * hair}
                shadowOffsetY={1 * hair}
                // 점선 = 아직 저장되지 않은 좌석(범례에 명시)
                dash={s.local ? [5 * hair, 4 * hair] : undefined}
              />
              <Text
                x={0}
                y={fixed ? 9 : 14}
                width={W}
                align="center"
                text={s.label}
                fontSize={13}
                fontStyle="bold"
                fill={INK}
              />
              {fixed && (
                <Text x={0} y={26} width={W} align="center" text="고정석" fontSize={9} fill={INK_SOFT} />
              )}
              {s.status === 'occupied' && <Circle x={W - 9} y={9} radius={3.5} fill={st.stroke} />}
            </Group>
          );
        })}
      </Layer>
    </Stage>
  );
}
