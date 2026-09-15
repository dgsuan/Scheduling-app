import assert from "node:assert/strict";

import type { Task } from "@/context/store";
import {
  FINISHED_SHOWN_MS,
  columnOf,
  currentActivity,
  initials,
  patchForColumn,
  timeAgo,
  validateActivityRow,
  visibleFriends,
} from "@/lib/activity";

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

const NOW = Date.parse("2026-09-15T10:00:00Z");
let n = 0;
const task = (p: Partial<Task>): Task => ({ id: `t${n++}`, title: "Task", priority: "medium", done: false, createdAt: 1, ...p });

test("board columns", () => {
  assert.equal(columnOf(task({})), "todo");
  assert.equal(columnOf(task({ status: "doing" })), "doing");
  assert.equal(columnOf(task({ status: "doing", done: true })), "done", "finished wins");
  assert.deepEqual(patchForColumn("doing", 5), { done: false, status: "doing", startedAt: 5 });
  assert.deepEqual(patchForColumn("todo"), { done: false, status: undefined, startedAt: undefined });
  assert.deepEqual(patchForColumn("done"), { done: true });
});

test("what gets shared", () => {
  const courses = [{ id: "c1", code: "CMSC 21" }];
  assert.equal(currentActivity([], courses, NOW), null);
  const older = task({ title: "Old", status: "doing", startedAt: NOW - 3600_000 });
  const newer = task({ title: "  Lab   report  ", status: "doing", startedAt: NOW - 60_000, courseId: "c1" });
  const secret = task({ title: "Secret", status: "doing", startedAt: NOW, private: true });
  assert.deepEqual(currentActivity([older, newer, secret], courses, NOW), { status: "doing", title: "Lab report", courseCode: "CMSC 21", since: NOW - 60_000 });
  const done = task({ title: "Essay", done: true, completedAt: NOW - 3600_000 });
  assert.deepEqual(currentActivity([done], courses, NOW), { status: "finished", title: "Essay", courseCode: null, since: NOW - 3600_000 });
  assert.equal(currentActivity([{ ...done, completedAt: NOW - FINISHED_SHOWN_MS - 1 }], courses, NOW), null, "finished long ago isn't shown");
  assert.equal(currentActivity([{ ...done, private: true }], courses, NOW), null, "private finished tasks aren't shown");
  assert.equal(currentActivity([task({ title: "   ", status: "doing" })], courses, NOW), null, "untitled isn't shared");
  assert.equal(currentActivity([task({ title: "x".repeat(500), status: "doing" })], courses, NOW)?.title.length, 140);
  assert.equal(currentActivity([task({ title: "Later", status: "doing", startedAt: NOW + 999_999 })], courses, NOW)?.since, NOW, "never from the future");
});

test("friends' rows are validated and ordered", () => {
  const row = { user_id: "u1", display_name: "Gabe", status: "doing", title: "Reviewer", course_code: "MATH 21", since: new Date(NOW - 60_000).toISOString() };
  assert.deepEqual(validateActivityRow(row), { userId: "u1", name: "Gabe", status: "doing", title: "Reviewer", courseCode: "MATH 21", since: NOW - 60_000 });
  assert.equal(validateActivityRow({ ...row, status: "hacking" }), null);
  assert.equal(validateActivityRow({ ...row, title: "x".repeat(141) }), null);
  assert.equal(validateActivityRow({ ...row, display_name: "" }), null);
  assert.equal(validateActivityRow({ ...row, since: "nope" }), null);
  assert.equal(validateActivityRow({ ...row, course_code: 5 })?.courseCode, null);
  assert.equal(validateActivityRow(null), null);

  const f = (id: string, status: string, ago: number) => validateActivityRow({ ...row, user_id: id, status, since: new Date(NOW - ago).toISOString() })!;
  const list = visibleFriends([f("a", "finished", 60_000), f("b", "doing", 3600_000), f("c", "doing", 60_000), f("d", "finished", 4 * 86400_000), f("a", "doing", 0)], NOW);
  assert.deepEqual(list.map((x) => x.userId), ["c", "b", "a"], "doing first, newest first, one row each, stale hidden");

  assert.equal(timeAgo(NOW - 30_000, NOW), "now");
  assert.equal(timeAgo(NOW - 46 * 60_000, NOW), "46 min");
  assert.equal(timeAgo(NOW - 60 * 60_000, NOW), "1 hr");
  assert.equal(timeAgo(NOW - 50 * 3600_000, NOW), "2 d");
  assert.equal(initials("nisss"), "N");
  assert.equal(initials("Juan dela Cruz"), "JD");
  assert.equal(initials("  "), "?");
});

console.log(`all ${passed} activity test groups passed`);
