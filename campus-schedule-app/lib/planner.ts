import type { Weekday } from "@/context/store";
import type { CrsCourse } from "@/lib/crs";
import { parseTime } from "@/lib/schedule";

// Enlistment planning: paste the class offerings from CRS, pick one section
// per course, and see which picks clash before enlistment opens.

export type Offering = CrsCourse & { key: string };

export const offeringKey = (c: Pick<CrsCourse, "code" | "section">) =>
  `${c.code.replace(/\s+/g, " ").trim().toUpperCase()}|${(c.section ?? "").trim().toUpperCase()}`;

/** Sections grouped by course code, in the order they were pasted. */
export function groupOfferings(list: CrsCourse[]): { code: string; sections: Offering[] }[] {
  const groups = new Map<string, { code: string; sections: Offering[] }>();
  for (const c of list) {
    const code = c.code.replace(/\s+/g, " ").trim().toUpperCase();
    if (!groups.has(code)) groups.set(code, { code: c.code.replace(/\s+/g, " ").trim(), sections: [] });
    const group = groups.get(code)!;
    const key = offeringKey(c);
    if (!group.sections.some((s) => s.key === key)) group.sections.push({ ...c, key });
  }
  return [...groups.values()];
}

export type Conflict = { a: string; b: string; day: Weekday; start: string; end: string };

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Every overlap between two picked sections (touching end-to-start isn't a clash). */
export function findConflicts(picked: Offering[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < picked.length; i++) {
    for (let j = i + 1; j < picked.length; j++) {
      for (const ma of picked[i].meetings) {
        for (const mb of picked[j].meetings) {
          const as = parseTime(ma.start);
          const ae = parseTime(ma.end);
          const bs = parseTime(mb.start);
          const be = parseTime(mb.end);
          if (as == null || ae == null || bs == null || be == null) continue;
          const start = Math.max(as, bs);
          const end = Math.min(ae, be);
          if (start >= end) continue;
          for (const day of ma.days) {
            if (mb.days.includes(day)) out.push({ a: picked[i].key, b: picked[j].key, day, start: hhmm(start), end: hhmm(end) });
          }
        }
      }
    }
  }
  return out;
}

export const totalUnits = (picked: Offering[]) => picked.reduce((sum, o) => sum + (o.units ?? 0), 0);
