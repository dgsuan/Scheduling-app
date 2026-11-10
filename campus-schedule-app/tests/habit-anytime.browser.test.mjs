import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { CHROME, DIST, OUT } from "./helpers.mjs";

const base = "/Scheduling-app", port = 4633;
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url.startsWith(base)) url = url.slice(base.length);
  let file = path.join(DIST, url || "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  res.setHeader("content-type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(port);
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateTimezone("Asia/Manila");
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  const go = async route => { await page.goto(`http://localhost:${port}${base}${route}`); await page.waitForSelector('[role="heading"]'); };
  const click = async label => {
    await page.waitForFunction(s => [...document.querySelectorAll('button,[role="button"]')].some(e => e.textContent.trim() === s), {}, label);
    await page.evaluate(s => [...document.querySelectorAll('button,[role="button"]')].find(e => e.textContent.trim() === s).click(), label);
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:habits:v1") || "null"));

  await page.evaluateOnNewDocument(() => {
    const RealDate = Date;
    const start = RealDate.now();
    const fixed = RealDate.parse('2026-11-10T09:00:00+08:00');
    class Clock extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixed + RealDate.now() - start])); }
      static now() { return fixed + RealDate.now() - start; }
    }
    window.Date = Clock;
  });
  await go('/habits');
  await page.evaluate(() => {
    const make = (id, type = 'binary') => ({ id, title: type === 'duration' ? 'Study' : `Habit ${id}`, type, category: 'Personal', notes: '', createdAt: 1, reminder: false,
      schedules: [{ id: `${id}s`, from: '2026-11-01', timezone: 'Asia/Manila', frequency: 'daily', weekdays: [1], interval: 1, quota: 3, weekStart: 1, slots: ['17:00'], target: type === 'duration' ? 10800 : 1, unit: type === 'duration' ? 'minutes' : 'times', state: 'active' }] });
    const habits = [...Array.from({ length: 8 }, (_, i) => make(`filler${i}`)), make('study', 'duration')];
    localStorage.setItem('campus-schedule:habits:v1', JSON.stringify({ version: 1, habits, logs: [{ id: 'prior', habitId: 'study', occurrenceKey: 'study:studys:2026-11-10:17:00', date: '2026-11-10', at: Date.now(), amount: 600, confirmed: false }] }));
  });
  await page.reload();
  await page.waitForSelector('[aria-label="Details for Study"]');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent === 'Start studying')?.disabled), 'scheduled timer starts locked');
  await page.click('[aria-label="Details for Study"]');
  await click('Edit');
  const visible = async selector => page.waitForFunction(sel => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r && r.top >= 0 && r.bottom <= innerHeight;
  }, {}, selector);
  await visible('[aria-label="Habit name"]');
  await click('Customize habit');
  await page.click('[aria-label="Schedule options"]');
  await click('Any time'); await click('Save habit');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('campus-schedule:habits:v1')).habits.find(h => h.id === 'study').anytimeFrom?.studys === '2026-11-10');
  await visible('[aria-label="Details for Study"]');
  await page.reload();
  await page.waitForSelector('[aria-label="Details for Study"]');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent === 'Start studying' && !e.disabled)), 'anytime survives reload and unlocks today');
  assert.ok(await page.evaluate(() => document.body.innerText.includes('10 / 180 minutes')), 'earlier progress retained');
  await click('Start studying');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('campus-schedule-cache:focus'))?.habit?.id === 'study');
  await click('Take a break'); await click('Finish & save');
  await click('Log minutes'); await visible('[aria-label="Amount for Study"]');
  await page.type('[aria-label="Amount for Study"]', '5'); await click('Add');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('campus-schedule:habits:v1')).logs.some(l => l.amount === 300));
  // Existing edits made by the old editor also unlock, without requiring another save.
  await page.evaluate(() => {
    const key = 'campus-schedule:habits:v1'; const d = JSON.parse(localStorage.getItem(key));
    const h = d.habits.find(h => h.id === 'study'); delete h.anytimeFrom;
    localStorage.setItem(key, JSON.stringify(d));
  });
  await page.reload(); await page.waitForSelector('[aria-label="Details for Study"]');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].some(e => e.textContent === 'Start studying' && !e.disabled)), 'older pending anytime edit repaired');
  await page.setViewport({ width: 390, height: 844 });
  await page.click('[aria-label="Details for Study"]'); await click('Edit');
  await visible('[aria-label="Habit name"]');
  await click('Customize habit'); await page.click('[aria-label="Schedule options"]'); await click('Dates & timezone');
  await visible('[aria-label="Habit start date"]');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await page.screenshot({ path: path.join(OUT, 'habit-anytime-edit-mobile.png'), fullPage: false });
  assert.deepEqual(errors, []);
  console.log('PASS immediate Any time, existing queued edits, retained progress, timer, manual logging, reload and desktop/mobile reveal');
} finally { await browser?.close(); server.close(); }
