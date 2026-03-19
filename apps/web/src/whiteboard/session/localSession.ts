import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { loadBoardUpdate, saveBoardUpdate } from "../utils/boardStorage";

export type LocalBoardSession = {
  mode: "local";
  boardId: string;
  doc: Y.Doc;
  awareness: Awareness;
  destroy(): void;
};

export async function createLocalBoardSession(params: {
  boardId: string;
  user: { id: string; name: string; color: string };
}): Promise<LocalBoardSession> {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", params.user);

  const persisted = await loadBoardUpdate(params.boardId);
  if (persisted && persisted.byteLength > 0) {
    Y.applyUpdate(doc, persisted);
  }

  let saveTimer: number | null = null;
  const flushSave = (): void => {
    const full = Y.encodeStateAsUpdate(doc);
    saveBoardUpdate(params.boardId, full).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn("[web] failed to persist board", err);
    });
  };
  const scheduleSave = (): void => {
    if (saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      flushSave();
    }, 500);
  };

  const onUpdate = () => scheduleSave();
  doc.on("update", onUpdate);

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flushSave();
  };
  document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });

  const onPageHide = () => {
    flushSave();
  };
  window.addEventListener("pagehide", onPageHide, { passive: true });

  // Ensure an entry exists for this board even if it's currently empty.
  flushSave();

  return {
    mode: "local",
    boardId: params.boardId,
    doc,
    awareness,
    destroy() {
      doc.off("update", onUpdate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      flushSave();
      awareness.destroy();
      doc.destroy();
    }
  };
}
