import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
let handler, failSend = false, failRead = false, sent = [], requested = [], ranges = [];
const claims = new Set();
const source = fs.readFileSync(new URL('../supabase/functions/reminders/index.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const subscription = { id: 'device', user_id: 'user', endpoint: 'https://push.test', p256dh: 'x', auth: 'y', tz_offset_min: 480 };
const db = { from(table) {
  let action = 'read', inserted, filters = {}, rangeStart = 0;
  const q = {
    select() { return q; }, limit() { return q; }, order() { return q; },
    eq(key, value) { filters[key] = value; return q; },
    in(_key, values) { requested = values; return q; },
    range(start, end) { rangeStart = start; ranges.push([start, end]); return q; },
    insert(row) { action = 'insert'; inserted = row; return q; },
    delete() { action = 'delete'; return q; }, lt() { return q; },
    then(resolve, reject) {
      let result = { data: [], error: null };
      if (table === 'push_subscriptions' && action === 'read') result.data = [subscription];
      if (table === 'items') result = failRead ? { data: null, error: { message: 'failed' } } : { data: rangeStart === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: `h${i}` })) : [{ id: 'last-log' }], error: null };
      if (table === 'sent_reminders' && action === 'insert') {
        if (!claims.has(inserted.reminder_id)) { claims.add(inserted.reminder_id); result.data = [inserted]; }
      }
      if (table === 'sent_reminders' && action === 'delete' && filters.reminder_id) claims.delete(filters.reminder_id);
      return Promise.resolve(result).then(resolve, reject);
    }
  }; return q;
} };
vm.runInNewContext(compiled, {
  Response, Request, Date, Map, Promise, JSON, encodeURIComponent,
  Deno: { serve: fn => { handler = fn; }, env: { get: () => 'secret' } },
  safeEqual: (a, b) => a === b, serviceKey: () => 'secret', createClient: () => db,
  webpush: { setVapidDetails() {}, async sendNotification(_sub, body) { if (failSend) throw { statusCode: 503 }; sent.push(JSON.parse(body)); } },
  remindersForUser(rows) { assert.equal(rows.length, 1001, 'logs after page one included'); return [{ id: 'habit:one', kind: 'habit', habitId: 'h1', title: 'Time for a habit check-in', body: 'Open Habits' }]; }
});
const run = () => handler(new Request('https://test/reminders', { method: 'POST', headers: { 'x-cron-secret': 'secret' } }));
assert.equal((await handler(new Request('https://test/reminders'))).status, 403);
assert.equal((await run()).status, 200);
assert.ok(requested.includes('habit') && requested.includes('habit_log'));
assert.equal(sent[0].path, 'habits?habitId=h1');
await run(); assert.equal(sent.length, 1, 'claimed reminder does not repeat');
claims.clear(); failSend = true; await run(); assert.equal(claims.size, 0, 'failed send can retry');
failSend = false; await run(); assert.equal(sent.length, 2);
claims.clear(); failRead = true; await run(); assert.equal(sent.length, 2, 'incomplete reads do not send');
// Service worker routes a tap to Habits, including when another app window is open.
const listeners = {}; let shown, navigated, focused = false, pending;
vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
  URL, self: { location: { origin: 'https://app.test' }, registration: { scope: 'https://app.test/Scheduling-app/', showNotification: async (_title, options) => { shown = options; } },
    addEventListener: (name, fn) => { listeners[name] = fn; }, clients: { matchAll: async () => [{ url: 'https://app.test/Scheduling-app/', navigate: async url => { navigated = url; return { focus: async () => { focused = true; } }; } }], openWindow: async () => {} } }
});
listeners.push({ data: { json: () => sent[0] }, waitUntil: promise => { pending = promise; } }); await pending;
listeners.notificationclick({ notification: { data: shown.data, close() {} }, waitUntil: promise => { pending = promise; } }); await pending;
assert.equal(navigated, 'https://app.test/Scheduling-app/habits?habitId=h1'); assert.ok(focused);
console.log('PASS reminder handler auth, habit fetching, pagination, dedup, retry, failed reads and notification-tap routing');
