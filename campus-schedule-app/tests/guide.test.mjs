// The Guide and the one-time "what's new" banner on Home: a new user gets
// the tour, a returning user sees what's new, and both go away once handled.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4640;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-guide");
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

async function open(context, { width = 1280, seed } = {}) {
  const page = await context.newPage();
  await page.setViewport({ width, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  await page.setRequestInterception(true);
  page.on("request", (r) => (/supabase\.co/.test(r.url()) ? r.abort() : r.continue()));
  if (seed) {
    await page.evaluateOnNewDocument((data) => {
      if (sessionStorage.getItem("seeded")) return;
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
      sessionStorage.setItem("seeded", "1");
    }, seed);
  }
  return page;
}

try {
  // --- New user: the tour ---------------------------------------------------------
  const fresh = await browser.createBrowserContext();
  let page = await open(fresh);
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(800);
  check("New user is offered the tour", (await text(page)).includes("New here? Take the tour"));
  await page.screenshot({ path: path.join(SHOTS, "1-home-banner.png") });
  await clickText(page, "Take the tour");
  await wait(900);
  let t = await text(page);
  check("Tour opens the guide", page.url().includes("/guide") && t.includes("New in this update") && t.includes("How it works"), page.url());
  check("Getting started is open with its steps", t.includes("Paste your schedule from CRS") && t.includes("Set your semester dates"));
  await page.screenshot({ path: path.join(SHOTS, "2-guide.png") });

  await clickText(page, "Class sections");
  await wait(300);
  check("Sections expand to show how-tos", (await text(page)).includes("Ask “is it due Friday or Monday?”"));

  await page.click('[aria-label="Show me: Enlistment planner"]');
  await wait(900);
  check("“Show me” goes to the feature", page.url().includes("/planner"), page.url());

  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(700);
  check("Banner stays gone after the tour", !(await text(page)).includes("Take the tour"));
  await page.close();
  await fresh.close();

  // --- Returning user: what's new -------------------------------------------------
  const returning = await browser.createBrowserContext();
  page = await open(returning, {
    seed: {
      "campus-schedule:courses:v1": [{ id: "c1", code: "CMSC 21", color: "#2F7D6E", meetings: [] }],
      "campus-schedule:settings:v1": { skipRegularHolidays: true, skipSpecialHolidays: true, reminders: { enabled: false, classLeadMin: 10, taskLeadMin: 60 }, seenGuideVersion: 1 },
    },
  });
  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(800);
  t = await text(page);
  check("Returning user sees what's new", t.includes("New in this update") && t.includes("See what's new"));
  await clickText(page, "Not now");
  await wait(500);
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:settings:v1")).seenGuideVersion);
  check("“Not now” hides it for good", !(await text(page)).includes("See what's new") && seen === 2, `seenGuideVersion=${seen}`);
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(600);
  check("Guide is still reachable from Settings", (await text(page)).includes("Open the guide"));
  await page.close();
  await returning.close();

  // --- Phone ----------------------------------------------------------------------------
  const phoneCtx = await browser.createBrowserContext();
  page = await open(phoneCtx, { width: 400 });
  await page.goto(URL("/guide"), { waitUntil: "networkidle0" });
  await wait(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Guide fits a phone", overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(SHOTS, "3-phone.png"), fullPage: true });
  await page.close();
  await phoneCtx.close();
} catch (e) {
  results.push("ERROR " + (e?.stack ?? e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 12).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  if (results.some((r) => !r.startsWith("PASS")) || errors.length) process.exitCode = 1;
}
