import assert from "node:assert/strict";

import { dayLoads, defaultTarget, describeLoad, focusThisWeek, gradeTargets } from "@/lib/insights";
import { canvasOptions } from "@/lib/noteLinks";
import { DEFAULT_RULES } from "@/lib/schedule";

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

const comps = [
  { id: "q", name: "Quizzes", weight: 20 },
  { id: "e", name: "Exams", weight: 50 },
  { id: "r", name: "Requirements", weight: 30 },
];
const entry = (componentId: string, score: number, total: number) => ({ id: `${componentId}${score}`, componentId, name: "x", score, total });
const need = (plan: ReturnType<typeof gradeTargets>, grade: number) => plan!.targets.find((t) => t.grade === grade)!;

test("grade targets: what's needed on the rest", () => {
  // 90% on quizzes and requirements, no exams yet.
  const plan = gradeTargets({ components: comps, entries: [entry("q", 18, 20), entry("r", 27, 30)] });
  assert.deepEqual(plan!.remaining, [{ name: "Exams", weight: 50 }]);
  assert.equal(need(plan, 1.75).need, 70);
  assert.equal(need(plan, 1.75).status, "reachable");
  assert.equal(need(plan, 1.0).need, 94);
  assert.equal(defaultTarget(plan!, null), 1.0, "best reachable when there's no estimate");
  assert.equal(defaultTarget(plan!, 1.25), 1.0, "one step better than the estimate");
});

test("grade targets: secured, out of reach, nothing left", () => {
  const strong = gradeTargets({ components: comps, entries: [entry("q", 20, 20), entry("e", 100, 100)] });
  assert.equal(need(strong, 3.0).status, "secured");
  assert.equal(need(strong, 2.0).need, 20);
  const weak = gradeTargets({ components: comps, entries: [entry("q", 0, 20), entry("r", 0, 30)] });
  assert.equal(need(weak, 3.0).status, "out-of-reach");
  assert.equal(defaultTarget(weak!, 5.0), 4.0 > 0 ? weak!.targets[weak!.targets.length - 1].grade : 0);
  const done = gradeTargets({ components: comps, entries: [entry("q", 20, 20), entry("e", 80, 100), entry("r", 30, 30)] });
  assert.equal(need(done, 1.75).need, null);
  assert.equal(need(done, 1.75).status, "secured", "90% overall already clears 80%");
  assert.equal(need(done, 1.0).status, "out-of-reach");
  assert.equal(gradeTargets(undefined), null);
});

test("heavy days", () => {
  // 2026-09-14 is a Monday.
  const courses: any[] = [
    { id: "a", code: "CMSC 21", color: "#000", meetings: [{ days: [1], start: "08:00", end: "11:00" }, { days: [1], start: "13:00", end: "16:00" }] },
  ];
  const task = (id: string, title: string, due: string, done = false): any => ({ id, title, due, done, priority: "medium", createdAt: 1 });
  const tasks = [
    task("1", "Lab report 2", "2026-09-14"),
    task("2", "Reading", "2026-09-14"),
    task("3", "Essay draft", "2026-09-15"),
    task("4", "Quiz 1", "2026-09-16"),
    task("5", "Midterm exam", "2026-09-16"),
    task("6", "Done thing", "2026-09-17", true),
  ];
  const loads = dayLoads(courses, tasks, DEFAULT_RULES, "2026-09-14", 4);
  assert.deepEqual(
    loads.map((d) => d.crunch),
    [true, false, true, false],
    "Mon: 2 deadlines + 6h class; Tue: 1 deadline; Wed: quiz + exam; Thu: done task ignored"
  );
  assert.equal(describeLoad(loads[0]), "2 classes · 2 deadlines (Lab report 2, Reading)");
});

test("focus time this week", () => {
  const t = (over: any): any => ({ id: Math.random().toString(36), title: "t", priority: "medium", done: false, createdAt: 1, ...over });
  const tasks = [
    t({ courseId: "a", focusLog: { "2026-09-15": 1200, "2026-08-01": 9999 } }),
    t({ courseId: "b", focusLog: { "2026-09-16": 3600 } }),
    t({ focusLog: { "2026-09-16": 600 } }),
    t({ courseId: "a", due: "2026-09-17" }),
    t({ courseId: "a", due: "2026-09-18" }),
    t({ courseId: "b", due: "2026-09-17" }),
    t({ courseId: "b", due: "2026-09-18" }),
  ];
  const week = focusThisWeek(tasks, "2026-09-16");
  assert.equal(week.totalSeconds, 5400, "old sessions don't count");
  assert.deepEqual(week.byCourse.map((c) => c.courseId), ["b", "a", null]);
  assert.deepEqual(week.warnings, [{ courseId: "a", deadlines: 2, seconds: 1200 }], "b has an hour of focus, so only a is flagged");
});

test("note canvas labels", () => {
  const canvases: any = {
    general: { items: [{ id: "f1", kind: "folder", name: "Readings", x: 0, y: 0 }], drawings: [] },
    f1: { items: [{ id: "f2", kind: "folder", name: "Week 3", x: 0, y: 0 }], drawings: [] },
    c1: { items: [{ id: "f3", kind: "folder", name: "", x: 0, y: 0 }], drawings: [] },
  };
  const options = canvasOptions(canvases, [{ id: "c1", code: "CMSC 21", color: "#000", meetings: [] }]);
  assert.deepEqual(
    options.map((o) => o.label),
    ["General", "CMSC 21", "CMSC 21 › Folder", "General › Readings", "General › Readings › Week 3"]
  );
});

console.log(`all ${passed} insight test groups passed`);
