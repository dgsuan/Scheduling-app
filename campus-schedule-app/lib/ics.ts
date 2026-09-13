import type { CalendarEvent, Course, Task } from "@/context/store";
import { addDaysIso, hhmmOf, isoDate } from "@/lib/dates";
import { occurrencesOnDate, type ScheduleRules } from "@/lib/schedule";

// iCalendar (.ics) import and export — no dependencies. The parser is
// deliberately forgiving: anything it can't read is skipped and reported,
// never thrown, so one odd event can't sink a whole import.

// --- Parsing ---------------------------------------------------------------

export type IcsDateValue = { date: string; time?: string };

export type ParsedIcsItem = {
  /** Stable identity for de-duplication across re-imports. */
  key: string;
  uid?: string;
  title: string;
  description?: string;
  location?: string;
  categories: string[];
  /** A deadline (zero-length / VTODO) becomes a task; otherwise an event. */
  kind: "deadline" | "event";
  start: IcsDateValue;
  /** Inclusive end (all-day DTEND is exclusive in the file; converted here). */
  end?: IcsDateValue;
  recurring: boolean;
};

export type IcsParseResult = {
  items: ParsedIcsItem[];
  skipped: { title?: string; reason: string }[];
  calendarName?: string;
  /** Set when the text isn't an iCalendar file at all. */
  error?: string;
};

type Prop = { name: string; params: Record<string, string>; value: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

function unfold(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function parseLine(line: string): Prop | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

export function unescapeText(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

/** Wall-clock time in an IANA zone → the real instant. Null if the zone is unknown. */
function zonedToDate(parts: number[], tz: string): Date | null {
  try {
    const [y, mo, d, h, mi, s] = parts;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const offsetAt = (t: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
    };
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    let t = wall - offsetAt(wall);
    t = wall - offsetAt(t); // second pass settles DST boundaries
    return new Date(t);
  } catch {
    return null; // e.g. Windows zone names like "Singapore Standard Time"
  }
}

export function parseIcsDate(prop: Prop): IcsDateValue | null {
  const m = DATE_RE.exec(prop.value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (hh === undefined || prop.params.VALUE === "DATE") {
    const test = new Date(+y, +mo - 1, +d);
    return isNaN(test.getTime()) ? null : { date: `${y}-${mo}-${d}` };
  }
  const parts = [+y, +mo, +d, +hh, +mi, +(ss ?? 0)];
  const local = () => new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const dt = z
    ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]))
    : prop.params.TZID
      ? (zonedToDate(parts, prop.params.TZID) ?? local())
      : local();
  if (isNaN(dt.getTime())) return null;
  return { date: isoDate(dt), time: hhmmOf(dt) };
}

/** "PT1H30M" / "P1D" → minutes, or null. */
function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi] = m;
  const mins = (+(w ?? 0) * 7 + +(d ?? 0)) * 1440 + +(h ?? 0) * 60 + +(mi ?? 0);
  return sign === "-" ? -mins : mins;
}

function shiftMinutes(v: IcsDateValue, minutes: number): IcsDateValue {
  if (!v.time) return { date: addDaysIso(v.date, Math.round(minutes / 1440)) };
  const dt = new Date(`${v.date}T${v.time}:00`);
  dt.setMinutes(dt.getMinutes() + minutes);
  return { date: isoDate(dt), time: hhmmOf(dt) };
}

/** Moodle/UVLE phrases deadlines as "Assignment 1 is due". */
function cleanTitle(summary: string): string {
  return summary.replace(/\s+is due\.?$/i, "").trim();
}

export function itemKey(uid: string | undefined, title: string, start: IcsDateValue): string {
  return uid ? `uid:${uid}` : `sum:${title.toLowerCase()}|${start.date}|${start.time ?? ""}`;
}

export function parseIcs(text: string): IcsParseResult {
  const lines = unfold(text);
  if (!lines.some((l) => l.trim().toUpperCase() === "BEGIN:VCALENDAR")) {
    return { items: [], skipped: [], error: "This doesn't look like a calendar (.ics) file." };
  }

  const result: IcsParseResult = { items: [], skipped: [] };
  let block: { type: string; props: Prop[] } | null = null;
  let nested = 0; // e.g. VALARM inside a VEVENT

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:")) {
      const type = upper.slice(6);
      if (block) nested++;
      else if (type === "VEVENT" || type === "VTODO") block = { type, props: [] };
      continue;
    }
    if (upper.startsWith("END:")) {
      if (block && nested) nested--;
      else if (block && upper.slice(4) === block.type) {
        finishBlock(block, result);
        block = null;
      }
      continue;
    }
    const prop = parseLine(line);
    if (!prop) continue;
    if (block && !nested) block.props.push(prop);
    else if (!block && prop.name === "X-WR-CALNAME") result.calendarName = unescapeText(prop.value);
  }
  return result;
}

function finishBlock(block: { type: string; props: Prop[] }, result: IcsParseResult) {
  const get = (name: string) => block.props.find((p) => p.name === name);
  const title = cleanTitle(unescapeText(get("SUMMARY")?.value ?? ""));
  if (!title) {
    result.skipped.push({ reason: "No title" });
    return;
  }
  if ((get("STATUS")?.value ?? "").toUpperCase() === "CANCELLED") {
    result.skipped.push({ title, reason: "Cancelled in the source calendar" });
    return;
  }
  const startProp = get("DTSTART") ?? (block.type === "VTODO" ? get("DUE") : undefined);
  const start = startProp ? parseIcsDate(startProp) : null;
  if (!start) {
    result.skipped.push({ title, reason: startProp ? "Unreadable date" : "No date" });
    return;
  }

  let end: IcsDateValue | undefined;
  const endProp = get("DTEND");
  const durProp = get("DURATION");
  if (endProp) end = parseIcsDate(endProp) ?? undefined;
  else if (durProp) {
    const mins = parseDuration(durProp.value);
    if (mins != null) end = shiftMinutes(start, mins);
  }
  // All-day DTEND is exclusive: a one-day event ends "the next day".
  if (end && !start.time && !end.time) {
    end = { date: addDaysIso(end.date, -1) };
    if (end.date < start.date) end = undefined;
  }

  const zeroLength = !end || (end.date === start.date && end.time === start.time);
  const kind: ParsedIcsItem["kind"] =
    block.type === "VTODO" || (zeroLength && !!start.time) || /\bdue\b/i.test(get("SUMMARY")?.value ?? "")
      ? "deadline"
      : "event";

  const uid = get("UID")?.value.trim() || undefined;
  const categories = (get("CATEGORIES")?.value ?? "")
    .split(/(?<!\\),/)
    .map((c) => unescapeText(c).trim())
    .filter(Boolean);

  result.items.push({
    key: itemKey(uid, title, start),
    uid,
    title,
    description: get("DESCRIPTION") ? unescapeText(get("DESCRIPTION")!.value).trim() || undefined : undefined,
    location: get("LOCATION") ? unescapeText(get("LOCATION")!.value).trim() || undefined : undefined,
    categories,
    kind,
    start,
    end: kind === "event" && end && !zeroLength ? end : undefined,
    recurring: !!get("RRULE"),
  });
}

// --- Import planning ---------------------------------------------------------

export type ImportedTask = Omit<Task, "id" | "createdAt" | "done"> & { source: { kind: "ics"; key: string } };
export type ImportedEvent = Omit<CalendarEvent, "id" | "createdAt"> & { source: { kind: "ics"; key: string } };

export type ImportRow = {
  item: ParsedIcsItem;
  status: "new" | "update" | "unchanged";
  courseId?: string;
} & ({ as: "task"; task: ImportedTask } | { as: "event"; event: ImportedEvent });

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** Match "CMSC 13 N" (categories/title) to a course by its code. */
export function matchCourse(item: ParsedIcsItem, courses: Course[]): Course | undefined {
  const haystacks = [...item.categories, item.title].map(normalize);
  return [...courses]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => c.code.trim() && haystacks.some((h) => h.includes(normalize(c.code))));
}

export function planImport(
  items: ParsedIcsItem[],
  existing: { tasks: Task[]; events: CalendarEvent[] },
  courses: Course[]
): ImportRow[] {
  const taskByKey = new Map(existing.tasks.filter((t) => t.source).map((t) => [t.source!.key, t]));
  const eventByKey = new Map(existing.events.filter((e) => e.source).map((e) => [e.source!.key, e]));

  return items.map((item) => {
    const course = matchCourse(item, courses);
    const source = { kind: "ics" as const, key: item.key };
    if (item.kind === "deadline") {
      const task: ImportedTask = {
        title: item.title,
        due: item.start.date,
        dueTime: item.start.time,
        priority: "medium",
        courseId: course?.id,
        source,
      };
      const prev = taskByKey.get(item.key);
      const status = !prev
        ? "new"
        : prev.title === task.title && prev.due === task.due && prev.dueTime === task.dueTime
          ? "unchanged"
          : "update";
      return { item, status, courseId: course?.id, as: "task", task };
    }
    const timed = !!item.start.time && !!item.end?.time;
    const event: ImportedEvent = {
      title: item.title,
      start: item.start.date,
      end: item.end?.date ?? item.start.date,
      startTime: timed ? item.start.time : undefined,
      endTime: timed ? item.end!.time : undefined,
      source,
    };
    const prev = eventByKey.get(item.key);
    const status = !prev
      ? "new"
      : prev.title === event.title &&
          prev.start === event.start &&
          prev.end === event.end &&
          prev.startTime === event.startTime &&
          prev.endTime === event.endTime
        ? "unchanged"
        : "update";
    return { item, status, courseId: course?.id, as: "event", event };
  });
}

// --- Export ------------------------------------------------------------------

export type IcsExportEvent = {
  uid: string;
  title: string;
  start: IcsDateValue;
  /** Inclusive end date/time. */
  end?: IcsDateValue;
  description?: string;
  location?: string;
  categories?: string[];
};

export function escapeText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold to 75 characters per line, as RFC 5545 asks. */
function fold(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 75) return line;
  const out = [chars.slice(0, 75).join("")];
  for (let i = 75; i < chars.length; i += 74) out.push(" " + chars.slice(i, i + 74).join(""));
  return out.join("\r\n");
}

const compactDate = (iso: string) => iso.replace(/-/g, "");
const compactTime = (hhmm: string) => `${hhmm.replace(":", "")}00`;

export function buildIcs(events: IcsExportEvent[], calendarName = "Campus Schedule", now = new Date()): string {
  const stamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(
    now.getUTCHours()
  )}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Campus Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(e.title)}`);
    if (e.start.time) {
      // Floating local times: calendar apps show them in the viewer's zone.
      const end = e.end?.time ? e.end : { date: e.start.date, time: e.start.time };
      lines.push(
        `DTSTART:${compactDate(e.start.date)}T${compactTime(e.start.time)}`,
        `DTEND:${compactDate(end.date)}T${compactTime(end.time!)}`
      );
    } else {
      const lastDay = e.end?.date ?? e.start.date;
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(e.start.date)}`,
        `DTEND;VALUE=DATE:${compactDate(addDaysIso(lastDay, 1))}`
      );
    }
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** App data → export events for [from, to]. Classes honour term/holidays/cancellations. */
export function collectExportEvents(opts: {
  from: string;
  to: string;
  include: { tasks: boolean; events: boolean; classes: boolean };
  tasks: Task[];
  events: CalendarEvent[];
  courses: Course[];
  rules: ScheduleRules;
}): IcsExportEvent[] {
  const { from, to, include } = opts;
  const out: IcsExportEvent[] = [];
  const courseById = new Map(opts.courses.map((c) => [c.id, c]));

  if (include.tasks) {
    for (const t of opts.tasks) {
      if (!t.due || t.due < from || t.due > to) continue;
      const course = t.courseId ? courseById.get(t.courseId) : undefined;
      out.push({
        uid: `${t.id}@campus-schedule`,
        title: `${t.done ? "✓ " : ""}Due: ${t.title || "Untitled task"}`,
        start: { date: t.due, time: t.dueTime },
        categories: course ? [course.code] : undefined,
      });
    }
  }
  if (include.events) {
    for (const e of opts.events) {
      if (e.end < from || e.start > to) continue;
      out.push({
        uid: `${e.id}@campus-schedule`,
        title: e.title,
        start: { date: e.start, time: e.startTime },
        end: { date: e.end, time: e.endTime },
      });
    }
  }
  if (include.classes) {
    for (let iso = from; iso <= to; iso = addDaysIso(iso, 1)) {
      for (const o of occurrencesOnDate(opts.courses, iso, opts.rules)) {
        if (o.status !== "scheduled") continue;
        out.push({
          uid: `${o.course.id}-${iso}-${o.meeting.start.replace(":", "")}@campus-schedule`,
          title: o.course.title ? `${o.course.code} · ${o.course.title}` : o.course.code,
          start: { date: iso, time: o.meeting.start },
          end: { date: iso, time: o.meeting.end },
          location: o.meeting.room || undefined,
          categories: [o.course.code],
        });
      }
    }
  }
  return out.sort((a, b) =>
    `${a.start.date}${a.start.time ?? ""}`.localeCompare(`${b.start.date}${b.start.time ?? ""}`)
  );
}
