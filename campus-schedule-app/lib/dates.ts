import type { Weekday } from "@/context/store";

// Local calendar-date helpers. Dates are "YYYY-MM-DD" strings in the
// user's local time throughout the app (no timezones, no UTC shifts).

const pad2 = (n: number) => String(n).padStart(2, "0");

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isoToDate(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

export function addDaysIso(iso: string, days: number): string {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function weekdayOf(iso: string): Weekday {
  return isoToDate(iso).getDay() as Weekday;
}

/** Whole calendar days from `a` to `b` (negative if b is earlier). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The Monday on or before `iso`. */
export function startOfWeekIso(iso: string): string {
  const wd = weekdayOf(iso);
  return addDaysIso(iso, wd === 0 ? -6 : 1 - wd);
}

/** Local Date for a date + "HH:MM" wall time. */
export function atTime(iso: string, hhmm: string): Date {
  return new Date(`${iso}T${hhmm}:00`);
}

export function hhmmOf(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
