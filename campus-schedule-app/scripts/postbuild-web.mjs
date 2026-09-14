// Post-processes the exported web build's index.html. Expo generates the
// single-page HTML itself (there is no template to edit), so this adds:
//  • the PWA manifest, icons and theme-color
//  • an inline script that applies the saved theme before the bundle loads,
//    avoiding a flash of the default colors on every reload
//
// Usage: node scripts/postbuild-web.mjs [distDir]   (default: dist)

import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(process.argv[2] ?? "dist");
const file = path.join(dist, "index.html");
const MARKER = "<!-- campus-schedule:head -->";

let html = fs.readFileSync(file, "utf8");
if (html.includes(MARKER)) {
  console.log("postbuild-web: already processed");
  process.exit(0);
}

// Asset URLs in the build are absolute to the base path (e.g. /Scheduling-app/).
const base = (html.match(/href="([^"]*?)favicon\.ico"/) ?? [, "/"])[1];

// Keep in sync with THEME_SNAPSHOT_KEY in constants/theme.ts.
const prepaint = `(function(){try{var s=JSON.parse(localStorage.getItem("campus-schedule-cache:theme")||"null");if(!s||!s.tokens)return;var r=document.documentElement;for(var k in s.tokens)r.style.setProperty(k,s.tokens[k]);r.style.setProperty("--font-sans",s.fontSans);r.style.setProperty("--font-display",s.fontDisplay);r.style.colorScheme=s.dark?"dark":"light";r.style.backgroundColor=s.bg;if(s.dark)r.classList.add("dark");var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=s.bg;document.addEventListener("DOMContentLoaded",function(){var b=document.body;b.style.backgroundColor=s.bg;if(s.scale&&s.scale!==1){b.style.zoom=s.scale;b.style.width="calc(100% / "+s.scale+")";b.style.height="calc(100% / "+s.scale+")";}});}catch(e){}})();`;

const head = [
  MARKER,
  `<meta name="theme-color" content="#F7F6F3" />`,
  `<link rel="manifest" href="${base}manifest.webmanifest" />`,
  `<link rel="apple-touch-icon" href="${base}icons/icon-192.png" />`,
  `<meta name="apple-mobile-web-app-capable" content="yes" />`,
  `<meta name="mobile-web-app-capable" content="yes" />`,
  `<meta name="apple-mobile-web-app-title" content="Isked" />`,
  `<script>${prepaint}</script>`,
].join("\n    ");

// Set the tab title, and insert right after <title> so the theme is applied before stylesheets paint.
html = html.replace(/<title>[^<]*<\/title>/, `<title>Isked</title>\n    ${head}`);
fs.writeFileSync(file, html);
console.log(`postbuild-web: injected manifest + pre-paint theme into ${path.relative(process.cwd(), file)}`);
