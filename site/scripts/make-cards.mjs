#!/usr/bin/env node
// Post pictures: one 1200x676 card and one 640x360 thumbnail per published post, drawn from src/lib/card-specs.mjs.
//   npm run cards     (needs the Playwright headless shell, like make-og.mjs)
// Writes public/cards/<slug>.png and public/cards/<slug>-thumb.png. Chrome writes a PNG with no text chunks;
// `npm run check` verifies that. Read DESIGN.md "Post image (the card)" before changing anything here.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CARDS, SAMPLES } from "../src/lib/card-specs.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const samplesDir = process.argv[2] === "--samples" ? resolve(process.argv[3] ?? ".") : null;
const OUT = samplesDir ?? join(ROOT, "public/cards");

mkdirSync(OUT, { recursive: true });
const caches = join(homedir(), "Library/Caches/ms-playwright");
const shells = existsSync(caches) ? readdirSync(caches).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse() : [];
const chrome = shells.map((n) => join(caches, n, "chrome-headless-shell-mac-arm64/chrome-headless-shell")).find(existsSync);
if (!chrome) { console.error("No headless Chrome found under ~/Library/Caches/ms-playwright"); process.exit(1); }

// Every color comes from the blog's stylesheet, so a token change shows up here and a stray hex cannot.
const css = readFileSync(join(ROOT, "src/styles/global.css"), "utf8");
const tok = (name) => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token --color-${name} not found in global.css`);
  return m[1];
};
const C = {
  canvas: tok("bg-canvas"), card: tok("bg-card"), border: tok("border-default"), ink7: tok("ink-700"), ink9: tok("ink-900"),
  n4: tok("neutral-400"), n6: tok("neutral-600"), text: tok("text-primary"), blue: tok("brand-blue-500"),
  purple: tok("accent-purple"), purpleM: tok("accent-purple-muted"), ok: tok("success-700"), bad: tok("danger-700"),
};
const color = { blue: C.blue, purple: C.purpleM, n4: C.n4, n6: C.n6, text: C.text, ok: C.ok, bad: C.bad };
let ACC = C.blue; // set per card from spec.accent
const ACCENTS = { blue: C.blue, purple: C.purpleM }; // never green or red: those two colors always mean good and bad
const tone = (t) => (t === "ok" ? C.ok : t === "bad" ? C.bad : t === "purple" ? C.purpleM : C.n4);

const font = `file://${join(ROOT, "src/assets/fonts/inter-latin-wght-normal.woff2")}`;
const mono = `file://${join(ROOT, "src/assets/fonts/jetbrains-mono-latin-wght-normal.woff2")}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ICON = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
};
const icon = (n, s) => `<svg style="flex:none" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${ACC}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
const arrowH = (x1, y, x2, col = C.n6, dash = false) =>
  `<line x1="${x1}" y1="${y}" x2="${x2 - 14}" y2="${y}" stroke="${col}" stroke-width="3"${dash ? ' stroke-dasharray="9 9"' : ""}/><path d="M${x2} ${y} L${x2 - 16} ${y - 9} L${x2 - 16} ${y + 9} Z" fill="${col}"/>`;
const arrowV = (x, y1, y2, col, dash) =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 14}" stroke="${col}" stroke-width="3"${dash ? ' stroke-dasharray="9 9"' : ""}/><path d="M${x} ${y2} L${x - 9} ${y2 - 16} L${x + 9} ${y2 - 16} Z" fill="${col}"/>`;
const dots = () => `<div class="dots"><i style="background:${ACC}"></i><i style="background:${C.purple}"></i><i style="background:${C.n4}"></i></div>`;
const tag = (label, t, extra = "") => `<span class="tag" style="color:${tone(t)};border-color:${tone(t)};${extra}">${esc(label)}</span>`;

// ----- large card: scenes are drawn in a 1056 x 520 box ------------------------------------------------------------
const big = {
  tree(s) {
    const lines = s.tree.map((l) => (l.gap ? '<div style="height:22px"></div>' : `<div style="color:${color[l.c]};white-space:pre;display:flex;justify-content:space-between;align-items:center;gap:16px">${esc(l.t)}${l.tag ? tag(l.tag[0], l.tag[1]) : ""}</div>`)).join("");
    const ys = [100, 250, 400].slice(0, s.targets.length);
    const tiles = ys.map((y) => `<div class="p" style="left:700px;top:${y - 60}px;width:120px;height:120px;display:flex;align-items:center;justify-content:center">${icon("folder", 64)}</div>`).join("");
    const labels = ys.map((y, i) => `<div class="lab" style="left:848px;top:${y - 20}px;white-space:nowrap">${esc(s.targets[i])}</div>`).join("");
    const lines2 = `<line x1="560" y1="250" x2="630" y2="250" stroke="${C.n6}" stroke-width="3"/><line x1="630" y1="${ys[0]}" x2="630" y2="${ys[ys.length - 1]}" stroke="${C.n6}" stroke-width="3"/>` + ys.map((y) => `<line x1="630" y1="${y}" x2="700" y2="${y}" stroke="${C.n6}" stroke-width="3"/>`).join("");
    return `<div class="p mono" style="left:0;top:30px;width:560px;height:420px;padding:28px 30px;font-size:27px;line-height:50px">${dots()}${lines}</div>${tiles}${labels}<svg class="ov">${lines2}</svg>`;
  },
  compare(s) {
    const panel = (x, p) => `<div class="p" style="left:${x}px;top:130px;width:480px;height:350px;padding:28px 30px"><div class="mono" style="font-size:27px;font-weight:600;white-space:nowrap">${esc(p.name)}</div><div style="height:26px"></div>${p.bars.map((w) => `<div style="height:16px;border-radius:8px;background:${p.tone === "ok" ? ACC : C.ink7};width:${w}%;margin-bottom:16px"></div>`).join("")}<div style="position:absolute;left:30px;bottom:26px"><div style="font-size:22px;color:${C.n4}">${esc(p.label)}</div><div style="font-size:46px;font-weight:700;color:${tone(p.tone)};line-height:54px">${esc(p.value)}</div><div class="mono" style="font-size:22px;color:${C.n6}">${esc(p.sub)}</div></div></div>`;
    const pill = (x, w, [t, k]) => `<div class="pill" style="left:${x}px;top:0;width:${w}px;height:62px;color:${tone(k)};border-color:${k === "n4" ? C.n6 : tone(k)}">${esc(t)}</div>`;
    const [p1, p2] = s.pills ?? [];
    return (p1 ? pill(0, 480, p1) : "") + (p2 ? pill(576, 480, p2) : "") + panel(0, s.left) + panel(576, s.right) + (p1 && s.arrow ? `<svg class="ov">${arrowV(240, 62, 130, tone(s.left.tone), true)}</svg>` : "");
  },
  flow(s) {
    const n = s.sources.length, h = n === 3 ? 130 : 170, gap = n === 3 ? 32 : 80, top = (520 - (n * h + (n - 1) * gap)) / 2;
    const ys = s.sources.map((_, i) => top + i * (h + gap));
    const src = s.sources.map((q, i) => `<div class="p" style="left:0;top:${ys[i]}px;width:360px;height:${h}px;display:flex;align-items:center;gap:22px;padding:0 26px">${icon(q.icon, 60)}<div class="mono" style="font-size:25px;white-space:nowrap">${esc(q.name)}</div></div>`).join("");
    const cmd = s.sources.map((q, i) => (q.cmd ? `<div class="mono" style="position:absolute;left:390px;top:${ys[i] + h / 2 - 50}px;width:220px;text-align:center;font-size:23px;color:${C.n4};white-space:nowrap">${esc(q.cmd)}</div>` : "")).join("");
    const arrows = ys.map((y) => arrowH(376, y + h / 2, 640)).join("");
    const dest = `<div class="p" style="left:650px;top:40px;width:390px;height:430px;padding:36px 32px">${icon(s.dest.icon ?? "folder", 92)}<div class="mono" style="font-size:25px;font-weight:600;margin-top:20px;white-space:nowrap">${esc(s.dest.name)}</div><div class="mono" style="font-size:22px;color:${C.n4};line-height:42px;margin-top:20px;white-space:pre">${s.dest.lines.map(esc).join("\n")}</div></div>`;
    return `${src}${cmd}${dest}<svg class="ov">${arrows}</svg>`;
  },
  list(s) {
    const rows = s.rows.map((r) => `<div style="display:flex;align-items:center;justify-content:space-between;height:${s.rows.length > 4 ? 60 : 76}px"><div style="white-space:nowrap"><span style="color:${C.n6}">${esc(r.k)}</span>${r.v ? `<span style="color:${r.ok ? C.n4 : C.text}">&nbsp;&nbsp;${esc(r.v)}</span>` : ""}</div>${tag(r.tag, r.tone ?? (r.ok ? "ok" : "bad"))}</div>`).join("");
    return `<div class="p mono" style="left:0;top:20px;width:1020px;height:440px;padding:28px 36px;font-size:25px">${dots()}${rows}</div>`;
  },
};

// ----- more templates (DESIGN.md "Post image"): redact, laptop, stack, board, api --------------------------------
const LH = 56; // line height of the redact panel
Object.assign(big, {
  // A document with some values hidden behind bars and some still readable in a red outline.
  redact(s) {
    const head = 20 + 28 + 38; // panel top + padding + window dots
    const line = (l, i) => {
      const segs = l.map((g) => g.hidden ? `<span style="display:inline-block;height:26px;width:${g.w}px;border-radius:7px;background:${C.ink7};vertical-align:middle"></span>`
        : g.leak ? `<span style="display:inline-block;border:2px solid ${C.bad};border-radius:9px;padding:0 10px;color:${C.text};line-height:36px;white-space:nowrap">${esc(g.t)}</span>`
        : `<span style="color:${g.key ? C.n6 : C.n4}">${esc(g.t)}</span>`).join('<span style="display:inline-block;width:14px"></span>');
      return `<div style="height:${LH}px;display:flex;align-items:center;white-space:nowrap">${segs}</div>`;
    };
    const call = s.callouts.map((c) => {
      const y = head + c.line * LH + LH / 2;
      return `<div class="pill" style="left:760px;top:${y - 26}px;width:290px;height:52px;border-color:${c.ok ? C.ok : C.bad};color:${c.ok ? C.ok : C.bad};font-size:23px">${esc(c.label)}</div>`;
    }).join("");
    const lines = s.callouts.map((c) => { const y = head + c.line * LH + LH / 2; return `<line x1="${c.x ?? 640}" y1="${y}" x2="758" y2="${y}" stroke="${c.ok ? C.ok : C.bad}" stroke-width="3" stroke-dasharray="9 9"/>`; }).join("");
    return `<div class="p mono" style="left:0;top:20px;width:700px;height:440px;padding:28px 34px;font-size:25px">${dots()}${s.lines.map(line).join("")}</div>${call}<svg class="ov">${lines}</svg>`;
  },
  // A MacBook-style screen showing one small interface.
  laptop(s) {
    const sc = s.screen;
    const rows = (sc.rows ?? []).map((r) => `<div style="display:flex;align-items:center;justify-content:space-between;height:58px;padding:0 20px;border-radius:10px;background:${C.canvas};margin-top:10px"><span style="color:${C.n4};font-size:24px;white-space:nowrap">${esc(r.t)}</span>${tag(r.tag, r.ok ? "ok" : "bad")}</div>`).join("");
    const empty = sc.result ? `<div style="margin-top:34px;text-align:center;font-size:27px;color:${C.bad};font-weight:600">${esc(sc.result)}</div>` : "";
    const screen = `<div class="p" style="left:120px;top:10px;width:700px;height:400px;border-radius:22px;padding:22px 30px;background:${C.card}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><div style="font-size:24px;font-weight:600;color:${C.n4}">${esc(sc.title)}</div>${dots().replace('margin-bottom:22px', 'margin-bottom:0')}</div><div style="height:62px;border:2px solid ${C.n6};border-radius:12px;display:flex;align-items:center;padding:0 20px;gap:14px"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${C.n4}" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg><span class="mono" style="font-size:27px;color:${C.text}">${esc(sc.query)}</span></div>${rows}${empty}</div>`;
    const base = `<div style="position:absolute;left:60px;top:424px;width:820px;height:22px;border:2px solid ${C.n6};border-radius:6px 6px 22px 22px;background:${C.ink9}"></div><div style="position:absolute;left:400px;top:424px;width:140px;height:9px;border-radius:0 0 12px 12px;background:${C.ink7}"></div>`;
    const note = s.note ? `<div class="pill" style="left:700px;top:458px;width:340px;height:52px;border-color:${C.n6};color:${C.n4};font-size:22px">${esc(s.note)}</div>` : "";
    return `${screen}${base}${note}`;
  },
  // Copies of one thing, newest in front.
  stack(s) {
    const src = `<div class="p" style="left:0;top:130px;width:330px;height:170px;display:flex;align-items:center;gap:22px;padding:0 26px">${icon(s.source.icon, 62)}<div class="mono" style="font-size:25px;white-space:nowrap">${esc(s.source.name)}</div></div>`;
    const cmd = `<div class="mono" style="position:absolute;left:350px;top:176px;width:230px;text-align:center;font-size:23px;color:${C.n4};white-space:nowrap">${esc(s.source.cmd)}</div>`;
    const n = s.layers, step = 30, x0 = 660, y0 = 70 + (n - 1) * step;
    const cards = Array.from({ length: n }, (_, i) => {
      const back = n - 1 - i; // 0 = front
      const x = x0 + (n - 1 - back) * 0; const dx = back * step, dy = -back * step;
      return `<div class="p" style="left:${x0 + dx}px;top:${y0 + dy}px;width:360px;height:170px;${back ? `opacity:${1 - back * 0.14};` : ""}border-color:${back ? C.border : C.n6}">${back === 0 ? `<div style="padding:26px 28px"><div class="mono" style="font-size:25px;font-weight:600;white-space:nowrap">${esc(s.front)}</div><div style="margin-top:20px;display:flex;gap:12px;align-items:center">${tag("newest", "ok")}${icon("file", 34)}</div></div>` : ""}</div>`;
    }).join("");
    const caption = `<div style="position:absolute;left:${x0}px;top:${y0 + 215}px;width:420px;font-size:30px;font-weight:600;white-space:nowrap">${esc(s.caption)}</div>`;
    return `${src}${cmd}${cards}${caption}<svg class="ov">${arrowH(346, 215, 650)}</svg>`;
  },
  // A ticket board with three lanes; one card is highlighted.
  board(s) {
    const lane = (l, i) => `<div class="p" style="left:${i * 358}px;top:30px;width:340px;height:440px;padding:22px 20px"><div style="display:flex;justify-content:space-between;font-size:24px;font-weight:600;color:${C.n4}"><span>${esc(l.name)}</span><span class="mono" style="color:${C.n6}">${l.cards.length}</span></div>${l.cards.map((c) => `<div style="margin-top:16px;border:2px solid ${c.hl ? ACC : C.border};border-radius:12px;background:${C.canvas};padding:16px 18px"><div class="mono" style="font-size:20px;color:${c.hl ? ACC : C.n6}">${esc(c.id)}</div><div style="font-size:24px;margin-top:6px;line-height:30px">${esc(c.t)}</div>${c.chip ? `<div style="margin-top:12px">${tag(c.chip, "ok")}</div>` : ""}</div>`).join("")}</div>`;
    return s.lanes.map(lane).join("");
  },
  // A request on the left and what comes back on the right.
  api(s) {
    const body = (lines) => lines.map((l) => `<div style="height:44px;white-space:pre;color:${l.c ? color[l.c] : C.n4}">${esc(l.t)}</div>`).join("");
    const req = `<div class="p mono" style="left:0;top:50px;width:470px;height:400px;padding:30px 30px;font-size:25px"><div style="display:flex;gap:14px;align-items:center;margin-bottom:22px">${tag(s.req.method, "purple", "font-size:22px")}<span style="font-size:27px;font-weight:600">${esc(s.req.path)}</span></div>${body(s.req.lines)}</div>`;
    const res = `<div class="p mono" style="left:586px;top:50px;width:470px;height:400px;padding:30px 30px;font-size:25px"><div style="display:flex;gap:14px;align-items:center;margin-bottom:22px">${tag(s.res.status, "ok", "font-size:22px")}<span style="font-size:27px;font-weight:600">${esc(s.res.label ?? "response")}</span></div>${body(s.res.lines)}</div>`;
    return `${req}${res}<svg class="ov">${arrowH(486, 250, 580)}</svg>`;
  },
});

Object.assign(big, {
  // A pull-request card, GitHub-style but generic: no logo, no vendor name.
  pr(s) {
    const merge = `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="${ACC}" stroke-width="1.7" stroke-linecap="round"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 7.2v9.6M8 5h4a4 4 0 0 1 4 4v.8"/></svg>`;
    const checks = s.checks.map((c) => `<div style="display:flex;align-items:center;justify-content:space-between;height:62px;border-top:2px solid ${C.border}"><span style="font-size:26px;color:${C.n4}">${esc(c.t)}</span>${tag(c.tag ?? (c.ok ? "passed" : "waiting"), c.ok ? "ok" : "bad")}</div>`).join("");
    const bars = (n, col) => Array.from({ length: n }, () => `<i style="display:inline-block;width:22px;height:22px;border-radius:5px;background:${col};margin-right:6px"></i>`).join("");
    return `<div class="p" style="left:0;top:20px;width:1020px;height:440px;padding:30px 38px"><div style="display:flex;align-items:center;gap:22px">${merge}<div style="font-size:36px;font-weight:700;white-space:nowrap">${esc(s.title)}</div><div class="mono" style="font-size:28px;color:${C.n6}">${esc(s.number)}</div></div><div style="display:flex;align-items:center;gap:14px;margin:22px 0 22px 68px"><span class="mono" style="border:2px solid ${C.n6};border-radius:999px;padding:2px 16px;font-size:23px">${esc(s.branch[0])}</span><span style="color:${C.n6};font-size:26px">→</span><span class="mono" style="border:2px solid ${C.n6};border-radius:999px;padding:2px 16px;font-size:23px">${esc(s.branch[1])}</span><span class="mono" style="margin-left:auto;font-size:25px;color:${C.ok}">${esc(s.stat[0])}</span><span class="mono" style="font-size:25px;color:${C.bad}">${esc(s.stat[1])}</span><span style="margin-left:6px">${bars(3, C.ok)}${bars(1, C.bad)}</span></div>${checks}</div>`;
  },
});

Object.assign(big, {
  // Two computers side by side with the folder path each one uses; the arrow carries the command; tags say what stays behind.
  move(s) {
    const box = (x, side) => `<div class="p" style="left:${x}px;top:70px;width:400px;height:300px;padding:28px 30px"><div style="display:flex;align-items:center;gap:16px">${icon(side.icon ?? "folder", 54)}<div style="font-size:30px;font-weight:700;white-space:nowrap">${esc(side.name)}</div></div><div style="margin-top:30px;font-size:21px;color:${C.n6}">${esc(side.pathLabel ?? "project folder")}</div><div class="mono" style="margin-top:8px;font-size:27px;color:${C.text};white-space:nowrap">${esc(side.path)}</div><div style="margin-top:26px;font-size:21px;color:${C.n6}">${esc(side.fileLabel ?? "session file")}</div><div class="mono" style="margin-top:8px;font-size:25px;color:${side.has ? ACC : C.n4};white-space:nowrap">${esc(side.file)}</div></div>`;
    const chips = s.chips.map((c, i) => `<div style="position:absolute;left:${400 + 20}px;top:${300 + i * 62}px;width:216px;text-align:center">${tag(c[0], c[1], "font-size:21px;white-space:nowrap")}</div>`).join("");
    return `${box(0, s.from)}${box(656, s.to)}<div class="mono" style="position:absolute;left:430px;top:150px;width:196px;text-align:center;font-size:26px;color:${C.n4}">${esc(s.cmd)}</div>${chips}<svg class="ov">${arrowH(414, 216, 642)}</svg>`;
  },
});

// ----- scenes: search (an isometric grid with a magnifier) and agent (a bot wired to tools) ---------------------------
// Flat fills and outlines only; faces use ink and card tokens, the found block uses the accent at three opacities.
const isoPt = (g, x, y, z = 0) => [g.ox + ((x - y) * g.tw) / 2, g.oy + ((x + y) * g.th) / 2 - z];
const pts = (a) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const face = (a, fill, stroke, sw, op, so) => `<polygon points="${pts(a)}" fill="${fill}"${op !== undefined ? ` fill-opacity="${op}"` : ""} stroke="${stroke}"${so !== undefined ? ` stroke-opacity="${so}"` : ""} stroke-width="${sw}" stroke-linejoin="round"/>`;

function isoGrid(g, spec) {
  const out = [];
  const blocks = new Set((spec.blocks ?? []).map((b) => `${b.x},${b.y}`));
  const holes = new Set((spec.holes ?? []).map((h) => `${h.x},${h.y}`));
  const hit = spec.found ? `${spec.found.x},${spec.found.y}` : "";
  for (let sum = 0; sum <= (g.n - 1) * 2; sum++) {
    for (let x = 0; x < g.n; x++) {
      const y = sum - x;
      if (y < 0 || y >= g.n) continue;
      const key = `${x},${y}`;
      const t = [isoPt(g, x, y), isoPt(g, x + 1, y), isoPt(g, x + 1, y + 1), isoPt(g, x, y + 1)];
      if (holes.has(key)) {
        const dn = (p) => [p[0], p[1] + g.hole];
        out.push(face(t.map(dn), C.canvas, C.n6, g.line, undefined, 0.45));
        out.push(face([t[0], t[3], dn(t[3]), dn(t[0])], C.ink9, C.n6, g.line, undefined, 0.45));
        out.push(face([t[0], t[1], dn(t[1]), dn(t[0])], C.card, C.n6, g.line, undefined, 0.45));
        continue;
      }
      out.push(face(t, C.card, C.n6, g.line, undefined, 0.45));
      if (blocks.has(key) || key === hit) {
        const u = t.map((p) => [p[0], p[1] - g.bh]);
        const sides = [[[u[3], u[2], t[2], t[3]], C.ink9, 0.6], [[u[2], u[1], t[1], t[2]], C.card, 0.35], [u, C.ink7, 1]];
        for (const [f, base, op] of sides) {
          if (key === hit) { out.push(face(f, C.canvas, ACC, g.edge)); out.push(face(f, ACC, ACC, g.edge, op)); }
          else out.push(face(f, base, C.n6, g.edge));
        }
      }
    }
  }
  return out.join("");
}

function isoSearch(g, spec) {
  const grid = isoGrid(g, spec);
  const [cx, cy] = isoPt(g, spec.found.x + 0.5, spec.found.y + 0.5, g.bh / 2);
  const R = g.R, ring = g.rim, d = 0.7071;
  const x1 = cx - d * (R + ring), y1 = cy + d * (R + ring), x2 = x1 - d * g.handle, y2 = y1 + d * g.handle;
  const arc = (r, a0, a1) => { const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]; const [ax, ay] = p(a0), [bx, by] = p(a1); return `M${ax.toFixed(1)} ${ay.toFixed(1)} A${r} ${r} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}`; };
  return `<defs><clipPath id="lens"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath></defs>${grid}`
    + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.n6}" stroke-width="${g.hw + 6}" stroke-linecap="round"/>`
    + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.ink7}" stroke-width="${g.hw}" stroke-linecap="round"/>`
    + `<g clip-path="url(#lens)"><rect width="${g.w}" height="${g.h}" fill="${C.canvas}"/><g transform="translate(${cx} ${cy}) scale(${g.zoom}) translate(${-cx} ${-cy})">${grid}</g></g>`
    + `<circle cx="${cx}" cy="${cy}" r="${R + ring / 2}" fill="none" stroke="${C.ink7}" stroke-width="${ring}"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${R + ring}" fill="none" stroke="${C.n6}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.n6}" stroke-width="3"/>`
    + `<path d="${arc(R - 18, 200, 250)}" fill="none" stroke="${C.n4}" stroke-opacity="0.7" stroke-width="5" stroke-linecap="round"/>`;
}

// The bot: antenna, ears, a screen face with two pill eyes and a smile. Drawn in a 420 x 400 box.
const botSvg = () => {
  const hx = 60, hy = 120, hw = 300, hh = 230, cx = hx + hw / 2;
  return `<rect x="${hx + 14}" y="${hy + 14}" width="${hw}" height="${hh}" rx="70" fill="${C.ink9}"/>`
    + `<line x1="${cx}" y1="${hy}" x2="${cx}" y2="72" stroke="${C.n6}" stroke-width="3"/><circle cx="${cx}" cy="52" r="22" fill="${C.card}" stroke="${ACC}" stroke-width="4"/><circle cx="${cx}" cy="52" r="6" fill="${ACC}"/>`
    + `<rect x="${hx - 30}" y="${hy + 75}" width="34" height="80" rx="17" fill="${C.ink7}" stroke="${C.n6}" stroke-width="3"/><rect x="${hx + hw - 4}" y="${hy + 75}" width="34" height="80" rx="17" fill="${C.ink7}" stroke="${C.n6}" stroke-width="3"/>`
    + `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" rx="70" fill="${C.card}" stroke="${C.n6}" stroke-width="3"/>`
    + `<rect x="${hx + 36}" y="${hy + 34}" width="${hw - 72}" height="${hh - 84}" rx="40" fill="${C.canvas}" stroke="${C.ink7}" stroke-width="3"/>`
    + `<rect x="${cx - 65}" y="${hy + 66}" width="26" height="58" rx="13" fill="${ACC}"/><rect x="${cx + 39}" y="${hy + 66}" width="26" height="58" rx="13" fill="${ACC}"/>`
    + `<path d="M${cx - 32} ${hy + 144} Q${cx} ${hy + 174} ${cx + 32} ${hy + 144}" fill="none" stroke="${ACC}" stroke-width="7" stroke-linecap="round"/>`
    + `<rect x="${cx - 40}" y="${hy + hh}" width="80" height="26" rx="10" fill="${C.ink7}" stroke="${C.n6}" stroke-width="3"/>`;
};

Object.assign(big, {
  search(s) {
    const g = { w: 1056, h: 520, n: 5, tw: 150, th: 75, ox: 600, oy: 96, bh: 54, hole: 32, R: 150, zoom: 1.3, handle: 140, hw: 26, rim: 16, line: 1.5, edge: 2 };
    const label = s.label ? `<div class="pill" style="right:10px;bottom:6px;height:52px;padding:0 26px;border-color:${ACC};color:${ACC};font-size:24px">${esc(s.label)}</div>` : "";
    return `<svg class="ov" viewBox="0 0 ${g.w} ${g.h}" width="${g.w}" height="${g.h}">${isoSearch(g, s)}</svg>${label}`;
  },
  agent(s) {
    const tools = s.tools.slice(0, 3), ys = [95, 260, 425].slice(0, tools.length), act = s.active ?? 0;
    const tiles = tools.map((t, i) => `<div class="p" style="left:660px;top:${ys[i] - 55}px;width:380px;height:110px;display:flex;align-items:center;gap:22px;padding:0 28px">${icon(t.icon, 56)}<div class="mono" style="font-size:25px;white-space:nowrap">${esc(t.name)}</div></div>`).join("");
    const wire = (y, on) => `<path d="M390 235 H530 V${y} H654" fill="none" stroke="${on ? ACC : C.n6}" stroke-width="${on ? 4 : 3}" stroke-linejoin="round"/>`;
    const dots = ys.map((y, i) => `<circle cx="654" cy="${y}" r="7" fill="${i === act ? ACC : C.n6}"/>`).join("");
    const label = s.label ? `<div class="pill" style="left:80px;top:440px;width:260px;height:50px;border-color:${C.n6};color:${C.n4};font-size:23px">${esc(s.label)}</div>` : "";
    return `<svg class="ov" viewBox="0 0 1056 520" width="1056" height="520">${ys.map((y, i) => (i === act ? "" : wire(y, false))).join("")}${wire(ys[act], true)}${dots}<g transform="translate(0 10)">${botSvg()}</g></svg>${tiles}${label}`;
  },
});

// ----- thumbnail: drawn natively at 640 x 360, type 30px or larger, at most three things --------------------------
const thumb = {
  tree(s) {
    const t = s.thumb.tree.map((l) => `<div style="color:${color[l.c]};display:flex;justify-content:space-between;align-items:center;height:92px;white-space:nowrap">${esc(l.t)}${l.tag ? tag(l.tag[0], l.tag[1], "font-size:26px") : ""}</div>`).join("");
    const ys = [70, 180, 290].slice(0, s.thumb.targets.length);
    const tiles = ys.map((y, i) => `<div class="p" style="left:350px;top:${y - 40}px;width:80px;height:80px;display:flex;align-items:center;justify-content:center;border-radius:12px">${icon("folder", 44)}</div><div style="position:absolute;left:452px;top:${y - 20}px;font-size:32px;font-weight:600;white-space:nowrap">${esc(s.thumb.targets[i])}</div>`).join("");
    const ln = `<line x1="300" y1="180" x2="326" y2="180" stroke="${C.n6}" stroke-width="3"/><line x1="326" y1="${ys[0]}" x2="326" y2="${ys[ys.length - 1]}" stroke="${C.n6}" stroke-width="3"/>` + ys.map((y) => `<line x1="326" y1="${y}" x2="350" y2="${y}" stroke="${C.n6}" stroke-width="3"/>`).join("");
    return `<div class="p mono" style="left:0;top:50px;width:300px;height:260px;padding:34px 22px;font-size:30px;line-height:40px">${t}</div>${tiles}<svg class="ov">${ln}</svg>`;
  },
  compare(s) {
    const panel = (x, p) => `<div class="p" style="left:${x}px;top:30px;width:290px;height:300px;padding:26px 26px"><div class="mono" style="font-size:30px;font-weight:600;white-space:nowrap">${esc(p.name)}</div><div style="height:22px"></div>${p.bars.map((w) => `<div style="height:16px;border-radius:8px;background:${p.tone === "ok" ? ACC : C.ink7};width:${w}%;margin-bottom:14px"></div>`).join("")}<div style="position:absolute;left:26px;bottom:24px;font-size:62px;font-weight:700;color:${tone(p.tone)};line-height:68px;white-space:nowrap">${esc(p.value)}</div></div>`;
    return panel(0, s.thumb.left) + panel(330, s.thumb.right);
  },
  flow(s) {
    const q = s.thumb.sources, n = q.length, h = n === 3 ? 84 : 110, gap = n === 3 ? 16 : 40, top = (330 - (n * h + (n - 1) * gap)) / 2 + 15;
    const ys = q.map((_, i) => top + i * (h + gap));
    const src = q.map((x, i) => `<div class="p" style="left:0;top:${ys[i]}px;width:300px;height:${h}px;display:flex;align-items:center;gap:16px;padding:0 20px;border-radius:12px">${icon(x.icon, 44)}<div class="mono" style="font-size:28px;white-space:nowrap">${esc(x.name)}</div></div>`).join("");
    const arrows = ys.map((y) => arrowH(316, y + h / 2, 392)).join("");
    const dest = `<div class="p" style="left:400px;top:50px;width:230px;height:260px;padding:30px 24px;border-radius:12px">${icon(s.dest.icon ?? "folder", 72)}<div class="mono" style="font-size:28px;font-weight:600;margin-top:16px;white-space:nowrap">${esc(s.thumb.dest.name)}</div></div>`;
    return `${src}${dest}<svg class="ov">${arrows}</svg>`;
  },
  list(s) {
    const rows = s.thumb.rows.map((r) => `<div style="display:flex;align-items:center;justify-content:space-between;height:86px"><span style="color:${C.n4};font-size:34px">${esc(r.k)}</span>${tag(r.tag, r.tone ?? (r.ok ? "ok" : "bad"), "font-size:30px;padding:4px 18px")}</div>`).join("");
    return `<div class="p mono" style="left:0;top:25px;width:600px;height:310px;padding:22px 30px">${rows}</div>`;
  },
};

Object.assign(thumb, {
  redact(s) {
    const row = (kind, w) => kind === "mark"
      ? `<div style="height:84px;display:flex;align-items:center"><span class="mono" style="border:3px solid ${ACC};border-radius:14px;padding:6px 18px;font-size:34px;color:${ACC};white-space:nowrap">${esc(w)}</span></div>`
      : kind === "leak"
      ? `<div style="height:84px;display:flex;align-items:center"><span class="mono" style="border:3px solid ${C.bad};border-radius:14px;padding:6px 18px;font-size:34px;color:${C.text};white-space:nowrap">${esc(w)}</span></div>`
      : `<div style="height:84px;display:flex;align-items:center"><span style="display:block;height:38px;width:${w}px;border-radius:11px;background:${C.ink7}"></span></div>`;
    return `<div class="p mono" style="left:0;top:25px;width:600px;height:310px;padding:28px 36px">${s.thumb.rows.map((r) => row(r.k, r.w)).join("")}</div>`;
  },
  laptop(s) {
    const t = s.thumb;
    return `<div class="p" style="left:50px;top:30px;width:500px;height:250px;border-radius:18px;padding:18px 22px"><div style="height:54px;border:2px solid ${C.n6};border-radius:10px;display:flex;align-items:center;padding:0 16px;gap:12px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${C.n4}" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg><span class="mono" style="font-size:30px">${esc(t.query)}</span></div><div style="margin-top:34px;text-align:center">${tag(t.tag, t.ok ? "ok" : "bad", "font-size:34px;padding:6px 26px")}</div></div><div style="position:absolute;left:10px;top:296px;width:580px;height:18px;border:2px solid ${C.n6};border-radius:5px 5px 18px 18px;background:${C.ink9}"></div>`;
  },
  stack(s) {
    const n = Math.min(s.layers, 4), step = 26, x0 = 300, y0 = 150;
    const cards = Array.from({ length: n }, (_, i) => { const back = n - 1 - i; return `<div class="p" style="left:${x0 + back * step}px;top:${y0 - back * step}px;width:290px;height:150px;${back ? `opacity:${1 - back * 0.18};border-color:${C.border};` : ""}">${back === 0 ? `<div style="padding:22px 22px"><div class="mono" style="font-size:30px;font-weight:600;white-space:nowrap">${esc(s.thumb.front)}</div><div style="margin-top:18px">${tag("newest", "ok", "font-size:26px;padding:3px 14px")}</div></div>` : ""}</div>`; }).join("");
    return `<div class="p" style="left:0;top:90px;width:210px;height:170px;display:flex;align-items:center;justify-content:center;border-radius:14px">${icon(s.source.icon, 84)}</div>${cards}<svg class="ov">${arrowH(250, 175, 296)}</svg>`;
  },
  board(s) {
    const lane = (l, i) => `<div class="p" style="left:${i * 206}px;top:30px;width:190px;height:300px;padding:16px 14px;border-radius:12px"><div style="font-size:26px;font-weight:600;color:${C.n4}">${esc(l.short ?? l.name)}</div>${l.cards.slice(0, 2).map((c) => `<div style="margin-top:12px;border:2px solid ${c.hl ? ACC : C.border};border-radius:9px;background:${C.canvas};height:${c.chip ? 100 : 60}px;padding:10px">${c.chip ? `<div style="margin-top:34px">${tag(c.chip, "ok", "font-size:22px;padding:2px 10px")}</div>` : `<div style="height:10px;border-radius:5px;background:${C.ink7};width:80%"></div>`}</div>`).join("")}</div>`;
    return s.lanes.map(lane).join("");
  },
  api(s) {
    const lines = (ls) => ls.slice(0, 3).map((l) => `<div class="mono" style="height:48px;font-size:28px;color:${l.c ? color[l.c] : C.n4};white-space:nowrap">${esc(l.t)}</div>`).join("");
    return `<div class="p" style="left:0;top:40px;width:270px;height:270px;padding:22px 22px;border-radius:12px">${tag(s.req.method, "purple", "font-size:26px")}<div style="height:16px"></div>${lines(s.thumb?.req ?? s.req.lines)}</div><div class="p" style="left:340px;top:40px;width:270px;height:270px;padding:22px 22px;border-radius:12px">${tag(s.res.status, "ok", "font-size:26px")}<div style="height:16px"></div>${lines(s.thumb?.res ?? s.res.lines)}</div><svg class="ov">${arrowH(284, 175, 334)}</svg>`;
  },
});

Object.assign(thumb, {
  pr(s) {
    const merge = `<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="${ACC}" stroke-width="1.7" stroke-linecap="round"><circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 7.2v9.6M8 5h4a4 4 0 0 1 4 4v.8"/></svg>`;
    const rows = s.checks.slice(0, 3).map((c) => `<div style="display:flex;justify-content:space-between;align-items:center;height:58px;border-top:2px solid ${C.border}"><span style="font-size:30px;color:${C.n4}">${esc(c.t)}</span>${tag(c.ok ? "passed" : "open", c.ok ? "ok" : "bad", "font-size:26px;padding:3px 14px")}</div>`).join("");
    return `<div class="p" style="left:0;top:20px;width:600px;height:320px;padding:20px 28px;border-radius:12px"><div style="display:flex;align-items:center;gap:16px;margin-bottom:10px">${merge}<span style="font-size:34px;font-weight:700;white-space:nowrap">${esc(s.thumb?.title ?? s.number)}</span></div>${rows}</div>`;
  },
});

Object.assign(thumb, {
  move(s) {
    const box = (x, label, path) => `<div class="p" style="left:${x}px;top:50px;width:250px;height:260px;padding:24px 22px;border-radius:12px"><div style="font-size:32px;font-weight:700;white-space:nowrap">${esc(label)}</div><div style="margin-top:24px">${icon("folder", 56)}</div><div class="mono" style="margin-top:20px;font-size:27px;color:${C.n4};white-space:nowrap">${esc(path)}</div></div>`;
    return `${box(0, s.thumb.from, s.thumb.fromPath)}${box(350, s.thumb.to, s.thumb.toPath)}<svg class="ov">${arrowH(262, 180, 342)}</svg>`;
  },
});

Object.assign(thumb, {
  search(s) {
    const g = { w: 620, h: 360, n: 4, tw: 130, th: 65, ox: 360, oy: 64, bh: 46, hole: 26, R: 105, zoom: 1.25, handle: 80, hw: 22, rim: 14, line: 2, edge: 3 };
    return `<svg class="ov" viewBox="0 0 ${g.w} ${g.h}" width="${g.w}" height="${g.h}">${isoSearch(g, s.thumb ? { ...s, ...s.thumb } : s)}</svg>`;
  },
  agent(s) {
    const tools = (s.thumb?.tools ?? s.tools).slice(0, 3), ys = [62, 180, 298].slice(0, tools.length), act = s.active ?? 0, k = 0.74;
    const tiles = tools.map((t, i) => `<div class="p" style="left:392px;top:${ys[i] - 42}px;width:218px;height:84px;display:flex;align-items:center;gap:14px;padding:0 18px;border-radius:12px">${icon(t.icon, 44)}<div class="mono" style="font-size:30px;white-space:nowrap">${esc(t.name)}</div></div>`).join("");
    const wire = (y, on) => `<path d="M280 174 H336 V${y} H384" fill="none" stroke="${on ? ACC : C.n6}" stroke-width="${on ? 4 : 3}" stroke-linejoin="round"/>`;
    return `<svg class="ov" viewBox="0 0 620 360" width="620" height="360">${ys.map((y, i) => (i === act ? "" : wire(y, false))).join("")}${wire(ys[act], true)}<g transform="translate(-6 -2) scale(${k})">${botSvg()}</g></svg>${tiles}`;
  },
});

const STYLE = `
@font-face{font-family:Inter;font-weight:100 900;src:url("${font}") format("woff2")}
@font-face{font-family:JBM;font-weight:100 800;src:url("${mono}") format("woff2")}
*{box-sizing:border-box}
html,body{margin:0;background:${C.canvas};color:${C.text};font-family:Inter,sans-serif}
.mono{font-family:JBM,monospace}
.grid{background-image:radial-gradient(${C.border} 2px,transparent 2.2px);background-size:26px 26px}
.scene{position:absolute;isolation:isolate}
.p{position:absolute;background:${C.card};border:2px solid ${C.n6};border-radius:16px}
.p::after{content:"";position:absolute;inset:-2px;transform:translate(14px,14px);background:${C.ink9};border-radius:inherit;z-index:-1}
.dots{display:flex;gap:10px;margin-bottom:22px}.dots i{width:16px;height:16px;border-radius:50%;display:block}
.pill{position:absolute;border:2px solid;border-radius:999px;background:${C.card};display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:600;white-space:nowrap}
.lab{position:absolute;font-size:30px;font-weight:600}
svg.ov{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.tag{font-family:Inter;font-size:20px;font-weight:600;border:2px solid;border-radius:999px;padding:2px 14px;white-space:nowrap}
`;

function shoot(file, w, h, inner) {
  const html = `<!doctype html><meta charset="utf-8"><style>${STYLE}</style><body class="grid" style="width:${w}px;height:${h}px;overflow:hidden">${inner}</body>`;
  const tmp = join(tmpdir(), `card-${file.replace(/\W/g, "_")}.html`);
  writeFileSync(tmp, html);
  execFileSync(chrome, ["--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=3000", `--window-size=${w},${h}`, `--screenshot=${join(OUT, file)}`, `file://${tmp}`], { stdio: "ignore" });
  console.log("wrote public/cards/" + file);
}

const only = samplesDir ? undefined : process.argv[2];
for (const [slug, spec] of Object.entries(samplesDir ? SAMPLES : CARDS)) {
  if (only && only !== slug) continue;
  ACC = ACCENTS[spec.accent ?? "blue"];
  shoot(`${slug}.png`, 1200, 676, `<div class="scene" style="left:72px;top:78px;width:1056px;height:520px">${big[spec.kind](spec)}</div>`);
  shoot(`${slug}-thumb.png`, 640, 360, `<div class="scene" style="left:10px;top:0;width:620px;height:360px">${thumb[spec.kind](spec)}</div>`);
}
