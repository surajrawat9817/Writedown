import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { BoardShell } from "../whiteboard/BoardShell";
import { useBoardSession } from "../whiteboard/hooks/useBoardSession";

export function BoardPage() {
  const { boardId } = useParams();
  const id = useMemo(() => (typeof boardId === "string" && boardId.length > 0 ? boardId : null), [boardId]);
  const session = useBoardSession(id);

  if (!id) {
    return <div className="p-6 text-sm text-muted-foreground">Invalid board id.</div>;
  }

  if (session.status === "connecting") {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (session.status === "error") {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to connect. {session.errorMessage ?? "Unknown error"}
      </div>
    );
  }

  return <BoardShell session={session.session} />;
}
