import { useEffect, useRef } from "react";
import { useUIStore } from "../store/uiStore";
import type { BoardCommandBus } from "../commandBus";
import { BoardController } from "./board/BoardController";
import { CanvasEngine } from "./engine/CanvasEngine";
import type { LocalBoardSession } from "../session/localSession";

export function BoardCanvas(_params: {
  session: LocalBoardSession & { commandBus: BoardCommandBus };
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    const overlay = overlayRef.current;
    if (!el || !overlay) return;

    const board = new BoardController({
      doc: _params.session.doc,
      awareness: _params.session.awareness,
      userId: useUIStore.getState().user.id
    });
    const engine = new CanvasEngine({
      canvas: el,
      overlay,
      boardId: _params.session.boardId,
      board,
      commandBus: _params.session.commandBus,
      getUI: () => useUIStore.getState(),
      setSelectedIds: (ids) => useUIStore.getState().setSelectedIds(ids)
    });

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      engine.destroy();
      board.destroy();
    };
  }, [_params.session]);

  return (
    <div className="absolute inset-0">
      <canvas ref={ref} className="h-full w-full" />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" />
    </div>
  );
}
