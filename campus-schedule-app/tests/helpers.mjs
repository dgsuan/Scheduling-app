// Shared paths for the browser suites. They drive the exported web build
// (`npm run export:web` → dist/) in headless Chrome.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DIST = path.resolve(HERE, "..", "dist");
export const FIXTURES = path.join(HERE, "fixtures");
/** Screenshots and downloads (gitignored). */
export const OUT = path.join(HERE, ".output");

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export const CHROME = CANDIDATES.find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error("Chrome not found. Set CHROME_PATH to your Chrome/Chromium executable.");
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("No web build found. Run `npm run export:web` first.");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
