import type { CollectionName } from "@/lib/backup";

// Per-item cloud sync, the pure part: how each local data slice maps to
// rows (one per course, task, note, …), and how a sync decides what to
// upload, what to apply locally, and what was deleted. No I/O here, so it's
// unit-tested directly; components/SyncEngine.tsx does the network side.
//
// Change detection uses a "base": the hash of every item as of the last
// successful sync. Local ≠ base → changed here; remote ≠ base → changed
// elsewhere; both → the newer change wins.

export type ItemCollection =
  | "course"
  | "task"
  | "event"
  | "cancellation"
  | "grade"
  | "note_item"
  | "drawing"
  | "setting";

export type SyncItem = {
  collection: ItemCollection;
  id: string;
  /** Notes and drawings: the canvas they're on. */
  parent: string | null;
  data: unknown;
};

export type RemoteItem = SyncItem & { deleted: boolean; updated_at: string };

export type PushItem = SyncItem & { deleted: boolean };

export const itemKey = (collection: string, id: string) => `${collection}/${id}`;

export function splitKey(key: string): { collection: ItemCollection; id: string } {
  const i = key.indexOf("/");
  return { collection: key.slice(0, i) as ItemCollection, id: key.slice(i + 1) };
}

const ARRAY_SLICES: Partial<Record<CollectionName, ItemCollection>> = {
  courses: "course",
  tasks: "task",
  events: "event",
  cancellations: "cancellation",
};

export function sliceOfItem(collection: string, id: string): CollectionName | null {
  switch (collection) {
    case "course":
      return "courses";
    case "task":
      return "tasks";
    case "event":
      return "events";
    case "cancellation":
      return "cancellations";
    case "grade":
      return "grades";
    case "note_item":
    case "drawing":
      return "canvases";
    case "setting":
      return id === "settings" ? "settings" : id === "appearance" ? "appearance" : null;
    default:
      return null;
  }
}

export const sliceOfKey = (key: string) => {
  const { collection, id } = splitKey(key);
  return sliceOfItem(collection, id);
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const withId = (v: unknown): v is { id: string } => isObj(v) && typeof v.id === "string" && v.id.length > 0 && v.id.length <= 120;

/** Every item in one slice's stored value. */
export function sliceToItems(name: CollectionName, value: unknown): SyncItem[] {
  const arrayCollection = ARRAY_SLICES[name];
  if (arrayCollection) {
    return (Array.isArray(value) ? value : []).filter(withId).map((x) => ({ collection: arrayCollection, id: x.id, parent: null, data: x }));
  }
  switch (name) {
    case "grades":
      return isObj(value)
        ? Object.entries(value)
            .filter(([id, g]) => id.length <= 120 && isObj(g))
            .map(([id, g]) => ({ collection: "grade" as const, id, parent: null, data: g }))
        : [];
    case "canvases": {
      if (!isObj(value)) return [];
      const out: SyncItem[] = [];
      for (const [canvasId, canvas] of Object.entries(value)) {
        if (!isObj(canvas)) continue;
        for (const it of Array.isArray(canvas.items) ? canvas.items : [])
          if (withId(it)) out.push({ collection: "note_item", id: it.id, parent: canvasId, data: it });
        for (const d of Array.isArray(canvas.drawings) ? canvas.drawings : [])
          if (withId(d)) out.push({ collection: "drawing", id: d.id, parent: canvasId, data: d });
      }
      return out;
    }
    case "settings":
    case "appearance":
      return isObj(value) ? [{ collection: "setting", id: name, parent: null, data: value }] : [];
    default:
      return [];
  }
}

type Canvas = { items: { id: string }[]; drawings: { id: string }[] };

/**
 * Apply remote changes (upserts and deletions) to one slice's current value.
 * Existing items keep their position, so note stacking order survives.
 */
export function applyToSlice(name: CollectionName, current: unknown, changes: RemoteItem[]): unknown {
  if (!changes.length) return current;
  const arrayCollection = ARRAY_SLICES[name];
  if (arrayCollection) {
    const list = (Array.isArray(current) ? current : []).filter(withId);
    const index = new Map(list.map((x, i) => [x.id, i]));
    const out: ({ id: string } | null)[] = [...list];
    for (const c of changes) {
      const at = index.get(c.id);
      if (c.deleted) {
        if (at !== undefined) out[at] = null;
        continue;
      }
      if (!isObj(c.data)) continue;
      const next = { ...c.data, id: c.id };
      if (at !== undefined) out[at] = next;
      else {
        index.set(c.id, out.length);
        out.push(next);
      }
    }
    return out.filter((x): x is { id: string } => x !== null);
  }
  switch (name) {
    case "grades": {
      const out: Record<string, unknown> = isObj(current) ? { ...current } : {};
      for (const c of changes) {
        if (c.deleted) delete out[c.id];
        else if (isObj(c.data)) out[c.id] = c.data;
      }
      return out;
    }
    case "canvases": {
      const src = isObj(current) ? (current as Record<string, Partial<Canvas>>) : {};
      const out: Record<string, Canvas> = {};
      for (const [k, v] of Object.entries(src))
        out[k] = { ...v, items: Array.isArray(v?.items) ? [...v.items] : [], drawings: Array.isArray(v?.drawings) ? [...v.drawings] : [] };
      const field = (c: RemoteItem) => (c.collection === "drawing" ? "drawings" : "items");
      for (const c of changes) {
        const f = field(c);
        let foundIn: string | null = null;
        for (const [k, cv] of Object.entries(out)) {
          if (cv[f].some((x) => x.id === c.id)) {
            foundIn = k;
            break;
          }
        }
        if (c.deleted) {
          if (foundIn) out[foundIn][f] = out[foundIn][f].filter((x) => x.id !== c.id);
          continue;
        }
        if (!isObj(c.data) || !c.parent) continue;
        const next = { ...c.data, id: c.id };
        if (foundIn === c.parent) {
          out[foundIn][f] = out[foundIn][f].map((x) => (x.id === c.id ? next : x));
        } else {
          if (foundIn) out[foundIn][f] = out[foundIn][f].filter((x) => x.id !== c.id);
          const target = (out[c.parent] ??= { items: [], drawings: [] });
          target[f] = [...target[f], next];
        }
      }
      return out;
    }
    case "settings":
    case "appearance": {
      const last = [...changes].reverse().find((c) => !c.deleted && isObj(c.data));
      return last ? last.data : current;
    }
    default:
      return current;
  }
}

// --- Hashing ------------------------------------------------------------------

/** JSON with sorted keys: Postgres jsonb reorders keys, so plain JSON wouldn't compare. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !isFinite(v)) return "null";
    return JSON.stringify(v) ?? "null";
  }
  if (Array.isArray(v)) {
    return `[${v.map((x) => (x === undefined || typeof x === "function" ? "null" : stableStringify(x))).join(",")}]`;
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined && typeof o[k] !== "function")
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** 53-bit string hash (cyrb53) — change detection and file names, not security. */
export function hash53(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const itemHash = (item: Pick<SyncItem, "parent" | "data">) =>
  `${hash53(stableStringify([item.parent ?? null, item.data]))}`;

// --- Planning -------------------------------------------------------------------

export type PlanInput = {
  /** Current local items (in cloud form). */
  local: SyncItem[];
  /** key → hash as of the last sync. */
  base: Record<string, string>;
  /** Remote rows: changes since the last sync, or everything (fullSnapshot). */
  remote: RemoteItem[];
  /**
   * A full snapshot means "the account holds exactly these": an unchanged
   * local item that's missing remotely was removed elsewhere.
   */
  fullSnapshot: boolean;
  /** When both sides changed an item: keep this device's version? */
  preferLocal: (key: string, remote: RemoteItem) => boolean;
};

export type PlanOutput = {
  /** Upload these (tombstones for local deletions). */
  push: PushItem[];
  /** Apply these locally (including deletions). */
  apply: RemoteItem[];
  /** Local edits that lost to a newer change from another device. */
  overwritten: { local: SyncItem | null; remote: RemoteItem }[];
  /** Base after applying; pushed items are recorded once their upload succeeds. */
  base: Record<string, string>;
};

export function planSync({ local, base, remote, fullSnapshot, preferLocal }: PlanInput): PlanOutput {
  const localMap = new Map(local.map((i) => [itemKey(i.collection, i.id), i]));
  const nextBase: Record<string, string> = { ...base };
  const push: PushItem[] = [];
  const apply: RemoteItem[] = [];
  const overwritten: PlanOutput["overwritten"] = [];
  const seen = new Set<string>();
  const tombstone = (collection: ItemCollection, id: string): PushItem => ({ collection, id, parent: null, data: {}, deleted: true });

  for (const r of remote) {
    const key = itemKey(r.collection, r.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const li = localMap.get(key);
    const lh = li ? itemHash(li) : null;
    const bh = base[key] ?? null;
    const rh = r.deleted ? null : itemHash(r);

    if (lh === rh) {
      if (rh) nextBase[key] = rh;
      else delete nextBase[key];
      continue;
    }
    const localChanged = lh !== bh;
    const remoteChanged = rh !== bh;
    if (!remoteChanged) {
      // Only this device changed it.
      push.push(li ? { ...li, deleted: false } : tombstone(r.collection, r.id));
      continue;
    }
    if (localChanged && preferLocal(key, r)) {
      push.push(li ? { ...li, deleted: false } : tombstone(r.collection, r.id));
      continue;
    }
    if (localChanged) overwritten.push({ local: li ?? null, remote: r });
    if (li || !r.deleted) apply.push(r);
    if (rh) nextBase[key] = rh;
    else delete nextBase[key];
  }

  for (const [key, li] of localMap) {
    if (seen.has(key)) continue;
    const lh = itemHash(li);
    if (lh === base[key]) {
      if (fullSnapshot) {
        apply.push({ ...li, deleted: true, updated_at: "" });
        delete nextBase[key];
      }
      continue;
    }
    push.push({ ...li, deleted: false });
  }

  for (const key of Object.keys(base)) {
    if (seen.has(key) || localMap.has(key)) continue;
    if (fullSnapshot) {
      // Gone on both sides.
      delete nextBase[key];
      continue;
    }
    const { collection, id } = splitKey(key);
    push.push(tombstone(collection, id));
  }

  return { push, apply, overwritten, base: nextBase };
}

const KIND_LABEL: Record<ItemCollection, string> = {
  course: "Course",
  task: "Task",
  event: "Event",
  cancellation: "Class cancellation",
  grade: "Grades",
  note_item: "Note",
  drawing: "Drawing",
  setting: "Settings",
};

/** A human description of an item for the sync history ("Task", "Lab report 2"). */
export function describeSyncItem(item: Pick<SyncItem, "collection" | "data">): { kind: string; title: string | null } {
  const d = (item.data && typeof item.data === "object" ? item.data : {}) as Record<string, unknown>;
  const text = typeof d.text === "string" ? d.text.split("\n")[0] : undefined;
  const title = [d.title, d.code, d.name, text].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  return { kind: KIND_LABEL[item.collection] ?? "Item", title: title ? title.trim().slice(0, 80) : null };
}

/** Base that makes a full-snapshot plan behave as "replace this device with the account". */
export const baseFromItems = (items: SyncItem[]) =>
  Object.fromEntries(items.map((i) => [itemKey(i.collection, i.id), itemHash(i)]));

/** Base that makes a plan behave as "replace the account with this device". */
export const baseFromRemote = (rows: RemoteItem[]) =>
  Object.fromEntries(rows.filter((r) => !r.deleted).map((r) => [itemKey(r.collection, r.id), itemHash(r)]));
