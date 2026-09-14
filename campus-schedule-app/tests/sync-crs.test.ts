import assert from "node:assert/strict";

import { parseCrs, parseDays, planCrsImport, resolveTimeRange } from "@/lib/crs";
import {
  applyToSlice,
  baseFromItems,
  baseFromRemote,
  itemHash,
  itemKey,
  planSync,
  sliceToItems,
  stableStringify,
  type RemoteItem,
  type SyncItem,
} from "@/lib/syncItems";

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

// --- Sync: slices ⇄ items -------------------------------------------------------

test("stable stringify ignores key order", () => {
  assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] }), stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(stableStringify({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(itemHash({ parent: null, data: { x: 1, y: 2 } }), itemHash({ parent: null, data: { y: 2, x: 1 } }));
});

test("array slices round-trip and keep order", () => {
  const tasks = [
    { id: "t1", title: "A" },
    { id: "t2", title: "B" },
    { id: "t3", title: "C" },
  ];
  const items = sliceToItems("tasks", tasks);
  assert.equal(items.length, 3);
  assert.equal(items[0].collection, "task");
  const r = (id: string, data: unknown, deleted = false): RemoteItem => ({ collection: "task", id, parent: null, data, deleted, updated_at: "x" });
  const next = applyToSlice("tasks", tasks, [r("t2", { id: "t2", title: "B2" }), r("t1", {}, true), r("t4", { title: "D" })]) as { id: string; title: string }[];
  assert.deepEqual(
    next.map((t) => `${t.id}:${t.title}`),
    ["t2:B2", "t3:C", "t4:D"]
  );
});

test("canvases: notes move between canvases, drawings separate", () => {
  const canvases = {
    general: { items: [{ id: "n1", kind: "text" }, { id: "n2", kind: "text" }], drawings: [{ id: "d1", strokes: [] }] },
    course1: { items: [], drawings: [] },
  };
  const items = sliceToItems("canvases", canvases);
  assert.deepEqual(
    items.map((i) => `${i.collection}:${i.id}@${i.parent}`),
    ["note_item:n1@general", "note_item:n2@general", "drawing:d1@general"]
  );
  const moved = applyToSlice("canvases", canvases, [
    { collection: "note_item", id: "n1", parent: "course1", data: { id: "n1", kind: "text", text: "hi" }, deleted: false, updated_at: "x" },
    { collection: "drawing", id: "d1", parent: null, data: {}, deleted: true, updated_at: "x" },
    { collection: "note_item", id: "n9", parent: "folder-x", data: { kind: "todo" }, deleted: false, updated_at: "x" },
  ]) as Record<string, { items: { id: string }[]; drawings: unknown[] }>;
  assert.deepEqual(moved.general.items.map((i) => i.id), ["n2"]);
  assert.deepEqual(moved.course1.items.map((i) => i.id), ["n1"]);
  assert.equal(moved.general.drawings.length, 0);
  assert.deepEqual(moved["folder-x"].items.map((i) => i.id), ["n9"], "new canvas created for a folder");
  assert.equal(canvases.general.items.length, 2, "input not mutated");
});

test("settings, appearance and grades", () => {
  assert.deepEqual(sliceToItems("settings", { term: null }).map((i) => itemKey(i.collection, i.id)), ["setting/settings"]);
  assert.deepEqual(sliceToItems("appearance", { preset: "ink" }).map((i) => i.id), ["appearance"]);
  const grades = sliceToItems("grades", { c1: { components: [] }, c2: { components: [] } });
  assert.deepEqual(grades.map((g) => g.id), ["c1", "c2"]);
  const g = applyToSlice("grades", { c1: {} }, [{ collection: "grade", id: "c1", parent: null, data: {}, deleted: true, updated_at: "" }]);
  assert.deepEqual(g, {});
});

// --- Sync: planning -------------------------------------------------------------

const T = (id: string, title: string): SyncItem => ({ collection: "task", id, parent: null, data: { id, title } });
const R = (item: SyncItem, updated_at = "2026-09-14T10:00:00Z", deleted = false): RemoteItem => ({ ...item, deleted, updated_at });
const keys = (list: { collection: string; id: string; deleted?: boolean }[]) =>
  list.map((i) => `${i.collection}/${i.id}${i.deleted ? " (deleted)" : ""}`).sort();
const never = () => false;
const always = () => true;

test("incremental: local edits push, remote edits apply", () => {
  const a = T("a", "A");
  const b = T("b", "B");
  const base = baseFromItems([a, b]);
  // Local edit to a, remote edit to b.
  const plan = planSync({ local: [T("a", "A2"), b], base, remote: [R(T("b", "B2"))], fullSnapshot: false, preferLocal: never });
  assert.deepEqual(keys(plan.push), ["task/a"]);
  assert.deepEqual(keys(plan.apply), ["task/b"]);
  assert.equal(plan.base["task/b"], itemHash(T("b", "B2")));
});

test("incremental: deletions both ways", () => {
  const a = T("a", "A");
  const b = T("b", "B");
  const base = baseFromItems([a, b]);
  const plan = planSync({ local: [b], base, remote: [R(b, "x", true)], fullSnapshot: false, preferLocal: never });
  assert.deepEqual(keys(plan.push), ["task/a (deleted)"], "local delete → tombstone");
  assert.deepEqual(keys(plan.apply), ["task/b (deleted)"], "remote tombstone → removed here");
  assert.equal(plan.base["task/b"], undefined);
});

test("incremental: conflicts go to the newer side", () => {
  const a = T("a", "A");
  const base = baseFromItems([a]);
  const input = { local: [T("a", "local")], base, remote: [R(T("a", "remote"))], fullSnapshot: false };
  const remoteWins = planSync({ ...input, preferLocal: never });
  assert.deepEqual(keys(remoteWins.apply), ["task/a"]);
  assert.equal(remoteWins.overwritten.length, 1, "the lost local edit is reported");
  assert.equal(remoteWins.overwritten[0].local?.data && (remoteWins.overwritten[0].local.data as any).title, "local");
  const localWins = planSync({ ...input, preferLocal: always });
  assert.deepEqual(keys(localWins.push), ["task/a"]);
  assert.equal(localWins.apply.length, 0);
});

test("incremental: re-fetched rows and identical changes are no-ops", () => {
  const a = T("a", "A");
  const base = baseFromItems([a]);
  const same = planSync({ local: [a], base, remote: [R(a)], fullSnapshot: false, preferLocal: never });
  assert.equal(same.push.length + same.apply.length, 0);
  // Already-applied row seen again while the local copy changed: not a conflict.
  const edited = planSync({ local: [T("a", "A2")], base, remote: [R(a)], fullSnapshot: false, preferLocal: never });
  assert.deepEqual(keys(edited.push), ["task/a"]);
  assert.equal(edited.apply.length, 0);
  // Both sides made the same edit.
  const both = planSync({ local: [T("a", "Z")], base, remote: [R(T("a", "Z"))], fullSnapshot: false, preferLocal: never });
  assert.equal(both.push.length + both.apply.length, 0);
  assert.equal(both.base["task/a"], itemHash(T("a", "Z")));
});

test("first sync: merge, use account, use device", () => {
  const local = [T("shared", "local"), T("onlyLocal", "L")];
  const remote = [R(T("shared", "remote")), R(T("onlyRemote", "R")), R(T("gone", "x"), "x", true)];

  const merge = planSync({ local, base: {}, remote, fullSnapshot: true, preferLocal: never });
  assert.deepEqual(keys(merge.push), ["task/onlyLocal"]);
  assert.deepEqual(keys(merge.apply), ["task/onlyRemote", "task/shared"]);

  const cloud = planSync({ local, base: baseFromItems(local), remote, fullSnapshot: true, preferLocal: never });
  assert.equal(cloud.push.length, 0);
  assert.deepEqual(keys(cloud.apply), ["task/onlyLocal (deleted)", "task/onlyRemote", "task/shared"]);

  const device = planSync({ local, base: baseFromRemote(remote), remote, fullSnapshot: true, preferLocal: always });
  assert.deepEqual(keys(device.push), ["task/onlyLocal", "task/onlyRemote (deleted)", "task/shared"]);
  assert.equal(device.apply.length, 0);
});

// --- CRS import -------------------------------------------------------------------

test("CRS days and times", () => {
  assert.deepEqual(parseDays("TTh"), [2, 4]);
  assert.deepEqual(parseDays("MWF"), [1, 3, 5]);
  assert.deepEqual(parseDays("Sat"), [6]);
  assert.deepEqual(parseDays("MTWThF"), [1, 2, 3, 4, 5]);
  assert.equal(parseDays("TBA"), null);
  const r = (...a: Parameters<typeof resolveTimeRange>) => {
    const x = resolveTimeRange(...a);
    return x && [x.start / 60, x.end / 60];
  };
  assert.deepEqual(r(10, 0, null, 11, 30, "a"), [10, 11.5]);
  assert.deepEqual(r(11, 0, null, 1, 0, "p"), [11, 13]);
  assert.deepEqual(r(12, 0, null, 1, 0, "p"), [12, 13]);
  assert.deepEqual(r(10, 0, "a", 1, 0, null), [10, 13]);
  assert.deepEqual(r(4, 0, null, 7, 0, null), [16, 19]);
  assert.deepEqual(r(7, 0, null, 10, 0, null), [7, 10]);
  assert.deepEqual(r(13, 0, null, 16, 0, null), [13, 16]);
  assert.equal(r(4, 0, "p", 1, 0, "p"), null, "end before start");
});

test("CRS paste → courses", () => {
  const text = [
    "Class Code\tClass\tCredits\tSchedule\tRemarks",
    "54321\tCMSC 21 T-3L\t3.0\tTTh 10-11:30AM lec AECH-Accenture Room; F 1-4PM lab AECH-TL3\tEnlisted",
    "54322\tMATH 21 THY2\t4.0\tMWF 7AM-8AM MB 101",
    "11111\tPE 2 WFX\t2.0\tS 7-10 Gym",
    "22222\tCMSC 199 X\t1.0\tTBA",
    "Soc Sci 1 WFR Understanding Society 3",
    "WF 2:30-4PM lec AS 101",
  ].join("\n");
  const { courses, warnings } = parseCrs(text);
  assert.deepEqual(
    courses.map((c) => `${c.code}|${c.section ?? ""}`),
    ["CMSC 21|T-3L", "MATH 21|THY2", "PE 2|WFX", "CMSC 199|X", "Soc Sci 1|WFR"]
  );
  const cmsc = courses[0];
  assert.equal(cmsc.units, 3);
  assert.deepEqual(cmsc.meetings, [
    { days: [2, 4], start: "10:00", end: "11:30", room: "AECH-Accenture Room" },
    { days: [5], start: "13:00", end: "16:00", room: "AECH-TL3" },
  ]);
  assert.deepEqual(courses[1].meetings, [{ days: [1, 3, 5], start: "07:00", end: "08:00", room: "MB 101" }]);
  assert.deepEqual(courses[2].meetings, [{ days: [6], start: "07:00", end: "10:00", room: "Gym" }]);
  assert.equal(courses[3].meetings.length, 0);
  assert.equal(courses[3].title, undefined, "TBA isn't a title");
  assert.ok(warnings.some((w) => w.startsWith("CMSC 199")), "TBA course is flagged");
  assert.equal(courses[4].title, "Understanding Society");
  assert.deepEqual(courses[4].meetings, [{ days: [3, 5], start: "14:30", end: "16:00", room: "AS 101" }], "schedule on the next line");
  assert.deepEqual(parseCrs("hello\nnothing here").courses, []);
});

test("CRS import plan", () => {
  const { courses } = parseCrs("CMSC 21 T-3L 3.0 TTh 10-11:30AM AECH\nMATH 21 THY2 MWF 7-8AM MB 101");
  const existing: any[] = [
    { id: "c1", code: "cmsc  21", section: "t-3l", color: "#000", meetings: [{ days: [2, 4], start: "10:00", end: "11:30", room: "AECH" }] },
    { id: "c2", code: "MATH 21", color: "#000", meetings: [] },
  ];
  const plan = planCrsImport(courses, existing);
  assert.deepEqual(
    plan.map((r) => `${r.parsed.code}:${r.status}:${r.match?.id ?? "-"}`),
    ["CMSC 21:same:c1", "MATH 21:update:c2"]
  );
});

console.log(`all ${passed} sync + CRS test groups passed`);
