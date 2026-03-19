import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Circle, Hand, Minus, MousePointer2, Palette, Pencil, Redo2, Shapes, Square, Type, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Separator } from "../../components/ui/separator";
import { Slider } from "../../components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../components/ui/utils";
import type { Tool } from "../types";
import { useUIStore } from "../store/uiStore";
import type { BoardCommandBus } from "../commandBus";

const shapeTools: Array<{ tool: Tool; icon: ReactNode; label: string; shortcut?: string }> = [
  { tool: "rect", icon: <Square className="h-4 w-4" />, label: "Rectangle", shortcut: "R" },
  { tool: "ellipse", icon: <Circle className="h-4 w-4" />, label: "Ellipse", shortcut: "O" },
  { tool: "line", icon: <Minus className="h-4 w-4" />, label: "Line", shortcut: "L" },
  { tool: "arrow", icon: <ArrowRight className="h-4 w-4" />, label: "Arrow", shortcut: "A" }
];

const STROKE_PRESETS = [2, 4, 8, 12] as const;
const TEXT_SIZE_PRESETS = [16, 24, 32, 48] as const;
const STROKE_COLORS = [
  "#0f172a",
  "#1f2937",
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ffffff"
] as const;

type SidebarPanel = "shapes" | "pen" | "colors" | null;

export function Toolbar(params: { commandBus: BoardCommandBus }) {
  const tool = useUIStore((s) => s.tool);
  const setTool = useUIStore((s) => s.setTool);
  const style = useUIStore((s) => s.style);
  const setStyle = useUIStore((s) => s.setStyle);
  const canUndo = useUIStore((s) => s.canUndo);
  const canRedo = useUIStore((s) => s.canRedo);

  const [panel, setPanel] = useState<SidebarPanel>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (tool === "select" || tool === "pan") setPanel(null);
  }, [tool]);

  useEffect(() => {
    if (!panel) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) {
        setPanel(null);
        return;
      }
      const target = e.target;
      if (!(target instanceof Node)) {
        setPanel(null);
        return;
      }
      if (root.contains(target)) return;
      setPanel(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [panel]);

  const toolIcons = useMemo(() => {
    const shapeActive = tool === "rect" || tool === "ellipse" || tool === "line" || tool === "arrow";
    const activeToolKey = shapeActive ? "shapes" : tool === "freehand" ? "pen" : tool;
    const icons: Array<{
      key: string;
      icon: ReactNode;
      label: string;
      shortcut?: string;
      highlight: boolean;
      open: boolean;
      onClick: () => void;
    }> = [
      {
        key: "select",
        icon: <MousePointer2 className="h-4 w-4" />,
        label: "Select",
        shortcut: "V",
        highlight: activeToolKey === "select",
        open: false,
        onClick: () => {
          setTool("select");
          setPanel(null);
        }
      },
      {
        key: "pan",
        icon: <Hand className="h-4 w-4" />,
        label: "Pan",
        shortcut: "H",
        highlight: activeToolKey === "pan",
        open: false,
        onClick: () => {
          setTool("pan");
          setPanel(null);
        }
      },
      {
        key: "pen",
        icon: <Pencil className="h-4 w-4" />,
        label: "Pen",
        shortcut: "P",
        highlight: activeToolKey === "pen",
        open: panel === "pen",
        onClick: () => {
          setTool("freehand");
          setPanel((p) => (p === "pen" ? null : "pen"));
        }
      },
      {
        key: "shapes",
        icon: <Shapes className="h-4 w-4" />,
        label: "Shapes",
        highlight: activeToolKey === "shapes",
        open: panel === "shapes",
        onClick: () => setPanel((p) => (p === "shapes" ? null : "shapes"))
      },
      {
        key: "text",
        icon: <Type className="h-4 w-4" />,
        label: "Text",
        shortcut: "T",
        highlight: activeToolKey === "text",
        open: false,
        onClick: () => {
          setTool("text");
          setPanel((p) => (p === "pen" ? null : "pen"));
        }
      },
      {
        key: "colors",
        icon: (
          <span className="relative">
            <Palette className="h-4 w-4" />
            <span
              className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border border-background"
              style={{ backgroundColor: style.strokeColor }}
            />
          </span>
        ),
        label: "Colors",
        highlight: false,
        open: panel === "colors",
        onClick: () => setPanel((p) => (p === "colors" ? null : "colors"))
      }
    ];
    return icons;
  }, [panel, setPanel, setStyle, setTool, style.strokeColor, tool]);

  return (
    <div ref={rootRef} className="flex h-full border-r bg-background">
      <div className="flex w-14 flex-col items-center gap-1 py-2">
        <div className="flex flex-col items-center gap-1 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!canUndo}
                onClick={() => params.commandBus.emit("undo")}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  !canUndo ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground" : ""
                )}
              >
                <Undo2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Undo (Ctrl/Cmd+Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!canRedo}
                onClick={() => params.commandBus.emit("redo")}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  !canRedo ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground" : ""
                )}
              >
                <Redo2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Redo (Ctrl/Cmd+Shift+Z)</TooltipContent>
          </Tooltip>
          <div className="h-px w-8 bg-border" />
        </div>

        {toolIcons.map((t) => {
          const active = t.highlight;
          return (
            <Tooltip key={t.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={t.onClick}
                  className={cn(
                    "relative grid h-10 w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    active ? "text-foreground" : "",
                    t.open && !active ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
                  )}
                >
                  {active ? (
                    <motion.div
                      layoutId="tool-active"
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.25 }}
                    />
                  ) : null}
                  <span className="relative">{t.icon}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="flex items-center gap-2">
                  <span>{t.label}</span>
                  {t.shortcut ? (
                    <span className="rounded border bg-background px-1 py-0.5 text-[10px]">{t.shortcut}</span>
                  ) : null}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <AnimatePresence initial={false} mode="wait">
        {panel ? (
          <motion.div
            key={panel}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
            className="w-64 space-y-4 border-l p-3"
          >
            {panel === "shapes" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Shapes</div>
                <div className="grid grid-cols-2 gap-2">
                  {shapeTools.map((t) => {
                    const active = t.tool === tool;
                    return (
                      <button
                        key={t.tool}
                        type="button"
                        onClick={() => {
                          setTool(t.tool);
                          setPanel(null);
                        }}
                        className={cn(
                          "flex items-center gap-2 rounded-md border bg-card px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                          active ? "border-primary/40 text-foreground" : ""
                        )}
                      >
                        {t.icon}
                        <span>{t.label}</span>
                        {t.shortcut ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">{t.shortcut}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Tip: After placing a shape, the tool switches back to Select.
                </div>
              </div>
            ) : null}

            {panel === "pen" ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Pen</div>
                  <div className="text-[11px] text-muted-foreground">Adjust stroke + text size.</div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Stroke</span>
                    <span className="text-xs tabular-nums text-foreground">{style.strokeWidth}px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {STROKE_PRESETS.map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setStyle({ strokeWidth: w })}
                        className={cn(
                          "grid h-9 w-9 place-items-center rounded-md border bg-card transition-colors hover:bg-accent",
                          style.strokeWidth === w ? "border-primary/40" : "border-border"
                        )}
                        title={`${w}px`}
                      >
                        <span className="block w-5 rounded-full bg-foreground" style={{ height: w }} />
                      </button>
                    ))}
                  </div>
                  <Slider
                    value={[style.strokeWidth]}
                    min={1}
                    max={24}
                    step={1}
                    onValueChange={(v) => {
                      const next = v[0];
                      if (typeof next === "number") setStyle({ strokeWidth: next });
                    }}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Text size</span>
                    <span className="text-xs tabular-nums text-foreground">{style.textFontSize}px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {TEXT_SIZE_PRESETS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStyle({ textFontSize: s })}
                        className={cn(
                          "grid h-9 w-9 place-items-center rounded-md border bg-card text-xs transition-colors hover:bg-accent",
                          style.textFontSize === s ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"
                        )}
                        title={`${s}px`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <Slider
                    value={[style.textFontSize]}
                    min={8}
                    max={96}
                    step={1}
                    onValueChange={(v) => {
                      const next = v[0];
                      if (typeof next === "number") setStyle({ textFontSize: next });
                    }}
                  />
                </div>
              </div>
            ) : null}

            {panel === "colors" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Colors</div>
                <div className="grid grid-cols-6 gap-2">
                  {STROKE_COLORS.map((c) => {
                    const active = style.strokeColor.toLowerCase() === c.toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setStyle({ strokeColor: c });
                          setPanel(null);
                        }}
                        className={cn(
                          "h-7 w-7 rounded-md border transition-transform hover:scale-105",
                          active ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
                        )}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
