import AsyncStorage from "@react-native-async-storage/async-storage";

import { APPEARANCE_KEY } from "@/constants/theme";
import { STORAGE_KEYS } from "@/context/store";

// Local backup & restore: one JSON file with everything the user created.
// Restores are all-or-nothing — the file is fully validated before any
// write, the current data is snapshotted first, and a failed write rolls
// back to that snapshot so nothing is left half-applied.

export const BACKUP_APP = "campus-schedule";
export const BACKUP_VERSION = 1;
/** Previous data, kept so the last restore can be undone (not itself backed up). */
export const BEFORE_RESTORE_KEY = "campus-schedule-cache:before-restore";

/** Collection name in the file → storage key. */
export const BACKUP_KEYS = { ...STORAGE_KEYS, appearance: APPEARANCE_KEY } as const;
export type CollectionName = keyof typeof BACKUP_KEYS;
const NAMES = Object.keys(BACKUP_KEYS) as CollectionName[];

export type BackupFile = {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: Partial<Record<CollectionName, unknown>>;
};

export type BackupSummary = {
  courses: number;
  tasks: number;
  events: number;
  notes: number;
  images: number;
  cancellations: number;
  gradedCourses: number;
  exportedAt: string;
};

export type ValidationResult =
  | { ok: true; backup: BackupFile; summary: BackupSummary }
  | { ok: false; errors: string[] };

export async function createBackup(now = new Date()): Promise<BackupFile> {
  const pairs = await AsyncStorage.multiGet(NAMES.map((n) => BACKUP_KEYS[n]));
  const byKey = Object.fromEntries(pairs);
  const data: BackupFile["data"] = {};
  for (const name of NAMES) {
    const raw = byKey[BACKUP_KEYS[name]];
    if (raw == null) continue;
    try {
      data[name] = JSON.parse(raw);
    } catch {
      // A corrupt slice in storage isn't exported rather than breaking the file.
    }
  }
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), data };
}

export function backupFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `campus-schedule-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

// --- Validation ----------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ERRORS = 8;

type Check = (path: string, v: unknown) => void;

function makeChecker(errors: string[]) {
  const fail = (path: string, msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(`${path} ${msg}`);
  };
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const str: Check = (p, v) => typeof v !== "string" && fail(p, "should be text");
  const optStr: Check = (p, v) => v !== undefined && typeof v !== "string" && fail(p, "should be text");
  const num: Check = (p, v) => (typeof v !== "number" || !isFinite(v)) && fail(p, "should be a number");
  const bool: Check = (p, v) => typeof v !== "boolean" && fail(p, "should be true/false");
  const date: Check = (p, v) => (typeof v !== "string" || !ISO_DATE.test(v)) && fail(p, "should be a date (YYYY-MM-DD)");
  const optDate: Check = (p, v) => v !== undefined && date(p, v);
  const time: Check = (p, v) => (typeof v !== "string" || !HHMM.test(v)) && fail(p, "should be a time (HH:MM)");
  const optTime: Check = (p, v) => v !== undefined && time(p, v);
  const arr = (p: string, v: unknown, each: (p: string, item: Record<string, unknown>) => void) => {
    if (!Array.isArray(v)) return fail(p, "should be a list");
    v.forEach((item, i) => (isObj(item) ? each(`${p}[${i}]`, item) : fail(`${p}[${i}]`, "should be an object")));
  };
  const oneOf = (p: string, v: unknown, allowed: readonly string[]) =>
    !allowed.includes(v as string) && fail(p, `should be one of ${allowed.join(", ")}`);
  return { fail, isObj, str, optStr, num, bool, date, optDate, time, optTime, arr, oneOf };
}

const VALIDATORS: Record<CollectionName, (c: ReturnType<typeof makeChecker>, v: unknown) => void> = {
  courses: (c, v) =>
    c.arr("courses", v, (p, x) => {
      c.str(`${p}.id`, x.id);
      c.str(`${p}.code`, x.code);
      c.str(`${p}.color`, x.color);
      if (x.units !== undefined) c.num(`${p}.units`, x.units);
      c.arr(`${p}.meetings`, x.meetings, (mp, m) => {
        if (!Array.isArray(m.days) || m.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
          c.fail(`${mp}.days`, "should be weekdays 0–6");
        c.time(`${mp}.start`, m.start);
        c.time(`${mp}.end`, m.end);
      });
    }),
  tasks: (c, v) =>
    c.arr("tasks", v, (p, x) => {
      c.str(`${p}.id`, x.id);
      c.str(`${p}.title`, x.title);
      c.oneOf(`${p}.priority`, x.priority, ["low", "medium", "high"]);
      c.bool(`${p}.done`, x.done);
      c.num(`${p}.createdAt`, x.createdAt);
      c.optDate(`${p}.due`, x.due);
      c.optDate(`${p}.start`, x.start);
      c.optTime(`${p}.dueTime`, x.dueTime);
      c.optStr(`${p}.courseId`, x.courseId);
      if (x.repeat !== undefined) {
        if (!c.isObj(x.repeat)) c.fail(`${p}.repeat`, "should be an object");
        else c.oneOf(`${p}.repeat.freq`, x.repeat.freq, ["daily", "weekdays", "weekly"]);
      }
      if (x.subtasks !== undefined)
        c.arr(`${p}.subtasks`, x.subtasks, (sp, s) => {
          c.str(`${sp}.id`, s.id);
          c.str(`${sp}.text`, s.text);
          c.bool(`${sp}.done`, s.done);
        });
    }),
  events: (c, v) =>
    c.arr("events", v, (p, x) => {
      c.str(`${p}.id`, x.id);
      c.str(`${p}.title`, x.title);
      c.date(`${p}.start`, x.start);
      c.date(`${p}.end`, x.end);
      c.optTime(`${p}.startTime`, x.startTime);
      c.optTime(`${p}.endTime`, x.endTime);
    }),
  canvases: (c, v) => {
    if (!c.isObj(v)) return c.fail("canvases", "should be an object");
    for (const [key, canvas] of Object.entries(v)) {
      const p = `canvases.${key}`;
      if (!c.isObj(canvas)) {
        c.fail(p, "should be an object");
        continue;
      }
      c.arr(`${p}.items`, canvas.items, (ip, it) => {
        c.str(`${ip}.id`, it.id);
        c.oneOf(`${ip}.kind`, it.kind, ["text", "todo", "image", "document", "folder"]);
        c.num(`${ip}.x`, it.x);
        c.num(`${ip}.y`, it.y);
        if (it.kind === "image" || it.kind === "document") c.str(`${ip}.uri`, it.uri);
      });
      if (canvas.drawings !== undefined)
        c.arr(`${p}.drawings`, canvas.drawings, (dp, d) => {
          c.str(`${dp}.id`, d.id);
          if (!Array.isArray(d.strokes)) c.fail(`${dp}.strokes`, "should be a list");
        });
    }
  },
  settings: (c, v) => {
    if (!c.isObj(v)) return c.fail("settings", "should be an object");
    if (v.term !== undefined) {
      if (!c.isObj(v.term)) return c.fail("settings.term", "should be an object");
      c.date("settings.term.start", v.term.start);
      c.date("settings.term.end", v.term.end);
    }
  },
  cancellations: (c, v) =>
    c.arr("cancellations", v, (p, x) => {
      c.str(`${p}.id`, x.id);
      c.str(`${p}.courseId`, x.courseId);
      c.date(`${p}.date`, x.date);
      c.time(`${p}.start`, x.start);
    }),
  grades: (c, v) => {
    if (!c.isObj(v)) return c.fail("grades", "should be an object");
    for (const [courseId, g] of Object.entries(v)) {
      const p = `grades.${courseId}`;
      if (!c.isObj(g)) {
        c.fail(p, "should be an object");
        continue;
      }
      c.arr(`${p}.components`, g.components, (cp, comp) => {
        c.str(`${cp}.id`, comp.id);
        c.num(`${cp}.weight`, comp.weight);
      });
      c.arr(`${p}.entries`, g.entries, (ep, e) => {
        c.str(`${ep}.componentId`, e.componentId);
        c.num(`${ep}.score`, e.score);
        c.num(`${ep}.total`, e.total);
      });
    }
  },
  appearance: (c, v) => {
    if (!c.isObj(v)) c.fail("appearance", "should be an object");
  },
};

export function validateBackup(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["This file isn't valid JSON — it may be damaged or not a backup."] };
  }
  const errors: string[] = [];
  const c = makeChecker(errors);
  if (!c.isObj(parsed) || parsed.app !== BACKUP_APP) {
    return { ok: false, errors: ["This isn't a Campus Schedule backup file."] };
  }
  if (typeof parsed.version !== "number") return { ok: false, errors: ["The backup has no version number."] };
  if (parsed.version > BACKUP_VERSION) {
    return { ok: false, errors: ["This backup was made by a newer version of the app. Update the app first."] };
  }
  if (!c.isObj(parsed.data)) return { ok: false, errors: ["The backup has no data section."] };
  const data = parsed.data;
  const present = NAMES.filter((n) => data[n] !== undefined);
  if (!present.length) return { ok: false, errors: ["The backup doesn't contain any app data."] };
  for (const name of present) VALIDATORS[name](c, data[name]);
  if (errors.length) return { ok: false, errors };

  const canvases = (data.canvases ?? {}) as Record<string, { items: { kind: string }[] }>;
  const items = Object.values(canvases).flatMap((cv) => cv.items);
  const backup = parsed as BackupFile;
  return {
    ok: true,
    backup,
    summary: {
      courses: ((data.courses as unknown[]) ?? []).length,
      tasks: ((data.tasks as unknown[]) ?? []).length,
      events: ((data.events as unknown[]) ?? []).length,
      notes: items.filter((i) => i.kind === "text" || i.kind === "todo").length,
      images: items.filter((i) => i.kind === "image").length,
      cancellations: ((data.cancellations as unknown[]) ?? []).length,
      gradedCourses: Object.keys((data.grades as object) ?? {}).length,
      exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : "",
    },
  };
}

// --- Restore -------------------------------------------------------------------

type WithId = { id: string };

function mergeById<T extends WithId>(current: unknown, incoming: unknown): T[] {
  const cur = Array.isArray(current) ? (current as T[]) : [];
  const ids = new Set(cur.map((x) => x.id));
  return [...cur, ...((Array.isArray(incoming) ? incoming : []) as T[]).filter((x) => !ids.has(x.id))];
}

function mergeCanvases(current: unknown, incoming: unknown) {
  const out: Record<string, { items: WithId[]; drawings: WithId[] }> = JSON.parse(JSON.stringify(current ?? {}));
  for (const [key, cv] of Object.entries((incoming ?? {}) as Record<string, { items?: WithId[]; drawings?: WithId[] }>)) {
    const target = (out[key] ??= { items: [], drawings: [] });
    target.items = mergeById(target.items, cv.items);
    target.drawings = mergeById(target.drawings ?? [], cv.drawings);
  }
  return out;
}

/** What the stored data would become. Merge keeps current settings/appearance. */
export function plannedData(current: BackupFile, incoming: BackupFile, mode: "replace" | "merge"): BackupFile["data"] {
  if (mode === "replace") return { appearance: current.data.appearance, ...incoming.data };
  const cur = current.data;
  const inc = incoming.data;
  return {
    ...cur,
    courses: mergeById(cur.courses, inc.courses),
    tasks: mergeById(cur.tasks, inc.tasks),
    events: mergeById(cur.events, inc.events),
    cancellations: mergeById(cur.cancellations, inc.cancellations),
    canvases: mergeCanvases(cur.canvases, inc.canvases),
    grades: { ...((inc.grades as object) ?? {}), ...((cur.grades as object) ?? {}) },
    settings: cur.settings ?? inc.settings,
  };
}

async function writeAll(data: BackupFile["data"]) {
  const sets: [string, string][] = [];
  const removes: string[] = [];
  for (const name of NAMES) {
    if (data[name] === undefined) removes.push(BACKUP_KEYS[name]);
    else sets.push([BACKUP_KEYS[name], JSON.stringify(data[name])]);
  }
  await AsyncStorage.multiSet(sets);
  if (removes.length) await AsyncStorage.multiRemove(removes);
}

/**
 * Apply a validated backup. Current data is snapshotted first; if writing
 * fails (e.g. storage full) the snapshot is written back and the error rethrown.
 */
export async function applyBackup(incoming: BackupFile, mode: "replace" | "merge"): Promise<void> {
  const current = await createBackup();
  const next = plannedData(current, incoming, mode);
  try {
    await AsyncStorage.setItem(BEFORE_RESTORE_KEY, JSON.stringify(current));
  } catch {
    // No room for an undo copy; the restore itself can still proceed safely.
  }
  try {
    await writeAll(next);
  } catch (e) {
    await writeAll(current.data).catch(() => {});
    throw e;
  }
}

export async function hasUndoRestore(): Promise<boolean> {
  return (await AsyncStorage.getItem(BEFORE_RESTORE_KEY)) != null;
}

export async function undoLastRestore(): Promise<void> {
  const raw = await AsyncStorage.getItem(BEFORE_RESTORE_KEY);
  if (!raw) return;
  const previous = JSON.parse(raw) as BackupFile;
  await writeAll(previous.data);
  await AsyncStorage.removeItem(BEFORE_RESTORE_KEY);
}

/** Rough bytes used by the app's saved data (web localStorage stores UTF-16). */
export async function estimateStorageBytes(): Promise<number> {
  const pairs = await AsyncStorage.multiGet(NAMES.map((n) => BACKUP_KEYS[n]));
  return pairs.reduce((sum, [k, v]) => sum + (k.length + (v?.length ?? 0)) * 2, 0);
}
