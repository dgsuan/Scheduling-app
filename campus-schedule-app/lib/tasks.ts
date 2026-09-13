import type { Priority, Task } from "@/context/store";
import { isoDate } from "@/lib/dates";
import { display12h } from "@/lib/schedule";

// Small pure helpers shared by the Home dashboard, Tasks tab and Calendar.

/** A task without a time is due at the very end of its day. */
const END_OF_DAY = "23:59";

/** Tasks due within this window (and not overdue) count as "due soon". */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

export { isoDate };

export function todayIso(): string {
  return isoDate(new Date());
}

/** The moment a task is due (local time), or null if it has no date. */
export function dueAt(task: Pick<Task, "due" | "dueTime">): Date | null {
  if (!task.due) return null;
  return new Date(`${task.due}T${task.dueTime ?? END_OF_DAY}:00`);
}

export function isOverdue(task: Task, now = new Date()): boolean {
  const at = dueAt(task);
  return !task.done && !!at && at.getTime() < now.getTime();
}

export function isDueSoon(task: Task, now = new Date()): boolean {
  const at = dueAt(task);
  if (task.done || !at) return false;
  const diff = at.getTime() - now.getTime();
  return diff >= 0 && diff <= DUE_SOON_MS;
}

export function dueOn(tasks: Task[], iso: string): Task[] {
  return tasks.filter((t) => t.due === iso);
}

/** Sortable "YYYY-MM-DDTHH:MM" key; undated tasks sort last. */
function dueKey(task: Task): string {
  return `${task.due ?? "9999-99-99"}T${task.dueTime ?? END_OF_DAY}`;
}

export function withinNextDays(tasks: Task[], days: number, from = new Date()): Task[] {
  const start = isoDate(from);
  const end = new Date(from);
  end.setDate(end.getDate() + days);
  const endIso = isoDate(end);
  return tasks
    .filter((t) => t.due && t.due >= start && t.due <= endIso)
    .sort((a, b) => (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0));
}

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = dueKey(a);
    const bd = dueKey(b);
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (a.priority !== b.priority)
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return a.createdAt - b.createdAt;
  });
}

export function friendlyDue(due: string | undefined, ref = new Date()): string {
  if (!due) return "No date";
  const refIso = isoDate(ref);
  if (due === refIso) return "Today";
  const tomorrow = new Date(ref);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === isoDate(tomorrow)) return "Tomorrow";
  const yesterday = new Date(ref);
  yesterday.setDate(yesterday.getDate() - 1);
  if (due === isoDate(yesterday)) return "Yesterday";
  const d = new Date(due + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== ref.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "Today · 11:59 PM", "Sep 15 · 9:00 AM", or just the date when untimed. */
export function formatDue(task: Pick<Task, "due" | "dueTime">, ref = new Date()): string {
  const day = friendlyDue(task.due, ref);
  return task.due && task.dueTime ? `${day} · ${display12h(task.dueTime)}` : day;
}
