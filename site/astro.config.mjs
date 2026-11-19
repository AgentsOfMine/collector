// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import rehypeTakeaway from "./src/lib/rehype-takeaway.mjs";

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

export default defineConfig({
  site: "https://agentsofmine.github.io",
  base: BASE,
  trailingSlash: "always",
  output: "static",
  // GitHub Pages cannot send a Content-Security-Policy header, so the page carries one as a <meta> tag (see Base.astro).
  // That policy refuses inline styles, so CSS is never inlined.
  build: { inlineStylesheets: "never" },
  markdown: { syntaxHighlight: false, rehypePlugins: [docsMarkdown, rehypeTakeaway] },
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
});
