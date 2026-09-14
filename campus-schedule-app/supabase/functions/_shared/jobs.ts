// The pure part of the two scheduled jobs, built from the app's own logic
// (copied into ./app by scripts/prepare-functions.mjs). Unit-tested in Node:
// tests/functions.test.ts.

import { parseIcs, planImport } from "./app/ics.ts";
import { mergeImported } from "./app/icsMerge.ts";
import { dueReminders, type Reminder } from "./app/reminders.ts";
import type { CalendarEvent, Cancellation, Course, PlannerSettings, Task } from "./app/store-types.ts";

/** A row from the per-item sync table. */
export type ItemRow = { collection: string; id: string; data: unknown };

function pick<T>(rows: ItemRow[], collection: string): T[] {
  return rows
    .filter((r) => r.collection === collection && r.data && typeof r.data === "object")
    .map((r) => ({ ...(r.data as object), id: r.id }) as T);
}

/** Server reminders run within this window, so a missed minute still sends. */
export const SERVER_REMINDER_GRACE_MS = 5 * 60_000;

/**
 * Reminders due now for one person, from their synced data.
 * The Edge runtime's clock is UTC, and the app's scheduling code works in
 * local wall time — so "now" is shifted by the device's offset from UTC.
 */
export function remindersForUser(rows: ItemRow[], nowMs: number, tzOffsetMin: number): Reminder[] {
  const settingsRow = rows.find((r) => r.collection === "setting" && r.id === "settings");
  const settings = (settingsRow?.data ?? null) as Partial<PlannerSettings> | null;
  if (!settings?.reminders?.enabled) return [];
  const wallClock = new Date(nowMs + tzOffsetMin * 60_000);
  return dueReminders({
    now: wallClock,
    courses: pick<Course>(rows, "course"),
    tasks: pick<Task>(rows, "task"),
    rules: {
      term: settings.term,
      skipRegularHolidays: settings.skipRegularHolidays ?? true,
      skipSpecialHolidays: settings.skipSpecialHolidays ?? true,
      cancellations: pick<Cancellation>(rows, "cancellation"),
    },
    classLeadMin: settings.reminders.classLeadMin ?? 10,
    taskLeadMin: settings.reminders.taskLeadMin ?? 60,
    graceMs: SERVER_REMINDER_GRACE_MS,
  });
}

/** Short, stable id from a calendar entry's key (cyrb53). */
export function keyHash(s: string): string {
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

export type FeedChanges = { tasks: Task[]; events: CalendarEvent[]; skipped: number; error?: string };

/** What a calendar link adds or changes in someone's tasks and events. */
export function planFeedImport(text: string, rows: ItemRow[], nowMs: number): FeedChanges {
  const parsed = parseIcs(text);
  if (parsed.error) return { tasks: [], events: [], skipped: 0, error: parsed.error };
  const tasks = pick<Task>(rows, "task");
  const events = pick<CalendarEvent>(rows, "event");
  const courses = pick<Course>(rows, "course");
  const changed = planImport(parsed.items, { tasks, events }, courses).filter((r) => r.status !== "unchanged");
  const merged = mergeImported(
    { tasks, events },
    {
      tasks: changed.flatMap((r) => (r.as === "task" ? [r.task] : [])),
      events: changed.flatMap((r) => (r.as === "event" ? [r.event] : [])),
    },
    // Deterministic ids: re-running never duplicates.
    { now: nowMs, newId: (kind, key) => `${kind}-ics-${keyHash(key)}` }
  );
  return { ...merged, skipped: parsed.skipped.length };
}
