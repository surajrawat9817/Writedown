import { createId, pickColor } from "@whiteboard/shared";

type StoredIdentity = { id: string; name: string; color: string };

const KEY = "whiteboard:userIdentity:v1";

function safeParse(raw: string | null): StoredIdentity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof (parsed as { id?: unknown }).id === "string" &&
      typeof (parsed as { name?: unknown }).name === "string" &&
      typeof (parsed as { color?: unknown }).color === "string"
    ) {
      return parsed as StoredIdentity;
    }
    return null;
  } catch {
    return null;
  }
}

export function getOrCreateIdentity(): StoredIdentity {
  const existing = safeParse(localStorage.getItem(KEY));
  if (existing) return existing;

  const id = createId("user");
  const num = Math.abs(
    id.split("").reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) | 0, 5381)
  );
  const name = `Guest ${String(num % 10_000).padStart(4, "0")}`;
  const color = pickColor(id);

  const next: StoredIdentity = { id, name, color };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

