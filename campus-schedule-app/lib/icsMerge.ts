import type { CalendarEvent, Task } from "@/context/store";
import type { ImportedEvent, ImportedTask } from "@/lib/ics";

// Applying an imported calendar to existing tasks and events, matched by the
// calendar's own ids (source keys): updates change the title and dates but
// keep what you did locally (done, priority, steps, course), and new entries
// get ids from `newId`. Returns only what changed. Used by the server-side
// calendar sync; the same rules as Import → "Import" in the app.

export function mergeImported(
  existing: { tasks: Task[]; events: CalendarEvent[] },
  incoming: { tasks: ImportedTask[]; events: ImportedEvent[] },
  opts: { now: number; newId: (kind: "task" | "event", key: string) => string }
): { tasks: Task[]; events: CalendarEvent[] } {
  const taskByKey = new Map(existing.tasks.filter((t) => t.source).map((t) => [t.source!.key, t]));
  const eventByKey = new Map(existing.events.filter((e) => e.source).map((e) => [e.source!.key, e]));

  const tasks: Task[] = [];
  for (const inc of incoming.tasks) {
    const prev = taskByKey.get(inc.source.key);
    if (!prev) {
      tasks.push({ ...inc, id: opts.newId("task", inc.source.key), createdAt: opts.now, done: false });
      continue;
    }
    const next: Task = { ...prev, title: inc.title, due: inc.due, dueTime: inc.dueTime, courseId: prev.courseId ?? inc.courseId };
    if (next.title !== prev.title || next.due !== prev.due || next.dueTime !== prev.dueTime || next.courseId !== prev.courseId) tasks.push(next);
  }

  const events: CalendarEvent[] = [];
  for (const inc of incoming.events) {
    const prev = eventByKey.get(inc.source.key);
    if (!prev) {
      events.push({ ...inc, id: opts.newId("event", inc.source.key), createdAt: opts.now });
      continue;
    }
    const next: CalendarEvent = { ...prev, ...inc };
    if (
      next.title !== prev.title ||
      next.start !== prev.start ||
      next.end !== prev.end ||
      next.startTime !== prev.startTime ||
      next.endTime !== prev.endTime
    )
      events.push(next);
  }
  return { tasks, events };
}
