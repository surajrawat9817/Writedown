import { useEffect, useMemo, useState } from "react";
import { getOrCreateIdentity } from "../utils/userIdentity";
import { createLocalBoardSession, type LocalBoardSession } from "../session/localSession";
import { useUIStore } from "../store/uiStore";
import { BoardCommandBus } from "../commandBus";
import { setLastBoardId } from "../utils/lastBoard";

export type BoardSessionReady = {
  status: "ready";
  session: LocalBoardSession & { commandBus: BoardCommandBus };
};

export type BoardSessionConnecting = { status: "connecting" };
export type BoardSessionError = { status: "error"; errorMessage?: string };

export type BoardSessionState = BoardSessionReady | BoardSessionConnecting | BoardSessionError;

export function useBoardSession(boardId: string | null): BoardSessionState {
  const [state, setState] = useState<BoardSessionState>({ status: "connecting" });
  const setUser = useUIStore((s) => s.user);
  const setUserFn = useUIStore.setState;

  const identity = useMemo(() => getOrCreateIdentity(), []);

  useEffect(() => {
    if (!boardId) {
      setState({ status: "error", errorMessage: "Missing board id" });
      return;
    }

    setLastBoardId(boardId);

    // set user identity for UI; presence is handled by awareness.
    if (setUser.id !== identity.id) {
      setUserFn({ user: identity });
    }

    let disposed = false;
    let session: LocalBoardSession | null = null;
    const commandBus = new BoardCommandBus();

    setState({ status: "connecting" });
    createLocalBoardSession({ boardId, user: identity })
      .then((s) => {
        if (disposed) {
          s.destroy();
          return;
        }
        session = s;
        setState({ status: "ready", session: { ...s, commandBus } });
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[web] board session error", err);
        setState({ status: "error", errorMessage: err instanceof Error ? err.message : "Unknown error" });
      });

    return () => {
      disposed = true;
      session?.destroy();
    };
  }, [boardId, identity, setUser.id, setUserFn]);

  return state;
}
