import type { Point, Rect } from "../math";
import { clamp } from "../math";

export type Viewport = {
  scale: number;
  tx: number; // screen px
  ty: number; // screen px
};

export const VIEWPORT_LIMITS = {
  minScale: 0.1,
  maxScale: 10
} as const;

export function worldToScreen(p: Point, v: Viewport): Point {
  return { x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty };
}

export function screenToWorld(p: Point, v: Viewport): Point {
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale };
}

export function screenRectToWorldRect(screen: Rect, v: Viewport): Rect {
  const a = screenToWorld({ x: screen.minX, y: screen.minY }, v);
  const b = screenToWorld({ x: screen.maxX, y: screen.maxY }, v);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y)
  };
}

export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, tx: v.tx + dx, ty: v.ty + dy };
}

export function zoomAt(v: Viewport, cursorScreen: Point, nextScaleRaw: number): Viewport {
  const nextScale = clamp(nextScaleRaw, VIEWPORT_LIMITS.minScale, VIEWPORT_LIMITS.maxScale);
  if (nextScale === v.scale) return v;

  const worldUnderCursor = screenToWorld(cursorScreen, v);
  const nextTx = cursorScreen.x - worldUnderCursor.x * nextScale;
  const nextTy = cursorScreen.y - worldUnderCursor.y * nextScale;
  return { scale: nextScale, tx: nextTx, ty: nextTy };
}

