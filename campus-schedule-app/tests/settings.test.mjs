// Settings flows: appearance persistence + pre-paint, semester/holiday
// home states, cancel/restore a class, backup export/validation/restore,
// reminders (granted + blocked), service worker.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT, FIXTURES } from "./helpers.mjs";
const BASE = "/Scheduling-app";
const PORT = 4602;
const ORIGIN = `http://localhost:${PORT}`;
const URL = (p) => `${ORIGIN}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-settings");
const DL = path.join(OUT, "downloads");
for (const d of [SHOTS, DL]) {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

const server = http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
    let file = path.join(ROOT, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, "index.html");
    const type =
      { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".webmanifest": "application/manifest+json" }[
        path.extname(file)
      ] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
/** `node settings.test.mjs backup pwa` runs only those sections. */
const run = (name) => process.argv.length <= 2 || process.argv.slice(2).includes(name);
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);

/** New page (optionally in a fresh context) with a pinned-but-ticking clock. */
async function openAt(iso, { context, width = 1280, height = 900, notification } = {}) {
  const page = await (context ?? browser).newPage();
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  await page.evaluateOnNewDocument(
    (fixedIso, notification) => {
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
      // Capture notifications from both the page API and the service worker path.
      window.__notes = [];
      if (notification) {
        const perm = notification;
        const Fake = function (title, opts) {
          window.__notes.push({ via: "page", title, body: opts?.body });
          return { close() {}, set onclick(_) {} };
        };
        Fake.permission = perm;
        Fake.requestPermission = async () => perm;
        Object.defineProperty(window, "Notification", { value: Fake, configurable: true });
        if (window.ServiceWorkerRegistration) {
          ServiceWorkerRegistration.prototype.showNotification = async function (title, opts) {
            window.__notes.push({ via: "sw", title, body: opts?.body });
          };
        }
      }
      // Record the theme at the moment HTML parsing finishes, before the app bundle runs.
      document.addEventListener("readystatechange", () => {
        if (document.readyState === "interactive" && !window.__prepaint) {
          const s = document.documentElement.style;
          window.__prepaint = { primary: s.getPropertyValue("--primary"), font: s.getPropertyValue("--font-sans"), dark: document.documentElement.classList.contains("dark") };
        }
      });
    },
    iso,
    notification
  );
  return page;
}

const clickByText = async (page, t) => {
  const ok = await page.evaluate((s) => {
    const el = [...document.querySelectorAll("body *")].filter(
      (e) => e.childElementCount === 0 && e.textContent.trim() === s && e.getClientRects().length
    ).pop();
    if (!el) return false;
    (el.closest("button,[role=button],[role=radio],[role=checkbox],[role=menuitem]") ?? el).click();
    return true;
  }, t);
  if (!ok) throw new Error(`No element with text "${t}"`);
};

const seed = (page, data) =>
  page.evaluateOnNewDocument((d) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, JSON.stringify(v));
  }, data);

try {
  let page;
  let t;
  // --- Appearance ------------------------------------------------------------
  if (run("appearance")) {
  const ctxA = await browser.createBrowserContext();
  page = await openAt("2026-09-14T10:00:00", { context: ctxA });
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(1000);
  check("Settings tab reachable", (await text(page)).includes("Appearance") && (await text(page)).includes("Semester"));
  await page.screenshot({ path: path.join(SHOTS, "1-settings-top.png") });
  const campusPrimary = await page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"));
  await page.click('[aria-label="Ink theme"]');
  await wait(300);
  const inkPrimary = await page.evaluate(() => document.documentElement.style.getPropertyValue("--primary"));
  check("Preset changes the theme instantly", inkPrimary && inkPrimary !== campusPrimary, `${campusPrimary} → ${inkPrimary}`);
  await clickByText(page, "Atkinson Hyperlegible");
  await clickByText(page, "110%");
  await clickByText(page, "Round");
  await wait(400);
  const zoomNow = await page.evaluate(() => document.body.style.zoom);
  check("Interface size applies", zoomNow === "1.1", zoomNow);
  await page.reload({ waitUntil: "networkidle0" });
  await wait(900);
  const pre = await page.evaluate(() => window.__prepaint);
  check("Theme applied before the app loads (no flash)", pre?.primary === inkPrimary && /Atkinson/.test(pre?.font ?? ""), JSON.stringify(pre));
  const after = await page.evaluate(() => ({
    primary: document.documentElement.style.getPropertyValue("--primary"),
    radius: document.documentElement.style.getPropertyValue("--radius"),
    zoom: document.body.style.zoom,
    saved: JSON.parse(localStorage.getItem("campus-schedule:appearance:v1")),
  }));
  check("Appearance persists across reload", after.primary === inkPrimary && after.radius === "1rem" && after.zoom === "1.1" && after.saved.font === "atkinson", JSON.stringify(after.saved));

  // Calendar drag still maps correctly at 110% interface size.
  await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
  await wait(1000);
  const monBox = await (await page.$('[aria-label^="Monday, September 14"]')).boundingBox();
  const wedBox = await (await page.$('[aria-label^="Wednesday, September 16"]')).boundingBox();
  await page.mouse.move(monBox.x + monBox.width / 2, monBox.y + monBox.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(monBox.x + monBox.width / 2 + ((wedBox.x - monBox.x) * i) / 10, monBox.y + monBox.height / 2, { steps: 2 });
  await page.mouse.up();
  await wait(700);
  const zoomRange = await text(page);
  check("Calendar drag correct at 110% size", /Sep 14\s*–\s*Sep 16/.test(zoomRange), (zoomRange.match(/Sep 1\d\s*–\s*Sep \d+/) || ["no range"])[0]);
  await page.keyboard.press("Escape");
  await wait(300);

  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(800);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("[role=button],button")].filter((b) => b.textContent.trim() === "Custom…");
    btns[0].click();
  });
  await wait(200);
  const accentInput = await page.$('[aria-label="Custom accent color"]');
  await accentInput.click({ clickCount: 3 });
  await accentInput.type("#FFFF66");
  await page.keyboard.press("Enter");
  await wait(400);
  check("Contrast warning for an unreadable accent", (await text(page)).includes("Some text may be hard to read"));
  await page.screenshot({ path: path.join(SHOTS, "2-contrast-warning.png") });
  await page.click('[aria-label="Midnight background"]');
  await wait(400);
  check("Dark custom background switches to dark mode", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await page.screenshot({ path: path.join(SHOTS, "3-midnight.png") });
  await clickByText(page, "Reset appearance");
  await wait(400);
  const reset = await page.evaluate(() => ({ zoom: document.body.style.zoom, primary: document.documentElement.style.getPropertyValue("--primary") }));
  check("Reset appearance", reset.zoom === "" && reset.primary === campusPrimary, JSON.stringify(reset));
  await page.close();
  await ctxA.close();
  }

  // --- Semester / holidays / cancellations on the home screen ----------------
  if (run("semester")) {
  const ctxS = await browser.createBrowserContext();
  page = await openAt("2026-08-31T14:40:00", { context: ctxS });
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(1000);
  t = await text(page);
  check("Heroes Day: no 'Now' for CMSC 13", !/ends in/i.test(t) && t.includes("No classes today") && t.includes("National Heroes Day"), (t.match(/No classes today[^\n]*\n?[^\n]*/) || [""])[0].replace(/\n/g, " | "));
  await page.screenshot({ path: path.join(SHOTS, "4-home-heroes-day.png") });
  await page.close();

  page = await openAt("2026-09-14T14:48:00", { context: ctxS });
  await seed(page, { "campus-schedule:settings:v1": { term: { start: "2026-06-15", end: "2026-09-10" }, skipRegularHolidays: true, skipSpecialHolidays: true, reminders: { enabled: false, classLeadMin: 10, taskLeadMin: 60 } } });
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(1000);
  t = await text(page);
  check("After term end: no stale class", !/ends in/i.test(t) && t.includes("The semester has ended."));
  await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
  await wait(800);
  const sep21 = await page.$eval('[aria-label^="Monday, September 21"]', (el) => el.getAttribute("aria-label"));
  check("Calendar: no classes after term end", /September 21$/.test(sep21), sep21);
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(800);
  t = await text(page);
  check("Settings shows the term", /Jun 15 – Sep 10 · 1\d weeks · ended/.test(t), (t.match(/Jun 15[^\n]*/) || [""])[0]);
  await clickByText(page, "Clear");
  await wait(400);
  check("Clearing the term", (await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:settings:v1")).term)) === undefined);
  await page.close();

  page = await openAt("2026-09-14T09:00:00", { context: ctxS });
  await page.goto(URL("/calendar"), { waitUntil: "networkidle0" });
  await wait(900);
  await page.click('[aria-label^="Monday, September 21"]');
  await wait(500);
  await page.click('[aria-label="Cancel CMSC 13 on this day"]');
  await wait(400);
  t = await text(page);
  check("Cancel one class from the calendar", t.includes("Cancelled") && !!(await page.$('[aria-label="Restore CMSC 13 on this day"]')));
  await page.screenshot({ path: path.join(SHOTS, "5-calendar-cancelled.png") });
  const sep23 = await page.$eval('[aria-label^="Wednesday, September 23"]', (el) => el.getAttribute("aria-label"));
  check("Other dates keep the class (rule intact)", /1 item/.test(sep23), sep23);
  await page.close();
  page = await openAt("2026-09-21T14:48:00", { context: ctxS });
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(900);
  t = await text(page);
  check("Home on the cancelled day: not 'Now'", !/ends in/i.test(t) && t.includes("CMSC 13 cancelled"));
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(800);
  await page.click('[aria-label^="Restore CMSC 13 on 2026-09-21"]');
  await wait(400);
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(900);
  check("Restoring brings the class back", /ends in/i.test(await text(page)));
  await page.close();
  await ctxS.close();
  }

  // --- Backup ------------------------------------------------------------------
  if (run("backup")) {
  // Browser.setDownloadBehavior (without a context id) applies to the default profile.
  page = await openAt("2026-09-14T10:00:00");
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });
  await seed(page, {
    "campus-schedule:tasks:v1": [
      { id: "t1", title: "Lab report", priority: "high", done: false, createdAt: 1, due: "2026-09-18", dueTime: "23:59", repeat: { freq: "weekly", weekdays: [5] } },
      { id: "t2", title: "Read chapter 3", priority: "medium", done: true, createdAt: 2 },
    ],
    "campus-schedule:appearance:v1": { preset: "moss", mode: "light", accent: null, background: null, font: "inter", serifHeadings: false, scale: 1, radius: "sharp", atmosphere: false },
  });
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(1000);
  await clickByText(page, "Export backup");
  let file = null;
  for (let i = 0; i < 40 && !file; i++) {
    await wait(150);
    file = fs.readdirSync(DL).find((f) => f.endsWith(".json"));
  }
  const exported = file ? JSON.parse(fs.readFileSync(path.join(DL, file), "utf8")) : null;
  check(
    "Export downloads a timestamped JSON backup",
    !!exported && /^campus-schedule-backup-2026-09-14-\d{4}\.json$/.test(file) && exported.data.tasks.length === 2 && exported.data.appearance.preset === "moss",
    file ?? "no file"
  );

  const bad = path.join(FIXTURES, "bad.json");
  fs.writeFileSync(bad, "{ this is not json");
  const invalid = path.join(FIXTURES, "invalid.json");
  const edited = JSON.parse(JSON.stringify(exported));
  edited.data.tasks[0].title = 5;
  edited.data.courses = [{ id: "c", code: "X", color: "#000", meetings: [{ days: [9], start: "25:00", end: "10:00" }] }];
  fs.writeFileSync(invalid, JSON.stringify(edited));
  const before = await page.evaluate(() => localStorage.getItem("campus-schedule:tasks:v1"));

  const choose = async (p, f) => {
    const [chooser] = await Promise.all([p.waitForFileChooser({ timeout: 8000 }), clickByText(p, "Choose backup file…")]);
    await chooser.accept([f]);
    await wait(700);
  };
  await choose(page, bad);
  t = await text(page);
  check("Corrupted file rejected", t.includes("This file can't be restored") && t.includes("isn't valid JSON"));
  await choose(page, invalid);
  t = await text(page);
  check(
    "Hand-edited file rejected with reasons",
    t.includes("tasks[0].title should be text") && t.includes("courses[0].meetings[0].days should be weekdays") && t.includes("start should be a time"),
    (t.match(/tasks\[0\][^\n]*/) || [""])[0]
  );
  check("Nothing applied from a bad file", (await page.evaluate(() => localStorage.getItem("campus-schedule:tasks:v1"))) === before);
  await page.screenshot({ path: path.join(SHOTS, "6-restore-rejected.png") });
  await page.close();

  // Restore into a fresh browser profile.
  const ctxFresh = await browser.createBrowserContext();
  page = await openAt("2026-09-14T10:00:00", { context: ctxFresh });
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(1000);
  const freshTasks = await page.evaluate(() => localStorage.getItem("campus-schedule:tasks:v1"));
  check("Fresh profile has no tasks", freshTasks === null || freshTasks === "[]", String(freshTasks));
  await choose(page, path.join(DL, file));
  t = await text(page);
  check("Restore shows a summary and asks first", t.includes("Restore this backup?") && t.includes("2 tasks"));
  await page.screenshot({ path: path.join(SHOTS, "7-restore-confirm.png") });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }), clickByText(page, "Replace my data")]);
  await wait(1000);
  const restored = await page.evaluate(() => ({
    tasks: JSON.parse(localStorage.getItem("campus-schedule:tasks:v1")).map((x) => x.title),
    radius: document.documentElement.style.getPropertyValue("--radius"),
    undo: !!localStorage.getItem("campus-schedule-cache:before-restore"),
  }));
  check("Restore replaces data and appearance", restored.tasks.includes("Lab report") && restored.radius === "0.25rem", JSON.stringify(restored));
  check("Undo snapshot kept", restored.undo && (await text(page)).includes("Undo last restore"));
  await page.close();
  await ctxFresh.close();
  }

  // --- Reminders -------------------------------------------------------------------
  if (run("reminders")) {
  const ctxR = await browser.createBrowserContext();
  page = await openAt("2026-09-14T14:19:48", { context: ctxR, notification: "granted" });
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(900);
  await page.click('[aria-label="Remind me"]');
  await wait(600);
  check("Reminders on: permission state shown", (await text(page)).includes("System notifications are allowed."));
  await page.screenshot({ path: path.join(SHOTS, "8-reminders.png") });
  let notes = [];
  for (let i = 0; i < 40 && !notes.length; i++) {
    await wait(1000);
    notes = await page.evaluate(() => window.__notes);
  }
  check("Class reminder fires at the lead time", notes.some((n) => n.title === "CMSC 13 in 10 minutes · CS Laboratory 2"), JSON.stringify(notes[0] ?? null));
  await page.reload({ waitUntil: "networkidle0" });
  await wait(25000);
  const repeat = await page.evaluate(() => window.__notes.length);
  check("Same reminder doesn't fire again after reload", repeat === 0, `${repeat} after reload`);
  await page.close();
  await ctxR.close();

  const ctxD = await browser.createBrowserContext();
  page = await openAt("2026-09-14T14:19:50", { context: ctxD, notification: "denied" });
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(900);
  await page.click('[aria-label="Remind me"]');
  await wait(500);
  t = await text(page);
  check("Blocked notifications are explained", t.includes("Notifications are blocked for this site") && t.includes("Check again"));
  let toast = false;
  for (let i = 0; i < 40 && !toast; i++) {
    await wait(1000);
    toast = (await text(page)).includes("CMSC 13 in 10 minutes");
  }
  check("Blocked → reminder shows in the app instead", toast);
  await page.screenshot({ path: path.join(SHOTS, "9-reminder-toast.png") });
  await page.close();
  await ctxD.close();
  }

  // --- PWA ------------------------------------------------------------------------
  if (run("pwa")) {
  const ctxP = await browser.createBrowserContext();
  page = await openAt("2026-09-14T10:00:00", { context: ctxP });
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(800);
  const pwa = await page.evaluate(async () => {
    const manifest = document.querySelector('link[rel="manifest"]')?.href;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 6000))]);
    const m = manifest ? await (await fetch(manifest)).json() : null;
    return { manifest, scope: reg?.scope, name: m?.name, icons: m?.icons?.length };
  });
  check("Manifest linked and valid", pwa.name === "Campus Schedule" && pwa.icons === 3, pwa.manifest);
  check("Service worker registered for the app path", pwa.scope === `${ORIGIN}${BASE}/`, pwa.scope);
  check("Install section present", (await text(page)).includes("Install as an app"));
  // Phone layout of Settings
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle0" });
  await wait(900);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Settings fits a phone", overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(SHOTS, "10-phone-settings.png") });
  await page.close();
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
