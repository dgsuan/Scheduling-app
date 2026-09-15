// Task board: switch Tasks to Board, drag a card from Not started to Doing,
// use the card buttons, keep a task private, and check it all lands in
// storage. Signed out, Friend activity asks you to sign in.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4670;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-board");
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

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:tasks:v1") ?? "[]"));
const find = (list, id) => list.find((t) => t.id === id);
const center = async (el) => {
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const columnOfCard = (page, id) =>
  page.evaluate((id) => document.querySelector(`[data-testid="board-card-${id}"]`)?.closest("[role=list]")?.getAttribute("aria-label") ?? null, id);

const NOW = Date.now();
const SEED = {
  "campus-schedule:tasks:v1": [
    { id: "t1", title: "Read chapter 3", priority: "medium", done: false, createdAt: 1 },
    { id: "t2", title: "Lab report", priority: "high", done: false, createdAt: 2, status: "doing", startedAt: NOW - 600_000 },
    { id: "t3", title: "Essay draft", priority: "medium", done: true, createdAt: 3, completedAt: NOW - 3_600_000 },
  ],
};

async function open(width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
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

try {
  const page = await open(1280);
  await page.goto(URL("/tasks"), { waitUntil: "networkidle0" });
  await wait(800);
  check("List view marks the task in Doing", (await text(page)).includes("Doing"));

  await page.evaluate(() => [...document.querySelectorAll("[role=radio]")].find((b) => b.textContent.trim() === "Board")?.click());
  await wait(700);
  check("Board shows the three columns", !!(await page.$('[aria-label="Not started"]')) && !!(await page.$('[aria-label="Doing"]')) && !!(await page.$('[aria-label="Finished"]')));
  check(
    "Cards start in the right columns",
    (await columnOfCard(page, "t1")) === "Not started" && (await columnOfCard(page, "t2")) === "Doing" && (await columnOfCard(page, "t3")) === "Finished",
    `${await columnOfCard(page, "t1")}, ${await columnOfCard(page, "t2")}, ${await columnOfCard(page, "t3")}`
  );
  await page.screenshot({ path: path.join(SHOTS, "1-board.png") });

  // Drag "Read chapter 3" into Doing.
  const card = await page.$('[data-testid="board-card-t1"]');
  const from = await center(card);
  const doingCol = await page.$('[aria-label="Doing"]');
  const to = await center(doingCol);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16, { steps: 2 });
    await wait(16);
  }
  await page.screenshot({ path: path.join(SHOTS, "2-dragging.png") });
  await page.mouse.up();
  await wait(700);
  let tasks = await stored(page);
  check("Dragging a card to Doing starts it", find(tasks, "t1")?.status === "doing" && typeof find(tasks, "t1")?.startedAt === "number", JSON.stringify(find(tasks, "t1")));
  check("…and it moves columns", (await columnOfCard(page, "t1")) === "Doing");

  await page.click('[aria-label="Move “Lab report” to Finished"]');
  await wait(600);
  tasks = await stored(page);
  const t2 = find(tasks, "t2");
  check("Done finishes it and leaves Doing", t2?.done === true && t2?.status === undefined && typeof t2?.completedAt === "number", JSON.stringify(t2));

  await page.click('[aria-label="Move “Essay draft” to Not started"]');
  await wait(600);
  tasks = await stored(page);
  check("Moving back reopens it", find(tasks, "t3")?.done === false && find(tasks, "t3")?.completedAt === undefined, JSON.stringify(find(tasks, "t3")));

  await page.click('[aria-label="Keep “Read chapter 3” private"]');
  await wait(400);
  tasks = await stored(page);
  check("The lock keeps a task private", find(tasks, "t1")?.private === true && (await text(page)).includes("Private"));

  const friendText = await text(page);
  check(
    KEYED ? "Friend activity (signed out) asks to sign in" : "No Friend activity without an account backend",
    friendText.includes("Sign in to see what classmates are working on") === KEYED
  );
  await page.screenshot({ path: path.join(SHOTS, "3-after.png") });

  await page.reload({ waitUntil: "networkidle0" });
  await wait(800);
  check("Board stays selected after reload", !!(await page.$('[aria-label="Doing"][role=list]')));
  await page.close();

  const phone = await open(400);
  await phone.goto(URL("/tasks"), { waitUntil: "networkidle0" });
  await wait(600);
  await phone.evaluate(() => [...document.querySelectorAll("[role=radio]")].find((b) => b.textContent.trim() === "Board")?.click());
  await wait(700);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Board fits a phone (columns stack)", overflow <= 1, `${overflow}px`);
  await phone.screenshot({ path: path.join(SHOTS, "4-phone.png"), fullPage: true });
  await phone.close();
} catch (e) {
  results.push("ERROR " + (e?.stack ?? e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 12).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  if (results.some((r) => !r.startsWith("PASS")) || errors.length) process.exitCode = 1;
}
