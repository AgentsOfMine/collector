#!/usr/bin/env node
// Fails when what a docs page SAYS about the collector no longer matches the collector's code.
// The pages are read by people deciding whether to install it; a page that quietly stops being true is worse than none.
//   node scripts/check-drift.mjs        (after `npm run build`, run by `npm run check`)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SITE = resolve(import.meta.dirname, "..");
const REPO = resolve(SITE, "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");
const doc = (n) => readFileSync(join(SITE, "src/content/docs", n + ".md"), "utf8");
const failures = [];
const must = (cond, rule, detail) => { if (!cond) failures.push({ rule, detail }); };

const formats = doc("session-formats");
const sends = doc("what-the-collector-sends");
const addAgent = doc("add-an-agent");
const d4 = doc("claude-code-deletes-sessions-after-30-days");
const all = formats + sends + addAgent + d4;

// 1. The providers the code knows are the providers the pages name.
const providers = JSON.parse(read("src/core/providers.json")).providers;
const label = { opencode: "OpenCode", "claude-code": "Claude Code", codex: "Codex", pi: "Pi" };
for (const p of providers) {
  must(label[p] !== undefined, "provider-label", `provider "${p}" is in providers.json but this check has no display name for it: add one and document it`);
  must(label[p] && formats.includes(`## ${label[p]}`), "provider-section", `session-formats.md has no "## ${label[p]}" section`);
}
for (const h of formats.match(/^## (OpenCode|Claude Code|Codex|Pi)$/gm) ?? []) {
  const name = h.slice(3);
  must(providers.some((p) => label[p] === name), "provider-removed", `session-formats.md documents ${name}, which is not in providers.json`);
}

// 2. The paths in the code appear in the pages.
const paths = read("src/core/paths.ts");
for (const [needle, shown] of [
  ['".local", "share", "opencode", "opencode.db"', "~/.local/share/opencode/opencode.db"],
  ['".claude", "projects"', "~/.claude/projects/"],
  ['".codex", "sessions"', "~/.codex/sessions/"],
  ['".pi", "agent", "sessions"', "~/.pi/agent/sessions/"],
]) {
  must(paths.includes(needle), "path-moved", `src/core/paths.ts no longer contains ${needle}: the pages show ${shown}`);
  must(formats.includes(shown), "path-undocumented", `session-formats.md does not show ${shown}`);
}

// 3. The numbers the pages quote are the numbers in the code.
const trunc = read("src/core/message-truncation.ts");
const maxMsgs = trunc.match(/MAX_MESSAGES_PER_SESSION\s*=\s*(\d+)/)?.[1];
must(maxMsgs && sends.includes(`${maxMsgs}: the first one and the latest ${Number(maxMsgs) - 1}`), "message-cap", `code says ${maxMsgs} messages; what-the-collector-sends.md says otherwise`);
must(maxMsgs && d4.includes(`capped at ${maxMsgs} messages`), "message-cap-d4", `the 30-day page must quote the same cap (${maxMsgs})`);
const retry = read("src/core/http-client.ts");
const delays = retry.match(/RETRY_DELAYS_MS\s*=\s*\[([^\]]+)\]/)?.[1].split(",").map((s) => s.trim());
must(delays && sends.includes(`after ${delays[0]}, ${delays[1]} and ${delays[2]} milliseconds`), "retry-delays", `retry delays in code: ${delays}; the page says otherwise`);
const statuses = retry.match(/RETRYABLE_STATUS\s*=\s*\[([^\]]+)\]/)?.[1].split(",").map((s) => s.trim());
for (const s of statuses ?? []) must(sends.includes(`\`${s}\``), "retry-status", `status ${s} is retried in code and missing from the page`);
const engine = read("src/core/sync-engine.ts");
const batch = engine.match(/batchSize\s*\?\?\s*(\d+)/)?.[1];
must(batch && sends.includes(`${batch === "5" ? "five" : batch} sessions at a time`), "batch-size", `batch size in code is ${batch}`);
const runner = read("src/daemon/sync-runner.ts");
const debounce = runner.match(/debounceMs\s*\?\?\s*(\d+)/)?.[1];
must(debounce === "5000" && sends.includes("about five seconds"), "debounce", `debounce in code is ${debounce} ms`);
must(read("src/adapters/claude-code/content-blocks.ts").includes("slice(0, 500)") && sends.includes("| Tool output | 500 characters |"), "tool-output-cap", "tool output cap changed");
must(read("src/adapters/claude-code/content-blocks.ts").includes("slice(0, 64)") && sends.includes("| Image data | 64 characters"), "image-cap", "image cap changed");
must(read("src/adapters/claude-code/accumulator.ts").includes("slice(0, 80)") && sends.includes("| Session title | 80 characters |"), "title-cap", "title cap changed");

// 4. Every redaction rule in the code has a row in the table, and the table has no row the code lacks.
const redact = read("src/core/redact.ts");
const ruleNames = [...redact.matchAll(/name:\s*"([a-z-]+)"/g)].map((m) => m[1]);
const shownMarkers = [...sends.matchAll(/<REDACTED:([a-z-]+)>/g)].map((m) => m[1]);
// Three rules write the marker `secret` under their own rule names.
const MARKER_OF = { "secret-assignment": "secret", "key-value": "secret", "header-flag": "secret" };
for (const n of ruleNames) must(shownMarkers.includes(MARKER_OF[n] ?? n), "redaction-undocumented", `redaction rule "${n}" has no row in what-the-collector-sends.md`);
if (redact.includes('marker("private-key")')) must(shownMarkers.includes("private-key"), "redaction-undocumented", "private-key rule has no row");
for (const m of new Set(shownMarkers)) must(ruleNames.includes(m) || m === "secret" || m === "private-key" || m === "github-token", "redaction-removed", `the page lists <REDACTED:${m}> and the code has no such rule`);

// 5. Claims about what the collector does NOT do must still be true.
const src = (d) => readdirSync(join(REPO, d), { recursive: true }).filter((f) => String(f).endsWith(".ts")).map((f) => join(REPO, d, String(f)));
const srcText = src("src").map((f) => readFileSync(f, "utf8")).join("\n");
for (const v of ["CLAUDE_CONFIG_DIR", "OPENCODE_DB", "CODEX_HOME"]) {
  const reads = new RegExp(`process\\.env\\[?["'.]?${v}`).test(srcText);
  must(!reads, "env-var-now-read", `the collector now reads ${v}: the pages say it does not. Update session-formats.md, what-the-collector-sends.md and the 30-day page`);
}
must(!/subagents/.test(srcText), "subagents-now-read", "the collector now mentions subagent transcripts: the pages say it does not read them");
must(!/archived_sessions/.test(srcText), "archived-now-read", "the collector now reads archived_sessions: session-formats.md says it does not");
// A call, not an import: `rmSync(` or `unlinkSync(`; the import line has no opening parenthesis after the name.
const deletes = [...srcText.matchAll(/\b(unlinkSync|rmSync|rmdirSync|unlink|rmdir)\(/g)].length;
must(deletes === 1, "deletes", `expected exactly one file removal in src (config-repository clearLocalState), found ${deletes}: the pages say the collector deletes only its own state`);
const writes = src("src").filter((f) => /writeFileSync|appendFile|createWriteStream/.test(readFileSync(f, "utf8"))).map((f) => f.slice(REPO.length + 1)).sort();
must(JSON.stringify(writes) === JSON.stringify(["src/core/cursor-store.ts", "src/core/last-sync-store.ts", "src/infrastructure/config-repository.ts"]), "write-paths", `files that write: ${writes.join(", ")}: the page names exactly three`);
// redact.ts is left out: it names vendor token formats (an OAuth client secret prefix) by design, and only matches them.
const srcNoRedact = src("src").filter((f) => !f.endsWith("redact.ts")).map((f) => readFileSync(f, "utf8")).join("\n");
must(!/anthropic\.com|api\.openai\.com|api\.github\.com|copilot|oauth|client_secret/i.test(srcNoRedact), "provider-login", "the collector source now mentions a provider login: the page says it prints nothing for that search");
const verbs = [...srcText.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
must(verbs.every((v) => v === "POST" || v === "GET"), "http-verbs", `the collector now sends ${[...new Set(verbs)]}`);

// 6. Page front matter points at a commit that exists in this checkout, and is not older than the pages' claims.
const commit = (sends.match(/commit ([0-9a-f]{7})/) ?? [])[1];
must(commit !== undefined, "commit-named", "what-the-collector-sends.md must name the commit it was checked against");

if (failures.length) {
  console.error(`\nDRIFT: ${failures.length} claim(s) on the docs pages no longer match the collector\n`);
  for (const f of failures) console.error(`  [${f.rule}] ${f.detail}`);
  console.error("\nFix the page, or the code, then change `verified` and `checkedAgainst` on the page.\n");
  process.exit(1);
}
console.log(`ok: ${providers.length} providers, ${ruleNames.length} redaction rules, limits and "does not" claims match the code`);
