// Public deadlines page (/deadlines?code=…), signed out. The database reply
// is faked by intercepting the RPC request, so this never touches a real
// backend. Clock pinned to Monday 2026-09-14.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

import { CHROME, DIST as ROOT, OUT } from "./helpers.mjs";

const BASE = "/Scheduling-app";
const PORT = 4630;
const URL = (p) => `http://localhost:${PORT}${BASE}${p}`;
const SHOTS = path.join(OUT, "shots-deadlines");
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

const SECTION = {
  name: "CMSC 21 T-3L",
  course_code: "CMSC 21",
  posts: [
    { title: "Lab report 3", due: "2026-09-15", due_time: "23:59" },
    { title: "Quiz 2", due: "2026-09-15", due_time: null },
    { title: "Project proposal", due: "2026-09-20", due_time: null },
  ],
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const results = [];
const errors = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page) => page.evaluate(() => document.body.innerText);

async function open(route, { width = 1280 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/fonts\.g|net::|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));
  const rpcBodies = [];
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    if (!/supabase\.co/.test(url)) return r.continue();
    if (r.method() === "OPTIONS") return r.respond({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (url.includes("/rest/v1/rpc/get_public_section")) {
      const body = JSON.parse(r.postData() || "{}");
      rpcBodies.push(body);
      const reply = body.p_code === "ABCDEFGH23" ? SECTION : null;
      return r.respond({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(reply) });
    }
    return r.abort();
  });
  await page.evaluateOnNewDocument(() => {
    const fixed = new Date("2026-09-14T09:00:00").getTime();
    const RealDate = Date;
    const start = RealDate.now();
    class FakeDate extends RealDate {
      constructor(...a) {
        if (a.length === 0) super(fixed + (RealDate.now() - start));
        else super(...a);
      }
      static now() {
        return fixed + (RealDate.now() - start);
      }
    }
    // eslint-disable-next-line no-global-assign
    Date = FakeDate;
  });
  await page.goto(URL(route), { waitUntil: "networkidle0" });
  await wait(900);
  return { page, rpcBodies };
}

try {
  if (!KEYED) {
    const { page } = await open("/deadlines?code=ABCDE-FGH23");
    check("Keyless build explains the page needs sections", (await text(page)).includes("isn't connected to class sections"));
    await page.close();
  } else {
    let { page, rpcBodies } = await open("/deadlines?code=abcde-fgh23");
    let t = await text(page);
    check("Code is cleaned before asking the database", rpcBodies[0]?.p_code === "ABCDEFGH23", JSON.stringify(rpcBodies[0]));
    check("Section name and course shown", t.includes("CMSC 21 T-3L") && t.includes("Class deadlines"));
    check("Deadlines grouped by day, soonest first", t.indexOf("Lab report 3") < t.indexOf("Project proposal") && t.includes("Tomorrow"));
    check("Due times shown, untimed as end of day", t.includes("11:59 PM") && t.includes("End of day"));
    check("No private details on the page", !/invite|member|note/i.test(t.replace("It shows titles and due dates only.", "")), "");
    await page.screenshot({ path: path.join(SHOTS, "1-public-deadlines.png") });
    await page.close();

    ({ page } = await open("/deadlines?code=ZZZZZZZZZZ"));
    check("Stopped link explains itself", (await text(page)).includes("doesn't work anymore"));
    await page.close();

    ({ page, rpcBodies } = await open("/deadlines?code=bad"));
    check("Malformed code never reaches the database", rpcBodies.length === 0 && (await text(page)).includes("doesn't work anymore"));
    await page.close();

    ({ page } = await open("/deadlines?code=ABCDEFGH23", { width: 400 }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("Fits a phone", overflow <= 1, `${overflow}px`);
    await page.screenshot({ path: path.join(SHOTS, "2-phone.png") });
    await page.close();
  }
} catch (e) {
  results.push("ERROR " + (e?.stack ?? e));
} finally {
  console.log(results.join("\n"));
  console.log(errors.length ? "\nBrowser errors:\n" + [...new Set(errors)].slice(0, 12).join("\n") : "\nNo browser errors.");
  await browser.close();
  server.close();
  if (results.some((r) => !r.startsWith("PASS")) || errors.length) process.exitCode = 1;
}
