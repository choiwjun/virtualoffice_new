/**
 * geometry.ts — pure 2D floor-plane geometry helpers shared by movement and
 * proximity validation. No Colyseus / no I/O — trivially unit-testable.
 */

import type { Rect, WallSegment } from "../integration/FloorLayoutProvider";

export interface Vec2 {
  x: number;
  y: number;
}

/** Euclidean distance on the floor plane. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Is point inside an axis-aligned rectangle (inclusive edges)? */
export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * Do segments p1->p2 and p3->p4 properly intersect?
 * Standard orientation test. Used for both collision (movement path crosses a
 * wall) and LOS (sightline crosses a wall).
 */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross(sub(p3, p4), sub(p3, p1));
  const d2 = cross(sub(p3, p4), sub(p3, p2));
  const d3 = cross(sub(p1, p2), sub(p1, p3));
  const d4 = cross(sub(p1, p2), sub(p1, p4));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/** True if the straight path a->b crosses any (blocking) wall segment. */
export function pathCrossesWalls(a: Vec2, b: Vec2, walls: WallSegment[]): boolean {
  for (const w of walls) {
    if (segmentsIntersect(a, b, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })) return true;
  }
  return false;
}

/**
 * True if the sightline a->b is occluded by any opaque wall.
 * Glass walls do not block LOS (they block movement only). This is the LOS
 * ray-intersection used by proximity check #5.
 */
export function losBlocked(a: Vec2, b: Vec2, walls: WallSegment[]): boolean {
  for (const w of walls) {
    if (w.glass) continue; // glass: transparent to sightline
    if (segmentsIntersect(a, b, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })) return true;
  }
  return false;
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}
