import { activeHabitLogs, habitDate, habitOccurrences, habitTime, type HabitData } from "./habits";
import { addDaysIso, atTime, isoDate } from "./dates";
import { classesOnDate, type ScheduleRules } from "./schedule";
import { dueAt } from "./tasks";
import { dueReminders, UNTIMED_TASK_REMINDER, type Reminder } from "./reminders";
import type { Course, Task } from "@/context/store";

export type NativeReminderInput = { habits: HabitData; courses: Course[]; tasks: Task[]; rules: ScheduleRules; classLeadMin: number; taskLeadMin: number };
/** Android owns these alarms after scheduling, even with the JS app closed. */
export function planNativeReminders(input: NativeReminderInput, now: number): Reminder[] {
  const end = now + 7 * 86400000;
  const candidates = new Set<number>();
  const add = (at: number) => { if (at > now + 1000 && at <= end) candidates.add(at); };
  const today = isoDate(new Date(now));
  for (let day = 0; day <= 7; day++) {
    const date = addDaysIso(today, day);
    for (const o of classesOnDate(input.courses, date, input.rules)) add(atTime(date, o.meeting.start).getTime() - input.classLeadMin * 60000);
  }
  for (const task of input.tasks) if (!task.done && task.due) {
    const deadline = dueAt(task)?.getTime();
    if (deadline) add(task.dueTime ? deadline - input.taskLeadMin * 60000 : atTime(task.due, UNTIMED_TASK_REMINDER).getTime());
  }
  const logs = activeHabitLogs(input.habits.logs);
  for (const h of input.habits.habits) {
    if (!h.reminder || h.schedules.at(-1)?.state !== "active") continue;
    const first = habitDate(h.schedules.at(-1)!.timezone, now);
    for (let day = 0; day <= 7; day++) {
      const date = addDaysIso(first, day);
      for (const o of habitOccurrences(h, date, date)) {
        const snooze = h.reminderSnoozedUntil ?? 0;
        if (!h.reminderEveryMinutes) { add(Math.max(o.startAt, snooze)); continue; }
        const start = habitTime(date, h.reminderStart ?? "09:00", o.schedule.timezone);
        const stop = Math.min(o.endAt, habitTime(date, h.reminderEnd ?? "21:00", o.schedule.timezone));
        const interval = h.reminderEveryMinutes * 60000;
        const last = logs.filter(l => l.habitId === h.id && l.date === date && (l.amount > 0 || l.confirmed)).reduce((at, l) => Math.max(at, l.at), 0);
        const anchor = Math.max(start, o.startAt, last, snooze - interval);
        const count = Math.max(1, Math.floor((now - anchor) / interval) + 1);
        // Only the earliest 64 reminders can be scheduled overall.
        for (let n = count; n < count + 64 && anchor + n * interval < stop; n++) add(anchor + n * interval);
      }
    }
  }
  const result = new Map<string, Reminder>();
  for (const at of [...candidates].sort((a, b) => a - b)) {
    for (const reminder of dueReminders({ ...input, now: new Date(at), graceMs: 0 })) if (reminder.fireAt > now) result.set(reminder.id, reminder);
    if (result.size >= 64) break;
  }
  return [...result.values()].sort((a, b) => a.fireAt - b.fireAt).slice(0, 64);
}
