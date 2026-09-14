// Renders the Isked wordmark into every app icon: the word "isked" in
// Fraunces (the app's heading font), chalk on a deep teal tile, with the i's
// dot in warm ochre. Headless Chrome draws it so the type is exact.
//   node scripts/gen-icons.mjs        (needs Chrome and an internet connection for the font)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEAL = "#28716A";
const TEAL_LIGHT = "#33877E";
const TEAL_DEEP = "#1D5550";
const CHALK = "#F6F3EA";
const OCHRE = "#E7A93C";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("Chrome not found. Set CHROME_PATH.");

/**
 * size: output px · word: "isked" or "i" · width: share of the tile the word spans
 * tile: "rounded" | "square" | "none" · ink: letter color
 */
const ICONS = [
  { out: "public/icons/icon-192.png", size: 192, word: "isked", width: 0.74, tile: "rounded" },
  { out: "public/icons/icon-512.png", size: 512, word: "isked", width: 0.74, tile: "rounded" },
  // Maskable: full bleed, word inside the central 80% safe zone.
  { out: "public/icons/maskable-512.png", size: 512, word: "isked", width: 0.6, tile: "square" },
  // Native app icon (iOS/Android round the corners themselves).
  { out: "assets/icon.png", size: 1024, word: "isked", width: 0.72, tile: "square" },
  // Android adaptive icon: foreground within the 66% safe zone, plain background.
  { out: "assets/android-icon-foreground.png", size: 432, word: "isked", width: 0.52, tile: "none" },
  { out: "assets/android-icon-background.png", size: 432, word: "", width: 0, tile: "square" },
  { out: "assets/android-icon-monochrome.png", size: 432, word: "isked", width: 0.52, tile: "none", ink: "#FFFFFF", dot: "#FFFFFF" },
  // Splash: teal word on the app's light background.
  { out: "assets/splash-icon.png", size: 1024, word: "isked", width: 0.8, tile: "none", ink: TEAL, dot: OCHRE },
  // Favicon: a whole word is unreadable at 16px, so just the dotted i.
  // (sized by height: from the top of the dot to the baseline)
  { out: "assets/favicon.png", size: 48, word: "i", height: 0.64, tile: "rounded" },
  // Sidebar wordmark (12:5, tall enough for the k and d ascenders), one per theme.
  { out: "assets/wordmark-light.png", size: 360, h: 150, word: "isked", width: 0.86, tile: "none", ink: "#1C2624" },
  { out: "assets/wordmark-dark.png", size: 360, h: 150, word: "isked", width: 0.86, tile: "none", ink: "#EFEBE2" },
];

/** Fraunces @font-face rules with the font files inlined, so rendering never waits on the network. */
async function inlineFontCss() {
  const cssUrl = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=block";
  // A modern browser user agent makes Google Fonts serve woff2.
  const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" };
  const css = await (await fetch(cssUrl, { headers: ua })).text();
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]))];
  if (!urls.length) throw new Error("Couldn't get the Fraunces font from Google Fonts.");
  let inlined = css;
  for (const url of urls) {
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    inlined = inlined.replaceAll(url, `data:font/woff2;base64,${bytes.toString("base64")}`);
  }
  return inlined;
}

const FONT_CSS = await inlineFontCss();

const page = (icon) => `<!doctype html>
<html><head>
<style>${FONT_CSS}</style>
<style>
  html, body { margin: 0; background: transparent; }
  .tile {
    position: relative; width: ${icon.size}px; height: ${icon.h ?? icon.size}px; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    border-radius: ${icon.tile === "rounded" ? icon.size * 0.225 : 0}px;
    background: ${
      icon.tile === "none"
        ? "transparent"
        : `radial-gradient(120% 95% at 28% 12%, ${TEAL_LIGHT} 0%, ${TEAL} 48%, ${TEAL_DEEP} 100%)`
    };
  }
  .word {
    font-family: "Fraunces", Georgia, serif; font-weight: 600;
    font-variation-settings: "opsz" 144; letter-spacing: -0.035em;
    color: ${icon.ink ?? CHALK}; line-height: 1; white-space: nowrap;
  }
  .base { display: inline-block; width: 0; height: 0; }
  .dot { position: absolute; border-radius: 50%; background: ${icon.dot ?? OCHRE}; }
</style></head>
<body><div class="tile">${icon.word ? `<span class="word"><span class="i">ı</span>${icon.word.slice(1)}<span class="base"></span></span><span class="dot"></span>` : ""}</div></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
try {
  const tab = await browser.newPage();
  for (const icon of ICONS) {
    await tab.setViewport({ width: icon.size, height: icon.h ?? icon.size, deviceScaleFactor: 1 });
    await tab.setContent(page(icon), { waitUntil: "load" });
    const placed = await tab.evaluate(
      async ({ size, tileHeight, width, height, word }) => {
        await document.fonts.ready;
        if (!word) return true;
        if (!document.fonts.check('600 100px "Fraunces"')) return false;
        const wordEl = document.querySelector(".word");
        const ctx = document.createElement("canvas").getContext("2d");
        const metrics = (px) => {
          ctx.font = `600 ${px}px Fraunces`;
          return { xHeight: ctx.measureText("x").actualBoundingBoxAscent, stemRight: ctx.measureText("ı").actualBoundingBoxRight };
        };
        // Dot proportions, as a share of the font size.
        const STEM = 0.088; // thickness of the i's upright stroke
        const RADIUS = 0.066;
        const GAP = 0.085; // space between the stem's top and the dot

        // Size: the word spans `width` of the tile, or the dotted i fills `height` of it.
        wordEl.style.fontSize = "100px";
        let fontSize;
        if (height) {
          const m = metrics(100);
          fontSize = (100 * size * height) / (m.xHeight + (GAP + 2 * RADIUS) * 100);
        } else {
          fontSize = (100 * size * width) / wordEl.getBoundingClientRect().width;
        }
        wordEl.style.fontSize = `${fontSize}px`;

        // The dot sits centered over the stem (the serif only extends left of it).
        const { xHeight, stemRight } = metrics(fontSize);
        const tile = document.querySelector(".tile").getBoundingClientRect();
        const iRect = document.querySelector(".i").getBoundingClientRect();
        const baseline = document.querySelector(".base").getBoundingClientRect().bottom - tile.top;
        const radius = fontSize * RADIUS;
        const cx = iRect.left - tile.left + stemRight - (fontSize * STEM) / 2;
        const cy = baseline - xHeight - fontSize * GAP - radius;

        // Center the whole shape (dot top to baseline) vertically in the tile.
        const shift = tileHeight / 2 - (cy - radius + baseline) / 2;
        wordEl.style.transform = `translateY(${shift}px)`;
        Object.assign(document.querySelector(".dot").style, {
          width: `${radius * 2}px`,
          height: `${radius * 2}px`,
          left: `${cx - radius}px`,
          top: `${cy - radius + shift}px`,
        });
        return true;
      },
      { size: icon.size, tileHeight: icon.h ?? icon.size, width: icon.width ?? 0, height: icon.height ?? 0, word: icon.word }
    );
    if (!placed) throw new Error("Fraunces didn't load — check your internet connection and try again.");
    const target = path.join(APP, icon.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await (await tab.$(".tile")).screenshot({ path: target, omitBackground: true });
    console.log(`gen-icons: ${icon.out} (${icon.size}px)`);
  }
} finally {
  await browser.close();
}
