import type { Element } from "@whiteboard/shared";
import type { Point } from "../math";
import { dist2, rotateAround } from "../math";
import { computeElementBounds } from "./elementBounds";

function distPointToSegmentSq(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const closest = { x: a.x + abx * t, y: a.y + aby * t };
  return dist2(p, closest);
}

function hitRotatedRect(
  point: Point,
  rect: { x: number; y: number; w: number; h: number; rotation: number },
  fill: boolean,
  strokePad: number
): boolean {
  const { x, y, w, h, rotation } = rect;
  const center = { x: x + w / 2, y: y + h / 2 };
  const local = rotation ? rotateAround(point, center, -rotation) : point;
  const lx = local.x - x;
  const ly = local.y - y;

  const inside = lx >= 0 && lx <= w && ly >= 0 && ly <= h;
  if (fill) return inside;

  if (!inside) return false;
  const edgeDist = Math.min(lx, w - lx, ly, h - ly);
  return edgeDist <= strokePad;
}

function hitRotatedEllipse(
  point: Point,
  ellipse: { x: number; y: number; w: number; h: number; rotation: number },
  fill: boolean,
  strokePad: number
): boolean {
  const { x, y, w, h, rotation } = ellipse;
  const center = { x: x + w / 2, y: y + h / 2 };
  const local = rotation ? rotateAround(point, center, -rotation) : point;

  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;
  if (rx <= 0.0001 || ry <= 0.0001) return false;

  const dx = (local.x - center.x) / rx;
  const dy = (local.y - center.y) / ry;
  const norm = dx * dx + dy * dy;

  if (fill) return norm <= 1;

  const eps = (strokePad / Math.min(rx, ry)) * 2;
  return Math.abs(norm - 1) <= eps;
}

export function hitTestElement(el: Element, worldPoint: Point, toleranceWorld: number): boolean {
  const strokePad = Math.max(1, el.strokeWidth) / 2 + toleranceWorld;

  switch (el.type) {
    case "rect":
      return hitRotatedRect(
        worldPoint,
        { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation },
        true,
        strokePad
      );
    case "ellipse":
      return hitRotatedEllipse(
        worldPoint,
        { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation },
        true,
        strokePad
      );
    case "line":
    case "arrow": {
      const a = { x: el.x, y: el.y };
      const b = { x: el.x2, y: el.y2 };
      return distPointToSegmentSq(worldPoint, a, b) <= strokePad * strokePad;
    }
    case "freehand": {
      const localPoint = { x: worldPoint.x - el.x, y: worldPoint.y - el.y };
      const pts = el.points;
      if (pts.length === 0) return false;
      if (pts.length === 1) return dist2(localPoint, pts[0]!) <= strokePad * strokePad;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (distPointToSegmentSq(localPoint, a, b) <= strokePad * strokePad) return true;
      }
      return false;
    }
    case "text": {
      const b = computeElementBounds(el);
      return worldPoint.x >= b.minX && worldPoint.x <= b.maxX && worldPoint.y >= b.minY && worldPoint.y <= b.maxY;
    }
  }
}
