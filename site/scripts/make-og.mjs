#!/usr/bin/env node
// The social card, 1200x630: the mark and the site title on the canvas. npm run og
// Needs the Playwright headless Chrome. Chrome writes a PNG with no text chunks; `npm run check` verifies that.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "public/og");
mkdirSync(OUT, { recursive: true });
const caches = join(homedir(), "Library/Caches/ms-playwright");
const shells = existsSync(caches) ? readdirSync(caches).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse() : [];
const chrome = shells.map((n) => join(caches, n, "chrome-headless-shell-mac-arm64/chrome-headless-shell")).find(existsSync);
if (!chrome) { console.error("No headless Chrome found under ~/Library/Caches/ms-playwright"); process.exit(1); }
const mark = readFileSync(join(ROOT, "public/logo/logo-mark-dark-color.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
const font = `file://${join(ROOT, "src/assets/fonts/inter-latin-wght-normal.woff2")}`;
// Colors and sizes are the design tokens: canvas, text-primary, neutral-400, border-default.
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;font-weight:100 900;src:url("${font}") format("woff2")}
html,body{margin:0;width:1200px;height:630px;background:#0B0F14;color:#F5F7FA;font-family:Inter,sans-serif}
.w{box-sizing:border-box;width:1200px;height:630px;padding:72px;display:flex;flex-direction:column;justify-content:space-between;border-bottom:1px solid #1F2630}
.m svg{height:96px;width:auto}.t{font-weight:700;font-size:64px;line-height:72px;letter-spacing:-0.015em;max-width:1000px}
.k{font-size:20px;letter-spacing:0.02em;text-transform:uppercase;color:#A3A9B2;margin-bottom:24px;font-weight:500}.u{font-size:24px;color:#A3A9B2}
</style><div class="w"><div class="m">${mark}</div><div><div class="k">Documentation</div><div class="t">The AgentsOfMine collector, documented</div></div><div class="u">agentsofmine.github.io/collector</div></div>`;
const tmp = join(tmpdir(), "og-docs.html"); writeFileSync(tmp, html);
execFileSync(chrome, ["--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--window-size=1200,630", `--screenshot=${join(OUT, "default.png")}`, `file://${tmp}`], { stdio: "ignore" });
console.log("wrote public/og/default.png");
