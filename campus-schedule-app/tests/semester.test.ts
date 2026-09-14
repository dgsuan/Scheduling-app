import assert from "node:assert/strict";

import { parseCrs } from "@/lib/crs";
import { findConflicts, groupOfferings, totalUnits } from "@/lib/planner";
import { classesInRoom, nextInRoom, sameRoom, transferInto, transfersOn } from "@/lib/rooms";
import { DEFAULT_RULES, occurrencesOnDate } from "@/lib/schedule";
import { buildArchive, cumulativeGwa, termLabel } from "@/lib/semester";

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

test("UP term labels", () => {
  assert.equal(termLabel({ start: "2026-08-24", end: "2026-12-12" }, "2026-09-14"), "1st Semester, AY 2026–2027");
  assert.equal(termLabel({ start: "2027-01-25", end: "2027-05-29" }, "2027-02-01"), "2nd Semester, AY 2026–2027");
  assert.equal(termLabel({ start: "2027-06-14", end: "2027-07-24" }, "2027-06-20"), "Midyear 2027");
  assert.equal(termLabel(undefined, "2026-09-14"), "1st Semester, AY 2026–2027", "falls back to today");
});

test("semester archive and cumulative GWA", () => {
  const courses: any[] = [
    { id: "a", code: "CMSC 21", color: "#000", meetings: [], units: 3 },
    { id: "b", code: "MATH 21", color: "#000", meetings: [], units: 4 },
    { id: "c", code: "PE 2", color: "#000", meetings: [] },
  ];
  const grades: any = { a: { components: [], entries: [], finalGrade: 1.5 }, b: { components: [], entries: [], finalGrade: 2.0 } };
  const tasks: any[] = [{ done: true }, { done: false }, { done: true }];
  const archive = buildArchive({ id: "t1", label: " 1st Sem ", courses, grades, tasks, archivedAt: 1 });
  assert.equal(archive.label, "1st Sem");
  assert.equal(archive.tasksDone, 2);
  assert.equal(archive.units, 7, "ungraded PE isn't counted");
  assert.ok(Math.abs(archive.gwa! - (1.5 * 3 + 2 * 4) / 7) < 1e-9);
  assert.deepEqual(archive.courses.map((c) => [c.code, c.units, c.grade]), [["CMSC 21", 3, 1.5], ["MATH 21", 4, 2], ["PE 2", 3, null]]);

  const now = { courses: [{ id: "d", code: "CMSC 22", color: "#000", meetings: [], units: 3 }] as any, grades: { d: { components: [], entries: [], finalGrade: 1.0 } } as any };
  const cum = cumulativeGwa([archive], now);
  assert.equal(cum.units, 10);
  assert.ok(Math.abs(cum.gwa! - (1.5 * 3 + 2 * 4 + 1 * 3) / 10) < 1e-9);
  assert.equal(cumulativeGwa([]).gwa, null);
});

test("enlistment planner: sections and conflicts", () => {
  const { courses } = parseCrs(
    [
      "CMSC 21 T-1L 3.0 TTh 10-11:30AM AECH",
      "CMSC 21 T-2L 3.0 TTh 1-2:30PM AECH",
      "MATH 21 THY1 4.0 TTh 11AM-12PM MB 101",
      "MATH 21 THY2 4.0 MWF 7-8AM MB 101",
      "PE 2 WFX 2.0 TTh 11:30AM-1PM Gym",
    ].join("\n")
  );
  const groups = groupOfferings(courses);
  assert.deepEqual(groups.map((g) => [g.code, g.sections.length]), [["CMSC 21", 2], ["MATH 21", 2], ["PE 2", 1]]);
  const pick = (code: string, section: string) => groups.find((g) => g.code === code)!.sections.find((s) => s.section === section)!;

  const clash = findConflicts([pick("CMSC 21", "T-1L"), pick("MATH 21", "THY1"), pick("PE 2", "WFX")]);
  assert.deepEqual(
    clash.map((c) => `${c.a}~${c.b} d${c.day} ${c.start}-${c.end}`),
    [
      "CMSC 21|T-1L~MATH 21|THY1 d2 11:00-11:30",
      "CMSC 21|T-1L~MATH 21|THY1 d4 11:00-11:30",
      "MATH 21|THY1~PE 2|WFX d2 11:30-12:00",
      "MATH 21|THY1~PE 2|WFX d4 11:30-12:00",
    ],
    "CMSC 21 ending at 11:30 and PE starting at 11:30 don't clash with each other"
  );
  const clean = [pick("CMSC 21", "T-2L"), pick("MATH 21", "THY2"), pick("PE 2", "WFX")];
  assert.equal(findConflicts(clean).length, 0);
  assert.equal(totalUnits(clean), 9);
});

test("room finder and walking gaps", () => {
  // 2026-09-14 is a Monday.
  const courses: any[] = [
    { id: "a", code: "CMSC 21", color: "#000", meetings: [{ days: [1, 3], start: "08:00", end: "09:30", room: "AS-101" }] },
    { id: "b", code: "MATH 21", color: "#000", meetings: [{ days: [1], start: "09:40", end: "11:00", room: "MB 101" }] },
    { id: "c", code: "STS 1", color: "#000", meetings: [{ days: [1], start: "11:00", end: "12:00", room: "mb-101" }] },
  ];
  assert.ok(sameRoom("AS 101", "as-101"));
  assert.equal(classesInRoom(courses, "MB 101").length, 2);
  const at = (hhmm: string, day = "2026-09-14") => new Date(`${day}T${hhmm}:00`);
  assert.equal(nextInRoom(courses, "AS 101", DEFAULT_RULES, at("07:00"))?.date, "2026-09-14");
  assert.equal(nextInRoom(courses, "AS 101", DEFAULT_RULES, at("08:30"))?.date, "2026-09-16", "a class already started doesn't count");
  const moves = transfersOn(courses, "2026-09-14", DEFAULT_RULES);
  assert.deepEqual(moves.map((m) => [m.from.course.code, m.to.course.code, m.gapMin, m.roomChange]), [
    ["CMSC 21", "MATH 21", 10, true],
    ["MATH 21", "STS 1", 0, false],
  ]);
  const sts = occurrencesOnDate(courses, "2026-09-14", DEFAULT_RULES).find((o) => o.course.id === "c")!;
  assert.equal(transferInto(courses, sts, DEFAULT_RULES)?.from.course.code, "MATH 21");
});

console.log(`all ${passed} semester + planner + room test groups passed`);
