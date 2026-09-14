import type { Course, Weekday } from "@/context/store";
import { parseTime } from "@/lib/schedule";

// Shared free times for a class section. Members who opt in share only
// their busy blocks (weekday + start/end minute) — never course names or
// rooms — and the section sees when everyone who shared is free.

export type BusyBlock = { d: Weekday; s: number; e: number };
export type FreeSlot = BusyBlock;

/** Keep in step with the 80-block check in supabase/migrations/0003. */
export const MAX_BUSY_BLOCKS = 80;

function merge(list: [number, number][]): [number, number][] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Your weekly busy blocks, merged per day, from your courses' meeting times. */
export function busyFromCourses(courses: Course[]): BusyBlock[] {
  const byDay = new Map<Weekday, [number, number][]>();
  for (const course of courses) {
    for (const m of course.meetings) {
      const s = parseTime(m.start);
      const e = parseTime(m.end);
      if (s == null || e == null || e <= s) continue;
      for (const d of m.days) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push([s, e]);
      }
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([d, list]) => merge(list).map(([s, e]) => ({ d, s, e })))
    .slice(0, MAX_BUSY_BLOCKS);
}

/** Busy blocks read back from the server, with anything malformed dropped. */
export function validBusy(v: unknown): BusyBlock[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (b): b is BusyBlock =>
        !!b &&
        typeof b === "object" &&
        Number.isInteger((b as BusyBlock).d) &&
        (b as BusyBlock).d >= 0 &&
        (b as BusyBlock).d <= 6 &&
        Number.isInteger((b as BusyBlock).s) &&
        Number.isInteger((b as BusyBlock).e) &&
        (b as BusyBlock).s >= 0 &&
        (b as BusyBlock).s < (b as BusyBlock).e &&
        (b as BusyBlock).e <= 1440
    )
    .slice(0, MAX_BUSY_BLOCKS);
}

export type FreeTimeOptions = { days?: Weekday[]; from?: number; to?: number; minMinutes?: number };

/** Gaps of at least `minMinutes` when nobody who shared is busy. */
export function commonFreeTimes(members: BusyBlock[][], opts: FreeTimeOptions = {}): FreeSlot[] {
  const days = opts.days ?? ([1, 2, 3, 4, 5, 6] as Weekday[]);
  const from = opts.from ?? 7 * 60;
  const to = opts.to ?? 21 * 60;
  const min = opts.minMinutes ?? 60;
  const out: FreeSlot[] = [];
  for (const d of days) {
    const busy = merge(
      members
        .flat()
        .filter((b) => b.d === d)
        .map((b): [number, number] => [Math.max(b.s, from), Math.min(b.e, to)])
        .filter(([s, e]) => s < e)
    );
    let cursor = from;
    for (const [s, e] of busy) {
      if (s - cursor >= min) out.push({ d, s: cursor, e: s });
      cursor = Math.max(cursor, e);
    }
    if (to - cursor >= min) out.push({ d, s: cursor, e: to });
  }
  return out;
}

export const minutesToHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
