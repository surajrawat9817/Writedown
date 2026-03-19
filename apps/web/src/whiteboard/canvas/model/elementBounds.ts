import type { Element } from "@whiteboard/shared";
import type { Point, Rect } from "../math";
import { expandRect, rotateAround, rectFromPoints } from "../math";

function boundsFromRotatedRect(x: number, y: number, w: number, h: number, rotation: number): Rect {
  const center = { x: x + w / 2, y: y + h / 2 };
  const corners: Point[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h }
  ].map((p) => (rotation ? rotateAround(p, center, rotation) : p));

  let minX = corners[0]?.x ?? x;
  let minY = corners[0]?.y ?? y;
  let maxX = corners[0]?.x ?? x;
  let maxY = corners[0]?.y ?? y;

  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function approxTextSize(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split("\n");
  const longest = lines.reduce((m, line) => Math.max(m, line.length), 0);
  const w = Math.max(1, longest * fontSize * 0.6);
  const h = Math.max(1, lines.length * fontSize * 1.2);
  return { w, h };
}

export function computeElementBounds(el: Element): Rect {
  const strokePad = Math.max(1, el.strokeWidth) / 2;

  switch (el.type) {
    case "rect": {
      const r = boundsFromRotatedRect(el.x, el.y, el.w, el.h, el.rotation);
      return expandRect(r, strokePad);
    }
    case "ellipse": {
      const r = boundsFromRotatedRect(el.x, el.y, el.w, el.h, el.rotation);
      return expandRect(r, strokePad);
    }
    case "line":
    case "arrow": {
      const r = rectFromPoints({ x: el.x, y: el.y }, { x: el.x2, y: el.y2 });
      return expandRect(r, strokePad + 2);
    }
    case "freehand": {
      const points = el.points;
      if (points.length === 0) return expandRect({ minX: el.x, minY: el.y, maxX: el.x, maxY: el.y }, strokePad);

      let minRelX = points[0]!.x;
      let minRelY = points[0]!.y;
      let maxRelX = points[0]!.x;
      let maxRelY = points[0]!.y;

      for (const p of points) {
        minRelX = Math.min(minRelX, p.x);
        minRelY = Math.min(minRelY, p.y);
        maxRelX = Math.max(maxRelX, p.x);
        maxRelY = Math.max(maxRelY, p.y);
      }
      return expandRect(
        { minX: el.x + minRelX, minY: el.y + minRelY, maxX: el.x + maxRelX, maxY: el.y + maxRelY },
        strokePad + 2
      );
    }
    case "text": {
      const { w, h } =
        typeof el.w === "number" && typeof el.h === "number" ? { w: el.w, h: el.h } : approxTextSize(el.text, el.fontSize);
      const r = boundsFromRotatedRect(el.x, el.y, w, h, el.rotation);
      return expandRect(r, 2);
    }
  }
}
