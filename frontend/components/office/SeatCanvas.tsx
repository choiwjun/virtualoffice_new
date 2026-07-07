'use client';

import { Stage, Layer, Rect, Text, Group, Line } from 'react-konva';

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

const STATUS_FILL: Record<string, string> = {
  available: '#dcfce7',
  occupied: '#fee2e2',
  reserved: '#fef9c3',
  disabled: '#e5e7eb',
};
const STATUS_STROKE: Record<string, string> = {
  available: '#16a34a',
  occupied: '#dc2626',
  reserved: '#ca8a04',
  disabled: '#9ca3af',
};

const W = 96;
const H = 64;

export default function SeatCanvas({
  seats,
  rooms = [],
  zones = [],
  walls = [],
  width,
  height,
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
  width: number;
  height: number;
  onMove: (id: string, x: number, y: number) => void;
  onDelete?: (id: string) => void;
  onMoveShape?: (kind: ShapeKind, id: string, x: number, y: number) => void;
  onSelect?: (sel: Selection) => void;
  selected?: Selection;
}) {
  const grid: number[][] = [];
  for (let x = 0; x <= width; x += 40) grid.push([x, 0, x, height]);
  for (let y = 0; y <= height; y += 40) grid.push([0, y, width, y]);

  const isSel = (kind: string, id: string) => selected?.kind === kind && selected?.id === id;

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
          cornerRadius={kind === 'wall' ? 0 : 4}
          fill={s.color ? `${s.color}22` : fill}
          stroke={isSel(kind, s.id) ? '#4f46e5' : s.color ?? stroke}
          strokeWidth={isSel(kind, s.id) ? 3 : 2}
          dash={kind === 'zone' ? [8, 4] : undefined}
        />
        {s.label && <Text x={6} y={6} text={s.label} fontSize={12} fontStyle="bold" fill={stroke} />}
      </Group>
    ));

  return (
    <Stage width={width} height={height} onMouseDown={(e) => { if (e.target === e.target.getStage()) onSelect?.(null); }}>
      <Layer listening={false}>
        {grid.map((pts, i) => (
          <Line key={i} points={pts} stroke="#eef2f7" strokeWidth={1} />
        ))}
      </Layer>
      {/* zones (bottom) */}
      <Layer>{shapeLayer('zone', zones, '#3498db22', '#2563eb')}</Layer>
      {/* rooms */}
      <Layer>{shapeLayer('room', rooms, '#f5f3ff', '#7c3aed')}</Layer>
      {/* walls */}
      <Layer>{shapeLayer('wall', walls, '#78350f', '#78350f')}</Layer>
      {/* seats (top) */}
      <Layer>
        {seats.map((s) => (
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
            <Rect
              width={W}
              height={H}
              cornerRadius={8}
              fill={STATUS_FILL[s.status] ?? '#eef2ff'}
              stroke={isSel('seat', s.id) ? '#4f46e5' : STATUS_STROKE[s.status] ?? '#6366f1'}
              strokeWidth={isSel('seat', s.id) ? 3 : 2}
              shadowColor="#000"
              shadowOpacity={0.06}
              shadowBlur={4}
              dash={s.local ? [6, 4] : undefined}
            />
            <Text x={8} y={10} text={s.label} fontSize={13} fontStyle="bold" fill="#1f2937" width={W - 16} />
            <Text x={8} y={34} text={s.type} fontSize={10} fill="#6b7280" />
            <Text x={8} y={46} text={s.status} fontSize={10} fill={STATUS_STROKE[s.status] ?? '#6366f1'} />
          </Group>
        ))}
      </Layer>
    </Stage>
  );
}
