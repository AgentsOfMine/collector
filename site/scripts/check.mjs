#!/usr/bin/env node
// Runs after `astro build`. Fails the build on anything that would break a promise this PUBLIC site makes:
// no employer name, no LinkedIn link, no image metadata, no tracking, no broken links, and everything served under
// the /collector/ base path that GitHub Pages adds.
//
//   node scripts/check.mjs            check ./dist and ./src
//   node scripts/check.mjs --self-test  prove every rule fails when broken (see the end of this file)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { imageMetadata } from "./lib/images.mjs";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const BASE = "/collector";
const ORIGIN = "https://agentsofmine.github.io";
const CI = process.env.CI === "true";
const failures = [];
const fail = (rule, where, detail) => failures.push({ rule, where, detail });

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (p) => relative(ROOT, p);

// ---------------------------------------------------------------------------------------------
// 0. The forbidden words file must exist (it is local and git-ignored, so a fresh clone fails loudly).
const FW = join(ROOT, ".forbidden-words");
if (!existsSync(FW)) {
  if (CI) console.log("note: .forbidden-words is not available in CI (a public repo must not hold it). That one rule is skipped here and is enforced by the pre-push check on the owner's machine.");
  else fail("forbidden-words", ".forbidden-words", "missing. Create it (one word per line). It is git-ignored on purpose.");
}
const forbidden = existsSync(FW)
  ? readFileSync(FW, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  : [];
const forbiddenRe = forbidden.length
  ? new RegExp(`(?<![A-Za-z0-9])(${forbidden.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "i")
  : null;

// ---------------------------------------------------------------------------------------------
const textExt = new Set([".html", ".xml", ".txt", ".json", ".md", ".svg", ".css", ".js", ".webmanifest", ".mjs", ".astro", ".ts"]);
const imgExt = new Set([".jpg", ".jpeg", ".png", ".svg"]);

const distFiles = existsSync(DIST) ? walk(DIST) : [];
if (!distFiles.length) fail("build", "dist/", "empty or missing: run `npm run check`, not `node scripts/check.mjs` alone");

const srcFiles = ["src", "public", "scripts"].filter(existsSync).flatMap((d) => walk(join(ROOT, d)));
const hostRe = /\bhttps?:\/\/(?:[a-z0-9-]+\.)*linkedin\.com\b|\blnkd\.in\b/i;
const OWN = /^(https?:)?\/\/(blog\.agentsofmine\.io|agentsofmine\.io|app\.agentsofmine\.io|github\.com\/AgentsOfMine|agentsofmine\.github\.io)(\/|$)/i;

for (const f of [...distFiles, ...srcFiles]) {
  const ext = extname(f).toLowerCase();
  if (!textExt.has(ext)) continue;
  if (f.endsWith("check.mjs")) continue; // this file names the rules
  const t = readFileSync(f, "utf8");
  // 1. The employer: not in a page, feed, sitemap, front matter, source or image metadata text.
  if (forbiddenRe) {
    const m = t.match(forbiddenRe);
    if (m) fail("forbidden-word", rel(f), `contains "${m[0]}"`);
  }
  // 1b. Post content never carries a literal color: SVG gets its colors from classes that resolve to tokens.
  if (f.includes("/src/content/") && /\b(fill|stroke|stop-color)="(?!none|currentColor|url\()/i.test(t)) fail("svg-color", rel(f), "a literal color in content; use a class from global.css");
  // 2. LinkedIn: no link and no sameAs.
  if (hostRe.test(t)) fail("linkedin", rel(f), "links to linkedin.com");
}

// 3. Images: no metadata.
for (const f of [...distFiles, ...srcFiles.filter((p) => !p.includes("/dist/"))]) {
  if (!imgExt.has(extname(f).toLowerCase())) continue;
  const meta = imageMetadata(f);
  if (meta.length) fail("image-metadata", rel(f), meta.join(", "));
  if (/(^|\/)(IMG_|DSC_?|PXL_|Screenshot )/i.test(f)) fail("image-name", rel(f), "camera-style file name; name the file after what it shows");
}
const imgsInDist = distFiles.filter((f) => imgExt.has(extname(f).toLowerCase()));

// ---------------------------------------------------------------------------------------------
// Google Search Console's ownership file is plain text with an .html name, not a page. It is recognised only in its exact
// shape (name google<hex>.html, content "google-site-verification: <same name>"); any other .html file is still a page.
const isGoogleVerification = (f) => {
  const name = f.split("/").pop();
  return /^google[0-9a-f]{16}\.html$/.test(name) && readFileSync(f, "utf8").trim() === `google-site-verification: ${name}`;
};
const pages = distFiles.filter((f) => f.endsWith(".html") && !isGoogleVerification(f));
const byUrl = new Map(
  pages.map((f) => {
    const u = "/" + relative(DIST, f).replace(/index\.html$/, "");
    return [u, f];
  }),
);
const hasFile = (u) => existsSync(join(DIST, u.replace(/^\//, "")));

const canonOf = (html) => html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1];

for (const f of pages) {
  // Comments are not content: a source comment that mentions <img> must not be read as an image.
  const html = readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const where = rel(f);
  const is404 = f.endsWith("404.html");

  // 4. Tracking: no third-party script, no off-site stylesheet or font, no cookie writes.
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src");
    if (src && /^(https?:)?\/\//i.test(src) && !OWN.test(src)) fail("third-party-script", where, src);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attr(tag, "href");
    const rel_ = (attr(tag, "rel") ?? "").toLowerCase();
    if (href && /^(https?:)?\/\//i.test(href) && ["stylesheet", "preload", "preconnect", "dns-prefetch", "prefetch"].includes(rel_) && !OWN.test(href))
      fail("third-party-request", where, href);
  }
  for (const tag of html.match(/<(img|iframe|source|video|audio)\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src");
    if (src && /^(https?:)?\/\//i.test(src) && !OWN.test(src)) fail("third-party-request", where, src);
  }
  if (/document\.cookie\s*=|localStorage\s*\.|sessionStorage\s*\./.test(html)) fail("storage", where, "writes a cookie or browser storage");

  if (is404) continue;

  // 5. Page basics.
  if (!/<html[^>]*\blang="en"/i.test(html)) fail("lang", where, 'missing <html lang="en">');
  // Bing's ownership tag: only on the home page, once, and only in its exact shape (32 upper-case hex characters).
  const bingTags = html.match(/<meta\b[^>]*name="msvalidate\.01"[^>]*>/gi) ?? [];
  const isHome = canonOf(html) === `${ORIGIN}${BASE}/`;
  if (bingTags.length > 1) fail("verification-tag", where, `${bingTags.length} msvalidate.01 tags (one at most)`);
  for (const tag of bingTags) {
    if (!isHome) fail("verification-tag", where, "msvalidate.01 outside the home page");
    if (!/^<meta name="msvalidate\.01" content="[0-9A-F]{32}"\s*\/?>$/.test(tag)) fail("verification-tag", where, `unexpected shape: ${tag.slice(0, 80)}`);
  }
  const h1 = html.match(/<h1\b/gi)?.length ?? 0;
  if (h1 !== 1) fail("h1", where, `${h1} <h1> (must be exactly 1)`);
  const canon = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
  if (!canon) fail("canonical", where, "missing");
  else if (!canon.startsWith(`${ORIGIN}${BASE}/`)) fail("canonical", where, canon);
  if (!/<meta name="description" content="[^"]{30,160}"/i.test(html)) fail("description", where, "missing, or not 30 to 160 characters");
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => +m[1]);
  for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) fail("heading-order", where, `h${levels[i - 1]} then h${levels[i]}`);
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    // A card thumbnail in a list is decorative: the title beside it says the same, so its alt is empty on purpose.
    const decorativeCard = new RegExp(`\\bsrc="${BASE}/cards/[a-z0-9-]+-thumb\\.png"`, "i").test(tag) && /\balt=""/i.test(tag);
    if (!decorativeCard && !/\balt="[^"]+"/i.test(tag)) fail("img-alt", where, tag.slice(0, 80));
    if (!/\bwidth="\d+"/i.test(tag) || !/\bheight="\d+"/i.test(tag)) fail("img-size", where, "img without width and height: " + tag.slice(0, 80));
  }
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const txt = m[1].replace(/<[^>]+>/g, "").trim().toLowerCase();
    if (/^(click here|here|read more|this link|link)$/.test(txt)) fail("anchor-text", where, `"${txt}": describe the destination`);
  }
  // Inline SVG must be named for a screen reader, or hidden from it.
  for (const tag of html.match(/<svg\b[^>]*>/gi) ?? []) {
    const hidden = /\baria-hidden="true"/i.test(tag);
    const named = /\brole="img"/i.test(tag) && /\baria-(label|labelledby)="[^"]+"/i.test(tag);
    if (!hidden && !named) fail("svg-a11y", where, "inline <svg> with no accessible name: " + tag.slice(0, 80));
  }
  // The policy is a <meta> tag here (GitHub Pages cannot send headers): it must be present, and allow only 'self'.
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i)?.[1];
  if (!meta) fail("csp-meta", where, "no Content-Security-Policy <meta> tag");
  else {
    if (/https?:|\*/.test(meta)) fail("csp-meta", where, "the policy allows an origin other than 'self'");
    if (/unsafe-inline|unsafe-eval/.test(meta)) fail("csp-meta", where, "the policy allows unsafe-inline or unsafe-eval");
    if (!/script-src 'self'/.test(meta) || !/default-src 'none'/.test(meta)) fail("csp-meta", where, "the policy lost default-src 'none' or script-src 'self'");
  }
  // The Content-Security-Policy refuses style attributes, so one would silently not apply.
  if (/<[a-z][^>]*\sstyle="/i.test(html)) fail("inline-style", where, "a style attribute (the CSP blocks it); use a class");
  // The social card a page names must exist (a post without its card shares as a blank link).
  const ogUrl = html.match(/<meta property="og:image" content="([^"]+)"/i)?.[1];
  if (ogUrl) {
    const ogPath = new URL(ogUrl).pathname.replace(new RegExp("^" + BASE), "");
    if (!hasFile(ogPath)) fail("og-image", where, `${ogPath} missing: run npm run og`);
  } else fail("og-image", where, "no og:image");
  // JSON-LD must parse, and a Person may only have sameAs entries we allow.
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const text = JSON.stringify(j);
      for (const u of text.match(/"sameAs":\[([^\]]*)\]/g) ?? [])
        if (/linkedin/i.test(u)) fail("sameAs", where, "sameAs lists LinkedIn");
    } catch {
      fail("json-ld", where, "does not parse");
    }
  }

  // 6. Internal links resolve (pages, files, images). Anchors on the same page are checked too.
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/gi)) {
    const u = m[1];
    if (/^(mailto:|tel:|data:|javascript:)/i.test(u)) continue;
    if (/^(https?:)?\/\//i.test(u)) continue;
    const [path, hash] = u.split("#");
    if (!path) {
      if (hash && !html.includes(`id="${hash}"`)) fail("anchor", where, `#${hash} not found on the page`);
      continue;
    }
    if (path.startsWith("/") && !path.startsWith(BASE + "/") && path !== BASE) {
      fail("missing-base", where, `${u} is root-relative without ${BASE}: it would 404 on GitHub Pages`);
      continue;
    }
    const abs = path.startsWith("/") ? path.slice(BASE.length) || "/" : "/" + path;
    const clean = abs.split("?")[0];
    if (!byUrl.has(clean) && !byUrl.has(clean.endsWith("/") ? clean : clean + "/") && !hasFile(clean)) fail("broken-link", where, u);
  }
}

// 7. Reachability: every page within 3 clicks from "/".
{
  const graph = new Map();
  for (const [u, f] of byUrl) {
    const html = readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    graph.set(u, [...html.matchAll(/\bhref="(\/[^"#?]*)"/g)].map((m) => m[1].replace(new RegExp("^" + BASE), "") || "/").map((p) => (p.endsWith("/") || extname(p) ? p : p + "/")));
  }
  const depth = new Map([["/", 0]]);
  const q = ["/"];
  while (q.length) {
    const u = q.shift();
    for (const v of graph.get(u) ?? []) if (graph.has(v) && !depth.has(v)) { depth.set(v, depth.get(u) + 1); q.push(v); }
  }
  for (const u of graph.keys()) {
    if (u === "/404/" || u === "/404.html") continue;
    if (!depth.has(u)) fail("orphan", u, "not reachable from /");
    else if (depth.get(u) > 3) fail("depth", u, `${depth.get(u)} clicks from /`);
  }
}

// 8. Sitemap lists every indexable page; feed and robots exist.
for (const need of ["sitemap-index.xml", "404.html"]) if (!hasFile("/" + need)) fail("missing-file", need, "not built");
if (hasFile("/sitemap-0.xml")) {
  const sm = readFileSync(join(DIST, "sitemap-0.xml"), "utf8");
  for (const [u] of byUrl) {
    if (u === "/404/" || u === "/404.html") continue;
    if (!sm.includes(`${ORIGIN}${BASE}${u}`)) fail("sitemap", u, "not in sitemap-0.xml");
  }
}

// 9. Docs pages: the front matter schema is enforced by Astro at build time; here is what it cannot see.
const docsDir = join(ROOT, "src/content/docs");
if (existsSync(docsDir)) {
  const slugs = new Set(); const orders = new Set();
  for (const f of readdirSync(docsDir).filter((n) => n.endsWith(".md"))) {
    const t = readFileSync(join(docsDir, f), "utf8");
    const slug = t.match(/^slug:\s*(\S+)/m)?.[1]; const order = t.match(/^order:\s*(\d+)/m)?.[1];
    if (slug) { if (slugs.has(slug)) fail("duplicate-slug", f, slug); slugs.add(slug); if (f !== `${slug}.md`) fail("filename", f, `file name must be ${slug}.md`); }
    if (order) { if (orders.has(order)) fail("duplicate-order", f, `order ${order} is used twice`); orders.add(order); }
    if (!/^verified:\s*\d{4}-\d{2}-\d{2}/m.test(t)) fail("verified", f, "no verified date");
  }
}

// 10. Page pictures (DESIGN.md "Post image"): every docs page except "about" has both files and an alt text, shows
// them, and no template is used by more than two pages. Same rule id as the blog's, with the docs base path.
if (existsSync(docsDir)) {
  const { CARDS } = await import(pathToFileURL(join(ROOT, "src/lib/card-specs.mjs")).href);
  const decode = (t) => t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const docs = readdirSync(docsDir).filter((n) => n.endsWith(".md")).map((n) => ({ slug: n.replace(/\.md$/, ""), about: /^kind:\s*about/m.test(readFileSync(join(docsDir, n), "utf8")) }));
  const withCard = docs.filter((d) => !d.about).map((d) => d.slug);
  const homeHtml = existsSync(join(DIST, "index.html")) ? readFileSync(join(DIST, "index.html"), "utf8") : "";
  for (const slug of withCard) {
    const spec = CARDS[slug];
    if (!spec) { fail("post-card", slug, "no entry in src/lib/card-specs.mjs"); continue; }
    if (!spec.alt || spec.alt.length < 30 || spec.alt.length > 160) fail("post-card", slug, `alt text must be 30 to 160 characters (is ${spec.alt?.length ?? 0})`);
    for (const f of [`cards/${slug}.png`, `cards/${slug}-thumb.png`]) if (!existsSync(join(DIST, f))) fail("post-card", slug, `${f} missing: run npm run cards`);
    const html = existsSync(join(DIST, `${slug}/index.html`)) ? readFileSync(join(DIST, `${slug}/index.html`), "utf8") : "";
    const big = html.match(new RegExp(`<img[^>]*src="${BASE}/cards/${slug}\\.png"[^>]*>`))?.[0];
    if (!big) fail("post-card", slug, "the page does not show its picture");
    else if (decode(big.match(/\balt="([^"]*)"/)?.[1] ?? "") !== spec.alt) fail("post-card", slug, "the alt text on the page is not the one in card-specs.mjs (a stale build cache?)");
    if (!homeHtml.includes(`${BASE}/cards/${slug}-thumb.png`)) fail("post-card", slug, "the docs home does not show its thumbnail");
  }
  const byKind = {};
  for (const slug of withCard) if (CARDS[slug]) (byKind[CARDS[slug].kind] ??= []).push(slug);
  for (const [kind, list] of Object.entries(byKind)) if (list.length > 2) fail("post-card", kind, `template "${kind}" is used by ${list.length} pages (at most 2): ${list.join(", ")}`);
  for (const slug of Object.keys(CARDS)) if (!docs.some((d) => d.slug === slug && !d.about)) fail("post-card", slug, "a card spec for a page that does not exist or has none (about pages have no picture)");
}

// ---------------------------------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  console.log("self-test is run by scripts/prove-checks.sh, not here");
  process.exit(0);
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  [${f.rule}] ${f.where}: ${f.detail}`);
  console.error("");
  process.exit(1);
}
console.log(`ok: ${pages.length} pages, ${imgsInDist.length} images, ${forbidden.length} forbidden word(s) checked, no tracking, no metadata`);
