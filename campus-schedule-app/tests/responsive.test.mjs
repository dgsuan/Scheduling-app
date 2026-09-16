// Every screen at every size: phones, tablets, laptops and wide monitors.
// Nothing may overflow sideways, the Notes toolbar must stay on screen, and
// the Friend activity panel must fit — plus resizing a note by its corner.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4680;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-responsive");
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

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZES = [
  { w: 360, h: 740, name: "small phone" },
  { w: 414, h: 896, name: "phone" },
  { w: 768, h: 1024, name: "tablet" },
  { w: 1024, h: 768, name: "small laptop" },
  { w: 1280, h: 720, name: "laptop" },
  { w: 1512, h: 950, name: "large laptop" },
  { w: 1920, h: 1080, name: "monitor" },
];
const ROUTES = ["/", "/tasks", "/calendar", "/courses", "/notes", "/settings"];

const SEED = {
  "campus-schedule:tasks:v1": [
    { id: "t1", title: "Read chapter 3 of the statistics reader", priority: "medium", done: false, createdAt: 1, due: "2026-12-01" },
    { id: "t2", title: "Lab report", priority: "high", done: false, createdAt: 2, status: "doing", startedAt: Date.now() - 600_000 },
    { id: "t3", title: "Essay draft", priority: "medium", done: true, createdAt: 3, completedAt: Date.now() - 3_600_000 },
  ],
  "campus-schedule:settings:v1": {
    skipRegularHolidays: true,
    skipSpecialHolidays: true,
    reminders: { enabled: false, classLeadMin: 10, taskLeadMin: 60 },
    seenGuideVersion: 99,
    tasksView: "board",
  },
};

async function open(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  await page.setRequestInterception(true);
  page.on("request", (r) => (/supabase\.co/.test(r.url()) ? r.abort() : r.continue()));
  await page.evaluateOnNewDocument((data) => {
    if (sessionStorage.getItem("seeded")) return;
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    sessionStorage.setItem("seeded", "1");
  }, SEED);
  return page;
}

/** How far an element sticks out of the window (0 = fully inside). */
const clipped = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.round(Math.max(0, -r.left, r.right - window.innerWidth));
  }, selector);

try {
  const page = await open(1280, 800);
  const overflowing = [];
  const clippedPanels = [];

  for (const size of SIZES) {
    await page.setViewport({ width: size.w, height: size.h });
    for (const route of ROUTES) {
      await page.goto(URL(route), { waitUntil: "networkidle0" });
      await wait(650);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) overflowing.push(`${size.w}px ${route} (+${over}px)`);

      if (route === "/notes") {
        const dock = await clipped(page, '[aria-label="Notes toolbar"]');
        const buttons = await page.$$eval('[aria-label^="Add "]', (els) => els.length);
        if (dock === null || dock > 0 || buttons < 6) clippedPanels.push(`${size.w}px notes toolbar (clipped ${dock}px, ${buttons} buttons)`);
      }
      if (route === "/tasks") {
        const panel = await clipped(page, '[aria-label="Friend activity"]');
        // The panel only exists in builds with Supabase keys.
        if (panel !== null && panel > 0) clippedPanels.push(`${size.w}px friend activity (clipped ${panel}px)`);
      }
    }
    await page.goto(URL("/notes"), { waitUntil: "networkidle0" });
    await wait(500);
    await page.screenshot({ path: path.join(SHOTS, `notes-${size.w}.png`) });
    await page.goto(URL("/tasks"), { waitUntil: "networkidle0" });
    await wait(500);
    await page.screenshot({ path: path.join(SHOTS, `tasks-${size.w}.png`) });
  }

  check("No screen overflows sideways at any size", overflowing.length === 0, overflowing.slice(0, 6).join(", "));
  check("Toolbars and panels stay on screen", clippedPanels.length === 0, clippedPanels.slice(0, 6).join(", "));

  // --- Bigger interface sizes (Settings → Interface size) ---------------------------
  const zoomIssues = [];
  for (const scale of [1.1, 1.25]) {
    for (const w of [1280, 1536, 1920]) {
      await page.setViewport({ width: w, height: 900 });
      for (const route of ["/tasks", "/notes"]) {
        await page.goto(URL(route), { waitUntil: "networkidle0" });
        await page.evaluate((s) => {
          const a = JSON.parse(localStorage.getItem("campus-schedule:appearance:v1") ?? "{}");
          localStorage.setItem("campus-schedule:appearance:v1", JSON.stringify({ ...a, scale: s }));
        }, scale);
        await page.reload({ waitUntil: "networkidle0" });
        await wait(800);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const panel = await clipped(page, '[aria-label="Friend activity"]');
        const dock = await clipped(page, '[aria-label="Notes toolbar"]');
        if (over > 1) zoomIssues.push(`${Math.round(scale * 100)}% ${w}px ${route} overflows +${over}px`);
        if (panel !== null && panel > 0) zoomIssues.push(`${Math.round(scale * 100)}% ${w}px friend activity clipped ${panel}px`);
        if (dock !== null && dock > 0) zoomIssues.push(`${Math.round(scale * 100)}% ${w}px notes toolbar clipped ${dock}px`);
      }
    }
  }
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("campus-schedule:appearance:v1") ?? "{}");
    localStorage.setItem("campus-schedule:appearance:v1", JSON.stringify({ ...a, scale: 1 }));
  });
  check("Nothing is cut off at bigger interface sizes", zoomIssues.length === 0, zoomIssues.slice(0, 6).join(", "));

  // --- Around the width where Friend activity moves into its own column -------------
  const panelSizes = [];
  for (const w of [1180, 1239, 1240, 1366]) {
    await page.setViewport({ width: w, height: 800 });
    await page.goto(URL("/tasks"), { waitUntil: "networkidle0" });
    await wait(650);
    const panel = await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Friend activity"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { clipped: Math.round(Math.max(0, -r.left, r.right - window.innerWidth)), width: Math.round(r.width) };
    });
    if (panel && (panel.clipped > 0 || panel.width < 230)) panelSizes.push(`${w}px (clipped ${panel.clipped}px, ${panel.width}px wide)`);
  }
  check("Friend activity is whole and readable at every width", panelSizes.length === 0, panelSizes.join(", "));

  // --- Resizing a note by its corner ------------------------------------------------
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL("/notes"), { waitUntil: "networkidle0" });
  await wait(900);
  await page.click('[aria-label="Add to-do"]');
  await wait(600);
  const handle = await page.$('[aria-label="Resize to-do"]');
  check("To-do notes have a resize corner", !!handle);
  const posBefore = await page.evaluate(() => {
    const it = JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items.find((i) => i.kind === "todo");
    return { x: it?.x ?? 0, y: it?.y ?? 0 };
  });
  if (handle) {
    const box = await handle.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + i * 9, start.y + i * 3, { steps: 1 });
    await page.mouse.up();
    await wait(600);
    const todo = await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items.find((i) => i.kind === "todo"));
    check("Dragging the corner widens the to-do and saves it", (todo?.width ?? 0) > 240, `width → ${todo?.width}`);
    check(
      "Resizing doesn't move the note",
      Math.abs((todo?.x ?? -1) - posBefore.x) < 1 && Math.abs((todo?.y ?? -1) - posBefore.y) < 1,
      `(${posBefore.x}, ${posBefore.y}) → (${todo?.x}, ${todo?.y})`
    );
  }

  await page.click('[aria-label="Add text"]');
  await wait(600);
  const noteHandle = await page.$('[aria-label="Resize note"]');
  check("Text notes have a resize corner", !!noteHandle);
  if (noteHandle) {
    const box = await noteHandle.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + i * 7, start.y + i * 6, { steps: 1 });
    await page.mouse.up();
    await wait(600);
    const note = await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items.find((i) => i.kind === "text"));
    check("Dragging the corner resizes the note and saves it", (note?.width ?? 0) > 200 && (note?.height ?? 0) > 60, `${note?.width}×${note?.height}`);
  }
  await page.screenshot({ path: path.join(SHOTS, "resized-notes.png") });

  // A resized note keeps its size after a reload.
  await page.reload({ waitUntil: "networkidle0" });
  await wait(900);
  const widthAfter = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Resize to-do"]');
    const card = el?.closest('[data-testid^="canvas-card-"]')?.getBoundingClientRect();
    const saved = JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items.find((i) => i.kind === "todo")?.width ?? 0;
    return { drawn: Math.round(card?.width ?? 0), saved };
  });
  check("Sizes survive a reload", widthAfter.saved > 240 && Math.abs(widthAfter.drawn - widthAfter.saved) <= 2, `drawn ${widthAfter.drawn}px, saved ${widthAfter.saved}px`);
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
