// Planning features on real screens: heavy-day and focus warnings on Home,
// the room finder, linked notes, "What do I need?" grades, the enlistment
// planner, and ending a semester. The clock is pinned to Monday 2026-09-14,
// 7:30 AM, and the app starts with seeded data.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4620;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-planning");
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const server = http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
    let file = path.join(ROOT, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, "index.html");
    const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT);

const JS_DIR = path.join(ROOT, "_expo", "static", "js", "web");
const KEYED = fs.readdirSync(JS_DIR).some((f) => /https:\/\/[a-z0-9]{20}\.supabase\.co/.test(fs.readFileSync(path.join(JS_DIR, f), "utf8")));

const SEED = {
  "campus-schedule:courses:v1": [
    { id: "c1", code: "CMSC 21", color: "#2F7D6E", units: 3, meetings: [{ days: [1], start: "08:00", end: "09:30", room: "AS-101" }] },
    { id: "c2", code: "MATH 21", color: "#4E6FC7", units: 4, meetings: [{ days: [1], start: "09:40", end: "11:00", room: "MB 101" }] },
  ],
  "campus-schedule:tasks:v1": [
    { id: "t1", title: "Lab report 2", due: "2026-09-14", priority: "medium", done: false, createdAt: 1 },
    { id: "t2", title: "Quiz 1", due: "2026-09-14", priority: "medium", done: false, createdAt: 1 },
    { id: "t3", title: "Reading", due: "2026-09-14", priority: "medium", done: false, createdAt: 1 },
    { id: "t4", title: "Essay", due: "2026-09-20", priority: "medium", done: false, createdAt: 1, noteRef: { canvasId: "general" } },
    { id: "t5", title: "CMSC practice", due: "2026-09-19", priority: "medium", done: false, createdAt: 1, courseId: "c1", focusLog: { "2026-09-14": 1500 } },
    { id: "t6", title: "Problem set 1", due: "2026-09-16", priority: "medium", done: false, createdAt: 1, courseId: "c2" },
    { id: "t7", title: "Problem set 2", due: "2026-09-17", priority: "medium", done: false, createdAt: 1, courseId: "c2" },
    { id: "t8", title: "Old done task", due: "2026-09-01", priority: "low", done: true, createdAt: 1 },
  ],
  "campus-schedule:grades:v1": {
    c1: {
      components: [
        { id: "q", name: "Quizzes", weight: 20 },
        { id: "e", name: "Exams", weight: 50 },
        { id: "r", name: "Requirements", weight: 30 },
      ],
      entries: [
        { id: "q1", componentId: "q", name: "Quiz 1", score: 18, total: 20 },
        { id: "r1", componentId: "r", name: "MP 1", score: 27, total: 30 },
      ],
    },
  },
  "campus-schedule:settings:v1": {
    term: { start: "2026-08-24", end: "2026-12-12" },
    skipRegularHolidays: true,
    skipSpecialHolidays: true,
    reminders: { enabled: false, classLeadMin: 10, taskLeadMin: 60 },
  },
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);
const clickText = async (page, t) => {
  await page.waitForFunction(
    (s) => [...document.querySelectorAll("body *")].some((el) => el.childElementCount === 0 && el.textContent.trim() === s && el.getClientRects().length),
    { timeout: 6000 },
    t
  );
  const h = await page.evaluateHandle((s) => {
    const leaves = [...document.querySelectorAll("body *")].filter((el) => el.childElementCount === 0 && el.textContent.trim() === s && el.getClientRects().length);
    return leaves[leaves.length - 1];
  }, t);
  await h.asElement().click();
};
const clickLabel = async (page, label) => {
  const sel = `[aria-label="${label}"]`;
  await page.waitForSelector(sel, { timeout: 6000 });
  await page.click(sel);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  await page.setRequestInterception(true);
  page.on("request", (r) => (/supabase\.co/.test(r.url()) ? r.abort() : r.continue()));
  await page.evaluateOnNewDocument(
    (seed, fixedIso) => {
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
      if (!sessionStorage.getItem("seeded")) {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
        sessionStorage.setItem("seeded", "1");
      }
    },
    SEED,
    "2026-09-14T07:30:00"
  );

  // --- Home -------------------------------------------------------------------
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(800);
  let t = await text(page);
  check("Heavy day flagged", t.includes("Today looks heavy:") && t.includes("3 deadlines (Lab report 2, Quiz 1, Reading)"), (t.match(/looks heavy:[^\n]*/) || [""])[0]);
  check("Focus time shown per course", t.includes("Focus time") && t.includes("25m"));
  check("Low-focus course warned", t.includes("MATH 21 has 2 deadlines left this week but no focus time."));
  check(KEYED ? "Setup checklist shows the section step" : "Setup checklist hidden once set up", KEYED ? t.includes("Get set up") && t.includes("2 of 3 done") : !t.includes("Get set up"));
  await page.screenshot({ path: path.join(SHOTS, "1-home.png") });

  await clickLabel(page, "Room MB 101");
  await wait(400);
  t = await text(page);
  // The section label is styled uppercase, so compare case-insensitively.
  check("Room finder opens from Home", /your classes here/i.test(t) && t.includes("MATH 21"));
  check("Walking time from the class before", t.includes("10 min to get here from CMSC 21 in AS-101."), (t.match(/to get here[^\n]*/) || [""])[0]);
  await page.screenshot({ path: path.join(SHOTS, "2-room.png") });
  await page.keyboard.press("Escape");

  // --- Tasks: linked notes ----------------------------------------------------
  await page.goto(URL("/tasks"), { waitUntil: "networkidle0" });
  await wait(600);
  await clickLabel(page, "Open notes: General");
  await wait(800);
  check("Linked notes open the Notes tab", page.url().includes("/notes"), page.url());

  // --- Grades: what do I need? ------------------------------------------------
  await page.goto(URL("/courses"), { waitUntil: "networkidle0" });
  await wait(600);
  await clickLabel(page, "CMSC 21 grades");
  await wait(500);
  t = await text(page);
  check("Grade target shown", t.includes("What do I need for") && t.includes("To get 1.00, average at least 94% on Exams (50%)."), (t.match(/To get[^\n]*/) || [""])[0]);
  await page.screenshot({ path: path.join(SHOTS, "3-grades.png") });
  await page.keyboard.press("Escape");

  // --- Enlistment planner -----------------------------------------------------
  await page.goto(URL("/planner"), { waitUntil: "networkidle0" });
  await page.waitForSelector('[aria-label="Pasted class offerings"]');
  await page.click('[aria-label="Pasted class offerings"]');
  await page.keyboard.sendCharacter(
    ["CMSC 21 T-1L 3.0 TTh 10-11:30AM AECH", "MATH 21 THY1 4.0 TTh 11AM-12PM MB 101", "MATH 21 THY2 4.0 MWF 7-8AM MB 101"].join("\n")
  );
  await clickText(page, "Read offerings");
  await wait(300);
  await clickLabel(page, "CMSC 21 T-1L");
  await clickLabel(page, "MATH 21 THY1");
  await wait(300);
  t = await text(page);
  check("Planner finds the clash", t.includes("CMSC 21 T-1L and MATH 21 THY1 overlap on Tue") && t.includes("2 conflicts"), (t.match(/overlap[^\n]*/) || [""])[0]);
  await page.screenshot({ path: path.join(SHOTS, "4-planner-conflict.png") });
  await page.click('[aria-label="MATH 21 THY1, conflicts with another pick"]');
  await clickLabel(page, "MATH 21 THY2");
  await wait(300);
  t = await text(page);
  check("Switching sections clears it", t.includes("No conflicts between your picks.") && t.includes("7 units"));
  await page.reload({ waitUntil: "networkidle0" });
  await wait(600);
  check("Planner remembers picks after reload", (await text(page)).includes("2 of 2"));

  // --- End semester -------------------------------------------------------------
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(600);
  await clickText(page, "End semester…");
  await wait(400);
  t = await text(page);
  check("End semester explains what's kept", t.includes("End this semester?") && t.includes("Kept: unfinished tasks"));
  await clickText(page, "End semester");
  await wait(800);
  const after = await page.evaluate(() => ({
    courses: JSON.parse(localStorage.getItem("campus-schedule:courses:v1")),
    settings: JSON.parse(localStorage.getItem("campus-schedule:settings:v1")),
    tasks: JSON.parse(localStorage.getItem("campus-schedule:tasks:v1")),
  }));
  check("Courses cleared", after.courses.length === 0);
  check(
    "Semester archived with its GWA",
    after.settings.archivedTerms?.length === 1 && after.settings.archivedTerms[0].label === "1st Semester, AY 2026–2027" && !after.settings.term,
    JSON.stringify(after.settings.archivedTerms?.[0]?.label)
  );
  check("Finished tasks cleared, open ones kept", !after.tasks.some((x) => x.done) && after.tasks.some((x) => x.title === "Essay"));
  check("Past semesters listed", (await text(page)).includes("Past semesters"));
  await page.screenshot({ path: path.join(SHOTS, "5-past-semesters.png") });
  await page.close();
} catch (e) {
  results.push("ERROR " + (e?.stack ?? e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 12).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  if (results.some((r) => !r.startsWith("PASS")) || errors.length) process.exitCode = 1;
}
