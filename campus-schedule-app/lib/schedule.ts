import type { Course, Meeting, Weekday } from "@/context/store";

// Pure helpers for turning the user's recurring course meetings into
// "what's happening now / next" and per-day lookups. No React, no I/O —
// easy to reason about and (later) unit-test.

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "14:30" -> minutes since midnight, or null if unparseable. */
export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** minutes since midnight -> "2:30 PM". */
export function formatTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const min = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${period}`;
}

export function formatRange(start: string, end: string): string {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s == null || e == null) return `${start} – ${end}`;
  return `${formatTime(s)} – ${formatTime(e)}`;
}

export type ClassOccurrence = {
  course: Course;
  meeting: Meeting;
  day: Weekday;
  startMin: number;
  endMin: number;
};

/** Every valid meeting occurrence for a given weekday, sorted by start. */
export function occurrencesOnDay(courses: Course[], day: Weekday): ClassOccurrence[] {
  const out: ClassOccurrence[] = [];
  for (const course of courses) {
    for (const meeting of course.meetings) {
      if (!meeting.days.includes(day)) continue;
      const startMin = parseTime(meeting.start);
      const endMin = parseTime(meeting.end);
      if (startMin == null || endMin == null) continue;
      out.push({ course, meeting, day, startMin, endMin });
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}

/** True if any course meets on `weekday`. */
export function hasClassOnWeekday(courses: Course[], weekday: Weekday): boolean {
  return occurrencesOnDay(courses, weekday as Weekday).length > 0;
}

export type NowAndNext = {
  ongoing: ClassOccurrence | null;
  next: (ClassOccurrence & { daysAhead: number }) | null;
};

/**
 * Given the full course list and "now", find the class currently in
 * session (if any) and the next upcoming one within the next 7 days.
 */
export function computeNowAndNext(courses: Course[], now: Date): NowAndNext {
  const today = now.getDay() as Weekday;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const todays = occurrencesOnDay(courses, today);
  const ongoing =
    todays.find((o) => nowMin >= o.startMin && nowMin < o.endMin) ?? null;

  let next: (ClassOccurrence & { daysAhead: number }) | null = null;
  for (let ahead = 0; ahead < 7; ahead++) {
    const day = (((today + ahead) % 7) + 7) % 7 as Weekday;
    const occ = occurrencesOnDay(courses, day);
    const candidate =
      ahead === 0 ? occ.find((o) => o.startMin > nowMin) : occ[0];
    if (candidate) {
      next = { ...candidate, daysAhead: ahead };
      break;
    }
  }

  return { ongoing, next };
}

export function relativeDayLabel(daysAhead: number, day: Weekday): string {
  if (daysAhead === 0) return "Today";
  if (daysAhead === 1) return "Tomorrow";
  return WEEKDAY_LONG[day];
}
