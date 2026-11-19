/**
 * Colors code by token class at build time (DESIGN.md "Code highlighting"). No dependencies.
 *
 * It only wraps text in <span class="tok-..."> and never changes, drops or reorders a character: the
 * tokenizer consumes the source left to right, and anything no rule matches is kept as plain text.
 * A language it does not know, a block labelled `text`, and a block with no language stay plain.
 * No style attribute is ever written (the Content-Security-Policy blocks inline styles).
 */

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const SQL_KEYWORDS = words(`select from where and or not in is null as on join left right inner outer cross full using
  group by order having limit offset distinct union all insert into values update set delete create table index view
  drop alter add column primary key foreign references default unique case when then else end between like glob exists
  asc desc with pragma begin commit rollback if cast over partition`);
const SH_KEYWORDS = words("if then else elif fi for while until do done case esac in function");
const PY_KEYWORDS = words(`and as assert async await break class continue def del elif else except finally for from
  global if import in is lambda nonlocal not or pass raise return try while with yield match case`);
const PY_LITERALS = words("True False None");
const TS_KEYWORDS = words(`const let var function return if else for while do switch case break continue new class
  extends implements interface type enum import export from as default async await try catch finally throw typeof
  instanceof in of void readonly public private static`);
const TS_LITERALS = words("true false null undefined this");
const JSON_LITERALS = words("true false null");

const ident = (kw, lit = new Set(), insensitive = false) => ({
  re: /[A-Za-z_][A-Za-z0-9_]*/y,
  cls: (m) => {
    const w = insensitive ? m[0].toLowerCase() : m[0];
    if (lit.has(m[0])) return "tok-num";
    return kw.has(w) ? "tok-kw" : null;
  },
});

const RULES = {
  sql: [
    { re: /--[^\n]*/y, cls: "tok-com" },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: "tok-com" },
    { re: /'(?:[^']|'')*'?/y, cls: "tok-str" },
    { re: /\b\d+(?:\.\d+)?\b/y, cls: "tok-num" },
    ident(SQL_KEYWORDS, new Set(), true),
  ],
  sh: [
    { re: /(?<![^\s])#[^\n]*/y, cls: "tok-com" },
    { re: /"(?:[^"\\]|\\[\s\S])*"?/y, cls: "tok-str" },
    { re: /'[^']*'?/y, cls: "tok-str" },
    { re: /\$(?:\{[^}\n]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@#?!*-])/y, cls: "tok-num" },
    { re: /(?<![^\s])--?[A-Za-z][\w-]*/y, cls: "tok-kw" },
    ident(SH_KEYWORDS),
  ],
  python: [
    { re: /#[^\n]*/y, cls: "tok-com" },
    { re: /[rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y, cls: "tok-str" },
    { re: /[rRbBfFuU]{0,2}"(?:[^"\\\n]|\\[\s\S])*"?/y, cls: "tok-str" },
    { re: /[rRbBfFuU]{0,2}'(?:[^'\\\n]|\\[\s\S])*'?/y, cls: "tok-str" },
    { re: /\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, cls: "tok-num" },
    { re: /@[A-Za-z_][\w.]*/y, cls: "tok-kw" },
    ident(PY_KEYWORDS, PY_LITERALS),
  ],
  json: [
    { re: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, cls: "tok-kw" },
    { re: /"(?:[^"\\\n]|\\.)*"?/y, cls: "tok-str" },
    { re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, cls: "tok-num" },
    ident(new Set(), JSON_LITERALS),
  ],
  ts: [
    { re: /\/\/[^\n]*/y, cls: "tok-com" },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: "tok-com" },
    { re: /"(?:[^"\\\n]|\\.)*"?/y, cls: "tok-str" },
    { re: /'(?:[^'\\\n]|\\.)*'?/y, cls: "tok-str" },
    { re: /`(?:[^`\\]|\\[\s\S])*`?/y, cls: "tok-str" },
    { re: /\b\d[\d_]*(?:\.\d+)?\b/y, cls: "tok-num" },
    ident(TS_KEYWORDS, TS_LITERALS),
  ],
};

const ALIASES = {
  sql: "sql",
  sh: "sh", shell: "sh", bash: "sh", zsh: "sh", console: "sh",
  python: "python", py: "python",
  json: "json",
  ts: "ts", typescript: "ts", js: "ts", javascript: "ts",
};

/** @returns {Array<{text: string, cls: string | null}>} pieces whose texts join back to `source`. */
export function tokenize(lang, source) {
  const rules = RULES[ALIASES[lang]];
  if (!rules) return [{ text: source, cls: null }];
  const out = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ text: plain, cls: null });
    plain = "";
  };
  let i = 0;
  while (i < source.length) {
    let hit = null;
    for (const rule of rules) {
      rule.re.lastIndex = i;
      const m = rule.re.exec(source);
      if (m && m[0].length > 0) {
        const cls = typeof rule.cls === "function" ? rule.cls(m) : rule.cls;
        hit = { text: m[0], cls };
        break;
      }
    }
    if (hit === null) {
      plain += source[i];
      i += 1;
    } else if (hit.cls === null) {
      plain += hit.text;
      i += hit.text.length;
    } else {
      flush();
      out.push(hit);
      i += hit.text.length;
    }
  }
  flush();
  return out;
}

const classesOf = (node) => (Array.isArray(node.properties?.className) ? node.properties.className : []);

/** @returns {(tree: any) => void} */
export default function rehypeHighlight() {
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.tagName === "pre") {
        const code = (child.children ?? []).find((c) => c.type === "element" && c.tagName === "code");
        const lang = code && classesOf(code).map((c) => String(c).replace(/^language-/, "")).find((c) => ALIASES[c]);
        if (code && lang && code.children.length === 1 && code.children[0].type === "text") {
          code.children = tokenize(lang, code.children[0].value).map((t) =>
            t.cls === null
              ? { type: "text", value: t.text }
              : {
                  type: "element",
                  tagName: "span",
                  properties: { className: [t.cls] },
                  children: [{ type: "text", value: t.text }],
                },
          );
        }
        continue;
      }
      walk(child);
    }
  };
  return (tree) => walk(tree);
}
