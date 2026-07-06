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
  width,
  height,
  onMove,
  onDelete,
}: {
  seats: SeatBox[];
  width: number;
  height: number;
  onMove: (id: string, x: number, y: number) => void;
  onDelete?: (id: string) => void;
}) {
  // floor grid lines
  const grid: number[][] = [];
  for (let x = 0; x <= width; x += 40) grid.push([x, 0, x, height]);
  for (let y = 0; y <= height; y += 40) grid.push([0, y, width, y]);

  return (
    <Stage width={width} height={height}>
      <Layer listening={false}>
        {grid.map((pts, i) => (
          <Line key={i} points={pts} stroke="#eef2f7" strokeWidth={1} />
        ))}
      </Layer>
      <Layer>
        {seats.map((s) => (
          <Group
            key={s.id}
            x={s.x}
            y={s.y}
            draggable
            onDragEnd={(e) => onMove(s.id, Math.round(e.target.x()), Math.round(e.target.y()))}
            onDblClick={() => onDelete?.(s.id)}
            onDblTap={() => onDelete?.(s.id)}
          >
            <Rect
              width={W}
              height={H}
              cornerRadius={8}
              fill={STATUS_FILL[s.status] ?? '#eef2ff'}
              stroke={STATUS_STROKE[s.status] ?? '#6366f1'}
              strokeWidth={2}
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
