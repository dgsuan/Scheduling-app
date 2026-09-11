import type { Holiday } from "@/constants/holidays";
import type { CalendarEvent, Course, DatedNote, Task, Weekday } from "@/context/store";
import { display12h, formatRange, occurrencesOnDay, type ClassOccurrence } from "@/lib/schedule";
import { isoDate } from "@/lib/tasks";

// Pure date + agenda helpers for the Calendar tab and the date pickers.
// Dates are local "YYYY-MM-DD" strings throughout (no timezones).

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

export function isoToDate(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

export function addDaysIso(iso: string, days: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** True when `iso` falls within [start, end] (end defaults to start). */
export function spansDate(start: string, end: string | undefined, iso: string): boolean {
  return iso >= start && iso <= (end && end > start ? end : start);
}

/** "Monday, September 14" */
export function formatDayLong(iso: string): string {
  return isoToDate(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "Sep 14" (adds the year when it isn't the current one). */
export function formatShortDate(iso: string): string {
  const d = isoToDate(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

export type MonthCell = { day: number; iso: string; weekday: Weekday; outside?: boolean };

function cellFor(d: Date, outside?: boolean): MonthCell {
  return { day: d.getDate(), iso: isoDate(d), weekday: d.getDay() as Weekday, outside };
}

/**
 * Month laid out Sunday-first in whole weeks. Squares outside the month
 * are null, or — with `includeOutside` — the neighbouring months' days
 * flagged `outside: true`.
 */
export function buildMonthCells(year: number, month: number, includeOutside = false): (MonthCell | null)[] {
  const leading = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (MonthCell | null)[] = [];
  for (let i = leading; i > 0; i--) cells.push(includeOutside ? cellFor(new Date(year, month, 1 - i), true) : null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(cellFor(new Date(year, month, d)));
  for (let n = 1; cells.length % 7 !== 0; n++)
    cells.push(includeOutside ? cellFor(new Date(year, month + 1, n), true) : null);
  return cells;
}

// --- Agenda: everything happening on one date -------------------------

export type AgendaItem =
  | { kind: "holiday"; key: string; title: string; holiday: Holiday }
  | { kind: "class"; key: string; title: string; timeLabel: string; sortMin: number; occ: ClassOccurrence }
  | { kind: "event"; key: string; title: string; timeLabel: string; sortMin: number; event: CalendarEvent }
  | { kind: "task"; key: string; title: string; timeLabel: string; sortMin: number; task: Task }
  | { kind: "note"; key: string; title: string; note: DatedNote };

export type AgendaSources = {
  courses: Course[];
  tasks: Task[];
  events: CalendarEvent[];
  notes: DatedNote[];
  holidays: Holiday[];
};

function minutesOf(hhmm: string | undefined, fallback: number): number {
  if (!hhmm) return fallback;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function eventTimeLabel(e: CalendarEvent, iso: string): string {
  if (!e.startTime || !e.endTime) return "All day";
  if (e.start === e.end) return formatRange(e.startTime, e.endTime);
  if (iso === e.start) return `From ${display12h(e.startTime)}`;
  if (iso === e.end) return `Until ${display12h(e.endTime)}`;
  return "All day";
}

function taskTimeLabel(t: Task, iso: string): string {
  if (t.due !== iso) return t.due ? `Due ${formatShortDate(t.due)}` : "";
  return t.dueTime ? `Due ${display12h(t.dueTime)}` : "Due today";
}

/**
 * Holidays first, then classes / events / tasks by time (all-day first),
 * then notes. A task spans start→due when it has a start date.
 */
export function agendaForDate(iso: string, weekday: Weekday, src: AgendaSources): AgendaItem[] {
  const timed: Exclude<AgendaItem, { kind: "holiday" } | { kind: "note" }>[] = [];

  for (const occ of occurrencesOnDay(src.courses, weekday)) {
    timed.push({
      kind: "class",
      key: `c-${occ.course.id}-${occ.startMin}`,
      title: occ.course.code,
      timeLabel: formatRange(occ.meeting.start, occ.meeting.end),
      sortMin: occ.startMin,
      occ,
    });
  }
  for (const e of src.events) {
    if (!spansDate(e.start, e.end, iso)) continue;
    timed.push({
      kind: "event",
      key: e.id,
      title: e.title,
      timeLabel: eventTimeLabel(e, iso),
      sortMin: e.startTime && e.start === iso ? minutesOf(e.startTime, -1) : -1,
      event: e,
    });
  }
  for (const t of src.tasks) {
    if (!t.due || !spansDate(t.start ?? t.due, t.due, iso)) continue;
    timed.push({
      kind: "task",
      key: t.id,
      title: t.title || "Untitled task",
      timeLabel: taskTimeLabel(t, iso),
      sortMin: t.due === iso ? minutesOf(t.dueTime, 24 * 60) : 24 * 60,
      task: t,
    });
  }
  timed.sort((a, b) => a.sortMin - b.sortMin);

  return [
    ...src.holidays.map((h) => ({ kind: "holiday" as const, key: `h-${h.name}`, title: h.name, holiday: h })),
    ...timed,
    ...src.notes
      .filter((n) => spansDate(n.date, n.endDate, iso))
      .map((n) => ({ kind: "note" as const, key: n.id, title: n.text.trim() || "Untitled note", note: n })),
  ];
}
