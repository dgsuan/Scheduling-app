import assert from "node:assert/strict";

import { busyFromCourses, commonFreeTimes, validBusy } from "@/lib/freeTime";
import { cleanOcrText, imageFingerprint, OCR_TEXT_MAX } from "@/lib/ocrText";
import { snapshotNotes, validateSharedNotes } from "@/lib/sharedNotes";

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

test("busy blocks from courses merge overlaps and keep no names", () => {
  const courses: any[] = [
    { id: "a", code: "CMSC 21", color: "#000", meetings: [{ days: [1, 3], start: "08:00", end: "09:30", room: "AS 101" }] },
    { id: "b", code: "MATH 21", color: "#000", meetings: [{ days: [1], start: "09:00", end: "11:00" }, { days: [1], start: "13:00", end: "14:00" }] },
  ];
  const busy = busyFromCourses(courses);
  assert.deepEqual(busy, [
    { d: 1, s: 480, e: 660 },
    { d: 1, s: 780, e: 840 },
    { d: 3, s: 480, e: 570 },
  ]);
  assert.ok(!JSON.stringify(busy).includes("CMSC"), "no course info leaks");
});

test("common free times across members", () => {
  const me = [{ d: 1 as const, s: 480, e: 660 }];
  const them = [{ d: 1 as const, s: 720, e: 900 }, { d: 2 as const, s: 420, e: 1260 }];
  const free = commonFreeTimes([me, them], { days: [1, 2], from: 420, to: 1260, minMinutes: 60 });
  assert.deepEqual(free, [
    { d: 1, s: 420, e: 480 },
    { d: 1, s: 660, e: 720 },
    { d: 1, s: 900, e: 1260 },
  ], "an exactly one-hour gap counts; Tuesday is fully busy");
  assert.deepEqual(
    commonFreeTimes([me, them], { days: [1], from: 420, to: 1260, minMinutes: 90 }),
    [{ d: 1, s: 900, e: 1260 }],
    "a 90-minute minimum drops the one-hour gaps"
  );
  assert.equal(commonFreeTimes([], { days: [1] }).length, 1, "nobody busy → the whole day");
});

test("busy blocks read back are validated", () => {
  assert.deepEqual(validBusy([{ d: 1, s: 60, e: 120 }, { d: 9, s: 0, e: 10 }, { d: 1, s: 100, e: 50 }, "x", { d: 2, s: 0, e: 2000 }]), [{ d: 1, s: 60, e: 120 }]);
  assert.deepEqual(validBusy("nope"), []);
});

test("shared notes: text and to-dos only, in reading order", () => {
  const canvas: any = {
    items: [
      { id: "1", kind: "todo", x: 0, y: 200, title: "Bring", color: "#fff", entries: [{ id: "e", text: "Calculator", done: true }, { id: "f", text: " ", done: false }] },
      { id: "2", kind: "text", x: 0, y: 10, text: "Midterm covers ch. 1–4", color: "#fff" },
      { id: "3", kind: "image", x: 0, y: 50, uri: "data:image/png;base64,AAAA", width: 1, height: 1 },
      { id: "4", kind: "text", x: 0, y: 60, text: "   ", color: "#fff" },
    ],
    drawings: [{ id: "d", x: 0, y: 0, width: 1, height: 1, strokes: [] }],
  };
  const { notes, skipped } = snapshotNotes(canvas);
  assert.deepEqual(notes, [
    { kind: "text", text: "Midterm covers ch. 1–4" },
    { kind: "todo", title: "Bring", entries: [{ text: "Calculator", done: true }] },
  ]);
  assert.equal(skipped, 3, "image, empty note and drawing stay private");
  assert.deepEqual(validateSharedNotes([{ kind: "script", text: "<x>" }, { kind: "text", text: 5 }, { kind: "text", text: "ok", extra: 1 }]), [{ kind: "text", text: "ok" }]);
});

test("text found in images is tidied and fingerprinted", () => {
  assert.equal(cleanOcrText("  Midterm   covers\r\n ~ \n\nch. 1–4  \n|"), "Midterm covers\nch. 1–4");
  assert.equal(cleanOcrText("x".repeat(OCR_TEXT_MAX + 50)).length, OCR_TEXT_MAX);
  const a = "data:image/png;base64," + "A".repeat(100) + "xyz";
  assert.equal(imageFingerprint(a), imageFingerprint(a));
  assert.notEqual(imageFingerprint(a), imageFingerprint(a.slice(0, -1) + "q"), "an edited image is read again");
});

console.log(`all ${passed} social test groups passed`);
