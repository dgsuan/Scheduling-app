import assert from "node:assert/strict";

import { buildTheme, normalizeAppearance, DEFAULT_APPEARANCE } from "@/constants/theme";
import { agendaForDate } from "@/lib/calendar";
import { contrastRatio } from "@/lib/color";
import { fuzzyScore } from "@/lib/fuzzy";
import { computeGwa, courseStanding, percentToGrade } from "@/lib/grades";
import { buildIcs, collectExportEvents, parseIcs, planImport } from "@/lib/ics";
import { describeRepeat, nextRepeatDate, projectedDates } from "@/lib/recurrence";
import { dueReminders, formatLead } from "@/lib/reminders";
import {
  DEFAULT_RULES,
  classesOnDate,
  computeNowAndNext,
  display12h,
  formatDuration,
  occurrencesOnDate,
  parse12h,
  type ScheduleRules,
} from "@/lib/schedule";
import { formatDue, isDueSoon, isOverdue, sortTasks } from "@/lib/tasks";
import { getTimeOfDay, greeting, msUntilNextPeriod } from "@/lib/timeOfDay";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

const courses: any[] = [
  { id: "a", code: "CMSC 13", color: "#000", meetings: [{ days: [1], start: "14:00", end: "15:30", room: "R1" }] },
  { id: "b", code: "MATH 55", color: "#111", meetings: [{ days: [1], start: "16:00", end: "17:30" }] },
];
// 2026-09-14 is a Monday. 2026-08-31 is National Heroes Day (last Monday of August).
const at = (hhmm: string, day = "2026-09-14") => new Date(`${day}T${hhmm}:00`);
const rulesWith = (patch: Partial<ScheduleRules>): ScheduleRules => ({ ...DEFAULT_RULES, ...patch });

// --- Now / next (baseline behaviour preserved) ---------------------------
test("now/next baseline", () => {
  let r = computeNowAndNext(courses, at("14:48"));
  assert.equal(r.ongoing?.course.code, "CMSC 13");
  assert.equal(r.next?.course.code, "MATH 55");
  assert.equal(r.next?.daysAhead, 0);
  assert.equal(formatDuration(r.ongoing!.endMin - (14 * 60 + 48)), "42 min");
  r = computeNowAndNext(courses, at("15:45"));
  assert.equal(r.ongoing, null);
  assert.equal(r.next?.course.code, "MATH 55");
  r = computeNowAndNext(courses, at("18:00"));
  assert.equal(r.next?.daysAhead, 7, "weekly class found next week");
  assert.equal(r.termState, "none");
  assert.equal(computeNowAndNext(courses, at("15:30")).ongoing, null, "end minute exclusive");
  assert.equal(computeNowAndNext([], at("12:00")).next, null, "no courses → empty state");
});

// --- The bugs this work fixes -------------------------------------------
test("holiday: no class on National Heroes Day", () => {
  const occ = occurrencesOnDate(courses, "2026-08-31");
  assert.equal(occ.length, 2);
  assert.ok(occ.every((o) => o.status === "holiday"), "both Monday classes skipped");
  assert.match(occ[0].holiday!.name, /Heroes/);
  assert.equal(classesOnDate(courses, "2026-08-31").length, 0);
  const r = computeNowAndNext(courses, at("14:10", "2026-08-31"));
  assert.equal(r.ongoing, null, "not 'in class' on the holiday");
  assert.equal(r.next?.date, "2026-09-07", "next class skips to the following Monday");
  const off = rulesWith({ skipRegularHolidays: false });
  assert.equal(classesOnDate(courses, "2026-08-31", off).length, 2, "toggle can disable skipping");
});

test("term dates", () => {
  const rules = rulesWith({ term: { start: "2026-08-10", end: "2026-09-14" } });
  let r = computeNowAndNext(courses, at("18:00", "2026-09-14"), rules);
  assert.equal(r.termState, "during");
  assert.equal(r.next, null, "last class of the term is over → nothing next");
  r = computeNowAndNext(courses, at("14:30", "2026-09-21"), rules);
  assert.equal(r.termState, "after");
  assert.equal(r.ongoing, null, "no stale class after term end");
  assert.equal(r.next, null);
  assert.equal(occurrencesOnDate(courses, "2026-09-21", rules)[0].status, "outsideTerm");
  r = computeNowAndNext(courses, at("09:00", "2026-07-01"), rules);
  assert.equal(r.termState, "before");
  assert.equal(r.next?.date, "2026-08-10", "first class of term, 40 days out");
});

test("one-off cancellation", () => {
  const rules = rulesWith({
    cancellations: [{ id: "x", courseId: "a", date: "2026-09-14", start: "14:00", createdAt: 1 }],
  });
  const r = computeNowAndNext(courses, at("14:48"), rules);
  assert.equal(r.ongoing, null, "cancelled class isn't 'now'");
  assert.equal(r.next?.course.code, "MATH 55");
  const occ = occurrencesOnDate(courses, "2026-09-14", rules);
  assert.equal(occ.find((o) => o.course.id === "a")!.status, "cancelled");
  assert.equal(occ.find((o) => o.course.id === "b")!.status, "scheduled", "other classes unaffected");
  assert.equal(classesOnDate(courses, "2026-09-21", rules).length, 2, "the weekly rule stays intact");
});

// --- 12-hour time, deadlines ---------------------------------------------
test("times and deadlines", () => {
  assert.equal(display12h("23:59"), "11:59 PM");
  assert.equal(display12h("00:05"), "12:05 AM");
  assert.equal(parse12h("12:00", "AM"), "00:00");
  assert.equal(parse12h("3:05", "PM"), "15:05");
  const base = { priority: "medium", done: false, createdAt: 1 } as const;
  const t1: any = { ...base, id: "1", title: "late", due: "2026-09-14", dueTime: "23:59" };
  const t2: any = { ...base, id: "2", title: "morning", due: "2026-09-14", dueTime: "09:00" };
  const t3: any = { ...base, id: "3", title: "untimed", due: "2026-09-14" };
  const t4: any = { ...base, id: "4", title: "none" };
  assert.deepEqual(sortTasks([t1, t4, t3, t2]).map((t) => t.id), ["2", "1", "3", "4"]);
  assert.equal(isOverdue(t2, at("09:01")), true);
  assert.equal(isOverdue(t3, at("23:00")), false);
  assert.equal(isDueSoon(t1, at("12:00")), true);
  assert.equal(formatDue(t1, at("08:00", "2026-09-10")), "Sep 14 · 11:59 PM");
});

// --- Agenda --------------------------------------------------------------
test("agenda honours rules and projects recurring tasks", () => {
  const base = { priority: "medium", done: false, createdAt: 1 } as const;
  const src: any = {
    courses,
    tasks: [
      { ...base, id: "s", title: "Study", start: "2026-09-14", due: "2026-09-16", dueTime: "23:59" },
      { ...base, id: "r", title: "Lab report", due: "2026-09-18", dueTime: "23:59", repeat: { freq: "weekly", weekdays: [5] } },
    ],
    events: [{ id: "f", title: "Retreat", start: "2026-09-14", end: "2026-09-16", createdAt: 1 }],
    notes: [{ id: "n", kind: "text", text: "Review", color: "#fff", x: 0, y: 0, canvasId: "general", date: "2026-09-15" }],
    holidays: [],
  };
  assert.deepEqual(agendaForDate("2026-09-14", 1, src).map((i) => i.kind), ["event", "class", "class", "task"]);
  const holiday = agendaForDate("2026-08-31", 1, src).filter((i) => i.kind === "class");
  assert.ok(holiday.every((i) => i.kind === "class" && i.occ.status === "holiday"), "listed but marked holiday");
  const fri = agendaForDate("2026-09-25", 5, src).find((i) => i.kind === "task");
  assert.ok(fri && fri.kind === "task" && fri.projected, "next Friday shows a projected occurrence");
  assert.equal(agendaForDate("2026-09-24", 4, src).filter((i) => i.kind === "task").length, 0);
});

// --- Recurrence ------------------------------------------------------------
test("recurrence", () => {
  const task: any = { id: "r", title: "Lab", due: "2026-09-18", done: false, repeat: { freq: "weekly", weekdays: [5] } };
  assert.equal(describeRepeat(task.repeat), "Every Friday");
  assert.equal(nextRepeatDate(task.repeat, "2026-09-18"), "2026-09-25");
  assert.deepEqual(projectedDates(task, "2026-09-19", "2026-10-10"), ["2026-09-25", "2026-10-02", "2026-10-09"]);
  assert.deepEqual(
    projectedDates({ ...task, courseId: "a" }, "2026-09-19", "2026-10-10", "2026-10-01"),
    ["2026-09-25"],
    "course tasks stop at term end"
  );
  assert.deepEqual(projectedDates({ ...task, repeat: { ...task.repeat, until: "2026-10-03" } }, "2026-09-19", "2026-10-31"), [
    "2026-09-25",
    "2026-10-02",
  ]);
  assert.equal(nextRepeatDate({ freq: "weekdays" }, "2026-09-18"), "2026-09-21", "Fri → Mon");
});

// --- ICS -------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");
const localOf = (d: Date) => ({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` });

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:UVLE",
  "BEGIN:VEVENT",
  "UID:1001@uvle",
  "SUMMARY:Programming Assignment 2 is due",
  "DESCRIPTION:Submit via UVLE\\, before midnight\\nGood luck",
  "CATEGORIES:CMSC 13 N",
  "DTSTART:20260916T155900Z",
  "DTEND:20260916T155900Z",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "DESCRIPTION:ignored alarm",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:1002@uvle",
  "SUMMARY:Org general assembly with a very long title that definitely needs folding in t",
  " he file",
  "DTSTART;TZID=Asia/Manila:20260917T130000",
  "DTEND;TZID=Asia/Manila:20260917T150000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:1003@uvle",
  "SUMMARY:Sportsfest",
  "DTSTART;VALUE=DATE:20260921",
  "DTEND;VALUE=DATE:20260923",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:Broken event",
  "DTSTART:not-a-date",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:No date at all",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:1004@uvle",
  "SUMMARY:Cancelled thing",
  "STATUS:CANCELLED",
  "DTSTART:20260920T010000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("ics parse", () => {
  const res = parseIcs(SAMPLE);
  assert.equal(res.error, undefined);
  assert.equal(res.calendarName, "UVLE");
  assert.equal(res.items.length, 3);
  assert.deepEqual(
    res.skipped.map((s) => s.reason),
    ["Unreadable date", "No date", "Cancelled in the source calendar"]
  );
  const [due, org, fest] = res.items;
  assert.equal(due.kind, "deadline");
  assert.equal(due.title, "Programming Assignment 2", '"is due" stripped');
  assert.equal(due.description, "Submit via UVLE, before midnight\nGood luck");
  assert.deepEqual(due.start, localOf(new Date(Date.UTC(2026, 8, 16, 15, 59))), "UTC → local");
  assert.equal(org.kind, "event");
  assert.match(org.title, /needs folding in the file$/, "unfolded");
  assert.deepEqual(org.start, localOf(new Date(Date.UTC(2026, 8, 17, 5, 0))), "TZID Manila → local");
  assert.deepEqual(fest.start, { date: "2026-09-21" });
  assert.deepEqual(fest.end, { date: "2026-09-22" }, "exclusive all-day end → inclusive");
  assert.equal(parseIcs("hello").error !== undefined, true, "non-ics rejected");
});

test("ics import planning and de-duplication", () => {
  const { items } = parseIcs(SAMPLE);
  let plan = planImport(items, { tasks: [], events: [] }, courses);
  assert.deepEqual(plan.map((p) => p.status), ["new", "new", "new"]);
  const taskRow = plan[0];
  assert.equal(taskRow.as, "task");
  assert.equal(taskRow.courseId, "a", "matched CMSC 13 from categories");
  // Simulate having imported everything once.
  const tasks: any[] = [{ id: "t", done: true, createdAt: 1, ...(taskRow as any).task }];
  const events: any[] = plan.filter((p) => p.as === "event").map((p: any, i) => ({ id: `e${i}`, createdAt: 1, ...p.event }));
  plan = planImport(items, { tasks, events }, courses);
  assert.deepEqual(plan.map((p) => p.status), ["unchanged", "unchanged", "unchanged"], "re-import creates nothing");
  tasks[0] = { ...tasks[0], dueTime: "08:00" };
  assert.equal(planImport(items, { tasks, events }, courses)[0].status, "update");
});

test("ics export round-trip", () => {
  const exported = buildIcs(
    [
      { uid: "u1", title: "Due: Essay, draft; v2", start: { date: "2026-09-18", time: "23:59" } },
      { uid: "u2", title: "Retreat", start: { date: "2026-09-21" }, end: { date: "2026-09-22" } },
      { uid: "u3", title: "x".repeat(200), start: { date: "2026-09-19", time: "09:00" }, end: { date: "2026-09-19", time: "10:30" } },
    ],
    "Test"
  );
  assert.ok(exported.split("\r\n").every((l) => Array.from(l).length <= 75), "folded to 75");
  const back = parseIcs(exported);
  assert.equal(back.items.length, 3);
  assert.equal(back.items[0].title, "Due: Essay, draft; v2", "escaping survives");
  assert.deepEqual(back.items[0].start, { date: "2026-09-18", time: "23:59" });
  assert.deepEqual(back.items[1].end, { date: "2026-09-22" });
  assert.equal(back.items[2].title.length, 200);

  const rules = rulesWith({
    term: { start: "2026-08-10", end: "2026-12-10" },
    cancellations: [{ id: "x", courseId: "a", date: "2026-09-07", start: "14:00", createdAt: 1 }],
  });
  const ev = collectExportEvents({
    from: "2026-08-24",
    to: "2026-09-14",
    include: { tasks: false, events: false, classes: true },
    tasks: [],
    events: [],
    courses,
    rules,
  });
  const cmsc = ev.filter((e) => e.title === "CMSC 13").map((e) => e.start.date);
  assert.deepEqual(cmsc, ["2026-08-24", "2026-09-14"], "skips Heroes Day and the cancelled Sep 7");
});

// --- Grades ---------------------------------------------------------------
test("grades and GWA", () => {
  assert.equal(percentToGrade(92), 1.0);
  assert.equal(percentToGrade(59.9), 4.0);
  assert.equal(percentToGrade(40), 5.0);
  const g: any = {
    components: [
      { id: "q", name: "Quizzes", weight: 20 },
      { id: "e", name: "Exams", weight: 50 },
      { id: "p", name: "Projects", weight: 30 },
    ],
    entries: [
      { id: "1", componentId: "q", name: "Q1", score: 9, total: 10 },
      { id: "2", componentId: "q", name: "Q2", score: 9, total: 10 },
      { id: "3", componentId: "e", name: "LE1", score: 40, total: 50 },
    ],
  };
  const s = courseStanding(g);
  assert.ok(Math.abs(s.percent! - (90 * 20 + 80 * 50) / 70) < 1e-9, "running standing over graded components");
  assert.equal(s.estimatedGrade, 1.75);
  assert.equal(courseStanding(undefined).percent, null, "no grades → empty");
  const gwa = computeGwa(
    [{ ...courses[0], units: 3 }, { ...courses[1], units: 5 }, { id: "c", code: "PE 1", color: "#222", meetings: [] }] as any,
    { a: g, b: { components: [], entries: [], finalGrade: 2.0 } }
  );
  assert.equal(gwa.units, 8, "ungraded course excluded");
  assert.ok(Math.abs(gwa.gwa! - (1.75 * 3 + 2.0 * 5) / 8) < 1e-9);
  assert.equal(computeGwa([], {}).gwa, null);
});

// --- Reminders ---------------------------------------------------------------
test("reminders", () => {
  const base = { courses, tasks: [] as any[], rules: DEFAULT_RULES, classLeadMin: 10, taskLeadMin: 60 };
  assert.equal(dueReminders({ ...base, now: at("13:49") }).length, 0, "too early");
  const r = dueReminders({ ...base, now: at("13:50") });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "CMSC 13 in 10 minutes · R1");
  assert.equal(dueReminders({ ...base, now: at("14:01") }).length, 0, "class started → no reminder");
  const cancelled = rulesWith({ cancellations: [{ id: "x", courseId: "a", date: "2026-09-14", start: "14:00", createdAt: 1 }] });
  assert.equal(dueReminders({ ...base, rules: cancelled, now: at("13:50") }).length, 0, "no reminder for a cancelled class");
  assert.equal(dueReminders({ ...base, now: at("13:50", "2026-08-31") }).length, 0, "no reminder on a holiday");
  const outside = rulesWith({ term: { start: "2026-01-01", end: "2026-09-01" } });
  assert.equal(dueReminders({ ...base, rules: outside, now: at("13:50") }).length, 0, "no reminder outside term");
  const task: any = { id: "t", title: "Programming HW", due: "2026-09-14", dueTime: "17:00", done: false, priority: "medium", createdAt: 1 };
  const tr = dueReminders({ ...base, tasks: [task], now: at("16:00") });
  assert.equal(tr.find((x) => x.kind === "task")?.title, "Programming HW due in 1 hour");
  assert.equal(dueReminders({ ...base, tasks: [{ ...task, done: true }], now: at("16:00") }).length, 0);
  const untimed = { ...task, dueTime: undefined };
  assert.equal(dueReminders({ ...base, tasks: [untimed], now: at("08:00") })[0].title, "Programming HW is due today");
  assert.equal(formatLead(1440), "1 day");
});

// --- Theme ------------------------------------------------------------------
test("time of day + appearance", () => {
  assert.equal(getTimeOfDay(at("04:59")), "night");
  assert.equal(getTimeOfDay(at("09:00")), "morning");
  assert.equal(getTimeOfDay(at("17:00")), "evening");
  assert.equal(msUntilNextPeriod(at("16:59")), 60_000);
  assert.equal(greeting(at("02:00")), "Up late");
  assert.ok(Math.abs(contrastRatio("#000000", "#FFFFFF") - 21) < 0.01);
  assert.deepEqual(normalizeAppearance({ preset: "nope", scale: 7, accent: "zzz", mode: "dark" }), {
    ...DEFAULT_APPEARANCE,
    mode: "dark",
  });
  const campus = buildTheme("light", "afternoon");
  assert.equal(campus.contrastIssues.length, 0, "default theme passes contrast");
  const ink = buildTheme("light", "afternoon", { ...DEFAULT_APPEARANCE, preset: "ink" });
  assert.notEqual(ink.tokens["--primary"], campus.tokens["--primary"]);
  const darkBg = buildTheme("light", "afternoon", { ...DEFAULT_APPEARANCE, background: "#101418" });
  assert.equal(darkBg.scheme, "dark", "custom background decides the scheme");
  assert.equal(darkBg.contrastIssues.length, 0);
  const bad = buildTheme("light", "afternoon", { ...DEFAULT_APPEARANCE, accent: "#FFFF66" });
  assert.ok(bad.contrastIssues.some((i) => i.label === "Accent on background"), "unreadable accent flagged");
  assert.equal(buildTheme("light", "afternoon", { ...DEFAULT_APPEARANCE, radius: "round" }).tokens["--radius"], "1rem");
  const periods = ["earlyMorning", "morning", "afternoon", "evening", "night"] as const;
  const bgs = new Set(periods.map((p) => buildTheme("light", p).tokens["--background"]));
  assert.equal(bgs.size, 5);
  const still = new Set(periods.map((p) => buildTheme("light", p, { ...DEFAULT_APPEARANCE, atmosphere: false }).tokens["--background"]));
  assert.equal(still.size, 1, "atmosphere off → no drift");
});

test("fuzzy search", () => {
  assert.equal(fuzzyScore("xyz", "CMSC 13"), null);
  assert.ok(fuzzyScore("cmsc", "CMSC 13 lab")! > fuzzyScore("cmsc", "Calc misc stuff")!);
  assert.ok(fuzzyScore("lab rep", "Lab report")! > 0);
  assert.ok(fuzzyScore("lbrpt", "Lab report") != null, "scattered letters match");
});

console.log(`all ${passed} logic test groups passed`);
