import type { ElementType } from "@whiteboard/shared";

export type Tool =
  | "select"
  | "pan"
  | "freehand"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "text";

export type ToolShape = Exclude<Tool, "select" | "pan">;

export function isShapeTool(tool: Tool): tool is ToolShape {
  return tool !== "select" && tool !== "pan";
}

export function toolToElementType(tool: ToolShape): ElementType {
  switch (tool) {
    case "rect":
      return "rect";
    case "ellipse":
      return "ellipse";
    case "line":
      return "line";
    case "arrow":
      return "arrow";
    case "text":
      return "text";
    case "freehand":
      return "freehand";
  }
}

