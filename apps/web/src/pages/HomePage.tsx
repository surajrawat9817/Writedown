import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { createId } from "@whiteboard/shared";
import { getLastBoardId } from "../whiteboard/utils/lastBoard";

export function HomePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const lastBoardId = useMemo(() => getLastBoardId(), []);

  const createBoard = useCallback(async () => {
    setLoading(true);
    try {
      const id = createId("board");
      navigate(`/board/${id}`);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  return (
    <div className="h-full bg-gradient-to-b from-background to-muted/60">
      <div className="mx-auto flex h-full max-w-4xl flex-col items-center justify-center gap-6 px-6">
        <div className="text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight">Writedown</h1>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            A fast, offline-first whiteboard with a custom canvas engine and reliable local persistence.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={createBoard} disabled={loading}>
            {loading ? "Creating…" : "Create new board"}
          </Button>
          {lastBoardId ? (
            <Button variant="secondary" onClick={() => navigate(`/board/${lastBoardId}`)}>
              Continue last board
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => navigate(`/board/board_demo`)}
            title="Quick link for local testing; will be persisted once opened."
          >
            Open demo board
          </Button>
        </div>
        <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">
          Tip: This build is frontend-only. Boards are saved in your browser storage; share the URL to reopen the
          same board on this device/browser.
        </div>
      </div>
    </div>
  );
}
