// Week view, ICS import/export, recurring tasks, undo, subtasks, focus
// timer, grades/GWA, search + shortcuts. Clock pinned to Mon 2026-09-14.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT, FIXTURES } from "./helpers.mjs";
const BASE = "/Scheduling-app";
const PORT = 4603;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-features");
const DL = path.join(OUT, "downloads-features");
for (const d of [SHOTS, DL]) {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}
const run = (name) => process.argv.length <= 2 || process.argv.slice(2).includes(name);

const server = http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
    let file = path.join(ROOT, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, "index.html");
    const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".webmanifest": "application/manifest+json" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);
const ls = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);

async function openAt(iso, { context, width = 1280, height = 900, seed } = {}) {
  const page = await (context ?? browser).newPage();
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource|example\.invalid|CORS|Access to fetch/.test(m.text()) && errors.push("console: " + m.text()));
  await page.evaluateOnNewDocument(
    (fixedIso, seedData) => {
      const fixed = new Date(fixedIso).getTime();
      const RealDate = Date;
      const start = RealDate.now();
      class FakeDate extends RealDate {
        constructor(...a) {
          if (a.length === 0) super(fixed + (RealDate.now() - start));
          else super(...a);
        }
        static now() {
          return fixed + (RealDate.now() - start);
        }
      }
      // eslint-disable-next-line no-global-assign
      Date = FakeDate;
      if (seedData && !sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem("__seeded", "1");
        for (const [k, v] of Object.entries(seedData)) localStorage.setItem(k, JSON.stringify(v));
      }
    },
    iso,
    seed ?? null
  );
  return page;
}

const clickByText = async (page, t) => {
  const ok = await page.evaluate((s) => {
    const el = [...document.querySelectorAll("body *")]
      .filter((e) => e.childElementCount === 0 && e.textContent.trim() === s && e.getClientRects().length)
      .pop();
    if (!el) return false;
    (el.closest("button,[role=button],[role=radio],[role=checkbox],[role=option],[role=menuitem]") ?? el).click();
    return true;
  }, t);
  if (!ok) throw new Error(`No element with text "${t}"`);
};

const task = (o) => ({ priority: "medium", done: false, createdAt: 1, ...o });

try {
  // --- Export (default profile, for downloads) --------------------------------
  if (run("export")) {
    const page = await openAt("2026-09-14T10:00:00", {
      seed: {
        "campus-schedule:tasks:v1": [task({ id: "x1", title: "Programming Assignment 2", due: "2026-09-16", dueTime: "23:59" })],
        "campus-schedule:cancellations:v1": [{ id: "c1", courseId: "seed-cmsc13", date: "2026-09-16", start: "14:30", createdAt: 1 }],
      },
    });
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
    await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
    await wait(900);
    await page.click('[aria-label="Export calendar"]');
    await wait(500);
    check("Export dialog explains it's a one-time file", (await text(page)).includes("won't stay in sync") || (await text(page)).includes("won’t stay in sync"));
    await page.click('[aria-label="Classes"]');
    await wait(300);
    const count = (await text(page)).match(/(\d+) items?/)?.[1];
    await page.screenshot({ path: path.join(SHOTS, "1-export-dialog.png") });
    await clickByText(page, "Download .ics");
    let file;
    for (let i = 0; i < 40 && !file; i++) {
      await wait(150);
      file = fs.readdirSync(DL).find((f) => f.endsWith(".ics"));
    }
    const ics = file ? fs.readFileSync(path.join(DL, file), "utf8") : "";
    const classDates = [...ics.matchAll(/SUMMARY:CMSC 13[^\r]*\r\nDTSTART:(\d{8})/g)].map((m) => m[1]);
    check("Download is a valid .ics with tasks and classes", ics.startsWith("BEGIN:VCALENDAR") && ics.includes("SUMMARY:Due: Programming Assignment 2") && classDates.length > 0, `${file} · ${count} items`);
    check("Export skips the cancelled class", !classDates.includes("20260916") && classDates.includes("20260914"), classDates.join(","));
    await page.close();
  }

  // --- Week view ---------------------------------------------------------------
  if (run("week")) {
    const ctx = await browser.createBrowserContext();
    const page = await openAt("2026-09-14T10:00:00", {
      context: ctx,
      seed: {
        "campus-schedule:events:v1": [
          { id: "e1", title: "Org meeting", start: "2026-09-14", end: "2026-09-14", startTime: "14:00", endTime: "15:00", createdAt: 1 },
          { id: "e2", title: "Consultation", start: "2026-09-14", end: "2026-09-14", startTime: "14:15", endTime: "15:15", createdAt: 1 },
        ],
      },
    });
    await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
    await wait(900);
    await clickByText(page, "Week");
    await wait(700);
    let t = await text(page);
    check("Week view title", t.includes("Sep 14 – 20, 2026"));
    const boxes = await Promise.all(
      ['[aria-label^="Org meeting"]', '[aria-label^="Consultation"]', '[aria-label^="CMSC 13, 2:30 PM"]'].map(async (s) => (await page.$(s))?.boundingBox())
    );
    const ok = boxes.every(Boolean) && new Set(boxes.map((b) => Math.round(b.x))).size === 3 && boxes.every((b) => b.width < 70);
    check("Overlapping items sit side by side", ok, boxes.map((b) => b && `${Math.round(b.x)}/${Math.round(b.width)}`).join(" "));
    await page.screenshot({ path: path.join(SHOTS, "2-week-view.png") });

    await page.click('[aria-label^="CMSC 13, 2:30 PM"]');
    await wait(500);
    check("Clicking a class offers to cancel it", (await text(page)).includes("Cancel this class"));
    await clickByText(page, "Cancel this class");
    await wait(500);
    check("Cancelled class shows in the week", !!(await page.$('[aria-label="CMSC 13, 2:30 PM – 4:00 PM, Cancelled"]')));

    const add = await page.$('[aria-label="Add an event on Sep 17"]');
    const ab = await add.boundingBox();
    await page.mouse.click(ab.x + ab.width / 2, ab.y + 3.5 * 52 + 10); // ~10:30 AM with a 7 AM start
    await wait(700);
    t = await text(page);
    check("Empty slot creates a timed event there", t.includes("New item") && /10:00 AM/.test(t), (t.match(/\d+:\d\d [AP]M/g) || []).slice(0, 2).join(" "));
    await page.keyboard.press("Escape");
    await wait(400);
    await page.mouse.click(5, 5);
    await page.keyboard.press("ArrowRight");
    await wait(500);
    check("→ moves to next week", (await text(page)).includes("Sep 21 – 27, 2026"));

    await page.setViewport({ width: 400, height: 820 });
    await wait(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("Week view scrolls inside itself on a phone", overflow <= 1, `${overflow}px`);
    await page.screenshot({ path: path.join(SHOTS, "3-week-phone.png") });
    await page.close();
    await ctx.close();
  }

  // --- ICS import ---------------------------------------------------------------
  if (run("import")) {
    const ctx = await browser.createBrowserContext();
    const page = await openAt("2026-09-14T10:00:00", { context: ctx });
    const icsPath = path.join(FIXTURES, "uvle-sample.ics");
    fs.writeFileSync(
      icsPath,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "X-WR-CALNAME:UVLE Calendar",
        "BEGIN:VEVENT",
        "UID:501@uvle",
        "SUMMARY:Programming Assignment 2 is due",
        "CATEGORIES:CMSC 13 N",
        "DTSTART:20260916T155900Z",
        "DTEND:20260916T155900Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:502@uvle",
        "SUMMARY:Quiz 3 closes",
        "DTSTART:20260918T040000Z",
        "DTEND:20260918T040000Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:503@uvle",
        "SUMMARY:Department assembly",
        "DTSTART:20260919T010000Z",
        "DTEND:20260919T030000Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "SUMMARY:Broken one",
        "DTSTART:garbage",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n")
    );
    await page.goto(URL("/import"), { waitUntil: "networkidle0" });
    await wait(900);
    const upload = async () => {
      const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), clickByText(page, "Choose .ics file…")]);
      await chooser.accept([icsPath]);
      await wait(800);
    };
    await upload();
    let t = await text(page);
    check("Preview lists parsed items", t.includes("UVLE Calendar") && t.includes("3 items · 3 new") && t.includes("Programming Assignment 2"));
    check("Unreadable entries reported, not fatal", t.includes("1 entry couldn't be read"));
    await page.screenshot({ path: path.join(SHOTS, "4-import-preview.png") });
    await clickByText(page, "Import 3");
    await wait(700);
    const tasks = await ls(page, "campus-schedule:tasks:v1");
    const events = await ls(page, "campus-schedule:events:v1");
    const pa = tasks.find((x) => x.title === "Programming Assignment 2");
    check("Imports deadlines as tasks and events as events", tasks.length === 2 && events.length === 1 && pa?.courseId === "seed-cmsc13", `${tasks.length} tasks, ${events.length} events`);
    await upload();
    t = await text(page);
    check("Re-import doesn't duplicate", t.includes("3 already imported") && t.includes("Nothing to import"));
    const url = await page.$('[aria-label="Calendar link"]');
    await url.type("https://example.invalid/calendar.ics");
    await clickByText(page, "Load");
    await wait(2500);
    check("Blocked link falls back to upload instructions", (await text(page)).includes("couldn't load that link"));
    await page.close();
    await ctx.close();
  }

  // --- Tasks: recurring, undo, subtasks, focus ---------------------------------
  if (run("tasks")) {
    const ctx = await browser.createBrowserContext();
    const page = await openAt("2026-09-14T10:00:00", {
      context: ctx,
      seed: {
        "campus-schedule:tasks:v1": [
          task({ id: "r1", title: "Lab report", due: "2026-09-18", dueTime: "23:59", repeat: { freq: "weekly", weekdays: [5] } }),
          task({ id: "n1", title: "Read chapter 3", due: "2026-09-15" }),
          task({ id: "s1", title: "Thesis chapter 2", due: "2026-09-20" }),
        ],
      },
    });
    await page.goto(URL("/tasks"), { waitUntil: "networkidle0" });
    await wait(1000);
    check("Repeating task labelled", (await text(page)).includes("Every Friday"));
    await page.click('[aria-label="Lab report"]');
    await wait(1400);
    let tasks = await ls(page, "campus-schedule:tasks:v1");
    const series = tasks.find((x) => x.id === "r1");
    const copy = tasks.find((x) => x.seriesId === "r1");
    check("Completing one occurrence rolls the series", series?.due === "2026-09-25" && !series.done && copy?.done && copy.due === "2026-09-18", `series ${series?.due}, copy ${copy?.due}`);
    check("Toast shows the next date", (await text(page)).includes("next one is ready"));

    await page.click('[aria-label="Delete Lab report"]');
    await wait(500);
    check("Deleting a repeating task asks this-or-all", (await text(page)).includes("Delete a repeating task?"));
    await clickByText(page, "Only this one");
    await wait(600);
    tasks = await ls(page, "campus-schedule:tasks:v1");
    check("'Only this one' skips to the next date", tasks.find((x) => x.id === "r1")?.due === "2026-10-02");

    await page.click('[aria-label="Delete Read chapter 3"]');
    await wait(500);
    check("Delete is immediate with an Undo toast", !(await ls(page, "campus-schedule:tasks:v1")).some((x) => x.id === "n1") && (await text(page)).includes("Task deleted"));
    await clickByText(page, "Undo");
    await wait(500);
    check("Undo restores the task", (await ls(page, "campus-schedule:tasks:v1")).some((x) => x.id === "n1"));

    await page.click('[aria-label="Show steps for Thesis chapter 2"]');
    await wait(400);
    const stepInput = await page.$('[aria-label="Add a step to Thesis chapter 2"]');
    await stepInput.type("Outline");
    await page.keyboard.press("Enter");
    await stepInput.type("Draft");
    await page.keyboard.press("Enter");
    await wait(400);
    tasks = await ls(page, "campus-schedule:tasks:v1");
    check("Subtasks added", tasks.find((x) => x.id === "s1")?.subtasks?.map((s) => s.text).join(",") === "Outline,Draft");
    await page.screenshot({ path: path.join(SHOTS, "5-subtasks.png") });
    await page.click('[aria-label="Outline"]');
    await wait(500);
    await page.click('[aria-label="Draft"]');
    await wait(900);
    tasks = await ls(page, "campus-schedule:tasks:v1");
    check("Finishing the last step completes the task", tasks.find((x) => x.id === "s1")?.done === true);

    await page.click('[aria-label="Start focus timer for Read chapter 3"]');
    await wait(600);
    check("Focus bar appears", !!(await page.$('[role="timer"]')) && (await text(page)).includes("Focusing on"));
    await page.screenshot({ path: path.join(SHOTS, "6-focus.png") });
    await wait(2500);
    await page.click('[aria-label="Stop and save focus time"]');
    await wait(500);
    const spent = (await ls(page, "campus-schedule:tasks:v1")).find((x) => x.id === "n1")?.timeSpentSec ?? 0;
    check("Stopping saves time to the task", spent >= 2, `${spent}s`);
    await page.close();
    await ctx.close();
  }

  // --- Grades -------------------------------------------------------------------
  if (run("grades")) {
    const ctx = await browser.createBrowserContext();
    const page = await openAt("2026-09-14T10:00:00", { context: ctx });
    await page.goto(URL("/courses"), { waitUntil: "networkidle0" });
    await wait(900);
    check("GWA empty state", (await text(page)).includes("Open a course's Grades"));
    await page.click('[aria-label="CMSC 13 grades"]');
    await wait(600);
    // First component (Quizzes).
    await page.evaluate(() => [...document.querySelectorAll("[role=button],button")].find((b) => b.textContent.trim() === "Add score").click());
    await wait(300);
    const setNum = async (label, v) => {
      const el = await page.$(`[aria-label="${label}"]`);
      await el.focus();
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await page.keyboard.type(String(v));
      await wait(150);
    };
    await setNum("Quiz 1 points earned", 18);
    await setNum("Quiz 1 total points", 20);
    await wait(500);
    const t = await text(page);
    check("Standing and estimated grade update live", t.includes("90.0%") && t.includes("1.25"), (t.match(/\d+\.\d%/) || [""])[0]);
    await page.screenshot({ path: path.join(SHOTS, "7-grades.png") });
    await page.keyboard.press("Escape");
    await wait(500);
    const summary = await text(page);
    check("GWA shows on Courses", /GWA\s*1\.25/.test(summary) && summary.includes("Estimated · 1 course · 3 units"));
    await page.close();
    await ctx.close();
  }

  // --- Search + shortcuts -----------------------------------------------------------
  if (run("search")) {
    const ctx = await browser.createBrowserContext();
    const page = await openAt("2026-09-14T10:00:00", {
      context: ctx,
      seed: {
        "campus-schedule:tasks:v1": [task({ id: "q1", title: "Lab report", due: "2026-09-18" })],
        "campus-schedule:canvases:v2": {
          general: { items: [{ id: "note-ps", kind: "text", text: "Photosynthesis summary", color: "#FBF0C4", x: 1300, y: 1500 }], drawings: [] },
        },
      },
    });
    await page.goto(URL("/"), { waitUntil: "networkidle0" });
    await wait(1000);
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await wait(500);
    check("Ctrl+K opens search", !!(await page.$('[aria-label="Search"][placeholder]')));
    await page.keyboard.type("lab rep");
    await wait(300);
    await page.screenshot({ path: path.join(SHOTS, "8-search.png") });
    await page.keyboard.press("Enter");
    await wait(1200);
    check("Enter opens the task", page.url().includes("/tasks") && (await text(page)).includes("Edit task"));
    await page.keyboard.press("Escape");
    await wait(500);

    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await wait(400);
    await page.keyboard.type("photo");
    await wait(300);
    await page.keyboard.press("Enter");
    let hl = false;
    for (let i = 0; i < 30 && !hl; i++) {
      await wait(100);
      hl = await page.evaluate(() => !!document.querySelector('[aria-selected="true"]'));
      if (hl) await page.screenshot({ path: path.join(SHOTS, "9-note-jump.png") });
    }
    const scrolled = await page.evaluate(() => Math.max(...[...document.querySelectorAll("div")].map((d) => d.scrollTop + d.scrollLeft)));
    check("Search jumps to a note on the canvas", page.url().includes("/notes") && hl && scrolled > 100, `${new globalThis.URL(page.url()).pathname} highlight=${hl} scrolled=${Math.round(scrolled)}`);
    await page.screenshot({ path: path.join(SHOTS, "9-note-jump.png") });

    await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
    await wait(800);
    await page.mouse.click(5, 5);
    await page.keyboard.press("n");
    await wait(1000);
    const active = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("N opens a new task", page.url().includes("/tasks") && active === "New task title", active);
    await page.keyboard.type("n");
    await wait(400);
    const stillTyping = await page.evaluate(() => ({ url: location.pathname, value: document.activeElement?.value }));
    check("Shortcuts don't fire while typing", stillTyping.url.endsWith("/tasks") && stillTyping.value === "n");
    await page.close();
    await ctx.close();
  }
} catch (e) {
  results.push("ERROR " + (e?.stack ?? e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 12).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  // Fail the process (and CI) when any check failed or the suite crashed.
  if (results.some((r) => !r.startsWith("PASS"))) process.exitCode = 1;
}
