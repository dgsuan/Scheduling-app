import { holidayMap, type Holiday } from "@/constants/holidays";
import type { Cancellation, Course, Meeting, Weekday } from "@/context/store";
import { addDaysIso, daysBetween, isoDate, isoToDate, weekdayOf } from "@/lib/dates";

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

// --- 12-hour entry helpers -------------------------------------------

export type Period = "AM" | "PM";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Split stored 24h "HH:MM" into 12-hour display parts. */
export function to12h(
  value: string
): { hour: number; minute: number; period: Period } | null {
  const min = parseTime(value);
  if (min == null) return null;
  const h24 = Math.floor(min / 60);
  const minute = min % 60;
  const period: Period = h24 >= 12 ? "PM" : "AM";
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour, minute, period };
}

/** Pretty 12h label for a stored 24h value, e.g. "12:43 PM" ("" if invalid). */
export function display12h(value: string): string {
  const p = to12h(value);
  return p ? `${p.hour}:${pad2(p.minute)} ${p.period}` : "";
}

/**
 * Lenient 12-hour time entry. Accepts "1", "12", "930", "9:5", "1243",
 * "12:43" (+ an AM/PM choice) and returns stored 24h "HH:MM", or null.
 * A typed 13–23 hour is accepted as-is (24h fallback) so power users who
 * type "1330" still get 1:30 PM.
 */
export function parse12h(input: string, period: Period): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;

  let hour: number;
  let minute: number;
  if (digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else if (digits.length === 3) {
    hour = Number(digits.slice(0, 1));
    minute = Number(digits.slice(1));
  } else {
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2, 4));
  }
  if (minute > 59) return null;

  if (hour >= 13 && hour <= 23) return `${pad2(hour)}:${pad2(minute)}`;
  if (hour === 0) return `00:${pad2(minute)}`;
  if (hour < 1 || hour > 12) return null;

  let h24 = hour % 12;
  if (period === "PM") h24 += 12;
  return `${pad2(h24)}:${pad2(minute)}`;
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

// --- Dated occurrences: term dates, holidays, one-off cancellations -------
//
// A course's meetings are a weekly *rule*. Whether a class actually
// happens on a given date is decided here, in one place, so the home
// screen, calendar, week view, reminders and .ics export all agree.

export type ScheduleRules = {
  /** Inclusive semester dates; classes outside them don't happen. */
  term?: { start: string; end: string };
  skipRegularHolidays: boolean;
  skipSpecialHolidays: boolean;
  /** One-off suspensions of a single occurrence (the rule stays intact). */
  cancellations: Cancellation[];
};

export const DEFAULT_RULES: ScheduleRules = {
  skipRegularHolidays: true,
  skipSpecialHolidays: true,
  cancellations: [],
};

/** Why an occurrence does or doesn't happen. Precedence: term > cancelled > holiday. */
export type OccurrenceStatus = "scheduled" | "outsideTerm" | "cancelled" | "holiday";

export type DatedOccurrence = ClassOccurrence & {
  date: string;
  status: OccurrenceStatus;
  holiday?: Holiday;
  cancellation?: Cancellation;
};

const holidayCache = new Map<number, Map<string, Holiday[]>>();
function holidaysFor(iso: string): Holiday[] {
  const year = Number(iso.slice(0, 4));
  let map = holidayCache.get(year);
  if (!map) {
    map = holidayMap(year);
    holidayCache.set(year, map);
  }
  return map.get(iso) ?? [];
}

/** Every meeting that the weekly rule puts on `iso`, each with its status. */
export function occurrencesOnDate(
  courses: Course[],
  iso: string,
  rules: ScheduleRules = DEFAULT_RULES
): DatedOccurrence[] {
  const base = occurrencesOnDay(courses, weekdayOf(iso));
  if (!base.length) return [];
  const outside = !!rules.term && (iso < rules.term.start || iso > rules.term.end);
  const holiday = holidaysFor(iso).find((h) =>
    h.type === "regular" ? rules.skipRegularHolidays : rules.skipSpecialHolidays
  );
  return base.map((o) => {
    const cancellation = rules.cancellations.find(
      (c) => c.courseId === o.course.id && c.date === iso && c.start === o.meeting.start
    );
    const status: OccurrenceStatus = outside
      ? "outsideTerm"
      : cancellation
        ? "cancelled"
        : holiday
          ? "holiday"
          : "scheduled";
    return { ...o, date: iso, status, holiday, cancellation };
  });
}

/** Only the classes that actually happen on `iso`. */
export function classesOnDate(courses: Course[], iso: string, rules: ScheduleRules = DEFAULT_RULES) {
  return occurrencesOnDate(courses, iso, rules).filter((o) => o.status === "scheduled");
}

export type TermState = "none" | "before" | "during" | "after";

export function termStateOn(iso: string, rules: ScheduleRules): TermState {
  if (!rules.term) return "none";
  if (iso < rules.term.start) return "before";
  if (iso > rules.term.end) return "after";
  return "during";
}

export type NowAndNext = {
  ongoing: DatedOccurrence | null;
  next: (DatedOccurrence & { daysAhead: number }) | null;
  termState: TermState;
};

/** Days to look ahead for the next class (covers holiday weeks and breaks). */
const NEXT_CLASS_HORIZON_DAYS = 21;
const MAX_LOOKAHEAD_DAYS = 400;

/**
 * The class in session right now (if any) and the next one that will
 * actually happen — honouring term dates, holidays and cancellations.
 */
export function computeNowAndNext(
  courses: Course[],
  now: Date,
  rules: ScheduleRules = DEFAULT_RULES
): NowAndNext {
  const today = isoDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const termState = termStateOn(today, rules);

  const ongoing =
    classesOnDate(courses, today, rules).find((o) => nowMin >= o.startMin && nowMin < o.endMin) ?? null;

  let next: NowAndNext["next"] = null;
  if (termState !== "after" && courses.length) {
    const untilTerm = rules.term && termState === "before" ? daysBetween(today, rules.term.start) : 0;
    const horizon = Math.min(MAX_LOOKAHEAD_DAYS, untilTerm + NEXT_CLASS_HORIZON_DAYS);
    for (let ahead = 0; ahead <= horizon; ahead++) {
      const iso = addDaysIso(today, ahead);
      if (rules.term && iso > rules.term.end) break;
      const occ = classesOnDate(courses, iso, rules);
      const candidate = ahead === 0 ? occ.find((o) => o.startMin > nowMin) : occ[0];
      if (candidate) {
        next = { ...candidate, daysAhead: ahead };
        break;
      }
    }
  }

  return { ongoing, next, termState };
}

/** 42 -> "42 min", 60 -> "1 hr", 95 -> "1 hr 35 min". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

/** "Today", "Tomorrow", "Wednesday", or "Mon, Sep 21" beyond a week. */
export function relativeDayLabel(daysAhead: number, day: Weekday, iso?: string): string {
  if (daysAhead === 0) return "Today";
  if (daysAhead === 1) return "Tomorrow";
  if (daysAhead < 7 || !iso) return WEEKDAY_LONG[day];
  return isoToDate(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
