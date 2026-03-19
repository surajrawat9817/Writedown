import { Download, Redo2, Undo2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { useUIStore } from "../store/uiStore";
import type { BoardCommandBus } from "../commandBus";
import type { LocalBoardSession } from "../session/localSession";

export function TopBar(
  params: { session: LocalBoardSession & { commandBus: BoardCommandBus } }
) {
  const selectedIds = useUIStore((s) => s.selectedIds);
  const canUndo = useUIStore((s) => s.canUndo);
  const canRedo = useUIStore((s) => s.canRedo);

  return (
    <div className="flex h-12 items-center justify-between gap-3 border-b bg-background px-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 pr-2">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt="Writedown"
            className="h-6 w-6"
            draggable={false}
          />
          <div className="text-sm font-semibold tracking-tight">Writedown</div>
        </div>
        <div className="h-6 w-px bg-border" />
        <div className="text-xs text-muted-foreground">Local</div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          title="Undo (Ctrl/Cmd+Z)"
          disabled={!canUndo}
          onClick={() => params.session.commandBus.emit("undo")}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Redo (Ctrl/Cmd+Shift+Z)"
          disabled={!canRedo}
          onClick={() => params.session.commandBus.emit("redo")}
        >
          <Redo2 className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <Download className="h-4 w-4" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => params.session.commandBus.emit("export:png")}>
              Export PNG {selectedIds.length ? "(selection)" : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => params.session.commandBus.emit("export:json")}>
              Export JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => navigator.clipboard.writeText(window.location.href)}
            >
              Copy board link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
