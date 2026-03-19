import type { Element } from "@whiteboard/shared";
import { getStroke } from "perfect-freehand";
import type { Point, Rect } from "../math";
import { clamp, rectCenter, rectFromPoints, rectHeight, rectWidth } from "../math";
import type { Viewport } from "../engine/viewport";
import { screenToWorld } from "../engine/viewport";

function setStyle(ctx: CanvasRenderingContext2D, el: Element): void {
  ctx.globalAlpha = clamp(el.opacity, 0, 1);
  ctx.lineWidth = Math.max(0.5, el.strokeWidth);
  ctx.strokeStyle = el.strokeColor;
  ctx.fillStyle = el.fillColor ?? "transparent";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function drawRoundedRectPath(ctx: CanvasRenderingContext2D, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2));
  const x = -w / 2;
  const y = -h / 2;
  ctx.beginPath();
  if (radius === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, a: Point, b: Point, size: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const left = angle + Math.PI * 0.85;
  const right = angle - Math.PI * 0.85;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x + Math.cos(left) * size, b.y + Math.sin(left) * size);
  ctx.lineTo(b.x + Math.cos(right) * size, b.y + Math.sin(right) * size);
  ctx.closePath();
  ctx.fill();
}

function drawStrokeOutline(ctx: CanvasRenderingContext2D, outline: ReadonlyArray<readonly [number, number]>): void {
  if (outline.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(outline[0]![0], outline[0]![1]);
  for (let i = 1; i < outline.length; i += 1) {
    ctx.lineTo(outline[i]![0], outline[i]![1]);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawElement(ctx: CanvasRenderingContext2D, el: Element): void {
  ctx.save();
  setStyle(ctx, el);

  switch (el.type) {
    case "rect": {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      ctx.translate(cx, cy);
      if (el.rotation) ctx.rotate(el.rotation);
      drawRoundedRectPath(ctx, el.w, el.h, el.cornerRadius);
      if (el.fillColor) ctx.fill();
      ctx.stroke();
      break;
    }
    case "ellipse": {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      ctx.translate(cx, cy);
      if (el.rotation) ctx.rotate(el.rotation);
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.abs(el.w) / 2, Math.abs(el.h) / 2, 0, 0, Math.PI * 2);
      if (el.fillColor) ctx.fill();
      ctx.stroke();
      break;
    }
    case "line": {
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      ctx.fillStyle = el.strokeColor;
      drawArrowHead(ctx, { x: el.x, y: el.y }, { x: el.x2, y: el.y2 }, el.headSize);
      break;
    }
    case "freehand": {
      ctx.translate(el.x, el.y);
      ctx.fillStyle = el.strokeColor;
      const outline = getStroke(el.points, {
        size: Math.max(1, el.strokeWidth),
        thinning: 0.15,
        smoothing: 0.6,
        streamline: clamp(el.streamline, 0, 1),
        simulatePressure: true,
        start: { taper: true, cap: true },
        end: { taper: true, cap: true },
        last: true
      });
      drawStrokeOutline(ctx, outline);
      break;
    }
    case "text": {
      ctx.translate(el.x, el.y);
      if (el.rotation) {
        const w = el.w ?? 0;
        const h = el.h ?? 0;
        ctx.translate(w / 2, h / 2);
        ctx.rotate(el.rotation);
        ctx.translate(-w / 2, -h / 2);
      }
      ctx.fillStyle = el.strokeColor;
      ctx.textBaseline = "top";
      ctx.font = `${el.fontSize}px ${el.fontFamily}`;

      const lines = el.text.split("\n");
      const lineHeight = el.fontSize * 1.2;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        ctx.fillText(line, 0, i * lineHeight);
      }
      break;
    }
  }

  ctx.restore();
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  canvasCssSize: { w: number; h: number },
  baseGridSize: number
): void {
  const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToWorld({ x: canvasCssSize.w, y: canvasCssSize.h }, viewport);

  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);

  let step = Math.max(1, baseGridSize);
  while (step * viewport.scale < 24) step *= 2;
  const major = step * 4;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1 / viewport.scale;

  const startX = Math.floor(minX / step) * step;
  const startY = Math.floor(minY / step) * step;

  for (let x = startX; x <= maxX; x += step) {
    ctx.beginPath();
    ctx.strokeStyle = Math.abs(x % major) < 0.0001 ? "rgba(15, 23, 42, 0.08)" : "rgba(15, 23, 42, 0.04)";
    ctx.moveTo(x, minY);
    ctx.lineTo(x, maxY);
    ctx.stroke();
  }

  for (let y = startY; y <= maxY; y += step) {
    ctx.beginPath();
    ctx.strokeStyle = Math.abs(y % major) < 0.0001 ? "rgba(15, 23, 42, 0.08)" : "rgba(15, 23, 42, 0.04)";
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
    ctx.stroke();
  }

  ctx.restore();
}

export function computeWorldRectFromViewport(viewport: Viewport, canvasCss: { w: number; h: number }): Rect {
  const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToWorld({ x: canvasCss.w, y: canvasCss.h }, viewport);
  const r = rectFromPoints(topLeft, bottomRight);
  return r;
}

export function computeSelectionBounds(elements: Element[]): Rect | null {
  if (elements.length === 0) return null;
  const bounds = elements.map((e) => rectFromPoints({ x: e.x, y: e.y }, { x: e.x, y: e.y }));

  // fallback; real bounds computed elsewhere
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of bounds) {
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  const w = rectWidth({ minX, minY, maxX, maxY });
  const h = rectHeight({ minX, minY, maxX, maxY });
  const c = rectCenter({ minX, minY, maxX, maxY });
  return { minX: c.x - w / 2, minY: c.y - h / 2, maxX: c.x + w / 2, maxY: c.y + h / 2 };
}
