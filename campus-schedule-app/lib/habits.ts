import { addDaysIso } from "@/lib/dates";

export type HabitType = "binary" | "quantity" | "duration" | "avoid";
export type HabitSchedule = {
  id: string; from: string; until?: string; timezone: string;
  frequency: "daily" | "weekdays" | "interval" | "weekly";
  weekdays: number[]; interval: number; quota: number; weekStart: number;
  slots: string[]; target: number; unit: string;
  state: "active" | "paused" | "archived";
};
export type Habit = { id: string; title: string; type: HabitType; category: string; notes: string; createdAt: number; schedules: HabitSchedule[]; reminder: boolean; routine?: string; cue?: string; pomodoroEnabled?: boolean; focusMinutes?: number; breakMinutes?: number; reminderEveryMinutes?: number; reminderSnoozedUntil?: number; reminderStart?: string; reminderEnd?: string };
export type HabitLog = { id: string; habitId: string; occurrenceKey: string; date: string; at: number; amount: number; confirmed: boolean; retracts?: string; sourceId?: string; reflection?: string; mood?: "low" | "okay" | "good" };
export type HabitData = { version: 1; habits: Habit[]; logs: HabitLog[]; cloud?: { ownerId: string; base: Record<string, { data: Habit | HabitLog; updated_at: string }> } };
export const emptyHabits = (): HabitData => ({ version: 1, habits: [], logs: [] });
export const habitId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); formatters.set(zone, f); }
  return f;
}
function localParts(at: number, zone: string) {
  const p = Object.fromEntries(formatter(zone).formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export const habitDate = (zone: string, now = Date.now()) => localParts(now, zone).date;
export const currentZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
/** Resolve wall time: earliest repeated instance; gaps advance to the next valid minute. */
export function habitTime(date: string, time: string, zone: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const at = wall + delta * 3600000, p = localParts(at, zone);
    offsets.add(Date.parse(`${p.date}T${p.time}:00Z`) - at);
  }
  for (let gap = 0; gap <= 180; gap++) {
    const desired = new Date(wall + gap * 60000).toISOString().slice(0, 16);
    const matches = [...offsets].map(o => wall + gap * 60000 - o).filter(at => {
      const p = localParts(at, zone); return `${p.date}T${p.time}` === desired;
    });
    if (matches.length) return Math.min(...matches);
  }
  throw new Error("This local time cannot be resolved.");
}
export type HabitOccurrence = { key: string; habitId: string; date: string; endDate: string; slot: string; startAt: number; endAt: number; schedule: HabitSchedule };
export function habitOccurrences(habit: Habit, from: string, to: string): HabitOccurrence[] {
  const result: HabitOccurrence[] = [], seen = new Set<string>();
  for (let date = from, count = 0; date <= to && count < 3700; date = addDaysIso(date, 1), count++) {
    const s = habit.schedules.filter(s => s.from <= date).at(-1);
    if (!s || s.state !== "active" || (s.until && date > s.until)) continue;
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (s.frequency === "weekdays" && !s.weekdays.includes(day)) continue;
    if (s.frequency === "interval" && Math.round((Date.parse(date) - Date.parse(s.from)) / 86400000) % s.interval) continue;
    const period = s.frequency === "weekly" ? addDaysIso(date, -((day - s.weekStart + 7) % 7)) : date;
    const start = period < s.from ? s.from : period;
    const end = s.frequency === "weekly" ? addDaysIso(period, 7) : addDaysIso(date, 1);
    for (const slot of s.frequency === "weekly" ? ["00:00"] : s.slots) {
      const key = `${habit.id}:${s.id}:${period}:${slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ key, habitId: habit.id, date: start, endDate: end, slot, schedule: s,
        startAt: habitTime(start, slot, s.timezone), endAt: habitTime(end, "00:00", s.timezone) });
    }
  }
  return result;
}
export function activeHabitLogs(logs: HabitLog[]): HabitLog[] {
  const unique = [...new Map(logs.map(l => [l.id, l])).values()];
  const retracted = new Set(unique.map(l => l.retracts).filter(Boolean));
  const sources = new Set<string>();
  return unique.filter(l => {
    if (l.retracts || retracted.has(l.id)) return false;
    if (l.sourceId) { if (sources.has(l.sourceId)) return false; sources.add(l.sourceId); }
    return true;
  });
}
export function habitProgress(habit: Habit, o: HabitOccurrence, logs: HabitLog[], now = Date.now()) {
  const entries = activeHabitLogs(logs).filter(l => l.occurrenceKey === o.key && l.habitId === habit.id);
  const amount = entries.reduce((sum, l) => sum + l.amount, 0);
  const confirmed = entries.some(l => l.confirmed);
  const daily = new Map<string, HabitLog[]>();
  for (const l of entries) daily.set(l.date, [...(daily.get(l.date) ?? []), l]);
  const success = (total: number, confirm: boolean) => habit.type === "avoid" ? Number(confirm && total <= o.schedule.target) : habit.type === "binary" ? Number(total > 0) : Math.min(total / o.schedule.target, 1);
  const sessions = [...daily.values()].filter(ls => success(ls.reduce((n, l) => n + l.amount, 0), ls.some(l => l.confirmed)) === 1).length;
  const ratio = o.schedule.frequency === "weekly" ? Math.min(sessions / o.schedule.quota, 1) : success(amount, confirmed);
  return { amount, confirmed, sessions, ratio, closed: now >= o.endAt,
    status: ratio === 1 ? "completed" : now >= o.endAt ? "missed" : amount > 0 ? "partial" : "pending" };
}
export function habitStats(habit: Habit, logs: HabitLog[], now = Date.now()) {
  const today = habitDate(habit.schedules.at(-1)!.timezone, now);
  const opportunities = habitOccurrences(habit, habit.schedules[0].from, today).filter(o => o.endAt <= now);
  const ratios = opportunities.map(o => habitProgress(habit, o, logs, now).ratio);
  const mean = (n: number) => { const tail = ratios.slice(-n); return tail.reduce((s, p) => s + p, 0) / tail.length * 100; };
  let current = 0, best = 0;
  for (const p of ratios) { current = p === 1 ? current + 1 : 0; best = Math.max(best, current); }
  return { score: ratios.length ? .4 * mean(30) + .4 * mean(7) + .2 * mean(90) : null, count: ratios.length, current, best };
}
const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
/** Strict validation shared by hydration and backup restore. Never silently trim bad history. */
export function validateHabitData(value: unknown): value is HabitData {
  try {
    const d = value as HabitData;
    if (!d || d.version !== 1 || !Array.isArray(d.habits) || !Array.isArray(d.logs)) return false;
    if (d.cloud && (typeof d.cloud.ownerId !== 'string' || !/^[a-f0-9-]{36}$/i.test(d.cloud.ownerId) || !d.cloud.base || typeof d.cloud.base !== 'object' || Array.isArray(d.cloud.base))) return false;
    const ids = new Set<string>();
    for (const h of d.habits) {
      if (!h || typeof h.id !== "string" || !h.id || h.id.length > 40 || ids.has(h.id) || typeof h.title !== "string" || !h.title.trim() || !["binary", "quantity", "duration", "avoid"].includes(h.type) || typeof h.category !== "string" || typeof h.notes !== "string" || !Number.isFinite(h.createdAt) || typeof h.reminder !== "boolean" || !Array.isArray(h.schedules) || !h.schedules.length) return false;
      ids.add(h.id);
      if ((h.routine !== undefined && (typeof h.routine !== "string" || h.routine.length > 100)) || (h.cue !== undefined && (typeof h.cue !== "string" || h.cue.length > 500))) return false;
      for (const field of ["focusMinutes", "breakMinutes", "reminderEveryMinutes"] as const) {
        if (h[field] !== undefined && (!Number.isInteger(h[field]) || h[field]! < 1 || h[field]! > 1440)) return false;
      }
      if (h.reminderSnoozedUntil !== undefined && (!Number.isFinite(h.reminderSnoozedUntil) || h.reminderSnoozedUntil < 0)) return false;
      if (h.pomodoroEnabled !== undefined && typeof h.pomodoroEnabled !== "boolean") return false;
      for (const time of [h.reminderStart, h.reminderEnd]) if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
      if ((h.reminderStart ?? "09:00") >= (h.reminderEnd ?? "21:00")) return false;
      const versions = new Set<string>(); let previous = "";
      for (const s of h.schedules) {
        if (!s || typeof s.id !== "string" || !s.id || s.id.length > 30 || versions.has(s.id) || !validDate(s.from) || s.from < previous || (s.until !== undefined && (!validDate(s.until) || s.until < s.from))) return false;
        if (typeof s.timezone !== "string" || !s.timezone) return false;
        versions.add(s.id); previous = s.from; formatter(s.timezone).format(0);
        if (!["daily", "weekdays", "interval", "weekly"].includes(s.frequency) || !["active", "paused", "archived"].includes(s.state) || !Number.isFinite(s.target) || s.target < 0 || (h.type !== "avoid" && s.target <= 0) || typeof s.unit !== "string" || !Number.isInteger(s.interval) || s.interval < 1 || !Number.isInteger(s.quota) || s.quota < 1 || s.quota > 7 || !Number.isInteger(s.weekStart) || s.weekStart < 0 || s.weekStart > 6) return false;
        if (!Array.isArray(s.weekdays) || !s.weekdays.length || s.weekdays.some(n => !Number.isInteger(n) || n < 0 || n > 6) || !Array.isArray(s.slots) || !s.slots.length || new Set(s.slots).size !== s.slots.length || s.slots.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return false;
      }
    }
    const logIds = new Set<string>();
    for (const l of d.logs) {
      if (!l || typeof l.id !== "string" || !l.id || logIds.has(l.id) || !ids.has(l.habitId) || typeof l.occurrenceKey !== "string" || !validDate(l.date) || !Number.isFinite(l.at) || !Number.isFinite(l.amount) || l.amount < 0 || typeof l.confirmed !== "boolean" || (l.retracts !== undefined && typeof l.retracts !== "string") || (l.sourceId !== undefined && typeof l.sourceId !== "string")) return false;
      const h = d.habits.find(h => h.id === l.habitId)!;
      if ((l.reflection !== undefined && (typeof l.reflection !== "string" || l.reflection.length > 2000)) || (l.mood !== undefined && !["low", "okay", "good"].includes(l.mood))) return false;
      if (!h.schedules.some(s => l.occurrenceKey.startsWith(`${h.id}:${s.id}:`))) return false;
      if (l.retracts) {
        const original = d.logs.find(x => x.id === l.retracts);
        if (!original || original.retracts || original.habitId !== l.habitId || original.occurrenceKey !== l.occurrenceKey) return false;
      }
      logIds.add(l.id);
    }
    return true;
  } catch { return false; }
}
