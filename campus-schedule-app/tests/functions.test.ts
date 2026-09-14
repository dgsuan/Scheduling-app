// The Edge Functions' logic, run in Node. The Edge runtime's clock is UTC,
// so this suite pins Node to UTC too.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeImported } from "@/lib/icsMerge";

import { isBlockedHostname, isPrivateAddress, safeEqual, serviceKey } from "../supabase/functions/_shared/http.ts";
import { keyHash, planFeedImport, remindersForUser, type ItemRow } from "../supabase/functions/_shared/jobs.ts";

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

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("server reminders use the device's local time", () => {
  // CMSC 21 meets Tuesdays at 8:00 AM Manila time.
  const rows: ItemRow[] = [
    { collection: "course", id: "c1", data: { code: "CMSC 21", color: "#000", meetings: [{ days: [2], start: "08:00", end: "09:30", room: "AS 101" }] } },
    { collection: "task", id: "t1", data: { title: "Lab report", due: "2026-09-15", dueTime: "09:00", priority: "medium", done: false, createdAt: 1 } },
    {
      collection: "setting",
      id: "settings",
      data: { reminders: { enabled: true, classLeadMin: 10, taskLeadMin: 60 }, skipRegularHolidays: true, skipSpecialHolidays: true },
    },
  ];
  // 2026-09-14 23:50 UTC is Tuesday 2026-09-15 07:50 in Manila (UTC+8).
  const at = Date.UTC(2026, 8, 14, 23, 50);
  const manila = remindersForUser(rows, at, 480);
  assert.deepEqual(manila.map((r) => r.title), ["CMSC 21 in 10 minutes · AS 101"]);
  assert.equal(manila[0].id, "class:c1:2026-09-15:08:00:10", "same id the app uses, so nothing doubles up");
  assert.deepEqual(remindersForUser(rows, at, 0), [], "in UTC it's still Monday night");
  const taskTime = Date.UTC(2026, 8, 15, 0, 0); // 8:00 AM Manila, an hour before the lab report
  assert.deepEqual(remindersForUser(rows, taskTime, 480).map((r) => r.kind), ["task"]);
  const off = rows.map((r) => (r.id === "settings" ? { ...r, data: { reminders: { enabled: false } } } : r));
  assert.deepEqual(remindersForUser(off, at, 480), [], "reminders turned off in Settings");
});

test("calendar feed import is idempotent and keeps local edits", () => {
  const ics = fs.readFileSync(path.join(HERE, "fixtures", "uvle-sample.ics"), "utf8");
  const first = planFeedImport(ics, [], 1000);
  assert.equal(first.error, undefined);
  const created = first.tasks.length + first.events.length;
  assert.ok(created > 0, "the sample calendar has entries");
  assert.ok([...first.tasks, ...first.events].every((x) => /^(task|event)-ics-[0-9a-z]+$/.test(x.id)), "deterministic ids");

  const rows: ItemRow[] = [
    ...first.tasks.map((t) => ({ collection: "task", id: t.id, data: t })),
    ...first.events.map((e) => ({ collection: "event", id: e.id, data: e })),
  ];
  const again = planFeedImport(ics, rows, 2000);
  assert.equal(again.tasks.length + again.events.length, 0, "nothing changes on a second run");

  if (first.tasks.length) {
    const done = rows.map((r) => (r.id === first.tasks[0].id ? { ...r, data: { ...(r.data as object), done: true, title: "Old title" } } : r));
    const update = planFeedImport(ics, done, 3000);
    assert.equal(update.tasks.length, 1, "a changed title comes back from the calendar");
    assert.equal(update.tasks[0].done, true, "…without un-doing the task");
    assert.equal(update.tasks[0].id, first.tasks[0].id);
  }
  assert.equal(planFeedImport("not a calendar", [], 1).error !== undefined, true);
  assert.equal(keyHash("abc"), keyHash("abc"));
});

test("merging imported items", () => {
  const source = { kind: "ics" as const, key: "k1" };
  const existing: any = { tasks: [{ id: "t", title: "Old", due: "2026-09-01", priority: "high", done: false, createdAt: 1, courseId: "c1", source }], events: [] };
  const out = mergeImported(existing, { tasks: [{ title: "New", due: "2026-09-02", priority: "medium", courseId: "c2", source }], events: [] }, { now: 5, newId: () => "x" });
  assert.deepEqual(out.tasks, [{ ...existing.tasks[0], title: "New", due: "2026-09-02", dueTime: undefined }], "keeps priority and the course you set");
});

test("calendar links can't reach private networks", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "202.92.128.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("metadata.google.internal"), true);
  assert.equal(isBlockedHostname("uvle.upd.edu.ph"), false);
  assert.equal(safeEqual("secret", "secret"), true);
  assert.equal(safeEqual("secret", "secreT"), false);
  assert.equal(safeEqual("", ""), false, "an unset secret never matches");
  const envOf = (vars: Record<string, string>) => (n: string) => vars[n];
  assert.equal(serviceKey(envOf({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_abc"}', SUPABASE_SERVICE_ROLE_KEY: "eyJold" })), "sb_secret_abc");
  assert.equal(serviceKey(envOf({ SUPABASE_SERVICE_ROLE_KEY: "eyJold" })), "eyJold", "falls back to the legacy key");
});

console.log(`all ${passed} Edge Function test groups passed`);
