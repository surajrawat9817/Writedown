import type { Element, ElementType, Point as SharedPoint } from "@whiteboard/shared";
import { elementSchema, createId } from "@whiteboard/shared";
import RBush from "rbush";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { Rect } from "../math";
import { computeElementBounds } from "../model/elementBounds";

type IndexItem = Rect & { id: string };

type Listener = () => void;

function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map;
}

function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array;
}

function isYText(value: unknown): value is Y.Text {
  return value instanceof Y.Text;
}

function toPlainValue(value: unknown): unknown {
  if (isYText(value)) return value.toString();
  if (isYArray(value)) return value.toArray().map((v) => toPlainValue(v));
  return value;
}

function yElementToSnapshot(id: string, yEl: Y.Map<unknown>): Element | null {
  const obj: Record<string, unknown> = { id };
  for (const [k, v] of yEl.entries()) obj[k] = toPlainValue(v);
  const parsed = elementSchema.safeParse(obj);
  if (!parsed.success) return null;
  return parsed.data;
}

export type CreateStyle = {
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  opacity: number;
};

export type BoardControllerParams = {
  doc: Y.Doc;
  awareness: Awareness;
  userId: string;
};

export class BoardController {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  readonly undoManager: Y.UndoManager;

  private readonly localOrigin = { kind: "local" } as const;
  private readonly systemOrigin = { kind: "system" } as const;

  private root: Y.Map<unknown>;
  private elementsY: Y.Map<unknown>;
  private orderY: Y.Array<unknown>;

  private elements = new Map<string, Element>();
  private order: string[] = [];
  private orderIndex = new Map<string, number>();

  private index = new RBush<IndexItem>();
  private indexItems = new Map<string, IndexItem>();

  private listeners = new Set<Listener>();
  private destroyed = false;
  private unsubs: Array<() => void> = [];

  private readonly userId: string;

  constructor(params: BoardControllerParams) {
    this.doc = params.doc;
    this.awareness = params.awareness;
    this.userId = params.userId;

    this.root = this.doc.getMap<unknown>("board");
    this.doc.transact(() => {
      if (!isYMap(this.root.get("elements"))) this.root.set("elements", new Y.Map());
      if (!isYArray(this.root.get("order"))) this.root.set("order", new Y.Array());
      if (typeof this.root.get("schemaVersion") !== "number") this.root.set("schemaVersion", 1);
    }, this.systemOrigin);

    const elements = this.root.get("elements");
    const order = this.root.get("order");
    if (!isYMap(elements) || !isYArray(order)) {
      throw new Error("Invalid board root structure");
    }
    this.elementsY = elements;
    this.orderY = order;

    this.undoManager = new Y.UndoManager([this.elementsY, this.orderY], {
      trackedOrigins: new Set<unknown>([this.localOrigin]),
      captureTimeout: 10_000
    });

    this.rebuildAll();

    const onElements = () => {
      this.reconcileOrder();
    };
    this.elementsY.observe(onElements);
    this.unsubs.push(() => this.elementsY.unobserve(onElements));

    const onElementsDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      const changed = new Set<string>();
      for (const evt of events) {
        const id = evt.path[0];
        if (typeof id === "string") changed.add(id);
      }
      if (changed.size > 0) this.refreshElements(Array.from(changed));
    };
    this.elementsY.observeDeep(onElementsDeep);
    this.unsubs.push(() => this.elementsY.unobserveDeep(onElementsDeep));

    const onOrder = () => this.handleOrderChanged();
    this.orderY.observe(onOrder);
    this.unsubs.push(() => this.orderY.unobserve(onOrder));
  }

  destroy(): void {
    this.destroyed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.listeners.clear();
    this.undoManager.destroy();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  getOrder(): readonly string[] {
    return this.order;
  }

  getOrderIndex(id: string): number {
    return this.orderIndex.get(id) ?? -1;
  }

  getElement(id: string): Element | undefined {
    return this.elements.get(id);
  }

  getAllElements(): Element[] {
    return this.order.map((id) => this.elements.get(id)).filter((e): e is Element => Boolean(e));
  }

  queryRect(r: Rect): string[] {
    return this.index.search(r).map((i) => i.id);
  }

  queryPoint(p: { x: number; y: number }, radius: number): string[] {
    const r: Rect = { minX: p.x - radius, minY: p.y - radius, maxX: p.x + radius, maxY: p.y + radius };
    return this.queryRect(r);
  }

  private rebuildAll(): void {
    this.elements.clear();
    this.index.clear();
    this.indexItems.clear();

    for (const [id, value] of this.elementsY.entries()) {
      if (typeof id !== "string" || !isYMap(value)) continue;
      const snap = yElementToSnapshot(id, value);
      if (!snap) continue;
      this.elements.set(id, snap);
      this.upsertIndexItem(id, snap);
    }

    this.handleOrderChanged();
    this.reconcileOrder();
    this.emit();
  }

  private handleOrderChanged(): void {
    const next = this.orderY.toArray().filter((v): v is string => typeof v === "string");
    this.order = next;
    this.orderIndex.clear();
    for (let i = 0; i < next.length; i += 1) this.orderIndex.set(next[i]!, i);
    this.emit();
  }

  private reconcileOrder(): void {
    const ids = Array.from(this.elements.keys());
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of this.order) {
      if (this.elements.has(id) && !seen.has(id)) {
        next.push(id);
        seen.add(id);
      }
    }
    for (const id of ids) {
      if (!seen.has(id)) next.push(id);
    }
    if (next.length === this.order.length && next.every((id, i) => id === this.order[i])) return;

    this.doc.transact(() => {
      this.orderY.delete(0, this.orderY.length);
      this.orderY.insert(0, next);
    }, this.systemOrigin);
  }

  private refreshElements(ids: string[]): void {
    if (this.destroyed) return;

    let changed = false;
    for (const id of ids) {
      const value = this.elementsY.get(id);
      if (!isYMap(value)) continue;
      const snap = yElementToSnapshot(id, value);
      if (!snap) continue;
      this.elements.set(id, snap);
      this.upsertIndexItem(id, snap);
      changed = true;
    }
    if (changed) this.emit();
  }

  private upsertIndexItem(id: string, el: Element): void {
    const bounds = computeElementBounds(el);
    const prev = this.indexItems.get(id);
    const next: IndexItem = { ...bounds, id };

    if (prev) this.index.remove(prev);
    this.index.insert(next);
    this.indexItems.set(id, next);
  }

  private removeIndexItem(id: string): void {
    const prev = this.indexItems.get(id);
    if (!prev) return;
    this.index.remove(prev);
    this.indexItems.delete(id);
  }

  private getYElement(id: string): Y.Map<unknown> | null {
    const v = this.elementsY.get(id);
    return isYMap(v) ? v : null;
  }

  getTextType(id: string): Y.Text | null {
    const yEl = this.getYElement(id);
    if (!yEl) return null;
    const v = yEl.get("text");
    return isYText(v) ? v : null;
  }

  getFreehandPointsType(id: string): Y.Array<unknown> | null {
    const yEl = this.getYElement(id);
    if (!yEl) return null;
    const v = yEl.get("points");
    return isYArray(v) ? v : null;
  }

  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  delete(ids: string[]): void {
    if (ids.length === 0) return;
    const unique = Array.from(new Set(ids));

    this.doc.transact(() => {
      for (const id of unique) this.elementsY.delete(id);
      // Remove from order
      const next = this.order.filter((id) => !unique.includes(id));
      this.orderY.delete(0, this.orderY.length);
      this.orderY.insert(0, next);
    }, this.localOrigin);

    for (const id of unique) {
      this.elements.delete(id);
      this.removeIndexItem(id);
    }
    this.emit();
  }

  createElement(type: ElementType, initial: Partial<Element> & { x: number; y: number }, style: CreateStyle): string {
    const id = createId("el");
    const createdAt = Date.now();

    const yEl = new Y.Map<unknown>();
    yEl.set("type", type);
    yEl.set("x", initial.x);
    yEl.set("y", initial.y);
    yEl.set("rotation", typeof initial.rotation === "number" ? initial.rotation : 0);
    yEl.set("opacity", style.opacity);
    yEl.set("strokeColor", style.strokeColor);
    if (style.fillColor) yEl.set("fillColor", style.fillColor);
    yEl.set("strokeWidth", style.strokeWidth);
    yEl.set("roughness", 0);
    yEl.set("locked", false);
    yEl.set("createdAt", createdAt);
    yEl.set("createdBy", this.userId);

    switch (type) {
      case "rect": {
        yEl.set("w", typeof (initial as { w?: unknown }).w === "number" ? (initial as { w: number }).w : 0);
        yEl.set("h", typeof (initial as { h?: unknown }).h === "number" ? (initial as { h: number }).h : 0);
        yEl.set(
          "cornerRadius",
          typeof (initial as { cornerRadius?: unknown }).cornerRadius === "number"
            ? (initial as { cornerRadius: number }).cornerRadius
            : 0
        );
        break;
      }
      case "ellipse": {
        yEl.set("w", typeof (initial as { w?: unknown }).w === "number" ? (initial as { w: number }).w : 0);
        yEl.set("h", typeof (initial as { h?: unknown }).h === "number" ? (initial as { h: number }).h : 0);
        break;
      }
      case "line": {
        yEl.set("x2", typeof (initial as { x2?: unknown }).x2 === "number" ? (initial as { x2: number }).x2 : initial.x);
        yEl.set("y2", typeof (initial as { y2?: unknown }).y2 === "number" ? (initial as { y2: number }).y2 : initial.y);
        break;
      }
      case "arrow": {
        yEl.set("x2", typeof (initial as { x2?: unknown }).x2 === "number" ? (initial as { x2: number }).x2 : initial.x);
        yEl.set("y2", typeof (initial as { y2?: unknown }).y2 === "number" ? (initial as { y2: number }).y2 : initial.y);
        yEl.set("headSize", 14);
        break;
      }
      case "freehand": {
        const pointsY = new Y.Array<SharedPoint>();
        yEl.set("points", pointsY);
        yEl.set("streamline", 0.7);
        break;
      }
      case "text": {
        const yText = new Y.Text(typeof (initial as { text?: unknown }).text === "string" ? (initial as { text: string }).text : "");
        yEl.set("text", yText);
        yEl.set(
          "fontSize",
          typeof (initial as { fontSize?: unknown }).fontSize === "number" ? (initial as { fontSize: number }).fontSize : 24
        );
        yEl.set(
          "fontFamily",
          typeof (initial as { fontFamily?: unknown }).fontFamily === "string"
            ? (initial as { fontFamily: string }).fontFamily
            : "\"Bradley Hand\", \"Segoe Print\", \"Comic Sans MS\", \"Chalkboard SE\", \"Marker Felt\", ui-rounded, system-ui, -apple-system, Segoe UI, Roboto, cursive"
        );
        yEl.set(
          "align",
          typeof (initial as { align?: unknown }).align === "string" ? (initial as { align: string }).align : "left"
        );
        break;
      }
    }

    this.doc.transact(() => {
      this.elementsY.set(id, yEl);
      this.orderY.push([id]);
    }, this.localOrigin);

    const snap = yElementToSnapshot(id, yEl);
    if (snap) {
      this.elements.set(id, snap);
      this.upsertIndexItem(id, snap);
      this.emit();
    }
    return id;
  }

  update(id: string, patch: Record<string, unknown>): void {
    const yEl = this.getYElement(id);
    if (!yEl) return;

    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || typeof v === "undefined") {
          yEl.delete(k);
        } else {
          yEl.set(k, v);
        }
      }
    }, this.localOrigin);
  }

  appendFreehandPoints(id: string, points: SharedPoint[]): void {
    if (points.length === 0) return;
    const yArr = this.getFreehandPointsType(id);
    if (!yArr) return;

    this.doc.transact(() => {
      yArr.push(points);
    }, this.localOrigin);
  }

  setFreehandPoints(id: string, points: SharedPoint[]): void {
    const yArr = this.getFreehandPointsType(id);
    if (!yArr) return;
    this.doc.transact(() => {
      yArr.delete(0, yArr.length);
      yArr.insert(0, points);
    }, this.localOrigin);
  }

  applyTextDiff(id: string, nextValue: string): void {
    const yText = this.getTextType(id);
    if (!yText) return;

    const prev = yText.toString();
    if (prev === nextValue) return;

    let start = 0;
    while (start < prev.length && start < nextValue.length && prev[start] === nextValue[start]) start += 1;

    let endPrev = prev.length;
    let endNext = nextValue.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === nextValue[endNext - 1]) {
      endPrev -= 1;
      endNext -= 1;
    }

    const deleteCount = endPrev - start;
    const insertText = nextValue.slice(start, endNext);

    this.doc.transact(() => {
      if (deleteCount > 0) yText.delete(start, deleteCount);
      if (insertText.length > 0) yText.insert(start, insertText);
    }, this.localOrigin);
  }

  bringToFront(ids: string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    const rest = this.order.filter((id) => !set.has(id));
    const next = rest.concat(this.order.filter((id) => set.has(id)));
    this.doc.transact(() => {
      this.orderY.delete(0, this.orderY.length);
      this.orderY.insert(0, next);
    }, this.localOrigin);
  }

  sendToBack(ids: string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    const selected = this.order.filter((id) => set.has(id));
    const rest = this.order.filter((id) => !set.has(id));
    const next = selected.concat(rest);
    this.doc.transact(() => {
      this.orderY.delete(0, this.orderY.length);
      this.orderY.insert(0, next);
    }, this.localOrigin);
  }
}
