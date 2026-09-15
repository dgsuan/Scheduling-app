import type { Course, Meeting, Weekday } from "@/context/store";

// Reads the class list you copy from UP CRS (Enlisted classes / Form 5)
// and turns it into courses. CRS tables paste in slightly different shapes
// depending on the page and browser, so parsing is deliberately lenient:
//   12345  CMSC 21 T-3L  3.0  TTh 10-11:30AM lec AECH; F 1-4PM lab TL3
//   MATH 21 THY2   MWF 7AM-8AM  MB 101
// Anything it can't read is reported instead of guessed.

export type CrsCourse = {
  code: string;
  section?: string;
  title?: string;
  units?: number;
  meetings: Meeting[];
};

export type CrsParseResult = { courses: CrsCourse[]; warnings: string[] };

const DAY_WORD = "Mon|Tue|Wed|Thu|Fri|Sat|Sun|Th|Tu|Sa|Su|M|T|W|F|S|R|U";
const DAY_TOKEN = new RegExp(DAY_WORD, "gi");
const DAYS: Record<string, Weekday> = {
  mon: 1, m: 1,
  tue: 2, tu: 2, t: 2,
  wed: 3, w: 3,
  thu: 4, th: 4, r: 4,
  fri: 5, f: 5,
  sat: 6, sa: 6, s: 6,
  sun: 0, su: 0, u: 0,
};

const MERIDIEM = "(?:\\s*(a\\.?m\\.?|p\\.?m\\.?|a|p)(?![a-z]))?";
const TIME = `(\\d{1,2})(?::(\\d{2}))?${MERIDIEM}`;
const SEGMENT = new RegExp(`(?<![A-Za-z])((?:${DAY_WORD})+)\\.?\\s+${TIME}\\s*(?:-|–|—|to)\\s*${TIME}`, "gi");

// Subject: one to three words ("CMSC", "Soc Sci", "SOC SCI RES"); number may carry letters ("PE 2ICD").
const COURSE = /(?:^|[\s|,;])(?:\d{4,6}\s+)?([A-Z][A-Za-z]{1,7}(?:\s(?:[A-Z][a-z]{1,6}|[A-Z]{2,8})){0,2})\s?(\d{1,3}(?:\.\d{1,2})?[A-Za-z]{0,4})(?=\s|$|[,;|])/;
const SECTION = /^(?:(?=[A-Za-z0-9/-]*[\d-])[A-Za-z0-9][A-Za-z0-9/-]{0,11}|[A-Z]{1,4})$/;
const CLASS_TYPE = /^(?:lec(?:ture)?|lab(?:oratory)?|rec(?:itation)?|dis(?:cussion)?|sem(?:inar)?)\b\.?\s*/i;

export function parseDays(token: string): Weekday[] | null {
  const parts = token.match(DAY_TOKEN);
  if (!parts || parts.join("").toLowerCase() !== token.toLowerCase()) return null;
  const days = new Set<Weekday>();
  for (const p of parts) {
    const d = DAYS[p.toLowerCase()];
    if (d === undefined) return null;
    days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

type Mer = "a" | "p" | null;
const mer = (s: string | undefined): Mer => (s ? (s[0].toLowerCase() as "a" | "p") : null);

function toMinutes(h: number, m: number, meridiem: Mer): number | null {
  if (m > 59) return null;
  if (meridiem === null) return h <= 23 ? h * 60 + m : null;
  if (h < 1 || h > 12) return null;
  return ((h % 12) + (meridiem === "p" ? 12 : 0)) * 60 + m;
}

/** "10-11:30AM", "11-1PM", "7:00AM-10:00AM", "13:00-16:00", "4-7" → minutes. */
export function resolveTimeRange(
  sh: number,
  sm: number,
  sMer: Mer,
  eh: number,
  em: number,
  eMer: Mer
): { start: number; end: number } | null {
  let start: number | null;
  let end: number | null;
  if (sMer && eMer) {
    start = toMinutes(sh, sm, sMer);
    end = toMinutes(eh, em, eMer);
  } else if (eMer) {
    end = toMinutes(eh, em, eMer);
    const same = toMinutes(sh, sm, eMer);
    start = end != null && same != null && same < end ? same : toMinutes(sh, sm, "a");
  } else if (sMer) {
    start = toMinutes(sh, sm, sMer);
    const same = toMinutes(eh, em, sMer);
    end = start != null && same != null && same > start ? same : toMinutes(eh, em, "p");
  } else if (sh > 12 || eh > 12) {
    start = toMinutes(sh, sm, null);
    end = toMinutes(eh, em, null);
  } else {
    // No AM/PM at all: classes run roughly 7 AM – 9 PM.
    const sGuess: Mer = sh >= 7 && sh <= 11 ? "a" : "p";
    start = toMinutes(sh, sm, sGuess);
    const same = toMinutes(eh, em, sGuess);
    end = start != null && same != null && same > start ? same : toMinutes(eh, em, "p");
  }
  if (start == null || end == null || end <= start || end - start > 12 * 60) return null;
  return { start, end };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const normalizeCode = (code: string) => code.replace(/\s+/g, " ").trim().toUpperCase();
const courseKey = (code: string, section?: string) => `${normalizeCode(code)}|${(section ?? "").trim().toUpperCase()}`;

// Form 5 prints its fee table beside the classes, so a PDF row can end with
// "Mode:", "ITEM", "Library Fees 1,100.00" — none of that is a room.
const NOT_A_ROOM = /:$|^(?:item|code|amount|cashier|register|mode|lab fee)$|\bfees?\b|\btuition\b|\d\.\d{2}\b/i;

function cleanRoom(raw: string): string | undefined {
  // Leading spaces first: text from a PDF puts two spaces before the next column.
  let s = raw.replace(/^[\s,:-]+/, "").split(/[;\t]|\s{2,}/)[0] ?? "";
  s = s.replace(/^[\s,:-]+/, "").replace(CLASS_TYPE, "").trim();
  if (!s || /^(tba|tbd|n\/?a|-+)$/i.test(s) || NOT_A_ROOM.test(s)) return undefined;
  return s.slice(0, 60);
}

// Words that look like a course code next to a number but are page furniture
// ("Form 5 (Certificate of Registration)", "Page 1", "Total units 10").
const NOT_A_SUBJECT = /^(?:form|page|total|units?|year|sem|semester|room|rm|no|step|batch|ay|tel|block|lot|zip|phase)$/i;

function readCourse(prefix: string): { code: string; section?: string; title?: string; units?: number } | null {
  const m = COURSE.exec(prefix);
  if (!m || m[1].split(" ").some((w) => NOT_A_SUBJECT.test(w))) return null;
  const code = `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim();
  let rest = prefix.slice(m.index + m[0].length).trim();
  let section: string | undefined;
  const first = rest.split(/\s+/)[0];
  if (first && SECTION.test(first) && !/^\d+(\.\d+)?$/.test(first)) {
    section = first;
    rest = rest.slice(first.length).trim();
  }
  let units: number | undefined;
  const u = /(?:^|\s)\(?(\d{1,2}(?:\.\d{1,2})?)\)?(?=\s|$)/.exec(rest);
  if (u) {
    const n = Number(u[1]);
    if (n > 0 && n <= 30) {
      units = n;
      rest = (rest.slice(0, u.index) + " " + rest.slice(u.index + u[0].length)).trim();
    }
  }
  const title = rest
    .replace(CLASS_TYPE, "")
    .replace(/\bTB[AD]\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    code,
    section,
    title: /[A-Za-z]{3,}/.test(title) && title.length <= 120 ? title : undefined,
    units,
  };
}

export function parseCrs(text: string): CrsParseResult {
  const courses = new Map<string, CrsCourse>();
  const warnings: string[] = [];
  let current: CrsCourse | null = null;

  const lines = text
    .replace(/\r/g, "")
    .replace(/[–—]/g, "-")
    .split("\n")
    .slice(0, 400);

  for (const rawLine of lines) {
    const line = rawLine.slice(0, 500);
    if (!line.trim()) continue;
    const segments = [...line.matchAll(SEGMENT)];
    const prefix = segments.length ? line.slice(0, segments[0].index) : line;
    const found = readCourse(prefix);

    if (found) {
      const key = courseKey(found.code, found.section);
      const existing = courses.get(key);
      if (existing) {
        existing.title ??= found.title;
        existing.units ??= found.units;
        current = existing;
      } else {
        current = { code: found.code, section: found.section, title: found.title, units: found.units, meetings: [] };
        courses.set(key, current);
      }
    } else if (!segments.length) {
      continue;
    }

    if (segments.length && !current) {
      warnings.push(`Found a schedule without a course before it: “${line.trim().slice(0, 60)}”`);
      continue;
    }

    segments.forEach((seg, i) => {
      const days = parseDays(seg[1]);
      const range = resolveTimeRange(
        Number(seg[2]),
        Number(seg[3] ?? 0),
        mer(seg[4]),
        Number(seg[5]),
        Number(seg[6] ?? 0),
        mer(seg[7])
      );
      if (!days || !range) {
        warnings.push(`Couldn't read the time “${seg[0].trim()}” for ${current!.code}.`);
        return;
      }
      const after = line.slice(seg.index! + seg[0].length, i + 1 < segments.length ? segments[i + 1].index : undefined);
      const meeting: Meeting = { days, start: hhmm(range.start), end: hhmm(range.end) };
      const room = cleanRoom(after);
      if (room) meeting.room = room;
      const dup = current!.meetings.some(
        (m) => m.start === meeting.start && m.end === meeting.end && m.days.join() === meeting.days.join()
      );
      if (!dup) current!.meetings.push(meeting);
    });
  }

  // No meeting time means it isn't something to put on the schedule: usually
  // stray text (an address), sometimes a TBA class. Only mention real-looking classes.
  const all = [...courses.values()];
  for (const c of all) {
    if (!c.meetings.length && c.section) warnings.push(`Skipped ${c.code} ${c.section} — no schedule listed (TBA?). Add it in Courses once it has a time.`);
  }
  return { courses: all.filter((c) => c.meetings.length).slice(0, 30), warnings };
}

// --- Planning the import ------------------------------------------------------

export type CrsRow = {
  parsed: CrsCourse;
  /** The existing course this matches (same code and section). */
  match?: Course;
  status: "new" | "update" | "same";
};

const sameMeetings = (a: Meeting[], b: Meeting[]) => {
  const norm = (ms: Meeting[]) =>
    ms
      .map((m) => `${[...m.days].sort().join("")}|${m.start}|${m.end}|${(m.room ?? "").trim()}`)
      .sort()
      .join(";");
  return norm(a) === norm(b);
};

export function planCrsImport(parsed: CrsCourse[], existing: Course[]): CrsRow[] {
  return parsed.map((p) => {
    const sameCode = existing.filter((c) => normalizeCode(c.code) === normalizeCode(p.code));
    const match =
      sameCode.find((c) => (c.section ?? "").trim().toUpperCase() === (p.section ?? "").trim().toUpperCase()) ??
      (sameCode.length === 1 && (!p.section || !sameCode[0].section) ? sameCode[0] : undefined);
    if (!match) return { parsed: p, status: "new" };
    return { parsed: p, match, status: sameMeetings(match.meetings, p.meetings) ? "same" : "update" };
  });
}
