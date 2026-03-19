const DB_NAME = "whiteboard";
const DB_VERSION = 1;
const STORE_NAME = "boards";

type StoredBoard = {
  id: string;
  update: Uint8Array;
  updatedAt: number;
};

const LS_PREFIX = "whiteboard:boardUpdate:v1:";

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) return Promise.reject(new Error("indexeddb_unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_open_failed"));
  });
  return dbPromise;
}

function u8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(bytes.length, i + chunk));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64ToU8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function readFromLocalStorage(boardId: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${boardId}`);
    if (!raw) return null;
    return base64ToU8(raw);
  } catch {
    return null;
  }
}

function writeToLocalStorage(boardId: string, update: Uint8Array): void {
  try {
    localStorage.setItem(`${LS_PREFIX}${boardId}`, u8ToBase64(update));
  } catch {
    // ignore
  }
}

export async function loadBoardUpdate(boardId: string): Promise<Uint8Array | null> {
  try {
    const db = await openDb();
    const result = await new Promise<StoredBoard | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(boardId);
      req.onsuccess = () => resolve((req.result as StoredBoard | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("indexeddb_get_failed"));
    });
    if (!result) return readFromLocalStorage(boardId);
    if (result.update instanceof Uint8Array) return result.update;
    return readFromLocalStorage(boardId);
  } catch {
    return readFromLocalStorage(boardId);
  }
}

export async function saveBoardUpdate(boardId: string, update: Uint8Array): Promise<void> {
  const record: StoredBoard = { id: boardId, update: update.slice(), updatedAt: Date.now() };
  writeToLocalStorage(boardId, record.update);

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("indexeddb_put_failed"));
    });
  } catch {
    // ignore; localStorage fallback already written
  }
}

