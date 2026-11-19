// Fails if the highlighter ever changes the text of a code block: joining its pieces must give the source back.
import fs from "node:fs";
import path from "node:path";
import { tokenize } from "../src/lib/rehype-highlight.mjs";

const dir = new URL("../src/content/", import.meta.url).pathname;
let blocks = 0;
const bad = [];
const walk = (d) => {
  for (const name of fs.readdirSync(d)) {
    const p = path.join(d, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".md")) {
      for (const m of fs.readFileSync(p, "utf8").matchAll(/```(\w*)\n([\s\S]*?)```/g)) {
        blocks += 1;
        if (tokenize(m[1], m[2]).map((t) => t.text).join("") !== m[2]) bad.push(`${path.relative(dir, p)} (${m[1] || "no language"})`);
      }
    }
  }
};
walk(dir);
const extra = [
  ["sql", "SELECT 'it''s' AS x -- c\nFROM t;"],
  ["sh", 'echo "a $B" # c\nfor f in *; do :; done'],
  ["python", 'x = f"{a}" # c\nprint("""a\nb""")'],
  ["sql", "SELECT 'unterminated"],
  ["json", '{"a": [1, 2.5e3, null]}'],
];
for (const [lang, src] of extra) if (tokenize(lang, src).map((t) => t.text).join("") !== src) bad.push(`built-in ${lang}`);
if (tokenize("text", "SELECT 1").some((t) => t.cls)) bad.push("a text block was colored");
if (bad.length) {
  console.error(`FAIL highlight: text changed in ${bad.join(", ")}`);
  process.exit(1);
}
console.log(`ok: highlighter keeps the text of ${blocks} code blocks`);
