// Exported-app integration: persistence, task completion, mobile layout,
// unsupported/denied PiP, and portal lifecycle with a controlled window.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { CHROME, DIST, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const server = http.createServer((req, res) => {
  const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(BASE, "");
  let file = path.join(DIST, requested);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".webmanifest": "application/manifest+json" };
  res.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}${BASE}/sticky`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.error("Browser error:", e.message); });
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluateOnNewDocument(() => {
    // Explicit unsupported-browser branch, independent of CI browser version.
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: undefined });
    if (!sessionStorage.getItem("sticky-seeded")) {
      sessionStorage.setItem("sticky-seeded", "1");
      localStorage.setItem("campus-schedule:canvases:v2", JSON.stringify({ general: { items: [{ id: "n1", kind: "text", text: "Bring lab coat", color: "#FFF7C2", x: 40, y: 40 }], drawings: [] } }));
      localStorage.setItem("campus-schedule:tasks:v1", JSON.stringify([{ id: "t1", title: "Submit lab report", priority: "high", done: false, due: "2026-01-01", createdAt: 1 }]));
    }
  });
  await page.goto(url);
  await page.waitForSelector('textarea[aria-label="Note text"]');
  assert.equal(await page.$eval("textarea", (e) => e.value), "Bring lab coat");
  assert.equal(await page.evaluate(() => document.body.innerText.includes("Float on desktop")), false);
  await page.focus("textarea");
  await page.$eval("textarea", (e) => e.setSelectionRange(e.value.length, e.value.length));
  await page.type("textarea", " and goggles");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items[0].text === "Bring lab coat and goggles");
  await page.click('input[type="checkbox"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("campus-schedule:tasks:v1"))[0].done);
  await page.reload();
  await page.waitForSelector("textarea");
  assert.equal(await page.$eval("textarea", (e) => e.value), "Bring lab coat and goggles");
  assert.equal(await page.$('input[type="checkbox"]'), null);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: path.join(OUT, "sticky-mobile.png") });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "New note").click());
  await page.waitForFunction(() => document.querySelector("textarea").value === "");
  await page.type("textarea", "Study reminder");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items.length === 2);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items[1].text === "Study reminder");
  await page.reload();
  await page.waitForSelector("textarea");
  assert.equal(await page.$eval("textarea", (e) => e.value), "Study reminder", "selection persists");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.setOfflineMode(true);
  await page.reload();
  await page.waitForSelector("textarea");
  assert.equal(await page.$eval("textarea", (e) => e.value), "Study reminder", "compact view works offline");
  await page.setOfflineMode(false);

  // Mock only the browser API boundary; rendering and persistence use the real app.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: {
      requestWindow: async () => {
        if (sessionStorage.getItem("deny-pip")) throw new Error("denied");
        const popup = window.open("about:blank", "sticky-test", "width=380,height=620");
        window.__stickyTestWindow = popup;
        return popup;
      },
    } });
  });
  await page.setViewport({ width: 1280, height: 900 });
  await page.reload();
  await page.waitForSelector("button.primary");
  const popupPromise = new Promise((resolve) => page.once("popup", resolve));
  await page.click("button.primary");
  const popup = await popupPromise;
  await popup.waitForSelector("textarea");
  await popup.focus("textarea");
  await popup.$eval("textarea", (e) => e.setSelectionRange(e.value.length, e.value.length));
  await popup.type("textarea", " tonight");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("campus-schedule:canvases:v2")).general.items[1].text === "Study reminder tonight");
  await popup.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await popup.close();
  await page.waitForSelector("textarea");
  assert.equal(await page.$eval("textarea", (e) => e.value), "Study reminder tonight", "docking retains edits");
  await page.evaluate(() => sessionStorage.setItem("deny-pip", "1"));
  await page.click("button.primary");
  await page.waitForFunction(() => document.body.innerText.includes("Couldn't open a floating window"));
  assert.ok(await page.$("textarea"), "failed PiP keeps compact view usable");
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.shortcuts[0].url, "./sticky");
  assert.deepEqual(errors, []);
  console.log("PASS sticky: save/reload, selection, new note, task completion, mobile layout, unsupported/denied floating, portal editing/docking, manifest shortcut");

  const real = await browser.newPage();
  await real.goto(url);
  await real.waitForSelector("textarea");
  if (await real.$("button.primary")) {
    await real.click("button.primary");
    await real.waitForFunction(() => document.body.innerText.includes("Sticky view is floating") || document.body.innerText.includes("Couldn't open a floating window"));
    const floating = await real.evaluate(() => !!window.documentPictureInPicture?.window?.document.querySelector("textarea"));
    if (floating) {
      await real.evaluate(() => window.documentPictureInPicture.window.close());
      await real.waitForSelector("textarea");
      console.log("PASS real browser Document Picture-in-Picture open and close");
    } else console.log("SKIP real floating window: headless browser rejected it; controlled API lifecycle tested above");
  } else console.log("SKIP real floating window: browser API unavailable; compact fallback tested above");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
