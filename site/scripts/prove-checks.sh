#!/bin/zsh
# Breaks each rule of the docs site's checks on purpose and requires `npm run check` (or `npm run csp`) to FAIL naming
# that rule. Before every test the working tree (this site, and the collector's own src/ and test/ that the drift check
# reads) is restored from a snapshot taken at the start, so one test cannot leave damage for the next.
# A guard that cannot fail is worth nothing. Run: npm run prove  (needs .forbidden-words, so on the owner's machine)
set -u
cd "$(dirname "$0")/.."
SNAP=$(mktemp -d)
KEEP=(src public scripts astro.config.mjs package.json tsconfig.json .forbidden-words)
for k in $KEEP; do cp -R "$k" "$SNAP/"; done
cp -R ../src "$SNAP/collector-src"

reset() {
  for k in $KEEP; do
    if [[ -d "$k" ]]; then rsync -a --delete "$SNAP/$k/" "$k/"; else cp "$SNAP/$k" "$k"; fi
  done
  rsync -a --delete "$SNAP/collector-src/" ../src/
}
trap 'reset; rm -rf "$SNAP"' EXIT INT TERM

ok=0; bad=0; ran=0
t() { # name, wanted text in the output, command to run (check or csp), shell code that breaks the tree
  local name=$1 want=$2 cmd=$3; shift 3
  ran=$((ran+1)); reset
  eval "$@"
  local out; out=$(npm run $cmd 2>&1); local rc=$?
  reset
  if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then echo "  PASS  $name  -> $want"; ok=$((ok+1))
  else echo "  FAIL  $name  (exit $rc, wanted \"$want\")"; echo "$out" | tail -4 | sed 's/^/        /'; bad=$((bad+1)); fi
}

echo "baseline must pass"
if npm run check >/dev/null 2>&1 && npm run csp >/dev/null 2>&1; then echo "  PASS  baseline"; else echo "  FAIL  baseline is red; fix that first"; exit 1; fi

WORD=$(grep -v "^#" .forbidden-words | grep -v "^$" | head -1)   # read from the local file, never written in this script
A=src/content/docs/about-these-docs.md
SF=src/content/docs/session-formats.md
WS=src/content/docs/what-the-collector-sends.md
PX="public/favicon-32.png"

echo "owner rules (public repo)"
t "employer word in a page"            "[forbidden-word]" check "printf '\n\nI work at %s.\n' \"$WORD\" >> $A"
t "employer word, lower case"          "[forbidden-word]" check "printf '\n\n%s is my employer.\n' \"${(L)WORD}\" >> $A"
t "employer word in front matter"      "[forbidden-word]" check 'sed -i "" "s|^title: About these docs|title: About these docs '"$WORD"'|" '"$A"
t "employer word in a source file"     "[forbidden-word]" check "printf '// %s\n' \"$WORD\" >> src/lib/format.ts"
t "LinkedIn link in a page"            "[linkedin]"       check "printf '\n\n[me](https://www.linkedin.com/in/someone/)\n' >> $A"
t "LinkedIn short link"                "[linkedin]"       check "printf '\n\nhttps://lnkd.in/abc\n' >> $A"
t "forbidden-words file missing"       "[forbidden-words]" check "rm .forbidden-words"

echo "no tracking"
t "third-party script"                 "[third-party-script]"  check "sed -i '' 's|</head>|<script is:inline src=\"https://example.com/a.js\"></script></head>|' src/layouts/Base.astro"
t "third-party stylesheet"             "[third-party-request]" check "sed -i '' 's|</head>|<link rel=\"stylesheet\" href=\"https://rsms.me/inter/inter.css\"></head>|' src/layouts/Base.astro"
t "third-party image"                  "[third-party-request]" check "printf '\n\n<img src=\"https://example.com/p.png\" alt=\"x\" width=\"1\" height=\"1\">\n' >> $A"
t "cookie write"                       "[storage]"             check "sed -i '' 's|</head>|<script is:inline>document.cookie=\"a=1\"</script></head>|' src/layouts/Base.astro"
t "inline script is blocked by the meta CSP" "violates the following Content Security Policy" csp "sed -i '' 's|</head>|<script is:inline>window.x=1</script></head>|' src/layouts/Base.astro"
t "meta CSP missing entirely (page would load anything)" "[csp-meta]" check "sed -i '' 's|<meta http-equiv=\"Content-Security-Policy\" content={SITE.csp} />||' src/layouts/Base.astro"
t "CSP allows another origin"          "[csp-meta]" check "sed -i '' \"s|script-src 'self'|script-src 'self' https://example.com|\" src/site.config.ts"
t "CSP allows unsafe-inline"           "[csp-meta]" check "sed -i '' \"s|style-src 'self'|style-src 'self' 'unsafe-inline'|\" src/site.config.ts"

echo "base path and links (GitHub Pages serves under /collector/)"
t "root-relative link, no base"        "[missing-base]"  check "printf '\n\n<a href=\"/add-an-agent/\">raw</a>\n' >> $A"
t "broken internal link"               "[broken-link]"   check "printf '\n\n[x](/collector/does-not-exist/)\n' >> $A"
t "broken in-page anchor"              "[anchor]"        check "printf '\n\n[x](#nowhere)\n' >> $A"
t "click here anchor"                  "[anchor-text]"   check "printf '\n\n[click here](/add-an-agent/)\n' >> $A"
t "canonical not on the Pages origin"  "[canonical]"     check "sed -i '' 's|const canonical = .*|const canonical = \"https://example.com/\";|' src/layouts/Base.astro"
t "orphan page"                        "[orphan]"        check "printf -- '---\ntitle: A page nothing links to at all\ndescription: A page that nothing links to, written to prove that the reachability rule really works.\nslug: lonely\norder: 9\nverified: 2026-11-19\ncheckedAgainst: nothing, a proof page\nkind: reference\n---\n\nNobody links here.\n' > src/content/docs/lonely.md; sed -i '' 's|kind: reference|kind: about|' src/content/docs/lonely.md"

echo "page quality"
t "two H1"                             "[h1]"            check "printf '\n\n<h1>Second</h1>\n' >> $A"
t "skipped heading level"              "[heading-order]" check "printf '\n\n#### Deep\n' >> $A"
t "image without alt"                  "[img-alt]"       check "printf '\n\n<img src=\"/collector/favicon-32.png\" width=\"32\" height=\"32\">\n' >> $A"
t "image without size"                 "[img-size]"      check "printf '\n\n<img src=\"/collector/favicon-32.png\" alt=\"x\">\n' >> $A"
t "inline SVG without a name"          "[svg-a11y]"      check "printf '\n\n<svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg>\n' >> $A"
t "style attribute (blocked by the CSP)" "[inline-style]" check "printf '\n\n<p style=\"color:red\">x</p>\n' >> $A"
t "no verified date (schema)"            "does not match collection schema" check "sed -i '' 's|^verified: .*||' $A"
t "duplicate page order"               "[duplicate-order]" check "sed -i '' 's|^order: 5|order: 1|' $A"

echo "images"
t "PNG with a text chunk"              "[image-metadata]" check "python3 -c \"
import struct,zlib
ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
open('public/note.png','wb').write(b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+ch(b'tEXt',b'Author\0someone')+ch(b'IDAT',zlib.compress(b'\0\0\0\0'))+ch(b'IEND',b''))\""
t "SVG with a metadata block"          "[image-metadata]" check "sed -i '' 's|</svg>|<metadata>x</metadata></svg>|' public/logo/logo-mark-dark-color.svg"
t "camera-style file name"             "[image-name]"     check "cp $PX public/IMG_2916.png"

echo "the pages stay true to the collector (drift check)"
t "a provider is added without documenting it" "[provider-section]" check "python3 - <<'PY'
import json; p='../src/core/providers.json'; d=json.load(open(p)); d['providers'].append('newagent'); json.dump(d,open(p,'w'))
PY"
t "a documented path moves"            "[path-moved]"    check "sed -i '' 's|\".codex\", \"sessions\"|\".codex\", \"history\"|' ../src/core/paths.ts"
t "the message cap changes"            "[message-cap]"   check "sed -i '' 's|MAX_MESSAGES_PER_SESSION = 150|MAX_MESSAGES_PER_SESSION = 200|' ../src/core/message-truncation.ts"
t "the retry delays change"            "[retry-delays]"  check "sed -i '' 's|\[100, 200, 400\]|[100, 200, 800]|' ../src/core/http-client.ts"
t "the batch size changes"             "[batch-size]"    check "sed -i '' 's|batchSize ?? 5|batchSize ?? 10|' ../src/core/sync-engine.ts"
t "the tool-output cap changes"        "[tool-output-cap]" check "sed -i '' 's|slice(0, 500)|slice(0, 900)|g' ../src/adapters/claude-code/content-blocks.ts"
t "a redaction rule is added"          "[redaction-undocumented]" check "sed -i '' 's|name: \"slack-token\",|name: \"slack-token\",\n  },\n  {\n    name: \"stripe-key\", pattern: /sk_live_[A-Za-z0-9]+/g,\n  },\n  {\n    name: \"slack-token\",|' ../src/core/redact.ts"
t "the collector starts reading CLAUDE_CONFIG_DIR" "[env-var-now-read]" check "printf '\nexport const x = process.env[\"CLAUDE_CONFIG_DIR\"];\n' >> ../src/core/paths.ts"
t "the collector starts reading subagent files" "[subagents-now-read]" check "printf '\n// reads the subagents folder\n' >> ../src/core/paths.ts"
t "the collector starts deleting files" "[deletes]"      check "printf '\nimport {rmSync} from \"node:fs\";\nexport const wipe = (p: string) => rmSync(p);\n' >> ../src/core/paths.ts"
t "a new file in src writes to disk"   "[write-paths]"   check "printf 'import {writeFileSync} from \"node:fs\";\nexport const w = (p: string) => writeFileSync(p, \"x\");\n' > ../src/core/extra-writer.ts"
t "the collector starts sending PUT"   "[http-verbs]"    check "printf '\nexport const o = { method: \"PUT\" };\n' >> ../src/core/paths.ts"
t "a provider login appears in the source" "[provider-login]" check "printf '\n// oauth flow\n' >> ../src/core/paths.ts"

t "a fake Search Console file with the wrong content is read as a page" "[h1]" check "printf 'hello' > public/google1111111111111111.html"
t "a Search Console file whose content names another file is read as a page" "[h1]" check "printf 'google-site-verification: other.html' > public/google2222222222222222.html"

echo
reset
DEFINED=$(grep -c '^t "' "$0")
[[ $ran -ne $DEFINED ]] && { echo "  FAIL  $DEFINED tests written but $ran ran: a test is not executing"; bad=$((bad+1)); }
if npm run check >/dev/null 2>&1; then echo "  PASS  baseline again"; else echo "  FAIL  baseline red after the run"; bad=$((bad+1)); fi
echo "$ok of $DEFINED rules proven, $bad problem(s)"
[[ $bad -eq 0 ]]
