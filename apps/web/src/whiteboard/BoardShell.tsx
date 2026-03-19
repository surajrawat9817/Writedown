import { useEffect } from "react";
import { TooltipProvider } from "../components/ui/tooltip";
import { TopBar } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { BoardCanvas } from "./canvas/BoardCanvas";
import { useUIStore } from "./store/uiStore";
import type { BoardCommandBus } from "./commandBus";
import type { LocalBoardSession } from "./session/localSession";

export function BoardShell(
  params: { session: LocalBoardSession & { commandBus: BoardCommandBus } }
) {
  const setIsSpacePanning = useUIStore((s) => s.setIsSpacePanning);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsSpacePanning(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsSpacePanning(false);
    };
    window.addEventListener("keydown", down, { passive: true });
    window.addEventListener("keyup", up, { passive: true });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setIsSpacePanning]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full flex-col">
        <TopBar session={params.session} />
        <div className="flex min-h-0 flex-1">
          <Toolbar commandBus={params.session.commandBus} />
          <div className="relative min-h-0 flex-1 bg-muted/20">
            <BoardCanvas session={params.session} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
