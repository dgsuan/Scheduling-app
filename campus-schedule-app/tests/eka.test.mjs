// Eka mode: the Settings toggle applies its theme, survives a reload (with no
// flash of the old theme), and turning it off brings back the previous look.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4660;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-eka");
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
const token = (page, name) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);

async function open(width = 1280) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  await page.setRequestInterception(true);
  page.on("request", (r) => (/supabase\.co/.test(r.url()) ? r.abort() : r.continue()));
  await page.evaluateOnNewDocument(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive" && !window.__prepaint) {
        window.__prepaint = document.documentElement.style.getPropertyValue("--primary");
      }
    });
  });
  return page;
}

try {
  const page = await open();
  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(800);
  const before = await token(page, "--primary");
  check("Eka mode is in Settings, off by default", (await text(page)).includes("Eka mode") && !(await page.$('[data-testid="eka-sparkles"]')));

  await page.click('[aria-label="Eka mode"]');
  await wait(600);
  let t = await text(page);
  check("Turning it on sets the accent", (await token(page, "--primary")) === "330 68% 46%", await token(page, "--primary"));
  check("Sets the background", (await token(page, "--background")).startsWith("340 "), await token(page, "--background"));
  check("Sets the corners", (await token(page, "--radius")) === "1.25rem");
  check("Sets the fonts", /Nunito/.test(await token(page, "--font-sans")) && /Fredoka/.test(await token(page, "--font-display")));
  check("Background decoration appears", !!(await page.$('[data-testid="eka-sparkles"]')));
  check("Sidebar logo changes", await page.$eval('[aria-label="isked"]', (el) => el.textContent.includes("♡")).catch(() => false));
  check("Settings it overrides are tucked away", !t.includes("A starting point for the colors.") && !t.includes("Corner roundness"));
  check("No readability warning", !t.includes("Some text may be hard to read"));
  await page.screenshot({ path: path.join(SHOTS, "1-settings.png") });

  await page.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(800);
  check("Home greeting changes", /♡/.test((await text(page)).split("\n").slice(0, 6).join(" ")));
  // Headless Chrome sometimes reports dark for a moment, so accept either variant.
  check("Theme applied before the app loads (no flash)", /^330 /.test(await page.evaluate(() => window.__prepaint)), await page.evaluate(() => window.__prepaint));
  await page.screenshot({ path: path.join(SHOTS, "2-home.png") });

  await page.goto(URL("/settings"), { waitUntil: "networkidle0" });
  await wait(600);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=radio],[role=button],[role=tab]")].find((b) => b.textContent.trim() === "Dark");
    el?.click();
  });
  await wait(600);
  check("Dark mode works too", (await token(page, "--background")).startsWith("330 22% "), await token(page, "--background"));
  check("…and still readable", !(await text(page)).includes("Some text may be hard to read"));
  await page.screenshot({ path: path.join(SHOTS, "3-dark.png") });

  await page.click('[aria-label="Eka mode"]');
  await wait(600);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("[role=radio],[role=button],[role=tab]")].find((b) => b.textContent.trim() === "Light");
    el?.click();
  });
  await wait(600);
  check("Turning it off brings the old look back", (await token(page, "--primary")) === before && !(await page.$('[data-testid="eka-sparkles"]')), `${before} → ${await token(page, "--primary")}`);
  await page.close();

  const phone = await open(400);
  await phone.evaluateOnNewDocument(() => {
    const raw = localStorage.getItem("campus-schedule:appearance:v1");
    const a = raw ? JSON.parse(raw) : {};
    localStorage.setItem("campus-schedule:appearance:v1", JSON.stringify({ ...a, eka: true }));
  });
  await phone.goto(URL("/"), { waitUntil: "networkidle0" });
  await wait(800);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Fits a phone", overflow <= 1, `${overflow}px`);
  await phone.screenshot({ path: path.join(SHOTS, "4-phone.png") });
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
