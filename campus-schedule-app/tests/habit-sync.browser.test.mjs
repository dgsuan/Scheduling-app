// Browser integration against a fake account/API. Never writes to Supabase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, DIST } from './helpers.mjs';
const port = 4632, base = '/Scheduling-app';
const key = 'campus-schedule:habits:v1';
const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const host = new URL(env.match(/^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m)[1].trim().replaceAll('"', '')).hostname;
const tokenKey = `sb-${host.split('.')[0]}-auth-token`;
const session = id => ({ access_token: `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fake`, token_type: 'bearer', refresh_token: 'fake', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: { id, email: `${id === a ? 'alice' : 'bob'}@example.test`, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]).replace(base, '');
  let file = path.join(DIST, url || 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port);
let browser;
const rows = new Map([[a, new Map()], [b, new Map()]]);
let offline = false, serial = 0, capability = 2;
const writes = [];
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const open = async id => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (url.hostname === 'localhost' || url.protocol === 'data:') return request.continue();
      if (url.hostname !== host) return request.respond({ status: 200, body: '{}', contentType: 'application/json' });
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'content-type': 'application/json' };
      if (request.method() === 'OPTIONS') return request.respond({ status: 200, headers, body: '' });
      if (offline) return request.abort('internetdisconnected');
      const reply = (data, status = 200) => request.respond({ status, headers, body: JSON.stringify(data) });
      const token = request.headers().authorization?.split(' ')[1];
      let owner; try { owner = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub; } catch {}
      if (url.pathname.includes('/auth/')) return reply(url.pathname.includes('/token') ? session(owner ?? id) : { user: session(owner ?? id).user });
      const body = request.postData() ? JSON.parse(request.postData()) : {};
      if (url.pathname.endsWith('/rpc/habit_sync_version')) return reply(capability);
      if (url.pathname.endsWith('/rpc/read_habit_items')) return reply([...(rows.get(owner)?.values() ?? [])]);
      if (url.pathname.endsWith('/rpc/write_habit_item')) {
        if (owner !== body.p_owner) return reply({ code: '42501', message: 'Wrong owner' }, 403);
        const map = rows.get(owner), k = `${body.p_collection}/${body.p_id}`, old = map.get(k);
        if (old && old.deleted === body.p_deleted && (old.deleted || JSON.stringify(old.data) === JSON.stringify(body.p_data))) return reply(old);
        if ((old?.updated_at ?? null) !== body.p_expected) return reply({ code: '40001', message: 'Concurrent change' }, 409);
        const row = { collection: body.p_collection, id: body.p_id, parent: body.p_parent, data: body.p_data, deleted: body.p_deleted, updated_at: new Date(Date.now() + ++serial).toISOString() };
        map.set(k, row); writes.push({ owner, ...row }); return reply(row);
      }
      if (url.pathname.includes('/rest/v1/')) return reply([]);
      return reply({});
    });
    await page.evaluateOnNewDocument((session, tokenKey) => {
      // Block real Realtime websocket access; reconciliation is tested via RPC.
      window.WebSocket = class { static OPEN = 1; static CLOSED = 3; readyState = 0; close() {} send() {} addEventListener() {} removeEventListener() {} };
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => sessionStorage.getItem('test-offline') !== 'yes' });
      if (!sessionStorage.getItem('seed')) {
        sessionStorage.setItem('seed', '1'); localStorage.setItem(tokenKey, JSON.stringify(session));
        localStorage.setItem('campus-schedule:courses:v1', '[]');
      }
    }, session(id), tokenKey);
    await page.goto(`http://localhost:${port}${base}/habits`);
    await page.waitForFunction(() => document.body.innerText.includes('New habit'));
    return page;
  };
  const click = async (page, label) => {
    await page.waitForFunction(s => [...document.querySelectorAll('button,[role="button"]')].some(e => e.textContent.trim() === s && e.getAttribute('aria-disabled') !== 'true' && !e.disabled), {}, label);
    await page.evaluate(s => [...document.querySelectorAll('button,[role="button"]')].find(e => e.textContent.trim() === s).click(), label);
  };
  const waitText = (p, text) => p.waitForFunction(t => document.body.innerText.includes(t), {}, text);
  const read = p => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
  const first = await open(a);
  await click(first, 'Create your first habit'); await first.type('[aria-label="Habit name"]', 'Private reading'); await click(first, 'Save habit'); await click(first, 'Check in');
  await first.waitForFunction(k => JSON.parse(localStorage.getItem(k) || '{}').logs?.length === 1, {}, key);
  assert.equal(writes.length, 0, 'Guest data must never upload without consent');
  capability = 1;
  await click(first, 'Sync settings'); await click(first, 'Enable habit sync'); await click(first, 'Include my guest habits'); await waitText(first, 'needs database update 0008');
  assert.equal(writes.length, 0);
  capability = 2;
  await click(first, 'Include my guest habits'); await waitText(first, 'Habits synced');
  assert.equal(rows.get(a).size, 2);
  assert.equal((await read(first)).cloud.ownerId, a);
  const second = await open(a);
  await click(second, 'Sync settings'); await click(second, 'Enable habit sync'); await click(second, 'Open account without guest habits'); await waitText(second, 'Habits synced'); await waitText(second, 'Private reading');
  assert.equal((await read(second)).logs.length, 1);
  offline = true;
  await second.evaluate(() => { sessionStorage.setItem('test-offline', 'yes'); window.dispatchEvent(new Event('offline')); });
  await click(second, 'Undo check-in');
  await second.waitForFunction(k => JSON.parse(localStorage.getItem(k)).logs.length === 2, {}, key);
  await second.evaluate(tokenKey => { const s = JSON.parse(localStorage.getItem(tokenKey)); s.expires_at = Math.floor(Date.now() / 1000) - 600; localStorage.setItem(tokenKey, JSON.stringify(s)); }, tokenKey);
  await second.reload(); await waitText(second, 'Private reading');
  await waitText(second, 'Offline · Saved on this device');
  assert.equal((await read(second)).logs.length, 2, 'Pending correction survives reload');
  offline = false;
  await second.evaluate(() => { sessionStorage.removeItem('test-offline'); window.dispatchEvent(new Event('online')); });
  await waitText(second, 'Habits synced');
  await click(second, 'Sync settings');
  await click(first, 'Sync habits now'); await waitText(first, 'Habits synced');
  assert.equal((await read(first)).logs.length, 2);
  offline = true;
  await click(second, 'Details'); await click(second, 'Edit');
  await second.click('[aria-label="Habit name"]');
  await second.keyboard.down('Control'); await second.keyboard.press('a'); await second.keyboard.up('Control');
  await second.type('[aria-label="Habit name"]', 'Private reading locally');
  await click(second, 'Save habit');
  const habitKey = [...rows.get(a).keys()].find(k => k.startsWith('habit/'));
  const remoteHabit = rows.get(a).get(habitKey);
  rows.get(a).set(habitKey, { ...remoteHabit, data: { ...remoteHabit.data, title: 'Private reading remotely' }, updated_at: new Date(Date.now() + ++serial).toISOString() });
  offline = false;
  await click(second, 'Sync habits now'); await waitText(second, 'edited on two devices');
  await click(second, "Keep this device's definition"); await waitText(second, 'Habits synced');
  assert.equal(rows.get(a).get(habitKey).data.title, 'Private reading locally');
  await click(first, 'Sync habits now'); await waitText(first, 'Habits synced');
  assert.equal((await read(first)).habits[0].title, 'Private reading locally');
  const before = writes.length;
  await click(first, 'Sync habits now'); await waitText(first, 'Habits synced'); assert.equal(writes.length, before, 'Replay does not create writes');
  await first.evaluate((tokenKey, s) => localStorage.setItem(tokenKey, JSON.stringify(s)), tokenKey, session(b));
  await first.reload(); await waitText(first, 'belong to another account');
  assert.ok(!(await first.evaluate(() => document.body.innerText)).includes('Private reading'));
  await click(first, 'Open my account habits'); await click(first, 'Open account without guest habits'); await waitText(first, 'Habits synced');
  assert.equal(rows.get(b).size, 0, 'Account switch must not upload previous account data');
  assert.equal((await read(first)).habits.length, 0);
  await first.evaluate((tokenKey, s) => localStorage.setItem(tokenKey, JSON.stringify(s)), tokenKey, session(a));
  await first.reload(); await waitText(first, 'belong to another account');
  await click(first, 'Open my account habits'); await click(first, 'Open account without guest habits'); await waitText(first, 'Private reading'); await waitText(first, 'Habits synced');
  assert.equal((await read(first)).logs.length, 2, 'Original account cache restored');
  assert.deepEqual(errors, []);
  console.log('PASS capability gate, guest consent, two-device sync, offline/reload correction, replay, account switch isolation and cached recovery (mock API)');
} finally { await browser?.close(); server.close(); }
