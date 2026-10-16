import type { Transcript } from "./types";

// Transcripts live in IndexedDB on this device only. Nothing is sent anywhere.
const DB = "scribe";
const STORE = "transcripts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const saveTranscript = (t: Transcript) => tx("readwrite", (s) => s.put(t)).catch(() => undefined);
export const deleteTranscript = (id: string) => tx("readwrite", (s) => s.delete(id)).catch(() => undefined);
export const getTranscript = (id: string) => tx<Transcript | undefined>("readonly", (s) => s.get(id)).catch(() => undefined);
export async function listTranscripts(): Promise<Transcript[]> {
  const all = await tx<Transcript[]>("readonly", (s) => s.getAll()).catch(() => []);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
