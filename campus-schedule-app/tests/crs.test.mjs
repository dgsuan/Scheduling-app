// CRS paste import: paste a class table on Import, add the courses, and
// check they land in Courses (and in storage) with meeting times and rooms.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4610;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-crs");
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

// A build made with Supabase keys shows sharing/sections UI (signed out).
// Look for an actual project URL: supabase-js itself contains "*.supabase.co",
// so a bare "supabase.co" match would misreport a keyless (CI) build as keyed.
const JS_DIR = path.join(ROOT, "_expo", "static", "js", "web");
const PROJECT_URL = /https:\/\/[a-z0-9]{20}\.supabase\.co/;
const KEYED = fs.readdirSync(JS_DIR).some((f) => PROJECT_URL.test(fs.readFileSync(path.join(JS_DIR, f), "utf8")));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);
const clickText = async (page, t) => {
  await page.waitForFunction(
    (s) => [...document.querySelectorAll("body *")].some((el) => el.childElementCount === 0 && el.textContent.trim() === s && el.getClientRects().length),
    { timeout: 5000 },
    t
  );
  const h = await page.evaluateHandle((s) => {
    const leaves = [...document.querySelectorAll("body *")].filter((el) => el.childElementCount === 0 && el.textContent.trim() === s && el.getClientRects().length);
    return leaves[leaves.length - 1];
  }, t);
  await h.asElement().click();
};

const PASTE = [
  "Class Code  Class  Credits  Schedule",
  "54321  CMSC 21 T-3L  3.0  TTh 10-11:30AM lec AECH; F 1-4PM lab TL3",
  "54322  MATH 21 THY2  4.0  MWF 7AM-8AM MB 101",
].join("\n");

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  // Never talk to a real backend from tests.
  await page.setRequestInterception(true);
  page.on("request", (r) => (/supabase\.co/.test(r.url()) ? r.abort() : r.continue()));

  await page.goto(URL("/import"), { waitUntil: "networkidle0" });
  await page.waitForSelector('[aria-label="Pasted CRS schedule"]');
  check("Import shows the CRS paste box", (await text(page)).includes("Paste your schedule from CRS"));

  await page.click('[aria-label="Pasted CRS schedule"]');
  await page.keyboard.sendCharacter(PASTE);
  await wait(200);
  await clickText(page, "Read schedule");
  await wait(300);
  const preview = await text(page);
  check("Finds both classes", preview.includes("Found 2 classes"), preview.match(/Found \d+ class\w*/)?.[0]);
  check("Preview shows parsed times and rooms", preview.includes("CMSC 21 (T-3L)") && preview.includes("AECH") && preview.includes("MB 101"));
  await page.screenshot({ path: path.join(SHOTS, "1-preview.png") });

  // Untick MATH 21, add only CMSC 21.
  await page.click('[aria-label="MATH 21 THY2"]');
  await wait(150);
  check("Unticking updates the count", (await text(page)).includes("Add 1 to Courses"));
  await clickText(page, "Add 1 to Courses");
  await wait(400);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:courses:v1") ?? "[]"));
  const cmsc = stored.find((c) => c.code === "CMSC 21");
  check("Course saved with its section", cmsc?.section === "T-3L");
  check(
    "Meetings saved in 24h with rooms",
    JSON.stringify(cmsc?.meetings) ===
      JSON.stringify([
        { days: [2, 4], start: "10:00", end: "11:30", room: "AECH" },
        { days: [5], start: "13:00", end: "16:00", room: "TL3" },
      ]),
    JSON.stringify(cmsc?.meetings)
  );
  check("Unticked class not added", !stored.some((c) => c.code === "MATH 21"));

  await page.goto(URL("/courses"), { waitUntil: "networkidle0" });
  await wait(500);
  const courses = await text(page);
  check("Courses screen lists it", courses.includes("CMSC 21") && courses.includes("AECH"));
  check(KEYED ? "Sharing UI shown (build has Supabase keys)" : "No sharing UI without an account backend", courses.includes("Add shared course") === KEYED);
  await page.screenshot({ path: path.join(SHOTS, "2-courses.png") });

  if (KEYED) {
    // Signed out: sharing and sections explain that an account is needed.
    await clickText(page, "Share");
    await wait(400);
    check("Share (signed out) asks to sign in", (await text(page)).includes("Sign in first"));
    await page.keyboard.press("Escape");
    await wait(300);
    await page.goto(URL("/tasks"), { waitUntil: "networkidle0" });
    await clickText(page, "Class sections");
    await wait(400);
    check("Class sections (signed out) asks to sign in", (await text(page)).includes("Sign in first"));
    await page.screenshot({ path: path.join(SHOTS, "3-sections-signed-out.png") });
    await page.goto(URL("/tasks?join=ABCDE-FGH23"), { waitUntil: "networkidle0" });
    await wait(600);
    check("Invite link opens the sections dialog", (await text(page)).includes("Class sections"));
    await page.goto(URL("/courses?course=ABCDE-FGH23"), { waitUntil: "networkidle0" });
    await wait(600);
    check("Share link opens “Add a shared course”", (await text(page)).includes("Add a shared course"));
  }

  // Re-import the same paste: CMSC 21 is recognised as already added.
  await page.goto(URL("/import"), { waitUntil: "networkidle0" });
  await page.waitForSelector('[aria-label="Pasted CRS schedule"]');
  await page.click('[aria-label="Pasted CRS schedule"]');
  await page.keyboard.sendCharacter(PASTE);
  await clickText(page, "Read schedule");
  await wait(300);
  const again = await text(page);
  check("Re-import marks it as already added", again.includes("Already added") && again.includes("Add 1 to Courses"));

  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Pasted CRS schedule"]');
    el.focus();
  });
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.sendCharacter("hello there\nnothing to see");
  await clickText(page, "Read schedule");
  await wait(300);
  check("Junk paste explains what to copy", (await text(page)).includes("No classes found"));
  await page.close();
} catch (e) {
  results.push("ERROR " + (e?.stack ?? e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 12).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  if (results.some((r) => !r.startsWith("PASS"))) process.exitCode = 1;
}
