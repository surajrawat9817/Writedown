export type Point = { x: number; y: number };

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  const m = 10 ** decimals;
  return Math.round(value * m) / m;
}

export function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dist(a: Point, b: Point): number {
  return Math.sqrt(dist2(a, b));
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(p: Point, scalar: number): Point {
  return { x: p.x * scalar, y: p.y * scalar };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y)
  };
}

export function rectWidth(r: Rect): number {
  return Math.max(0, r.maxX - r.minX);
}

export function rectHeight(r: Rect): number {
  return Math.max(0, r.maxY - r.minY);
}

export function rectCenter(r: Rect): Point {
  return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
}

export function expandRect(r: Rect, pad: number): Rect {
  return { minX: r.minX - pad, minY: r.minY - pad, maxX: r.maxX + pad, maxY: r.maxY + pad };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function rotateAround(p: Point, center: Point, angleRad: number): Point {
  const s = Math.sin(angleRad);
  const c = Math.cos(angleRad);
  const px = p.x - center.x;
  const py = p.y - center.y;
  return { x: center.x + px * c - py * s, y: center.y + px * s + py * c };
}

export function snap(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapPoint(p: Point, grid: number): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function pointToString(p: Point): string {
  return `${round(p.x, 2)},${round(p.y, 2)}`;
}

