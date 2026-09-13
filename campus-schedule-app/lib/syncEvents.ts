// Tiny pub/sub: the store and theme announce each successful local save,
// and the sync engine listens. Kept dependency-free so the store can import
// it without creating an import cycle.

type Listener = (storageKey: string, json: string) => void;

const listeners = new Set<Listener>();

export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLocalWrite(storageKey: string, json: string) {
  listeners.forEach((l) => l(storageKey, json));
}
