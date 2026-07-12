import * as THREE from 'three';

export interface ObstacleRect { minX: number; minY: number; maxX: number; maxY: number; }
interface GridNode { x: number; y: number; f: number; g: number; h: number; parent?: GridNode; }

export class GridNav {
  constructor(
    public bounds: [number, number, number, number] = [-7, -5, 7, 5],
    public cellSize = 0.28,
    public avatarRadius = 0.28,
  ) {}

  obstacles: ObstacleRect[] = [];

  setObstacles(obstacles: ObstacleRect[]): void { this.obstacles = obstacles; }

  private worldToGrid(p: THREE.Vector3): [number, number] {
    return [Math.round((p.x - this.bounds[0]) / this.cellSize), Math.round((p.y - this.bounds[1]) / this.cellSize)];
  }
  private gridToWorld(x: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(this.bounds[0] + x * this.cellSize, this.bounds[1] + y * this.cellSize, 0);
  }
  private blocked(x: number, y: number): boolean {
    const p = this.gridToWorld(x, y);
    if (p.x < this.bounds[0] || p.y < this.bounds[1] || p.x > this.bounds[2] || p.y > this.bounds[3]) return true;
    return this.obstacles.some((o) =>
      p.x >= o.minX - this.avatarRadius && p.x <= o.maxX + this.avatarRadius &&
      p.y >= o.minY - this.avatarRadius && p.y <= o.maxY + this.avatarRadius
    );
  }
  private key(x: number, y: number): string { return `${x},${y}`; }

  findPath(startWorld: THREE.Vector3, endWorld: THREE.Vector3): THREE.Vector3[] {
    const [sx, sy] = this.worldToGrid(startWorld);
    const [ex, ey] = this.worldToGrid(endWorld);
    if (this.blocked(ex, ey)) return [];
    const open = new Map<string, GridNode>();
    const closed = new Set<string>();
    const start: GridNode = { x: sx, y: sy, g: 0, h: 0, f: 0 };
    open.set(this.key(sx, sy), start);
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ] as const;
    let iterations = 0;
    while (open.size && iterations++ < 16000) {
      let current: GridNode | undefined;
      for (const node of open.values()) if (!current || node.f < current.f) current = node;
      if (!current) break;
      open.delete(this.key(current.x, current.y));
      if (current.x === ex && current.y === ey) {
        const path: THREE.Vector3[] = [];
        let node: GridNode | undefined = current;
        while (node) { path.push(this.gridToWorld(node.x, node.y)); node = node.parent; }
        path.reverse();
        return this.smooth(path);
      }
      closed.add(this.key(current.x, current.y));
      for (const [dx, dy, cost] of dirs) {
        const nx = current.x + dx, ny = current.y + dy;
        const key = this.key(nx, ny);
        if (closed.has(key) || this.blocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (this.blocked(current.x + dx, current.y) || this.blocked(current.x, current.y + dy))) continue;
        const g = current.g + cost;
        const h = Math.hypot(ex - nx, ey - ny);
        const existing = open.get(key);
        if (!existing || g < existing.g) open.set(key, { x: nx, y: ny, g, h, f: g + h, parent: current });
      }
    }
    return [];
  }

  private clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = a.distanceTo(b);
    const steps = Math.max(2, Math.ceil(dist / (this.cellSize * 0.55)));
    for (let i = 1; i < steps; i++) {
      const p = a.clone().lerp(b, i / steps);
      const [gx, gy] = this.worldToGrid(p);
      if (this.blocked(gx, gy)) return false;
    }
    return true;
  }

  private smooth(path: THREE.Vector3[]): THREE.Vector3[] {
    if (path.length <= 2) return path;
    const result = [path[0]!];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let furthest = anchor + 1;
      for (let candidate = path.length - 1; candidate > anchor + 1; candidate--) {
        if (this.clearLine(path[anchor]!, path[candidate]!)) { furthest = candidate; break; }
      }
      result.push(path[furthest]!);
      anchor = furthest;
    }
    return result;
  }
}
