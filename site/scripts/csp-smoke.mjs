#!/usr/bin/env node
// Serves ./dist with the exact Content-Security-Policy from security-headers.json and loads every page in
// a real headless Chrome. Fails on any CSP violation, any failed request, or any page that makes a request
// outside localhost. The unit tests in infra/ prove the policy is strict; this proves the site still works under it.
//   npm run csp        (after npm run build)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const BASE = "/collector";
// GitHub Pages cannot send headers, so the policy is the <meta> tag in the page; the test serves NO header and reads the page.
const H = {};
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };

const pages = [];
const walk = (d) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : p.endsWith("index.html") && pages.push(BASE + "/" + p.slice(DIST.length + 1).replace(/index\.html$/, "")); });
walk(DIST);

const server = createServer((req, res) => {
  const raw = decodeURIComponent(req.url.split("?")[0]);
  if (!raw.startsWith(BASE + "/")) { res.writeHead(404); return res.end("outside the base path"); }
  const u = raw.slice(BASE.length);
  let f = join(DIST, u.endsWith("/") ? u + "index.html" : u);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(4401, "127.0.0.1", r));

const caches = join(homedir(), "Library/Caches/ms-playwright");
const shells = readdirSync(caches).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse();
const chrome = shells.map((n) => join(caches, n, "chrome-headless-shell-mac-arm64/chrome-headless-shell")).find(existsSync);
if (!chrome) { console.error("No headless Chrome under ~/Library/Caches/ms-playwright"); process.exit(1); }

let failures = 0;
if (pages.length === 0) { console.error("FAILED: no pages found in dist/. Run the build first; a test that checked nothing has not passed."); server.close(); process.exit(1); }
for (const p of pages) {
  const out = await new Promise((done) => {
    const c = spawn(chrome, ["--disable-gpu", "--no-sandbox", "--enable-logging=stderr", "--v=0", "--virtual-time-budget=4000", "--dump-dom", `http://127.0.0.1:4401${p}`], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "", dom = "";
    c.stdout.on("data", (d) => (dom += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", () => done({ err, dom }));
  });
  const bad = out.err.split("\n").filter((l) => /Content Security Policy|Refused to|violates the following|ERR_BLOCKED|net::ERR|Failed to load resource/i.test(l));
  // What the page LOADS: src attributes and <link> hrefs. A plain <a href> to another site is a link the reader
  // may follow, not a request the page makes, so it is not counted here.
  const loads = [...out.dom.matchAll(/<(?:img|script|iframe|source|video|audio|embed)\b[^>]*\bsrc="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
    .concat([...out.dom.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((t) => /\brel="[^"]*\b(stylesheet|preload|prefetch|preconnect|dns-prefetch|icon|apple-touch-icon|manifest|modulepreload)\b/i.test(t)).map((t) => t.match(/\bhref="(https?:\/\/[^"]+)"/)?.[1]).filter(Boolean));
  const remote = loads.filter((u) => !/^https?:\/\/127\.0\.0\.1/.test(u));
  const ok = out.dom.includes("<h1") && bad.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p}${bad.length ? "\n      " + bad.slice(0, 3).join("\n      ") : ""}${out.dom.includes("<h1") ? "" : "\n      no <h1> rendered"}${remote.length ? "\n      loads remote: " + remote.join(", ") : ""}`);
  if (remote.length) failures++;
}
server.close();
console.log(failures ? `\nFAILED: ${failures} page(s) break under the CSP` : `\nok: ${pages.length} pages load under the production CSP with no violation`);
process.exit(failures ? 1 : 0);
