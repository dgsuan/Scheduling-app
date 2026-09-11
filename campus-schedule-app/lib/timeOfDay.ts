// Time-of-day periods drive the app's subtle "atmosphere" (see
// constants/theme.ts). Pure and tiny so it can run on every tick.

export type TimeOfDay = "earlyMorning" | "morning" | "afternoon" | "evening" | "night";

/** Start hour of each period, in order. Night wraps past midnight. */
const PERIODS: { tod: TimeOfDay; start: number }[] = [
  { tod: "earlyMorning", start: 5 },
  { tod: "morning", start: 9 },
  { tod: "afternoon", start: 12 },
  { tod: "evening", start: 17 },
  { tod: "night", start: 21 },
];

export function getTimeOfDay(d = new Date()): TimeOfDay {
  const h = d.getHours();
  let current: TimeOfDay = "night";
  for (const p of PERIODS) if (h >= p.start) current = p.tod;
  return current;
}

/** Milliseconds until the next period begins (for scheduling one timer). */
export function msUntilNextPeriod(d = new Date()): number {
  const next = new Date(d);
  const h = d.getHours();
  const upcoming = PERIODS.find((p) => p.start > h);
  if (upcoming) next.setHours(upcoming.start, 0, 0, 0);
  else {
    next.setDate(next.getDate() + 1);
    next.setHours(PERIODS[0].start, 0, 0, 0);
  }
  return next.getTime() - d.getTime();
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 || h < 1) return "Good evening";
  return "Up late";
}
