import type { Viewport } from "../canvas/engine/viewport";
import { clamp } from "../canvas/math";
import { VIEWPORT_LIMITS } from "../canvas/engine/viewport";

const KEY_PREFIX = "whiteboard:viewport:v1:";

type StoredViewport = { scale: number; tx: number; ty: number };

function isStoredViewport(v: unknown): v is StoredViewport {
  return (
    typeof (v as { scale?: unknown }).scale === "number" &&
    typeof (v as { tx?: unknown }).tx === "number" &&
    typeof (v as { ty?: unknown }).ty === "number"
  );
}

export function loadViewport(boardId: string): Viewport | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${boardId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredViewport(parsed)) return null;
    const scale = clamp(parsed.scale, VIEWPORT_LIMITS.minScale, VIEWPORT_LIMITS.maxScale);
    return { scale, tx: parsed.tx, ty: parsed.ty };
  } catch {
    return null;
  }
}

export function saveViewport(boardId: string, viewport: Viewport): void {
  try {
    const v: StoredViewport = { scale: viewport.scale, tx: viewport.tx, ty: viewport.ty };
    localStorage.setItem(`${KEY_PREFIX}${boardId}`, JSON.stringify(v));
  } catch {
    // ignore
  }
}

