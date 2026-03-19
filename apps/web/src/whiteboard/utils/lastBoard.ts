const LAST_BOARD_COOKIE = "whiteboard_last_board";

function parseCookies(): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = typeof document === "undefined" ? "" : document.cookie;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

export function getLastBoardId(): string | null {
  try {
    const cookies = parseCookies();
    const raw = cookies[LAST_BOARD_COOKIE];
    if (!raw) return null;
    const decoded = decodeURIComponent(raw);
    return decoded.length ? decoded : null;
  } catch {
    return null;
  }
}

export function setLastBoardId(boardId: string, opts?: { days?: number }): void {
  const days = typeof opts?.days === "number" ? opts.days : 30;
  const maxAge = Math.max(1, Math.floor(days * 24 * 60 * 60));
  const value = encodeURIComponent(boardId);
  document.cookie = `${LAST_BOARD_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

export function clearLastBoardId(): void {
  document.cookie = `${LAST_BOARD_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

