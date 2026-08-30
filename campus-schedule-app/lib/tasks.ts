import type { Priority, Task } from "@/context/store";

// Small pure helpers shared by the Home dashboard, Tasks tab and Calendar.

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function todayIso(): string {
  return isoDate(new Date());
}

export function isOverdue(task: Task, ref = todayIso()): boolean {
  return !task.done && !!task.due && task.due < ref;
}

export function dueOn(tasks: Task[], iso: string): Task[] {
  return tasks.filter((t) => t.due === iso);
}

export function withinNextDays(tasks: Task[], days: number, from = new Date()): Task[] {
  const start = isoDate(from);
  const end = new Date(from);
  end.setDate(end.getDate() + days);
  const endIso = isoDate(end);
  return tasks
    .filter((t) => t.due && t.due >= start && t.due <= endIso)
    .sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0));
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
    const ad = a.due ?? "9999-99-99";
    const bd = b.due ?? "9999-99-99";
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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
