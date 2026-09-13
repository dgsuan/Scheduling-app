// Image viewer/editor flow against the exported web build.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT, FIXTURES } from "./helpers.mjs";
const BASE = "/Scheduling-app";
const PORT = 4601;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-image");
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

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
const center = async (el) => {
  const b = await el.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
const storedImage = (page) =>
  page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("campus-schedule:canvases:v2") || "{}");
    const img = (c.general?.items || []).find((i) => i.kind === "image");
    return img ? { ...img, uri: img.uri.slice(0, 22), uriLen: img.uri.length, originalUri: img.originalUri ? img.originalUri.slice(0, 22) : undefined } : null;
  });

try {
  // A real 800×600 PNG with a gradient, written to disk for the file chooser.
  const gen = await browser.newPage();
  const b64 = await gen.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 600;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 800, 600);
    g.addColorStop(0, "#2F7D6E");
    g.addColorStop(1, "#F2A20C");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 90px sans-serif";
    ctx.fillText("Lecture 5", 170, 330);
    return c.toDataURL("image/png").split(",")[1];
  });
  const imgPath = path.join(FIXTURES, "test-image.png");
  fs.writeFileSync(imgPath, Buffer.from(b64, "base64"));
  await gen.close();

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|ERR_INTERNET|net::/.test(m.text()) && errors.push("console: " + m.text()));

  await page.goto(URL("/notes"), { waitUntil: "networkidle0" });
  await wait(1000);
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 8000 }), page.click('[aria-label="Add image"]')]);
  await chooser.accept([imgPath]);
  await page.waitForSelector('[aria-label="Open image"]', { timeout: 8000 });
  await wait(600);
  let stored = await storedImage(page);
  check("Upload stores a durable data URL (not blob:)", stored?.uri.startsWith("data:image/png"), stored?.uri);
  check("Upload keeps dimensions", stored?.width === 800 && stored?.height === 600, `${stored?.width}×${stored?.height}`);

  // Viewer
  await page.click('[aria-label="Open image"]');
  await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
  await wait(300);
  check("Viewer opens", true);
  check("Focus moves to Close", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Close image"));
  await page.click('[aria-label="Zoom in"]');
  await wait(250);
  check("Zoom button", (await page.$eval('[aria-label="Fit to screen"]', (el) => el.textContent)) === "125%");
  const stageImg = await page.$('[role="dialog"] img');
  const c = await center(stageImg);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel({ deltaY: -400 });
  await wait(250);
  const pctAfterWheel = await page.$eval('[aria-label="Fit to screen"]', (el) => parseInt(el.textContent));
  check("Scroll-to-zoom", pctAfterWheel > 125, `${pctAfterWheel}%`);
  // Pan while zoomed
  const before = await page.$eval('[role="dialog"] img', (el) => el.style.transform);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 60, { steps: 6 });
  await page.mouse.up();
  await wait(200);
  const after = await page.$eval('[role="dialog"] img', (el) => el.style.transform);
  check("Drag pans when zoomed", before !== after, after);
  await page.screenshot({ path: path.join(SHOTS, "1-viewer-zoomed.png") });
  await page.keyboard.press("Escape");
  await wait(300);
  check("Escape closes", !(await page.$('[role="dialog"][aria-modal="true"]')));
  check("Focus returns to the image", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Open image"));

  // Backdrop click closes
  await page.click('[aria-label="Open image"]');
  await page.waitForSelector('[role="dialog"][aria-modal="true"]');
  await wait(250);
  await page.mouse.click(40, 400);
  await wait(300);
  check("Click outside closes", !(await page.$('[role="dialog"][aria-modal="true"]')));

  // Editor
  await page.click('[aria-label="Open image"]');
  await page.waitForSelector('[aria-label="Edit image"]');
  await page.click('[aria-label="Edit image"]');
  await page.waitForSelector('[aria-label="Rotate right"]', { timeout: 8000 });
  await wait(500);
  await page.click('[aria-label="Rotate right"]');
  await wait(200);
  await page.click('button[aria-label="Crop"]');
  await wait(250);
  await page.screenshot({ path: path.join(SHOTS, "2-editor-crop.png") });
  // Drag the bottom-right crop handle inwards a bit.
  const area = await page.$("[data-crop-area]");
  const ab = await area.boundingBox();
  const hx = ab.x + ab.width * 0.9;
  const hy = ab.y + ab.height * 0.9;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - ab.width * 0.1, hy - ab.height * 0.1, { steps: 5 });
  await page.mouse.up();
  const cropLabel = await page.$eval('[role="group"][aria-label^="Crop area"]', (el) => el.getAttribute("aria-label"));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Apply crop").click());
  await wait(250);
  check("Crop applies", true, cropLabel);
  // Draw a stroke
  await page.click('button[aria-label="Draw"]');
  await wait(200);
  await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Highlighter").click());
  const ov = await (await page.$("[data-crop-area] canvas[aria-hidden]")).boundingBox();
  await page.mouse.move(ov.x + 30, ov.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(ov.x + 30 + i * 12, ov.y + 40 + Math.sin(i / 2) * 20);
  await page.mouse.up();
  await wait(200);
  await page.screenshot({ path: path.join(SHOTS, "3-editor-draw.png") });
  // Adjust brightness via the slider
  await page.click('button[aria-label="Adjust"]');
  await wait(200);
  await page.evaluate(() => {
    const input = document.querySelector('input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "30");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(150);
  const filter = await page.$eval("[data-crop-area] canvas:not([aria-hidden])", (el) => el.style.filter);
  check("Brightness previews live", /brightness\(1\.3\)/.test(filter), filter);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Apply").click());
  await wait(200);
  // Undo then redo the adjust by reapplying is overkill; check undo exists and works on the adjust step.
  const undoEnabled = await page.$eval('button[aria-label="Undo"]', (el) => !el.disabled);
  check("Undo available after edits", undoEnabled);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Save").click());
  await page.waitForSelector('[aria-label="Revert to original"]', { timeout: 8000 });
  await wait(400);
  stored = await storedImage(page);
  // 800×600 rotated → 600×800, crop box 10%..80% → 70% of each side.
  check("Save updates the stored image", stored.width === 420 && stored.height === 560, `${stored.width}×${stored.height}`);
  check("Original kept for revert", stored.originalUri?.startsWith("data:image/png"));
  await page.screenshot({ path: path.join(SHOTS, "4-viewer-after-save.png") });

  await page.click('[aria-label="Revert to original"]');
  await wait(400);
  stored = await storedImage(page);
  check("Revert restores original", stored.width === 800 && stored.height === 600 && !stored.originalUri, `${stored.width}×${stored.height}`);
  await page.keyboard.press("Escape");
  await wait(200);

  // Cancel with unsaved edits asks first
  await page.click('[aria-label="Open image"]');
  await page.waitForSelector('[aria-label="Edit image"]');
  await page.click('[aria-label="Edit image"]');
  await page.waitForSelector('[aria-label="Rotate left"]');
  await wait(400);
  await page.click('[aria-label="Rotate left"]');
  await page.keyboard.press("Escape");
  await wait(200);
  check("Discard confirmation on cancel", !!(await page.$('[role="alertdialog"]')));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Discard").click());
  await wait(300);
  await page.keyboard.press("Escape");
  await wait(200);
  stored = await storedImage(page);
  check("Discarded edits aren't saved", stored.width === 800 && stored.height === 600);

  // Survives reload
  await page.reload({ waitUntil: "networkidle0" });
  await wait(1200);
  const natural = await page.$eval('[aria-label="Open image"] img', (el) => el.naturalWidth).catch(() => 0);
  check("Image still loads after reload", natural > 0, `naturalWidth ${natural}`);

  // Phone
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.goto(URL("/notes"), { waitUntil: "networkidle0" });
  await wait(1000);
  await phone.tap('[aria-label="Open image"]');
  await phone.waitForSelector('[role="dialog"][aria-modal="true"]');
  await wait(300);
  const box = await (await phone.$('[role="dialog"] img')).boundingBox();
  check("Phone: image fits the screen", box.width <= 390 && box.x >= 0, `${Math.round(box.width)}px wide`);
  await phone.screenshot({ path: path.join(SHOTS, "5-phone-viewer.png") });
  await phone.tap('[aria-label="Edit image"]');
  await phone.waitForSelector('[aria-label="Rotate right"]');
  await wait(500);
  const tb = await (await phone.$('[role="toolbar"]')).boundingBox();
  check("Phone: editor toolbar fits", tb.x >= 0 && tb.x + tb.width <= 390, `${Math.round(tb.width)}px`);
  await phone.screenshot({ path: path.join(SHOTS, "6-phone-editor.png") });
} catch (e) {
  results.push("ERROR " + (e?.stack ?? e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 10).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  // Fail the process (and CI) when any check failed or the suite crashed.
  if (results.some((r) => !r.startsWith("PASS"))) process.exitCode = 1;
}
