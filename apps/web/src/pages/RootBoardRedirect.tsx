import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createId } from "@whiteboard/shared";
import { getLastBoardId, setLastBoardId } from "../whiteboard/utils/lastBoard";

export function RootBoardRedirect() {
  const navigate = useNavigate();
  const idRef = useRef<string | null>(null);

  if (!idRef.current) {
    idRef.current = getLastBoardId() ?? createId("board");
  }

  useEffect(() => {
    const id = idRef.current;
    if (!id) return;
    setLastBoardId(id);
    navigate(`/board/${id}`, { replace: true });
  }, [navigate]);

  return <div className="p-6 text-sm text-muted-foreground">Opening board…</div>;
}

