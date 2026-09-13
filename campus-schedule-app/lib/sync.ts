import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import { BACKUP_KEYS, type CollectionName } from "@/lib/backup";

// Shared pieces of cloud sync: status (read by the Settings screen), the
// per-device id, per-account bookkeeping, and "does this device already
// hold real data?". The engine itself lives in components/SyncEngine.tsx.

export const SLICES = Object.keys(BACKUP_KEYS) as CollectionName[];
export const sliceForKey = (storageKey: string) => SLICES.find((n) => BACKUP_KEYS[n] === storageKey);

// --- Status ------------------------------------------------------------------

export type SyncPhase = "off" | "connecting" | "syncing" | "synced" | "error" | "choice";

export type SyncState = {
  phase: SyncPhase;
  lastSyncedAt: number | null;
  error: string | null;
};

let state: SyncState = { phase: "off", lastSyncedAt: null, error: null };
const subscribers = new Set<() => void>();

export function setSyncState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => state,
    () => state
  );
}

let syncNowHandler: (() => void) | null = null;
export function registerSyncNow(fn: (() => void) | null) {
  syncNowHandler = fn;
}
export function requestSyncNow() {
  syncNowHandler?.();
}

// --- Device id & bookkeeping -------------------------------------------------

const DEVICE_KEY = "campus-schedule-cache:device-id";
const metaKey = (userId: string) => `campus-schedule-cache:sync-meta:${userId}`;

export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

export type SyncMeta = {
  /** Set once this device has finished its first sync with the account. */
  firstSyncDone: boolean;
  /** Server updated_at we last saw for each slice. */
  remoteUpdatedAt: Partial<Record<CollectionName, string>>;
  /** Hash of each slice as of the last sync, to spot changes made while offline. */
  syncedHash: Partial<Record<CollectionName, string>>;
  /** When this device last changed each slice (ms). */
  localChangedAt: Partial<Record<CollectionName, number>>;
};

export async function loadMeta(userId: string): Promise<SyncMeta> {
  try {
    const raw = await AsyncStorage.getItem(metaKey(userId));
    if (raw) return { remoteUpdatedAt: {}, syncedHash: {}, localChangedAt: {}, firstSyncDone: false, ...JSON.parse(raw) };
  } catch {
    // Corrupt bookkeeping just means a fresh first sync.
  }
  return { firstSyncDone: false, remoteUpdatedAt: {}, syncedHash: {}, localChangedAt: {} };
}

export async function saveMeta(userId: string, meta: SyncMeta) {
  await AsyncStorage.setItem(metaKey(userId), JSON.stringify(meta)).catch(() => {});
}

/** Fast non-cryptographic hash (FNV-1a) — only for change detection. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}:${s.length}`;
}

// --- Does a device have data worth keeping? ----------------------------------

const SEED_COURSE_ID = "seed-cmsc13";

export function hasMeaningfulData(data: Partial<Record<CollectionName, unknown>>): boolean {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  if (len(data.tasks) || len(data.events) || len(data.cancellations)) return true;
  const courses = Array.isArray(data.courses) ? (data.courses as { id: string }[]) : [];
  if (courses.some((c) => c.id !== SEED_COURSE_ID)) return true;
  if (data.grades && Object.keys(data.grades as object).length) return true;
  const settings = data.settings as { term?: unknown } | undefined;
  if (settings?.term) return true;
  const canvases = (data.canvases ?? {}) as Record<string, { items?: unknown[]; drawings?: unknown[] }>;
  return Object.values(canvases).some((c) => len(c?.items) || len(c?.drawings));
}

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
