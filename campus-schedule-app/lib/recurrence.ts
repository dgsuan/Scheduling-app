import type { Task, TaskRepeat, Weekday } from "@/context/store";
import { addDaysIso, weekdayOf } from "@/lib/dates";
import { WEEKDAY_LONG, WEEKDAY_SHORT } from "@/lib/schedule";

// Recurring tasks use a "rolling" series: the task always holds its
// current occurrence's due date. Completing it logs a done copy and moves
// the series to the next date — so future occurrences are never touched.

/** Longest gap searched for the next occurrence. */
const MAX_SEARCH_DAYS = 366;

export function matchesRepeat(r: TaskRepeat, iso: string): boolean {
  const wd = weekdayOf(iso);
  if (r.freq === "daily") return true;
  if (r.freq === "weekdays") return wd >= 1 && wd <= 5;
  return (r.weekdays ?? []).includes(wd);
}

/** Where a series stops: its own "until", and term end for course tasks. */
export function repeatStop(task: Pick<Task, "repeat" | "courseId">, termEnd?: string): string | undefined {
  const stops = [task.repeat?.until, task.courseId ? termEnd : undefined].filter(Boolean) as string[];
  return stops.length ? stops.sort()[0] : undefined;
}

/** First date after `afterIso` that matches, or null past `stopIso`. */
export function nextRepeatDate(r: TaskRepeat, afterIso: string, stopIso?: string): string | null {
  for (let i = 1; i <= MAX_SEARCH_DAYS; i++) {
    const iso = addDaysIso(afterIso, i);
    if (stopIso && iso > stopIso) return null;
    if (matchesRepeat(r, iso)) return iso;
  }
  return null;
}

/** Future occurrences of a series (after its current due) within [from, to]. */
export function projectedDates(task: Task, from: string, to: string, termEnd?: string): string[] {
  if (!task.repeat || !task.due || task.done) return [];
  const stop = repeatStop(task, termEnd);
  const out: string[] = [];
  let cursor = task.due;
  for (let guard = 0; guard < MAX_SEARCH_DAYS; guard++) {
    const next = nextRepeatDate(task.repeat, cursor, stop);
    if (!next || next > to) break;
    if (next >= from) out.push(next);
    cursor = next;
  }
  return out;
}

export function describeRepeat(r: TaskRepeat): string {
  if (r.freq === "daily") return "Every day";
  if (r.freq === "weekdays") return "Every weekday";
  const days = [...(r.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 1) return `Every ${WEEKDAY_LONG[days[0]]}`;
  return `Every ${days.map((d) => WEEKDAY_SHORT[d]).join(", ")}`;
}

/** A sensible weekly rule anchored on the due date's weekday. */
export function weeklyOn(iso: string | undefined): TaskRepeat {
  return { freq: "weekly", weekdays: [iso ? weekdayOf(iso) : (new Date().getDay() as Weekday)] };
}
