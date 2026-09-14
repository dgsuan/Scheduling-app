import type { Course, Meeting } from "@/context/store";
import { addDaysIso, isoDate } from "@/lib/dates";
import { occurrencesOnDate, type DatedOccurrence, type ScheduleRules } from "@/lib/schedule";

// Rooms from your own schedule: which of your classes use a room, the next
// time you're there, and how long you have to get between classes.

const normalize = (room: string) => room.toLowerCase().replace(/[\s\-_.]+/g, " ").trim();

/** "AS-101", "as 101" and "AS 101" are the same room. */
export const sameRoom = (a?: string, b?: string) => !!a && !!b && normalize(a) === normalize(b);

export function classesInRoom(courses: Course[], room: string): { course: Course; meeting: Meeting }[] {
  return courses.flatMap((course) => course.meetings.filter((m) => sameRoom(m.room, room)).map((meeting) => ({ course, meeting })));
}

/** Your next class in this room that hasn't started yet. */
export function nextInRoom(courses: Course[], room: string, rules: ScheduleRules, now: Date, days = 14): DatedOccurrence | null {
  const today = isoDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const mine = courses.filter((c) => c.meetings.some((m) => sameRoom(m.room, room)));
  for (let i = 0; i < days; i++) {
    const iso = addDaysIso(today, i);
    const hit = occurrencesOnDate(mine, iso, rules).find(
      (o) => o.status === "scheduled" && sameRoom(o.meeting.room, room) && (i > 0 || o.startMin > nowMin)
    );
    if (hit) return hit;
  }
  return null;
}

export type Transfer = { from: DatedOccurrence; to: DatedOccurrence; gapMin: number; roomChange: boolean };

/** Back-to-back pairs of classes on a day, with the time between them. */
export function transfersOn(courses: Course[], iso: string, rules: ScheduleRules): Transfer[] {
  const classes = occurrencesOnDate(courses, iso, rules)
    .filter((o) => o.status === "scheduled")
    .sort((a, b) => a.startMin - b.startMin);
  const out: Transfer[] = [];
  for (let i = 1; i < classes.length; i++) {
    const from = classes[i - 1];
    const to = classes[i];
    if (to.startMin < from.endMin) continue;
    out.push({ from, to, gapMin: to.startMin - from.endMin, roomChange: !!from.meeting.room && !!to.meeting.room && !sameRoom(from.meeting.room, to.meeting.room) });
  }
  return out;
}

/** How you get to this class: the class right before it that day, if any. */
export function transferInto(courses: Course[], occ: DatedOccurrence, rules: ScheduleRules): Transfer | null {
  return transfersOn(courses, occ.date, rules).find((t) => t.to.course.id === occ.course.id && t.to.meeting.start === occ.meeting.start) ?? null;
}
