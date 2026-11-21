import { addDaysIso } from "@/lib/dates";
import { activeHabitLogs, habitDate, habitOccurrences, habitProgress, type HabitData } from "@/lib/habits";

/** Count each scheduled opportunity once, including weekly quotas. */
export function habitReport(data: HabitData, days: number, now: number) {
  return data.habits.map(habit => {
    const today = habitDate(habit.schedules.at(-1)!.timezone, now);
    const opportunities = habitOccurrences(habit, addDaysIso(today, 1 - days), today)
      .filter(o => o.endAt <= now && o.date >= addDaysIso(today, 1 - days));
    const completed = opportunities.filter(o => habitProgress(habit, o, data.logs, now).ratio === 1).length;
    return { habit, opportunities: opportunities.length, completed, rate: opportunities.length ? Math.round(completed / opportunities.length * 100) : null };
  });
}

// Escape spreadsheet formulas as well as CSV delimiters. Export only effective
// entries, with no account identifiers, cloud metadata or private freeform notes.
const cell = (value: string | number | boolean) => {
  const text = String(value);
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replace(/"/g, '""')}"`;
};
export function habitCsv(data: HabitData): string {
  const habits = new Map(data.habits.map(h => [h.id, h]));
  const rows: (string | number | boolean)[][] = [["Habit", "Category", "Date", "Amount", "Unit", "Observation confirmed", "Recorded at"]];
  for (const log of activeHabitLogs(data.logs)) {
    if (log.reflection || log.mood) continue;
    const habit = habits.get(log.habitId);
    if (!habit) continue;
    const schedule = habitOccurrences(habit, log.date, log.date).find(o => o.key === log.occurrenceKey)?.schedule
      ?? habit.schedules.find(s => log.occurrenceKey.startsWith(`${habit.id}:${s.id}:`));
    rows.push([habit.title, habit.category, log.date, habit.type === "duration" ? log.amount / 60 : log.amount,
      habit.type === "duration" ? "minutes" : schedule?.unit ?? "times", log.confirmed, new Date(log.at).toISOString()]);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(",")).join("\r\n");
}

/** One activity credit per habit/day, so splitting an entry never farms points. */
export function habitMilestones(data: HabitData) {
  const entries = activeHabitLogs(data.logs).filter(l => l.amount > 0 || l.confirmed);
  const days = new Set(entries.map(l => l.date)).size;
  const checkIns = new Set(entries.map(l => `${l.habitId}:${l.date}`)).size;
  return { days, checkIns, points: checkIns * 10, level: Math.floor(checkIns / 10) + 1,
    badges: [
      { title: "First step", earned: checkIns >= 1, description: "Record your first habit." },
      { title: "Finding a rhythm", earned: days >= 7, description: "Show up on 7 different days." },
      { title: "Small steps add up", earned: checkIns >= 30, description: "Record 30 habit days." },
      { title: "Growing steadily", earned: days >= 30, description: "Show up on 30 different days." },
    ] };
}

/** Seven calendar days, using each habit's timezone and existing recurrence rules. */
export function habitWeek(habit: HabitData["habits"][number], logs: HabitData["logs"], now: number) {
  const today = habitDate(habit.schedules.at(-1)!.timezone, now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(today, i - 6);
    const occurrences = habitOccurrences(habit, date, date);
    const progress = occurrences.map(o => habitProgress(habit, o, logs, now));
    const ratio = progress.length ? progress.reduce((sum, p) => sum + p.ratio, 0) / progress.length : null;
    return { date, ratio, weekly: occurrences.some(o => o.schedule.frequency === "weekly") };
  });
}

/** Last seven complete local days versus the seven before them; weekly goals count once. */
export function habitWeeklyRecap(data: HabitData, now: number) {
  const periods = [0, 7].map(offset => {
    let completed = 0, total = 0;
    for (const habit of data.habits) {
      const today = habitDate(habit.schedules.at(-1)!.timezone, now);
      const end = addDaysIso(today, -offset);
      const start = addDaysIso(end, -7);
      const opportunities = habitOccurrences(habit, addDaysIso(start, -6), addDaysIso(end, -1))
        .filter(o => o.endDate > start && o.endDate <= end && o.endAt <= now);
      total += opportunities.length;
      completed += opportunities.filter(o => habitProgress(habit, o, data.logs, now).ratio === 1).length;
    }
    return { completed, total, rate: total ? Math.round(completed / total * 100) : null };
  });
  return { current: periods[0], previous: periods[1] };
}
