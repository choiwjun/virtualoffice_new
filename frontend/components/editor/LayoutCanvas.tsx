"use client";

import { useMemo } from "react";
import { Stage, Layer, Rect, Line, Group, Circle, Text } from "react-konva";
import type Konva from "konva";
import type { LayoutJson, LayoutSeat } from "@/lib/api";

const CANVAS_W = 720;
const CANVAS_H = 520;
const PAD = 24;
const SNAP_M = 0.5; // 스냅 그리드 0.5m

const SEAT_COLOR: Record<string, string> = {
  fixed: "#22c55e",
  free: "#38bdf8",
  temp: "#f59e0b",
  partner: "#a78bfa",
};

function snap(v: number): number {
  return Math.round(v / SNAP_M) * SNAP_M;
}

export interface LayoutCanvasProps {
  layout: LayoutJson;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  // 절대 미터 좌표(min 오프셋 포함)를 그대로 전달한다.
  onMoveSeat: (index: number, x: number, y: number) => void;
}

export default function LayoutCanvas({ layout, selectedIndex, onSelect, onMoveSeat }: LayoutCanvasProps) {
  const dim = layout.dimensions ?? {};
  const minX = dim.min_x ?? 0;
  const minY = dim.min_y ?? 0;
  const widthM = (dim.max_x != null ? dim.max_x - minX : undefined) ?? dim.width_m ?? 20;
  const heightM = (dim.max_y != null ? dim.max_y - minY : undefined) ?? dim.height_m ?? 15;
  const seats = layout.seats ?? [];

  const scale = useMemo(
    () => Math.min((CANVAS_W - PAD * 2) / widthM, (CANVAS_H - PAD * 2) / heightM),
    [widthM, heightM],
  );

  // 절대 미터 → 픽셀 (min 오프셋 반영)
  const toPx = (m: number, min: number) => PAD + (m - min) * scale;
  const fromPxX = (px: number) => (px - PAD) / scale + minX;
  const fromPxY = (px: number) => (px - PAD) / scale + minY;

  const gridLines: number[][] = [];
  for (let x = 0; x <= widthM; x += 1)
    gridLines.push([PAD + x * scale, PAD, PAD + x * scale, PAD + heightM * scale]);
  for (let y = 0; y <= heightM; y += 1)
    gridLines.push([PAD, PAD + y * scale, PAD + widthM * scale, PAD + y * scale]);

  return (
    <Stage
      width={CANVAS_W}
      height={CANVAS_H}
      onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.target === e.target.getStage()) onSelect(null);
      }}
      style={{ background: "#0f172a", borderRadius: 8 }}
    >
      <Layer>
        <Rect
          x={PAD}
          y={PAD}
          width={widthM * scale}
          height={heightM * scale}
          fill="#111827"
          stroke="#334155"
          strokeWidth={2}
        />
        {gridLines.map((pts, i) => (
          <Line key={i} points={pts} stroke="#1f2937" strokeWidth={1} />
        ))}
        {seats.map((s: LayoutSeat, i: number) => {
          const selected = i === selectedIndex;
          const color = SEAT_COLOR[s.seat_type] ?? "#22c55e";
          const size = 0.8 * scale;
          return (
            <Group
              key={s.seat_id ?? i}
              x={toPx(s.coords?.x ?? 0, minX)}
              y={toPx(s.coords?.y ?? 0, minY)}
              draggable
              onClick={() => onSelect(i)}
              onTap={() => onSelect(i)}
              onDragStart={() => onSelect(i)}
              onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                const nx = Math.max(minX, Math.min(minX + widthM, snap(fromPxX(e.target.x()))));
                const ny = Math.max(minY, Math.min(minY + heightM, snap(fromPxY(e.target.y()))));
                e.target.position({ x: toPx(nx, minX), y: toPx(ny, minY) });
                onMoveSeat(i, nx, ny);
              }}
            >
              <Rect
                x={-size / 2}
                y={-size / 2}
                width={size}
                height={size}
                cornerRadius={4}
                fill={color}
                opacity={selected ? 1 : 0.85}
                stroke={selected ? "#ffffff" : "#0f172a"}
                strokeWidth={selected ? 2 : 1}
              />
              <Circle x={0} y={-size / 2} radius={2.5} fill="#0f172a" />
              <Text
                text={s.seat_id ?? String(i + 1)}
                x={-size}
                y={size / 2 + 2}
                width={size * 2}
                align="center"
                fontSize={9}
                fill="#94a3b8"
              />
            </Group>
          );
        })}
      </Layer>
    </Stage>
  );
}
