import type { Course, Task } from "@/context/store";
import { addDaysIso, atTime, isoDate } from "@/lib/dates";
import { classesOnDate, formatRange, type ScheduleRules } from "@/lib/schedule";
import { dueAt } from "@/lib/tasks";

// Which reminders are due to fire right now. Pure: the engine component
// calls this on a timer and de-duplicates by id. Classes come from the
// same occurrence logic as the home screen, so cancelled classes, holidays
// and dates outside the term never produce a reminder.

export type Reminder = {
  id: string;
  kind: "class" | "task";
  title: string;
  body: string;
  fireAt: number;
};

/** Untimed tasks are reminded at this time on their due date. */
export const UNTIMED_TASK_REMINDER = "08:00";

/** A reminder missed (sleeping laptop, backgrounded tab) still fires within this window. */
export const REMINDER_GRACE_MS = 10 * 60_000;

export function formatLead(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const hours = m / 60;
  if (Math.abs(hours - Math.round(hours)) * 60 <= 2) {
    const h = Math.round(hours);
    return h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

export function dueReminders(opts: {
  now: Date;
  courses: Course[];
  tasks: Task[];
  rules: ScheduleRules;
  classLeadMin: number;
  taskLeadMin: number;
  graceMs?: number;
}): Reminder[] {
  const { now, rules, classLeadMin, taskLeadMin } = opts;
  const grace = opts.graceMs ?? REMINDER_GRACE_MS;
  const t = now.getTime();
  const due = (fireAt: number, eventAt: number) => fireAt <= t && t < eventAt && t - fireAt <= grace;
  const out: Reminder[] = [];

  const today = isoDate(now);
  for (const iso of [today, addDaysIso(today, 1)]) {
    for (const o of classesOnDate(opts.courses, iso, rules)) {
      const startAt = atTime(iso, o.meeting.start).getTime();
      const fireAt = startAt - classLeadMin * 60_000;
      if (!due(fireAt, startAt)) continue;
      const left = Math.ceil((startAt - t) / 60_000);
      out.push({
        id: `class:${o.course.id}:${iso}:${o.meeting.start}:${classLeadMin}`,
        kind: "class",
        title: `${o.course.code} in ${formatLead(left)}${o.meeting.room ? ` · ${o.meeting.room}` : ""}`,
        body: formatRange(o.meeting.start, o.meeting.end),
        fireAt,
      });
    }
  }

  for (const task of opts.tasks) {
    if (task.done || !task.due) continue;
    const deadline = dueAt(task)!.getTime();
    const fireAt = task.dueTime
      ? deadline - taskLeadMin * 60_000
      : atTime(task.due, UNTIMED_TASK_REMINDER).getTime();
    if (!due(fireAt, deadline)) continue;
    const name = task.title || "Untitled task";
    out.push({
      id: `task:${task.id}:${task.due}:${task.dueTime ?? ""}:${taskLeadMin}`,
      kind: "task",
      title: task.dueTime ? `${name} due in ${formatLead(Math.ceil((deadline - t) / 60_000))}` : `${name} is due today`,
      body: task.dueTime ? "Tap to open your tasks" : "No specific time set",
      fireAt,
    });
  }
  return out;
}
