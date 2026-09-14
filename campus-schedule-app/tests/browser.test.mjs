// Drives the exported web build in headless Chrome. Each scenario pins the
// clock (it still advances in real time) so time-based UI is testable.
// Seed course CMSC 13 meets Mon/Wed 2:30–4:00 PM; 2026-09-14 is a Monday.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT, FIXTURES } from "./helpers.mjs";
const BASE = "/Scheduling-app";
const URL = (p) => `http://localhost:4599${BASE}${p}`;
const SHOTS = path.join(OUT, "shots");
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const server = http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
    let file = path.join(ROOT, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, "index.html");
    const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".ttf": "font/ttf" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    fs.createReadStream(file).pipe(res);
  })
  .listen(4599);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});

const errors = [];
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** New tab with the clock pinned to `iso` (local time); optionally dark. */
async function openAt(iso, { width = 1280, height = 900, dark = false, context } = {}) {
  const page = await (context ?? browser).newPage();
  await page.setViewport({ width, height });
  // This machine's OS is in dark mode; pin the scheme per scenario.
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g/.test(m.text()) && errors.push("console: " + m.text()));
  await page.evaluateOnNewDocument((fixedIso) => {
    const fixed = new Date(fixedIso).getTime();
    const RealDate = Date;
    const start = RealDate.now();
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed + (RealDate.now() - start));
        else super(...args);
      }
      static now() {
        return fixed + (RealDate.now() - start);
      }
    }
    // eslint-disable-next-line no-global-assign
    Date = FakeDate;
  }, iso);
  return page;
}

const text = (page) => page.evaluate(() => document.body.innerText);
const center = async (el) => {
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
// Click the innermost visible element whose own text is exactly `t`.
const clickText = async (page, t) => {
  await page.waitForFunction(
    (s) => [...document.querySelectorAll("body *")].some((el) => el.childElementCount === 0 && el.textContent.trim() === s && el.getClientRects().length),
    { timeout: 5000 },
    t
  );
  const h = await page.evaluateHandle((s) => {
    const leaves = [...document.querySelectorAll("body *")].filter(
      (el) => el.childElementCount === 0 && el.textContent.trim() === s && el.getClientRects().length
    );
    return leaves[leaves.length - 1];
  }, t);
  await h.asElement().click();
};
const tod = (page) => page.evaluate(() => document.documentElement.dataset.tod);
const bgVar = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue("--background").trim());

try {
  // --- Main flow (afternoon, during class) -----------------------------
  const ctx = await browser.createBrowserContext();
  let page = await openAt("2026-09-14T14:48:00", { context: ctx });
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(1200);
  let txt = await text(page);
  check("Schedule: Now hero shows current class", /\bnow\b/i.test(txt) && txt.includes("CMSC 13"));
  check("Schedule: time remaining", /ends in\s*1 hr 12 min/i.test(txt), (txt.match(/ends in[^\n]*/i) || [""])[0]);
  check("Schedule: greeting follows time", txt.includes("Good afternoon"));
  check("Time-of-day: afternoon", (await tod(page)) === "afternoon", await tod(page));
  check("Sidebar navigation on desktop", !!(await page.$('[role="tablist"]')) && !!(await page.$('[aria-label="isked"]')));
  await page.screenshot({ path: path.join(SHOTS, "01-home-afternoon.png") });

  await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
  await wait(1200);
  const mon = await page.waitForSelector('[aria-label^="Monday, September 14"]');
  const wed = await page.waitForSelector('[aria-label^="Wednesday, September 16"]');
  const a = await center(mon);
  const c = await center(wed);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(a.x + ((c.x - a.x) * i) / 12, a.y, { steps: 2 });
    await wait(16);
  }
  await page.screenshot({ path: path.join(SHOTS, "02-calendar-dragging.png") });
  await page.mouse.up();
  await wait(700);
  txt = await text(page);
  check("Calendar: drag opens create dialog", txt.includes("New item"));
  check("Calendar: dialog shows range", /Sep 14\s*–\s*Sep 16/.test(txt));
  await page.keyboard.type("Study for Calculus");
  await page.click('[aria-label="Deadline time"]');
  await wait(500);
  await clickText(page, "11:59 PM");
  await wait(300);
  await page.screenshot({ path: path.join(SHOTS, "03-create-dialog.png") });
  await clickText(page, "Save");
  await wait(800);
  txt = await text(page);
  check("Calendar: task spans 3 cells", (txt.match(/Study for Calculus/g) || []).length >= 3);
  const tue = await page.$('[aria-label^="Tuesday, September 15"]');
  await tue.click();
  await wait(700);
  txt = await text(page);
  check("Calendar: day popover", txt.includes("Tuesday, September 15") && txt.includes("Due Sep 16"));
  await page.screenshot({ path: path.join(SHOTS, "04-calendar-popover.png") });
  await page.keyboard.press("Escape");
  await wait(300);
  check("Calendar: Escape closes popover", !(await text(page)).includes("Tuesday, September 15"));

  await page.goto(URL("/tasks"), { waitUntil: "networkidle0" });
  await wait(1000);
  txt = await text(page);
  check("Tasks: date + 12h time", txt.includes("Sep 16 · 11:59 PM"), (txt.match(/Sep 16[^\n]*/) || [""])[0]);
  check("Tasks: grouped by urgency", txt.includes("Next 7 days"));
  // Composer: add a task due today at a set time, then complete it.
  await page.type('[aria-label="New task title"]', "Read chapter 3");
  await page.click('[aria-label^="Due time"]');
  await wait(400);
  await clickText(page, "5:00 PM");
  await wait(300);
  await clickText(page, "Add");
  await wait(700);
  txt = await text(page);
  // Titles are editable inputs (not in innerText), so read their values.
  const titles = await page.$$eval('[aria-label="Task title"]', (els) => els.map((e) => e.value));
  check(
    "Tasks: new task lands in Today with 12h time",
    titles.includes("Read chapter 3") && /Today\s*1[\s\S]*5:00 PM/.test(txt),
    titles.join(", ")
  );
  await page.screenshot({ path: path.join(SHOTS, "05-tasks.png") });
  await page.click('[aria-label="Read chapter 3"]');
  await wait(1200);
  txt = await text(page);
  check("Tasks: completing moves it to Completed", /Completed\s*1/.test(txt) && !/Today\s*1/.test(txt));

  await page.goto(URL("/notes"), { waitUntil: "networkidle0" });
  await wait(1000);
  await clickText(page, "Folder");
  await wait(600);
  await (await page.waitForSelector('[aria-label^="Delete folder"]')).click();
  await wait(500);
  check("Notes: folder delete confirmation", (await text(page)).includes("Delete folder?"));
  await clickText(page, "Delete");
  await wait(500);
  check("Notes: folder removed after confirm", !(await page.$('[aria-label^="Delete folder"]')));

  const drawBtn = await page.waitForSelector('[aria-label="Add draw"]');
  await drawBtn.click();
  await wait(400);
  // A point well inside the canvas (below the header, above the dock).
  const sx = 620;
  const sy = 440;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(sx + i * 6, sy + Math.sin(i / 3) * 30, { steps: 1 });
  await page.mouse.up();
  await wait(200);
  await clickText(page, "Done");
  await wait(500);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.drawings[0]);
  await page.mouse.click(sx + 60, sy);
  await wait(500);
  const handles = await page.$$('[aria-label="Resize drawing"]');
  check("Notes: 4 resize handles on select", handles.length === 4, `${handles.length}`);
  let br = null;
  for (const h of handles) {
    const p = await center(h);
    if (!br || p.x + p.y > br.x + br.y) br = p;
  }
  await page.mouse.move(br.x, br.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(br.x + i * 8, br.y + i * 5, { steps: 1 });
  await page.mouse.up();
  await wait(500);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.drawings[0]);
  check("Notes: mouse resize grows drawing", (after.scale ?? 1) > 1.05, `scale → ${(after.scale ?? 1).toFixed(2)}`);
  check("Notes: resize keeps position", Math.abs(after.x - before.x) < 0.5 && Math.abs(after.y - before.y) < 0.5);
  await page.screenshot({ path: path.join(SHOTS, "06-notes-resized.png") });

  // Phone width
  await page.setViewport({ width: 400, height: 820 });
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(1000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Phone: no horizontal overflow", overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(SHOTS, "07-phone-home.png") });
  await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
  await wait(1000);
  await page.screenshot({ path: path.join(SHOTS, "08-phone-calendar.png") });
  await page.close();
  await ctx.close();

  // --- Live hand-off: class ends at 4:00 PM, no refresh -----------------
  page = await openAt("2026-09-14T15:59:50");
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(800);
  check("Live: Now shown before class ends", /ends in\s*1 min/i.test(await text(page)));
  await wait(12000);
  txt = await text(page);
  check("Live: switches to 'No more classes today' at 4:00", txt.includes("No more classes today.") && !/ends in/i.test(txt));
  await page.close();

  // --- Live time-of-day transition: 4:59:50 PM → evening ---------------
  page = await openAt("2026-09-14T16:59:50");
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(800);
  const t0 = await tod(page);
  const bg0 = await bgVar(page);
  await wait(12000);
  const t1 = await tod(page);
  const bg1 = await bgVar(page);
  check("Live: afternoon → evening without refresh", t0 === "afternoon" && t1 === "evening" && bg0 !== bg1, `${t0} (${bg0}) → ${t1} (${bg1})`);
  await page.close();

  // --- Atmosphere screenshots ------------------------------------------
  for (const [name, iso, dark, route = "/", width = 1280] of [
    ["09-morning", "2026-09-15T08:10:00", false],
    ["10-evening", "2026-09-14T18:30:00", false],
    ["11-night-light", "2026-09-14T23:10:00", false],
    ["12-night-dark", "2026-09-14T23:10:00", true],
    ["13-afternoon-dark-now", "2026-09-14T14:48:00", true],
    ["14-courses", "2026-09-14T10:00:00", false, "/courses"],
    ["15-phone-calendar-header", "2026-09-14T10:00:00", false, "/calendar", 400],
    ["16-calendar-dark-evening", "2026-09-14T19:00:00", true, "/calendar"],
  ]) {
    const p = await openAt(iso, { dark, width });
    await p.goto(URL(route), { waitUntil: "networkidle0" });
    await wait(1000);
    await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await p.close();
  }
} catch (e) {
  results.push("ERROR " + (e && e.stack ? e.stack : e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 15).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  // Fail the process (and CI) when any check failed or the suite crashed.
  if (results.some((r) => !r.startsWith("PASS"))) process.exitCode = 1;
}
