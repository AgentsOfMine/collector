// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { readdirSync, readFileSync } from "node:fs";
import rehypeTakeaway from "./src/lib/rehype-takeaway.mjs";
import rehypeHighlight from "./src/lib/rehype-highlight.mjs";
import rehypeCard from "./src/lib/rehype-card.mjs";

/** GitHub Pages serves a project site under /<repo>/. Every link has to carry it. */
const BASE = "/collector";

/**
 * rehype plugin, no dependencies:
 *  - root-relative links and images in Markdown get the base path ("/x/" becomes "/collector/x/"), because Astro does not
 *  - a code block or a table that scrolls sideways is focusable and named, for keyboard users
 * @returns {(tree: any) => void}
 */
function docsMarkdown() {
  const prefix = (v) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith(BASE + "/") ? BASE + v : v);
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "a" && child.properties) child.properties.href = prefix(child.properties.href);
      if (child.tagName === "img" && child.properties) child.properties.src = prefix(child.properties.src);
      if (child.tagName === "pre") {
        child.properties = { ...child.properties, tabIndex: 0, role: "region", ariaLabel: "Code, scrollable" };
      } else if (child.tagName === "table") {
        const table = { ...child };
        walk(table);
        child.tagName = "div";
        child.properties = { className: ["table-wrap"], tabIndex: 0, role: "region", ariaLabel: "Table, scrollable" };
        child.children = [table];
        continue;
      }
      walk(child);
    }
  };
  return (tree) => walk(tree);
}

/**
 * The date each page was last checked (`verified:` in its front matter), as the sitemap's <lastmod>.
 * The home page gets the newest of them. A page with no date gets none.
 * @returns {Map<string, string>} page URL to YYYY-MM-DD
 */
function verifiedDates() {
  const dir = new URL("./src/content/docs/", import.meta.url);
  const out = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const text = readFileSync(new URL(f, dir), "utf8");
    const slug = text.match(/^slug:\s*(\S+)/m)?.[1];
    const date = text.match(/^verified:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
    if (slug && date) out.set(`https://agentsofmine.github.io${BASE}/${slug}/`, date);
  }
  out.set(`https://agentsofmine.github.io${BASE}/`, [...out.values()].sort().at(-1) ?? "");
  return out;
}
const LASTMOD = verifiedDates();

export default defineConfig({
  site: "https://agentsofmine.github.io",
  base: BASE,
  trailingSlash: "always",
  output: "static",
  // GitHub Pages cannot send a Content-Security-Policy header, so the page carries one as a <meta> tag (see Base.astro).
  // That policy refuses inline styles, so CSS is never inlined.
  build: { inlineStylesheets: "never" },
  markdown: { syntaxHighlight: false, rehypePlugins: [docsMarkdown, rehypeTakeaway, rehypeHighlight, rehypeCard] },
  integrations: [
    sitemap({
      serialize(item) {
        const d = LASTMOD.get(item.url);
        return d ? { ...item, lastmod: d } : item;
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
