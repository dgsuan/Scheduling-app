import { emptyHabits, validateHabitData, type Habit, type HabitData, type HabitLog } from './habits';
import { stableStringify } from './syncItems';

export type HabitCloudRow = { collection: 'habit' | 'habit_log'; id: string; parent: string | null; data: Habit | HabitLog; deleted: boolean; updated_at: string };
export type HabitCloudBase = Record<string, { data: Habit | HabitLog; updated_at: string }>;
export type HabitCloudConflict = { id: string; title: string; local: Habit; remote: Habit };
export const habitRowKey = (r: Pick<HabitCloudRow, 'collection' | 'id'>) => `${r.collection}/${r.id}`;
export const sameHabitValue = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
export const habitCacheKey = (owner?: string) => `campus-schedule-cache:habit-profile:${owner ?? 'guest'}`;
export const canAccessHabits = (data: HabitData, userId: string | null) => !data.cloud || data.cloud.ownerId === userId;
export function habitRows(data: HabitData): HabitCloudRow[] {
  return [...data.habits.map(h => ({ collection: 'habit' as const, id: h.id, parent: null, data: h, deleted: false, updated_at: '' })),
    ...data.logs.map(l => ({ collection: 'habit_log' as const, id: l.id, parent: l.habitId, data: l, deleted: false, updated_at: '' }))];
}
export function cloudHabitData(rows: HabitCloudRow[]): HabitData {
  const habits = rows.filter(r => r.collection === 'habit' && !r.deleted).map(r => r.data as Habit);
  const parents = new Set(habits.map(h => h.id));
  const logs = rows.filter(r => r.collection === 'habit_log' && !r.deleted && parents.has(r.parent!)).map(r => r.data as HabitLog);
  const data = { version: 1 as const, habits, logs };
  if (!validateHabitData(data)) throw new Error('Cloud habit data failed validation. Local history has been kept.');
  return data;
}
/** Three-way merge: logs are independent immutable events; definitions conflict visibly.
 * Remote tombstones always win. The returned base is committed with local data.
 * Uploads use server compare-and-swap, so another device cannot be overwritten
 * between this snapshot and its acknowledgement.
 */
export function planHabitSync(local: HabitData, rows: HabitCloudRow[]) {
  cloudHabitData(rows);
  const base = local.cloud?.base ?? {};
  const remote = new Map(rows.map(r => [habitRowKey(r), r]));
  const localMap = new Map(habitRows(local).map(r => [habitRowKey(r), r]));
  const merged = new Map(localMap);
  const nextBase: HabitCloudBase = { ...base };
  const uploads: { row: HabitCloudRow; expected: string | null }[] = [];
  const conflicts: HabitCloudConflict[] = [];
  const deletedParents = new Set(rows.filter(r => r.collection === 'habit' && r.deleted).map(r => r.id));
  const locallyDeleted = new Set(Object.keys(base).filter(k => k.startsWith('habit/') && !localMap.has(k)).map(k => k.slice(6)));
  for (const key of new Set([...localMap.keys(), ...remote.keys(), ...Object.keys(base)])) {
    const l = localMap.get(key), r = remote.get(key), b = base[key];
    const parent = l?.parent ?? r?.parent;
    if (r?.deleted || (parent && deletedParents.has(parent)) || (key.startsWith('habit/') && deletedParents.has(key.slice(6)))) {
      merged.delete(key); delete nextBase[key]; continue;
    }
    if (parent && locallyDeleted.has(parent)) { merged.delete(key); delete nextBase[key]; continue; }
    if (!l && b) {
      if (r && !r.deleted) uploads.push({ row: { ...r, deleted: true }, expected: r.updated_at });
      else delete nextBase[key];
      continue;
    }
    if (!l && r) { merged.set(key, r); nextBase[key] = { data: r.data, updated_at: r.updated_at }; continue; }
    if (!l) continue;
    if (!r) {
      if (b) throw new Error('A synced habit record is missing from the server. No changes were uploaded; retry or restore from backup.');
      uploads.push({ row: l, expected: null }); continue;
    }
    if (sameHabitValue(l.data, r.data)) { nextBase[key] = { data: r.data, updated_at: r.updated_at }; continue; }
    if (l.collection === 'habit_log') throw new Error('A check-in ID has conflicting contents. Export a backup before resolving this history conflict.');
    if (b && sameHabitValue(l.data, b.data)) {
      merged.set(key, r); nextBase[key] = { data: r.data, updated_at: r.updated_at };
    } else if (b && sameHabitValue(r.data, b.data)) {
      uploads.push({ row: l, expected: r.updated_at });
    } else {
      conflicts.push({ id: l.id, title: (l.data as Habit).title, local: l.data as Habit, remote: r.data as Habit });
    }
  }
  if (conflicts.length) return { data: local, uploads: [], conflicts };
  const data = cloudHabitData([...merged.values()]);
  // Parents first, original logs next, corrections last, deletions last.
  const rank = (r: HabitCloudRow) => r.deleted ? 3 : r.collection === 'habit' ? 0 : (r.data as HabitLog).retracts ? 2 : 1;
  uploads.sort((a, b) => rank(a.row) - rank(b.row));
  return { data: { ...data, cloud: local.cloud ? { ...local.cloud, base: nextBase } : undefined }, uploads, conflicts };
}

/** Do not silently discard logs when accepting a conflicting definition. */
export function acceptCloudHabit(local: HabitData, remote: Habit) {
  const next = { ...local, habits: local.habits.map(h => h.id === remote.id ? remote : h) };
  if (!validateHabitData(next)) throw new Error('This definition does not contain schedules used by local logs. Export a backup and resolve those schedules first.');
  return next;
}

export const portableHabits = (data: HabitData): HabitData => ({ ...emptyHabits(), habits: data.habits, logs: data.logs });
