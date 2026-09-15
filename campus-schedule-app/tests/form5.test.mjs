// Form 5 PDF upload end to end: Chrome prints a Form 5-style table to a real
// PDF, the test uploads it on Import, and the classes should come out with
// their times and rooms. (Needs internet: the PDF reader loads from its CDN.)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4650;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-form5");
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

const FORM5_HTML = `<!doctype html><html><body style="font-family: Arial, sans-serif; font-size: 11px; margin: 32px">
  <h2 style="font-size:14px">University of the Philippines · Form 5 (Certificate of Registration)</h2>
  <p>Student: JUAN DELA CRUZ · 1st Semester AY 2026-2027</p>
  <table style="border-collapse: collapse; width: 100%">
    <tr>${["Class Code", "Class", "Units", "Schedule", "Room", "Instructor"].map((h) => `<th style="text-align:left;padding:6px 10px">${h}</th>`).join("")}</tr>
    ${[
      ["54321", "CMSC 21 T-3L", "3.0", "TTh 10:00AM-11:30AM", "AECH Accenture Rm", "DELA CRUZ, J"],
      ["54323", "MATH 21 THY2", "4.0", "MWF 7:00AM-8:00AM", "MB 101", "SANTOS, A"],
      ["55555", "STS 1 WFX", "3.0", "TTh 1:00PM-2:30PM", "CSSP AVR", "REYES, M"],
    ]
      .map((r) => `<tr>${r.map((c) => `<td style="padding:6px 10px">${c}</td>`).join("")}</tr>`)
      .join("")}
  </table>
  <p>Total units: 10.0</p>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);

try {
  // 1. Make a real PDF.
  const pdfPath = path.join(OUT, "form5-sample.pdf");
  const maker = await browser.newPage();
  await maker.setContent(FORM5_HTML, { waitUntil: "load" });
  await maker.pdf({ path: pdfPath, format: "A4", landscape: true });
  await maker.close();
  const notPdf = path.join(OUT, "not-a-form.pdf");
  const blank = await browser.newPage();
  await blank.setContent("<html><body><svg width='200' height='100'><rect width='200' height='100' fill='teal'/></svg></body></html>");
  await blank.pdf({ path: notPdf, width: "300px", height: "200px" });
  await blank.close();

  // 2. Upload it on Import.
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  await page.setRequestInterception(true);
  page.on("request", (r) => (/supabase\.co/.test(r.url()) ? r.abort() : r.continue()));
  await page.goto(URL("/import"), { waitUntil: "networkidle0" });
  await wait(700);

  const upload = async (file) => {
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 8000 }),
      page.evaluate(() => {
        const btn = [...document.querySelectorAll("[role=button],button")].find((b) => b.textContent.includes("Upload Form 5 (PDF)"));
        btn?.click();
      }),
    ]);
    await chooser.accept([file]);
  };

  await upload(pdfPath);
  await page.waitForFunction(() => /Found \d+ class|No classes found|Couldn't|isn't|no readable text/.test(document.body.innerText), { timeout: 30000 });
  await wait(300);
  const t = await text(page);
  check("Form 5 PDF finds all three classes", t.includes("Found 3 classes"), (t.match(/Found \d+ class\w*|No classes found[^\n]*|Couldn't[^\n]*/) || [""])[0]);
  check("Sections, times and rooms are read", t.includes("CMSC 21 (T-3L)") && t.includes("AECH Accenture Rm") && t.includes("MB 101") && t.includes("CSSP AVR"));
  check("Instructor names don't end up as rooms", !/Rm · DELA|101 · SANTOS|AVR · REYES|Accenture Rm DELA/.test(t));
  check("The PDF's text is shown so it can be fixed", t.includes("Read from form5-sample.pdf"));
  const box = await page.$eval('[aria-label="Pasted CRS schedule"]', (el) => el.value);
  if (!t.includes("Found 3 classes")) console.log("--- extracted text ---\n" + box + "\n--- page ---\n" + t.slice(t.indexOf("Found"), t.indexOf("Found") + 800));
  check("Extracted text is in the paste box", box.includes("CMSC 21") && box.includes("TTh 10:00AM-11:30AM"), box.split("\n").slice(0, 3).join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "1-form5-read.png") });

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("[role=button],button")].find((b) => b.textContent.trim() === "Add 3 to Courses");
    btn?.click();
  });
  await wait(500);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("campus-schedule:courses:v1") ?? "[]"));
  const sts = stored.find((c) => c.code === "STS 1");
  check("Adding saves the courses", stored.some((c) => c.code === "MATH 21") && sts?.meetings?.[0]?.start === "13:00" && sts?.meetings?.[0]?.room === "CSSP AVR", JSON.stringify(sts?.meetings));

  // 3. A PDF without text explains what to do.
  await upload(notPdf);
  await page.waitForFunction(() => /no readable text/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  check("A PDF without text says to paste instead", (await text(page)).includes("no readable text"));
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
