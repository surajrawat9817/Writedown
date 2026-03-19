import type { Element, ElementType, Point as SharedPoint } from "@whiteboard/shared";
import type { BoardCommand } from "../../commandBus";
import type { UIState } from "../../store/uiStore";
import type { BoardCommandBus } from "../../commandBus";
import type { Point, Rect } from "../math";
import { clamp, dist2, expandRect, rectCenter, rectFromPoints, rectHeight, rectWidth, snap } from "../math";
import type { Viewport } from "./viewport";
import { VIEWPORT_LIMITS, pan as panViewport, screenToWorld, worldToScreen, zoomAt } from "./viewport";
import { BoardController } from "../board/BoardController";
import { computeElementBounds } from "../model/elementBounds";
import { hitTestElement } from "../model/hitTest";
import { computeWorldRectFromViewport, drawElement, drawGrid } from "../render/renderer";
import { loadViewport, saveViewport } from "../../utils/viewportStorage";

type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "line:start"
  | "line:end"
  | "rotate";

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; startScreen: Point; startViewport: Viewport }
  | { kind: "box-select"; startWorld: Point; currentWorld: Point; additive: boolean }
  | { kind: "drag"; ids: string[]; startWorld: Point; initial: Map<string, Element> }
  | {
      kind: "resize";
      ids: string[];
      handle: ResizeHandle;
      startWorld: Point;
      startBounds: Rect;
      initial: Map<string, Element>;
    }
  | {
      kind: "rotate";
      ids: string[];
      startAngle: number;
      center: Point;
      initial: Map<string, Element>;
    }
  | { kind: "create"; id: string; type: ElementType; startWorld: Point }
  | { kind: "freehand"; id: string; origin: Point; buffer: SharedPoint[]; lastWorld: Point };

type EngineParams = {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  boardId: string;
  board: BoardController;
  commandBus: BoardCommandBus;
  getUI(): UIState;
  setSelectedIds(ids: string[]): void;
};

const HANDLE_PX = 8;
const ROTATE_HANDLE_PX = 26;
const HIT_TOLERANCE_PX = 6;

function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = rects[0]!.minX;
  let minY = rects[0]!.minY;
  let maxX = rects[0]!.maxX;
  let maxY = rects[0]!.maxY;
  for (const r of rects.slice(1)) {
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export class CanvasEngine {
  private canvas: HTMLCanvasElement;
  private overlay: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssSize = { w: 1, h: 1 };

  private viewport: Viewport = { scale: 1, tx: 0, ty: 0 };
  private readonly boardId: string;
  private viewportSaveTimer: number | null = null;
  private interaction: Interaction = { kind: "none" };
  private pointerId: number | null = null;

  private needsRender = true;
  private raf: number | null = null;

  private board: BoardController;
  private commandBus: BoardCommandBus;
  private getUI: () => UIState;
  private setSelectedIds: (ids: string[]) => void;

  private textEditor: { id: string; el: HTMLTextAreaElement; cleanup: () => void } | null = null;

  private unsubscribeBoard: (() => void) | null = null;
  private unsubscribeCommands: Array<() => void> = [];

  private cursorRaf: number | null = null;
  private pendingCursor: Point | null = null;
  private clipboard:
    | { elements: Element[]; bounds: Rect; pasteIndex: number }
    | null = null;
  private lastHistoryState = { canUndo: false, canRedo: false };

  constructor(params: EngineParams) {
    this.canvas = params.canvas;
    this.overlay = params.overlay;
    this.boardId = params.boardId;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context not available");
    this.ctx = ctx;

    this.board = params.board;
    this.commandBus = params.commandBus;
    this.getUI = () => params.getUI();
    this.setSelectedIds = params.setSelectedIds;

    this.resize();
    this.restoreViewport();

    this.attachEvents();
    this.unsubscribeBoard = this.board.subscribe(() => {
      this.updateHistoryState();
      this.requestRender();
    });
    this.subscribeCommands();
    this.updateHistoryState();
    this.requestRender();
  }

  destroy(): void {
    this.detachEvents();
    this.unsubscribeBoard?.();
    for (const u of this.unsubscribeCommands) u();
    this.unsubscribeCommands = [];
    this.destroyTextEditor();

    if (this.raf !== null) cancelAnimationFrame(this.raf);
    if (this.cursorRaf !== null) cancelAnimationFrame(this.cursorRaf);
    if (this.viewportSaveTimer !== null) window.clearTimeout(this.viewportSaveTimer);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssSize = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = Math.max(1, Math.floor(this.cssSize.w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(this.cssSize.h * this.dpr));
    this.requestRender();
  }

  private saveViewportSoon(): void {
    if (this.viewportSaveTimer !== null) return;
    this.viewportSaveTimer = window.setTimeout(() => {
      this.viewportSaveTimer = null;
      saveViewport(this.boardId, this.viewport);
    }, 150);
  }

  private setViewport(next: Viewport): void {
    this.viewport = next;
    this.saveViewportSoon();
    this.requestRender();
  }

  private resetViewportToCenter(): void {
    this.setViewport({ scale: 1, tx: this.cssSize.w / 2, ty: this.cssSize.h / 2 });
  }

  private fitViewportToContent(): boolean {
    const elements = this.board.getAllElements();
    if (elements.length === 0) return false;
    const rects = elements.map((e) => computeElementBounds(e));
    const bounds = unionRects(rects);
    if (!bounds) return false;

    const pad = 80;
    const w = Math.max(1, rectWidth(bounds));
    const h = Math.max(1, rectHeight(bounds));
    const scaleX = (this.cssSize.w - pad * 2) / w;
    const scaleY = (this.cssSize.h - pad * 2) / h;
    const scale = clamp(Math.min(scaleX, scaleY), VIEWPORT_LIMITS.minScale, VIEWPORT_LIMITS.maxScale);

    const center = rectCenter(bounds);
    const tx = this.cssSize.w / 2 - center.x * scale;
    const ty = this.cssSize.h / 2 - center.y * scale;
    this.setViewport({ scale, tx, ty });
    return true;
  }

  private restoreViewport(): void {
    const restored = loadViewport(this.boardId);
    if (restored) {
      this.viewport = restored;
      this.requestRender();
      return;
    }
    // No saved viewport yet — start centered on content when possible.
    if (!this.fitViewportToContent()) this.resetViewportToCenter();
  }

  private subscribeCommands(): void {
    const on = (cmd: BoardCommand, fn: () => void) => this.commandBus.on(cmd, fn);
    this.unsubscribeCommands.push(on("undo", () => this.board.undo()));
    this.unsubscribeCommands.push(on("redo", () => this.board.redo()));
    this.unsubscribeCommands.push(on("export:json", () => this.exportJson()));
    this.unsubscribeCommands.push(on("export:png", () => this.exportPng()));
  }

  private attachEvents(): void {
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private detachEvents(): void {
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  private requestRender(): void {
    this.needsRender = true;
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      if (this.needsRender) this.render();
    });
  }

  private getScreenPoint(e: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private getWorldPointFromEvent(e: MouseEvent): Point {
    return screenToWorld(this.getScreenPoint(e), this.viewport);
  }

  private setCursor(world: Point | null): void {
    this.pendingCursor = world;
    if (this.cursorRaf !== null) return;
    this.cursorRaf = requestAnimationFrame(() => {
      this.cursorRaf = null;
      const p = this.pendingCursor;
      this.pendingCursor = null;
      const current = this.board.awareness.getLocalState() as unknown;
      const next = { ...(typeof current === "object" && current ? current : {}), cursor: p ?? undefined };
      this.board.awareness.setLocalState(next);
      this.requestRender();
    });
  }

  private onPointerLeave = () => {
    this.setCursor(null);
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (isEditableTarget(e.target)) return;
    if (this.pointerId !== null) return;
    if (e.button !== 0 || e.shiftKey) return;

    e.preventDefault();

    const world = this.getWorldPointFromEvent(e);
    const ui = this.getUI();

    const hitId = this.hitTestTopmost(world);
    const hitEl = hitId ? this.board.getElement(hitId) : null;
    if (hitId && hitEl?.type === "text") {
      this.setSelected([hitId]);
      this.startTextEditing(hitId);
      return;
    }

    this.board.stopCapturing();
    const id = this.board.createElement(
      "text",
      { x: world.x, y: world.y, text: "", fontSize: ui.style.textFontSize },
      ui.style
    );
    this.setSelected([id]);
    this.startTextEditing(id);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const cursor = this.getScreenPoint(e);

    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(-delta * 0.0028);
    const nextScale = this.viewport.scale * factor;
    this.setViewport(zoomAt(this.viewport, cursor, nextScale));
  };

  private updateHistoryState(): void {
    const canUndo = this.board.undoManager.undoStack.length > 0;
    const canRedo = this.board.undoManager.redoStack.length > 0;
    if (canUndo === this.lastHistoryState.canUndo && canRedo === this.lastHistoryState.canRedo) return;
    this.lastHistoryState = { canUndo, canRedo };
    this.getUI().setHistoryState(this.lastHistoryState);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (isEditableTarget(e.target)) return;
    if (this.pointerId !== null) return;

    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);

    const ui = this.getUI();
    const screen = this.getScreenPoint(e);
    const world = this.getWorldPointFromEvent(e);

    const panMode = e.button === 1 || ui.isSpacePanning || ui.tool === "pan";
    if (panMode) {
      this.interaction = { kind: "pan", startScreen: screen, startViewport: this.viewport };
      this.requestRender();
      return;
    }

    if (ui.tool === "select") {
      const handle = this.hitTestHandle(world, ui.selectedIds);
      if (handle) {
        const ids = ui.selectedIds.length ? ui.selectedIds : [];
        const initial = new Map<string, Element>();
        for (const id of ids) {
          const el = this.board.getElement(id);
          if (el) initial.set(id, el);
        }
        const bounds = this.getSelectionBounds(ids);
        if (!bounds) return;

        this.board.stopCapturing();
        if (handle === "rotate") {
          const center = rectCenter(bounds);
          const startAngle = Math.atan2(world.y - center.y, world.x - center.x);
          this.interaction = { kind: "rotate", ids, startAngle, center, initial };
        } else {
          this.interaction = { kind: "resize", ids, handle, startWorld: world, startBounds: bounds, initial };
        }
        this.requestRender();
        return;
      }

      const hitId = this.hitTestTopmost(world);
      if (hitId) {
        const nextSelected = this.computeNextSelection(ui.selectedIds, hitId, e.shiftKey);
        this.setSelected(nextSelected);

        const initial = new Map<string, Element>();
        for (const id of nextSelected) {
          const el = this.board.getElement(id);
          if (el) initial.set(id, el);
        }
        this.board.stopCapturing();
        this.interaction = { kind: "drag", ids: nextSelected, startWorld: world, initial };
        this.requestRender();
        return;
      }

      if (!e.shiftKey && ui.selectedIds.length > 0) {
        const bounds = this.getSelectionBounds(ui.selectedIds);
        if (
          bounds &&
          world.x >= bounds.minX &&
          world.x <= bounds.maxX &&
          world.y >= bounds.minY &&
          world.y <= bounds.maxY
        ) {
          const initial = new Map<string, Element>();
          for (const id of ui.selectedIds) {
            const el = this.board.getElement(id);
            if (el) initial.set(id, el);
          }
          this.board.stopCapturing();
          this.interaction = { kind: "drag", ids: ui.selectedIds, startWorld: world, initial };
          this.requestRender();
          return;
        }
      }

      // Start box selection
      if (!e.shiftKey) this.setSelected([]);
      this.interaction = { kind: "box-select", startWorld: world, currentWorld: world, additive: e.shiftKey };
      this.requestRender();
      return;
    }

    // Shape tools
    if (ui.tool === "text") {
      this.board.stopCapturing();
      const id = this.board.createElement(
        "text",
        { x: world.x, y: world.y, text: "", fontSize: ui.style.textFontSize },
        ui.style
      );
      this.setSelected([id]);
      this.startTextEditing(id);
      return;
    }

    const type = ui.tool as ElementType;
    this.board.stopCapturing();

    if (type === "freehand") {
      const id = this.board.createElement("freehand", { x: world.x, y: world.y }, ui.style);
      if (ui.selectedIds.length > 0) this.setSelected([]);
      const rel: SharedPoint = { x: 0, y: 0 };
      this.board.appendFreehandPoints(id, [rel]);
      this.interaction = { kind: "freehand", id, origin: world, buffer: [], lastWorld: world };
      this.requestRender();
      return;
    }

    const id = this.board.createElement(type, { x: world.x, y: world.y }, ui.style);
    this.setSelected([id]);
    this.interaction = { kind: "create", id, type, startWorld: world };
    this.requestRender();
  };

  private onPointerMove = (e: PointerEvent) => {
    const ui = this.getUI();
    const world = this.getWorldPointFromEvent(e);
    this.setCursor(world);

    if (this.pointerId === null || e.pointerId !== this.pointerId) return;

    switch (this.interaction.kind) {
      case "none":
        return;
      case "pan": {
        const screen = this.getScreenPoint(e);
        const dx = screen.x - this.interaction.startScreen.x;
        const dy = screen.y - this.interaction.startScreen.y;
        this.setViewport(panViewport(this.interaction.startViewport, dx, dy));
        return;
      }
      case "box-select": {
        this.interaction = { ...this.interaction, currentWorld: world };
        this.requestRender();
        return;
      }
      case "drag": {
        const delta = { x: world.x - this.interaction.startWorld.x, y: world.y - this.interaction.startWorld.y };
        const snappedDelta =
          ui.snapToGrid && ui.gridSize > 0 && this.interaction.ids.length > 0
            ? (() => {
                const first = this.interaction.initial.get(this.interaction.ids[0]!);
                if (!first) return delta;
                const nx = snap(first.x + delta.x, ui.gridSize);
                const ny = snap(first.y + delta.y, ui.gridSize);
                return { x: nx - first.x, y: ny - first.y };
              })()
            : delta;

        this.applyTranslation(this.interaction.ids, this.interaction.initial, snappedDelta);
        this.requestRender();
        return;
      }
      case "resize": {
        if (this.interaction.handle === "line:start" || this.interaction.handle === "line:end") {
          const id = this.interaction.ids[0];
          if (typeof id === "string") {
            const el = this.interaction.initial.get(id);
            if (el && (el.type === "line" || el.type === "arrow")) {
              const p = ui.snapToGrid && ui.gridSize > 0 ? { x: snap(world.x, ui.gridSize), y: snap(world.y, ui.gridSize) } : world;
              if (this.interaction.handle === "line:start") this.board.update(id, { x: p.x, y: p.y });
              else this.board.update(id, { x2: p.x, y2: p.y });
            }
          }
          this.requestRender();
          return;
        }
        const nextBounds = this.computeResizedBounds(this.interaction.startBounds, this.interaction.handle, world);
        if (!nextBounds) return;
        this.applyResize(this.interaction.ids, this.interaction.initial, this.interaction.startBounds, nextBounds, this.interaction.handle);
        this.requestRender();
        return;
      }
      case "rotate": {
        const angle = Math.atan2(world.y - this.interaction.center.y, world.x - this.interaction.center.x);
        const delta = angle - this.interaction.startAngle;
        this.applyRotation(this.interaction.ids, this.interaction.initial, this.interaction.center, delta);
        this.requestRender();
        return;
      }
      case "create": {
        this.updateCreatingElement(this.interaction, world, ui);
        this.requestRender();
        return;
      }
      case "freehand": {
        const minDist = 0.5 / this.viewport.scale;
        if (dist2(world, this.interaction.lastWorld) < minDist * minDist) return;
        this.interaction.lastWorld = world;
        this.interaction.buffer.push({ x: world.x - this.interaction.origin.x, y: world.y - this.interaction.origin.y });
        if (this.interaction.buffer.length >= 6) this.flushFreehandBuffer(this.interaction);
        this.requestRender();
        return;
      }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.pointerId === null || e.pointerId !== this.pointerId) return;

    const finished = this.interaction;

    if (finished.kind === "box-select") {
      const r = rectFromPoints(finished.startWorld, finished.currentWorld);
      const ids = this.board.queryRect(r);
      const selected = this.filterIdsByBounds(ids, r);
      this.setSelected(finished.additive ? Array.from(new Set([...this.getUI().selectedIds, ...selected])) : selected);
    }

    if (finished.kind === "freehand") {
      this.flushFreehandBuffer(finished, true);
      this.board.stopCapturing();
    }

    if (finished.kind === "drag" || finished.kind === "resize" || finished.kind === "rotate") {
      this.board.stopCapturing();
    }

    if (finished.kind === "create") {
      const el = this.board.getElement(finished.id);
      if (el?.type === "rect" || el?.type === "ellipse") {
        if (Math.abs(el.w) < 2 && Math.abs(el.h) < 2) {
          this.board.update(finished.id, { w: 160, h: 100 });
        }
      } else if (el?.type === "line" || el?.type === "arrow") {
        const dx = el.x2 - el.x;
        const dy = el.y2 - el.y;
        if (dx * dx + dy * dy < 4) {
          this.board.update(finished.id, { x2: el.x + 160, y2: el.y });
        }
      }

      this.board.stopCapturing();
      const setTool = this.getUI().setTool;
      if (typeof setTool === "function") setTool("select");
    }

    this.interaction = { kind: "none" };
    this.pointerId = null;
    this.requestRender();
  };

  private onPointerCancel = (e: PointerEvent) => {
    if (this.pointerId === null || e.pointerId !== this.pointerId) return;
    this.interaction = { kind: "none" };
    this.pointerId = null;
    this.requestRender();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    const ui = this.getUI();

    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "c") {
      if (ui.selectedIds.length === 0) return;
      const selected = ui.selectedIds
        .map((id) => this.board.getElement(id))
        .filter((el): el is Element => Boolean(el));
      if (selected.length === 0) return;

      e.preventDefault();
      const rects = selected.map((el) => computeElementBounds(el));
      const bounds = unionRects(rects);
      if (!bounds) return;

      const cloned = selected.map((el) => {
        switch (el.type) {
          case "rect":
          case "ellipse":
          case "line":
          case "arrow":
          case "text":
            return { ...el };
          case "freehand":
            return { ...el, points: el.points.map((p) => ({ x: p.x, y: p.y })) };
        }
      });

      this.clipboard = { elements: cloned, bounds, pasteIndex: 0 };
      const payload = JSON.stringify({ kind: "whiteboard-elements", version: 1, elements: cloned });
      void navigator.clipboard?.writeText(payload).catch(() => {
        // ignore clipboard permission errors
      });
      return;
    }

    if (meta && e.key.toLowerCase() === "v") {
      const clip = this.clipboard;
      if (!clip || clip.elements.length === 0) return;

      e.preventDefault();
      this.board.stopCapturing();

      const nextIndex = clip.pasteIndex + 1;
      clip.pasteIndex = nextIndex;

      const offsetWorld = (24 / this.viewport.scale) * nextIndex;
      const delta = { x: offsetWorld, y: offsetWorld };

      const newIds: string[] = [];
      const createStyleFrom = (el: Element) => ({
        strokeColor: el.strokeColor,
        fillColor: el.fillColor ?? null,
        strokeWidth: el.strokeWidth,
        opacity: el.opacity
      });

      for (const el of clip.elements) {
        switch (el.type) {
          case "rect": {
            const id = this.board.createElement(
              "rect",
              {
                x: el.x + delta.x,
                y: el.y + delta.y,
                w: el.w,
                h: el.h,
                rotation: el.rotation,
                cornerRadius: el.cornerRadius
              },
              createStyleFrom(el)
            );
            newIds.push(id);
            break;
          }
          case "ellipse": {
            const id = this.board.createElement(
              "ellipse",
              { x: el.x + delta.x, y: el.y + delta.y, w: el.w, h: el.h, rotation: el.rotation },
              createStyleFrom(el)
            );
            newIds.push(id);
            break;
          }
          case "line": {
            const id = this.board.createElement(
              "line",
              {
                x: el.x + delta.x,
                y: el.y + delta.y,
                x2: el.x2 + delta.x,
                y2: el.y2 + delta.y,
                rotation: el.rotation
              },
              createStyleFrom(el)
            );
            newIds.push(id);
            break;
          }
          case "arrow": {
            const id = this.board.createElement(
              "arrow",
              {
                x: el.x + delta.x,
                y: el.y + delta.y,
                x2: el.x2 + delta.x,
                y2: el.y2 + delta.y,
                rotation: el.rotation
              },
              createStyleFrom(el)
            );
            this.board.update(id, { headSize: el.headSize });
            newIds.push(id);
            break;
          }
          case "freehand": {
            const id = this.board.createElement(
              "freehand",
              { x: el.x + delta.x, y: el.y + delta.y, rotation: el.rotation },
              createStyleFrom(el)
            );
            this.board.setFreehandPoints(id, el.points.map((p) => ({ x: p.x, y: p.y })));
            this.board.update(id, { streamline: el.streamline });
            newIds.push(id);
            break;
          }
          case "text": {
            const id = this.board.createElement(
              "text",
              {
                x: el.x + delta.x,
                y: el.y + delta.y,
                rotation: el.rotation,
                text: el.text,
                fontSize: el.fontSize,
                fontFamily: el.fontFamily,
                align: el.align
              },
              createStyleFrom(el)
            );
            const patch: Record<string, unknown> = {};
            if (typeof el.w === "number") patch.w = el.w;
            if (typeof el.h === "number") patch.h = el.h;
            if (Object.keys(patch).length > 0) this.board.update(id, patch);
            newIds.push(id);
            break;
          }
        }
      }

      this.setSelected(newIds);
      const setTool = this.getUI().setTool;
      if (typeof setTool === "function") setTool("select");
      this.board.stopCapturing();
      this.requestRender();
      return;
    }

    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.board.redo();
      else this.board.undo();
      return;
    }
    if (meta && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.setSelected(this.board.getOrder().filter((id) => Boolean(this.board.getElement(id))));
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (ui.selectedIds.length > 0) {
        e.preventDefault();
        this.board.stopCapturing();
        this.board.delete(ui.selectedIds);
        this.setSelected([]);
      }
      return;
    }

    const toolKey = e.key.toLowerCase();
    const nextTool = toolKey === "v"
      ? "select"
      : toolKey === "h"
        ? "pan"
        : toolKey === "p"
          ? "freehand"
          : toolKey === "r"
            ? "rect"
            : toolKey === "o"
              ? "ellipse"
              : toolKey === "l"
                ? "line"
                : toolKey === "a"
                  ? "arrow"
                  : toolKey === "t"
                    ? "text"
                    : null;
    if (nextTool) {
      // Tool state lives in Zustand; update via its setter if present.
      const setTool = this.getUI().setTool;
      if (typeof setTool === "function") setTool(nextTool);
    }
  };

  private setSelected(ids: string[]): void {
    this.setSelectedIds(ids);
    const current = this.board.awareness.getLocalState() as unknown;
    const next = { ...(typeof current === "object" && current ? current : {}), selectedIds: ids };
    this.board.awareness.setLocalState(next);
  }

  private computeNextSelection(current: string[], hitId: string, additive: boolean): string[] {
    if (!additive) return current.includes(hitId) ? current : [hitId];
    const set = new Set(current);
    if (set.has(hitId)) set.delete(hitId);
    else set.add(hitId);
    return Array.from(set);
  }

  private hitTestTopmost(world: Point): string | null {
    const tol = HIT_TOLERANCE_PX / this.viewport.scale;
    const candidates = this.board.queryPoint(world, tol + 4 / this.viewport.scale);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => this.board.getOrderIndex(b) - this.board.getOrderIndex(a));
    for (const id of candidates) {
      const el = this.board.getElement(id);
      if (!el) continue;
      if (hitTestElement(el, world, tol)) return id;
    }
    return null;
  }

  private getSelectionBounds(ids: string[]): Rect | null {
    const rects: Rect[] = [];
    for (const id of ids) {
      const el = this.board.getElement(id);
      if (!el) continue;
      rects.push(computeElementBounds(el));
    }
    return unionRects(rects);
  }

  private hitTestHandle(world: Point, selectedIds: string[]): ResizeHandle | null {
    if (selectedIds.length === 0) return null;
    if (selectedIds.length === 1) {
      const el = this.board.getElement(selectedIds[0]!);
      if (el && (el.type === "line" || el.type === "arrow")) {
        const tol = HANDLE_PX / this.viewport.scale;
        const a = { x: el.x, y: el.y };
        const b = { x: el.x2, y: el.y2 };
        if (dist2(world, a) <= tol * tol) return "line:start";
        if (dist2(world, b) <= tol * tol) return "line:end";
      }
    }

    const bounds = this.getSelectionBounds(selectedIds);
    if (!bounds) return null;
    const tol = HANDLE_PX / this.viewport.scale;

    const corners: Array<[ResizeHandle, Point]> = [
      ["nw", { x: bounds.minX, y: bounds.minY }],
      ["ne", { x: bounds.maxX, y: bounds.minY }],
      ["se", { x: bounds.maxX, y: bounds.maxY }],
      ["sw", { x: bounds.minX, y: bounds.maxY }],
      ["n", { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY }],
      ["e", { x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2 }],
      ["s", { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY }],
      ["w", { x: bounds.minX, y: (bounds.minY + bounds.maxY) / 2 }]
    ];
    for (const [handle, p] of corners) {
      if (dist2(world, p) <= tol * tol) return handle;
    }

    const rotOffset = ROTATE_HANDLE_PX / this.viewport.scale;
    const rot = { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY - rotOffset };
    if (dist2(world, rot) <= tol * tol) return "rotate";

    return null;
  }

  private computeResizedBounds(bounds: Rect, handle: ResizeHandle, world: Point): Rect | null {
    let { minX, minY, maxX, maxY } = bounds;

    if (handle === "nw" || handle === "w" || handle === "sw") minX = world.x;
    if (handle === "ne" || handle === "e" || handle === "se") maxX = world.x;
    if (handle === "nw" || handle === "n" || handle === "ne") minY = world.y;
    if (handle === "sw" || handle === "s" || handle === "se") maxY = world.y;

    const w = rectWidth({ minX, minY, maxX, maxY });
    const h = rectHeight({ minX, minY, maxX, maxY });
    if (w < 0.001 || h < 0.001) return null;

    return { minX: Math.min(minX, maxX), minY: Math.min(minY, maxY), maxX: Math.max(minX, maxX), maxY: Math.max(minY, maxY) };
  }

  private applyTranslation(ids: string[], initial: Map<string, Element>, delta: Point): void {
    for (const id of ids) {
      const el = initial.get(id);
      if (!el) continue;
      switch (el.type) {
        case "rect":
        case "ellipse":
        case "text":
        case "freehand":
          this.board.update(id, { x: el.x + delta.x, y: el.y + delta.y });
          break;
        case "line":
        case "arrow":
          this.board.update(id, { x: el.x + delta.x, y: el.y + delta.y, x2: el.x2 + delta.x, y2: el.y2 + delta.y });
          break;
      }
    }
  }

  private applyResize(ids: string[], initial: Map<string, Element>, start: Rect, next: Rect, handle: ResizeHandle): void {
    if (ids.length === 0) return;

    const sx = rectWidth(next) / Math.max(0.0001, rectWidth(start));
    const sy = rectHeight(next) / Math.max(0.0001, rectHeight(start));
    const anchor: Point = (() => {
      switch (handle) {
        case "nw":
          return { x: start.maxX, y: start.maxY };
        case "ne":
          return { x: start.minX, y: start.maxY };
        case "sw":
          return { x: start.maxX, y: start.minY };
        case "se":
          return { x: start.minX, y: start.minY };
        case "n":
          return { x: start.minX, y: start.maxY };
        case "s":
          return { x: start.minX, y: start.minY };
        case "e":
          return { x: start.minX, y: start.minY };
        case "w":
          return { x: start.maxX, y: start.minY };
        default:
          return { x: start.minX, y: start.minY };
      }
    })();

    for (const id of ids) {
      const el = initial.get(id);
      if (!el) continue;

      const bounds = computeElementBounds(el);
      const relMin = { x: bounds.minX - anchor.x, y: bounds.minY - anchor.y };
      const relMax = { x: bounds.maxX - anchor.x, y: bounds.maxY - anchor.y };

      const newMin = { x: anchor.x + relMin.x * sx, y: anchor.y + relMin.y * sy };
      const newMax = { x: anchor.x + relMax.x * sx, y: anchor.y + relMax.y * sy };
      const w = Math.max(1, newMax.x - newMin.x);
      const h = Math.max(1, newMax.y - newMin.y);

      switch (el.type) {
        case "rect":
        case "ellipse":
          this.board.update(id, { x: newMin.x, y: newMin.y, w, h });
          break;
        case "text": {
          const minW = 60;
          const minH = Math.max(28, el.fontSize * 1.2);
          this.board.update(id, {
            x: newMin.x,
            y: newMin.y,
            w: Math.max(minW, w),
            h: Math.max(minH, h)
          });
          break;
        }
        case "line":
        case "arrow": {
          // Scale endpoints relative to start bounds origin.
          const a = { x: el.x - anchor.x, y: el.y - anchor.y };
          const b = { x: el.x2 - anchor.x, y: el.y2 - anchor.y };
          this.board.update(id, {
            x: anchor.x + a.x * sx,
            y: anchor.y + a.y * sy,
            x2: anchor.x + b.x * sx,
            y2: anchor.y + b.y * sy
          });
          break;
        }
        case "freehand": {
          const nextOrigin = { x: anchor.x + (el.x - anchor.x) * sx, y: anchor.y + (el.y - anchor.y) * sy };
          const nextPoints = el.points.map((p) => {
            const worldP = { x: el.x + p.x, y: el.y + p.y };
            const scaled = { x: anchor.x + (worldP.x - anchor.x) * sx, y: anchor.y + (worldP.y - anchor.y) * sy };
            return { x: scaled.x - nextOrigin.x, y: scaled.y - nextOrigin.y };
          });
          this.board.update(id, { x: nextOrigin.x, y: nextOrigin.y });
          this.board.setFreehandPoints(id, nextPoints);
          break;
        }
      }
    }
  }

  private applyRotation(ids: string[], initial: Map<string, Element>, center: Point, delta: number): void {
    for (const id of ids) {
      const el = initial.get(id);
      if (!el) continue;

      switch (el.type) {
        case "rect": {
          const c0 = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
          const c1 = this.rotatePoint(c0, center, delta);
          this.board.update(id, { x: c1.x - el.w / 2, y: c1.y - el.h / 2, rotation: (el.rotation ?? 0) + delta });
          break;
        }
        case "ellipse": {
          const c0 = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
          const c1 = this.rotatePoint(c0, center, delta);
          this.board.update(id, { x: c1.x - el.w / 2, y: c1.y - el.h / 2, rotation: (el.rotation ?? 0) + delta });
          break;
        }
        case "text": {
          const w = el.w ?? 0;
          const h = el.h ?? el.fontSize * 1.2;
          const c0 = { x: el.x + w / 2, y: el.y + h / 2 };
          const c1 = this.rotatePoint(c0, center, delta);
          this.board.update(id, { x: c1.x - w / 2, y: c1.y - h / 2, rotation: (el.rotation ?? 0) + delta });
          break;
        }
        case "line":
        case "arrow": {
          const a = this.rotatePoint({ x: el.x, y: el.y }, center, delta);
          const b = this.rotatePoint({ x: el.x2, y: el.y2 }, center, delta);
          this.board.update(id, { x: a.x, y: a.y, x2: b.x, y2: b.y });
          break;
        }
        case "freehand": {
          const origin = this.rotatePoint({ x: el.x, y: el.y }, center, delta);
          const points = el.points.map((p) => {
            const wp = { x: el.x + p.x, y: el.y + p.y };
            const rp = this.rotatePoint(wp, center, delta);
            return { x: rp.x - origin.x, y: rp.y - origin.y };
          });
          this.board.update(id, { x: origin.x, y: origin.y });
          this.board.setFreehandPoints(id, points);
          break;
        }
      }
    }
  }

  private rotatePoint(p: Point, center: Point, angle: number): Point {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
  }

  private updateCreatingElement(interaction: Extract<Interaction, { kind: "create" }>, world: Point, ui: UIState): void {
    const start = interaction.startWorld;
    switch (interaction.type) {
      case "rect":
      case "ellipse": {
        const x = Math.min(start.x, world.x);
        const y = Math.min(start.y, world.y);
        const w = Math.abs(world.x - start.x);
        const h = Math.abs(world.y - start.y);
        this.board.update(interaction.id, { x, y, w, h });
        return;
      }
      case "line":
      case "arrow":
        this.board.update(interaction.id, { x2: world.x, y2: world.y });
        return;
      default:
        // freehand/text handled elsewhere
        void ui;
        return;
    }
  }

  private flushFreehandBuffer(interaction: Extract<Interaction, { kind: "freehand" }>, force = false): void {
    if (!force && interaction.buffer.length === 0) return;
    if (interaction.buffer.length > 0) {
      this.board.appendFreehandPoints(interaction.id, interaction.buffer);
      interaction.buffer.length = 0;
    }
  }

  private filterIdsByBounds(ids: string[], r: Rect): string[] {
    const out: string[] = [];
    for (const id of ids) {
      const el = this.board.getElement(id);
      if (!el) continue;
      const b = computeElementBounds(el);
      // Select elements that intersect the box.
      if (b.minX <= r.maxX && b.maxX >= r.minX && b.minY <= r.maxY && b.maxY >= r.minY) out.push(id);
    }
    out.sort((a, b) => this.board.getOrderIndex(a) - this.board.getOrderIndex(b));
    return out;
  }

  private startTextEditing(id: string): void {
    this.destroyTextEditor();
    const el = this.board.getElement(id);
    if (!el || el.type !== "text") return;
    const yText = this.board.getTextType(id);
    if (!yText) return;

    const ta = document.createElement("textarea");
    ta.value = yText.toString();
    ta.className =
      "absolute pointer-events-auto bg-transparent p-0 text-foreground outline-none border-0 shadow-none focus:ring-0 focus:outline-none";
    ta.spellcheck = false;
    ta.rows = 1;
    ta.placeholder = "Type…";
    ta.wrap = "off";
    ta.style.whiteSpace = "pre";
    ta.style.overflowX = "auto";
    ta.style.overflowY = "hidden";
    ta.style.background = "transparent";
    ta.style.border = "none";
    ta.style.outline = "none";
    ta.style.boxShadow = "none";
    ta.style.resize = "none";
    ta.style.padding = "0";
    ta.style.margin = "0";

    const stop = () => {
      this.destroyTextEditor();
      const ui = this.getUI();
      if (ui.tool === "text" && ui.selectedIds.length === 1 && ui.selectedIds[0] === id) {
        this.setSelected([]);
      }
      this.requestRender();
    };
    const updateBoxSizeFromDom = () => {
      const current = this.board.getElement(id);
      if (!current || current.type !== "text") return;

      const wWorld = Math.max(60, ta.offsetWidth / this.viewport.scale);
      const hWorld = Math.max(28, ta.offsetHeight / this.viewport.scale);
      const prevW = current.w ?? 220;
      const prevH = current.h ?? Math.max(28, current.fontSize * 1.2);

      if (Math.abs(prevW - wWorld) < 0.5 && Math.abs(prevH - hWorld) < 0.5) return;
      this.board.update(id, { w: wWorld, h: hWorld });
    };

    const syncToContent = () => {
      const needed = Math.max(28, ta.scrollHeight);
      if (needed > ta.offsetHeight) ta.style.height = `${needed}px`;
      updateBoxSizeFromDom();
    };

    const onInput = () => {
      this.board.applyTextDiff(id, ta.value);
      syncToContent();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ta.blur();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
      }
    };

    const yObserver = () => {
      // Avoid fighting with local typing; update when not focused.
      if (document.activeElement === ta) return;
      const next = yText.toString();
      if (ta.value !== next) ta.value = next;
    };
    yText.observe(yObserver);

    ta.addEventListener("input", onInput);
    ta.addEventListener("keydown", onKeyDown);
    ta.addEventListener("blur", stop);

    const ro = new ResizeObserver(() => updateBoxSizeFromDom());
    ro.observe(ta);

    this.overlay.appendChild(ta);
    this.textEditor = {
      id,
      el: ta,
      cleanup: () => {
        yText.unobserve(yObserver);
        ro.disconnect();
        ta.removeEventListener("input", onInput);
        ta.removeEventListener("keydown", onKeyDown);
        ta.removeEventListener("blur", stop);
        ta.remove();
      }
    };

    this.positionTextEditor();
    syncToContent();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  private positionTextEditor(): void {
    if (!this.textEditor) return;
    const el = this.board.getElement(this.textEditor.id);
    if (!el || el.type !== "text") return;
    const ta = this.textEditor.el;

    const pos = worldToScreen({ x: el.x, y: el.y }, this.viewport);
    ta.style.left = `${pos.x}px`;
    ta.style.top = `${pos.y}px`;
    ta.style.fontSize = `${Math.max(10, el.fontSize * this.viewport.scale)}px`;
    ta.style.lineHeight = "1.2";
    ta.style.fontFamily = el.fontFamily;
    ta.style.color = el.strokeColor;
    ta.style.caretColor = el.strokeColor;
    const w = (el.w ?? 220) * this.viewport.scale;
    const h = (el.h ?? el.fontSize * 1.2) * this.viewport.scale;
    ta.style.width = `${Math.max(80, w)}px`;
    ta.style.height = `${Math.max(28, h)}px`;
    ta.style.transformOrigin = "top left";
    ta.style.transform = el.rotation ? `rotate(${el.rotation}rad)` : "none";
  }

  private destroyTextEditor(): void {
    if (!this.textEditor) return;
    this.textEditor.cleanup();
    this.textEditor = null;
  }

  exportJson(): void {
    const snapshot = {
      id: this.getUI().selectedIds.join(",") ? "selection" : "board",
      exportedAt: new Date().toISOString(),
      order: this.board.getOrder(),
      elements: this.board.getAllElements()
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `board-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  exportPng(): void {
    const ui = this.getUI();
    const ids = ui.selectedIds.length ? ui.selectedIds : this.board.getOrder();
    const rects: Rect[] = [];
    const elements: Element[] = [];
    for (const id of ids) {
      const el = this.board.getElement(id);
      if (!el) continue;
      elements.push(el);
      rects.push(computeElementBounds(el));
    }
    const bounds = unionRects(rects);
    if (!bounds) return;

    const pad = 40;
    const padded = expandRect(bounds, pad);
    const w = rectWidth(padded);
    const h = rectHeight(padded);

    const maxDim = 8192;
    let scale = 2;
    if (w * scale > maxDim || h * scale > maxDim) {
      scale = Math.min(maxDim / w, maxDim / h);
    }
    scale = clamp(scale, 0.25, 4);

    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.floor(w * scale));
    off.height = Math.max(1, Math.floor(h * scale));
    const ctx = off.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, -padded.minX * scale, -padded.minY * scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(padded.minX, padded.minY, w, h);

    for (const el of elements) drawElement(ctx, el);

    off.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `board-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  private render(): void {
    this.needsRender = false;
    this.positionTextEditor();

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // World transform
    ctx.setTransform(
      this.viewport.scale * this.dpr,
      0,
      0,
      this.viewport.scale * this.dpr,
      this.viewport.tx * this.dpr,
      this.viewport.ty * this.dpr
    );

    const ui = this.getUI();
    if (ui.showGrid) drawGrid(ctx, this.viewport, this.cssSize, ui.gridSize);

    const worldRect = computeWorldRectFromViewport(this.viewport, this.cssSize);
    const visibleIds = this.board.queryRect(expandRect(worldRect, 300 / this.viewport.scale));
    visibleIds.sort((a, b) => this.board.getOrderIndex(a) - this.board.getOrderIndex(b));

    const activeFreehand = this.interaction.kind === "freehand" ? this.interaction : null;
    const editingTextId = this.textEditor?.id ?? null;
    for (const id of visibleIds) {
      if (activeFreehand && id === activeFreehand.id) continue;
      if (editingTextId && id === editingTextId) continue;
      const el = this.board.getElement(id);
      if (!el) continue;
      drawElement(ctx, el);
    }

    if (activeFreehand) {
      const base = this.board.getElement(activeFreehand.id);
      if (base && base.type === "freehand") {
        const points = base.points.concat(activeFreehand.buffer);
        drawElement(ctx, { ...base, points });
      }
    }

    // Overlay in screen coords
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawPresence(ctx);
    this.drawSelection(ctx, ui.selectedIds);
    this.drawBoxSelect(ctx);
  }

  private drawBoxSelect(ctx: CanvasRenderingContext2D): void {
    if (this.interaction.kind !== "box-select") return;
    const r = rectFromPoints(this.interaction.startWorld, this.interaction.currentWorld);
    const a = worldToScreen({ x: r.minX, y: r.minY }, this.viewport);
    const b = worldToScreen({ x: r.maxX, y: r.maxY }, this.viewport);
    const w = b.x - a.x;
    const h = b.y - a.y;

    ctx.save();
    ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
    ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(a.x, a.y, w, h);
    ctx.setLineDash([]);
    ctx.fillRect(a.x, a.y, w, h);
    ctx.restore();
  }

  private drawSelection(ctx: CanvasRenderingContext2D, selectedIds: string[]): void {
    if (selectedIds.length === 0) return;
    if (this.textEditor) return;

    const selected = selectedIds
      .map((id) => this.board.getElement(id))
      .filter((el): el is Element => Boolean(el));
    if (selected.length > 0 && selected.every((el) => el.type === "freehand")) {
      this.drawFreehandSelection(ctx, selected);
      return;
    }
    const bounds = this.getSelectionBounds(selectedIds);
    if (!bounds) return;

    const a = worldToScreen({ x: bounds.minX, y: bounds.minY }, this.viewport);
    const b = worldToScreen({ x: bounds.maxX, y: bounds.maxY }, this.viewport);
    const w = b.x - a.x;
    const h = b.y - a.y;

    ctx.save();
    ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, w, h);

    const handle = (x: number, y: number) => {
      const s = HANDLE_PX;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
      ctx.lineWidth = 1;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    };

    const corners = [
      [a.x, a.y],
      [a.x + w / 2, a.y],
      [a.x + w, a.y],
      [a.x + w, a.y + h / 2],
      [a.x + w, a.y + h],
      [a.x + w / 2, a.y + h],
      [a.x, a.y + h],
      [a.x, a.y + h / 2]
    ] as const;
    for (const [x, y] of corners) handle(x, y);

    // rotate handle
    const rx = a.x + w / 2;
    const ry = a.y - ROTATE_HANDLE_PX;
    ctx.beginPath();
    ctx.moveTo(a.x + w / 2, a.y);
    ctx.lineTo(rx, ry);
    ctx.strokeStyle = "rgba(37, 99, 235, 0.5)";
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(rx, ry, HANDLE_PX / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(37, 99, 235, 0.9)";
    ctx.stroke();

    ctx.restore();
  }

  private drawFreehandSelection(ctx: CanvasRenderingContext2D, elements: Element[]): void {
    ctx.save();
    ctx.setTransform(
      this.viewport.scale * this.dpr,
      0,
      0,
      this.viewport.scale * this.dpr,
      this.viewport.tx * this.dpr,
      this.viewport.ty * this.dpr
    );
    for (const el of elements) {
      if (el.type !== "freehand") continue;
      drawElement(ctx, {
        ...el,
        strokeColor: "#2563eb",
        opacity: 0.22,
        strokeWidth: el.strokeWidth + 6 / this.viewport.scale
      });
    }
    ctx.restore();
  }

  private drawPresence(ctx: CanvasRenderingContext2D): void {
    const states = this.board.awareness.getStates();
    for (const [clientId, state] of states.entries()) {
      if (clientId === this.board.doc.clientID) continue;
      if (typeof state !== "object" || !state) continue;
      const user = (state as { user?: unknown }).user;
      const cursor = (state as { cursor?: unknown }).cursor;
      if (!cursor || typeof cursor !== "object") continue;
      const x = (cursor as { x?: unknown }).x;
      const y = (cursor as { y?: unknown }).y;
      if (typeof x !== "number" || typeof y !== "number") continue;

      const sp = worldToScreen({ x, y }, this.viewport);
      const name = typeof (user as { name?: unknown })?.name === "string" ? (user as { name: string }).name : "Guest";
      const color =
        typeof (user as { color?: unknown })?.color === "string" ? (user as { color: string }).color : "#3b82f6";

      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(15, 23, 42, 0.15)";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
      ctx.textBaseline = "top";
      const padX = 6;
      const padY = 4;
      const textW = ctx.measureText(name).width;
      const boxW = textW + padX * 2;
      const boxH = 18;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
      ctx.lineWidth = 1;
      ctx.fillRect(sp.x + 8, sp.y + 8, boxW, boxH);
      ctx.strokeRect(sp.x + 8, sp.y + 8, boxW, boxH);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(name, sp.x + 8 + padX, sp.y + 8 + padY);
      ctx.restore();
    }
  }
}
