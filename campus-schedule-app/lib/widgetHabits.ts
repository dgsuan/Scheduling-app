import { habitDate, habitOccurrences, habitProgress, type HabitData } from "./habits";
export function widgetHabits(data: HabitData, now: number) {
  let total = 0, completed = 0;
  const rows = data.habits.flatMap(h => {
    const date = habitDate(h.schedules.at(-1)!.timezone, now);
    const occurrences = habitOccurrences(h, date, date);
    if (!occurrences.length) return [];
    const progress = occurrences.map(o => habitProgress(h, o, data.logs, now));
    const done = progress.filter(p => p.ratio === 1).length;
    total += occurrences.length; completed += done;
    const o = occurrences[0], p = progress[0];
    return [{ id: h.id, title: h.title, done: done === occurrences.length,
      progress: occurrences.length > 1 ? `${done}/${occurrences.length} daily goals` : o.schedule.frequency === "weekly" ? `${p.sessions}/${o.schedule.quota} days this week` : h.type === "binary" ? done ? "Done today" : "Ready when you are" : `${h.type === "duration" ? Math.floor(p.amount / 60) : p.amount}/${h.type === "duration" ? o.schedule.target / 60 : o.schedule.target} ${o.schedule.unit}` }];
  }).sort((a, b) => Number(a.done) - Number(b.done));
  return { total, completed, rows };
}
