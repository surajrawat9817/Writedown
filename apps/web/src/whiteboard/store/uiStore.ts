import { create } from "zustand";
import type { Tool } from "../types";
import type { PresenceUser } from "@whiteboard/shared";

export type StyleState = {
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  opacity: number;
  textFontSize: number;
};

export type UIState = {
  tool: Tool;
  style: StyleState;
  snapToGrid: boolean;
  gridSize: number;
  showGrid: boolean;
  selectedIds: string[];
  isSpacePanning: boolean;
  user: PresenceUser;
  canUndo: boolean;
  canRedo: boolean;

  setTool(tool: Tool): void;
  setStyle(style: Partial<StyleState>): void;
  setSnapToGrid(value: boolean): void;
  setShowGrid(value: boolean): void;
  setSelectedIds(ids: string[]): void;
  setIsSpacePanning(value: boolean): void;
  setHistoryState(next: { canUndo: boolean; canRedo: boolean }): void;
};

const DEFAULT_STYLE: StyleState = {
  strokeColor: "#1f2937",
  fillColor: null,
  strokeWidth: 2,
  opacity: 1,
  textFontSize: 24
};

export const useUIStore = create<UIState>((set) => ({
  tool: "select",
  style: DEFAULT_STYLE,
  snapToGrid: false,
  gridSize: 10,
  showGrid: true,
  selectedIds: [],
  isSpacePanning: false,
  user: { id: "anon", name: "Anonymous", color: "#3b82f6" },
  canUndo: false,
  canRedo: false,

  setTool: (tool) => set({ tool }),
  setStyle: (style) => set((s) => ({ style: { ...s.style, ...style } })),
  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  setIsSpacePanning: (isSpacePanning) => set({ isSpacePanning }),
  setHistoryState: (next) => set(next)
}));
