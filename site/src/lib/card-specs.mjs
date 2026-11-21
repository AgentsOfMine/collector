// One picture per docs page, drawn from a small spec. Read DESIGN.md "Post image (the card)" first.
// scripts/make-cards.mjs and src/lib/rehype-card.mjs are byte-identical to the blog's; this file is the docs site's own.
// Colors are the design tokens (global.css); nothing else is allowed here. The page title is never in the picture, and
// the docs are public: a picture holds only words and numbers that its page already states.
// Each docs page uses a different template (the check allows at most two per template).
//
// kinds: tree, compare, flow, list, redact, laptop, stack, move, board, api, pr, search, agent (see the blog's spec file for fields)

/** Where the site is served: the blog is at the root, the docs under /collector. */
export const CARD_BASE = "/collector";

export const CARDS = {
  "session-formats": {
    alt: "Four agents keep their sessions in different shapes: OpenCode in one SQLite database, Claude Code and Codex in JSONL files, Pi in JSONL files per project.",
    kind: "tree",
    accent: "blue",
    tree: [
      { t: "OpenCode", c: "blue", tag: ["1 database", "n4"] },
      { t: "Claude Code", c: "purple", tag: ["JSONL", "n4"] },
      { t: "Codex", c: "n4", tag: ["JSONL", "n4"] },
      { t: "Pi", c: "n4", tag: ["JSONL", "n4"] },
    ],
    targets: ["SQLite", "per session", "per day"],
    thumb: { tree: [{ t: "OpenCode", c: "blue" }, { t: "Claude Code", c: "purple" }], targets: ["SQLite", "JSONL", "JSONL"] },
  },
  "what-the-collector-sends": {
    alt: "Before upload the collector swaps secrets for markers such as REDACTED api-key, sends at most 150 messages per session and cuts tool output to 500 characters.",
    kind: "redact",
    accent: "purple",
    lines: [
      [{ t: '"prompt":', key: true }, { t: "deploy with <REDACTED:api-key>", leak: false }],
      [{ t: '"output":', key: true }, { t: "first 500 characters", leak: false }],
      [{ t: '"messages":', key: true }, { t: "first, and the latest 149", leak: false }],
      [{ t: '"input":', key: true }, { t: "not limited", leak: false }],
    ],
    callouts: [{ line: 0, label: "redacted", ok: true, x: 700 }, { line: 2, label: "150 per session", ok: true, x: 700 }],
    thumb: { rows: [{ k: "mark", w: "<REDACTED>" }, { k: "bar", w: 440 }, { k: "bar", w: 300 }] },
  },
  "add-an-agent": {
    alt: "A new agent needs four steps in the collector: an id in providers.json, an adapter folder, one line in perform-sync and a watcher in start.",
    kind: "list",
    accent: "blue",
    rows: [
      { k: "1", v: "src/core/providers.json", tag: "add the id", ok: true, tone: "purple" },
      { k: "2", v: "src/adapters/<id>/", tag: "adapter", ok: true, tone: "purple" },
      { k: "3", v: "src/core/perform-sync.ts", tag: "create it", ok: true, tone: "purple" },
      { k: "4", v: "src/cli/start.ts", tag: "watcher", ok: true, tone: "purple" },
    ],
    thumb: { rows: [{ k: "id", v: "", tag: "1", ok: true, tone: "purple" }, { k: "adapter", v: "", tag: "2", ok: true, tone: "purple" }, { k: "watcher", v: "", tag: "4", ok: true, tone: "purple" }] },
  },
  "claude-code-deletes-sessions-after-30-days": {
    alt: "Claude Code keeps transcripts for 30 days by default, then a background sweep deletes them; a copy kept outside the Claude folder survives.",
    kind: "stack",
    accent: "purple",
    layers: 4,
    source: { name: "~/.claude/projects", icon: "folder", cmd: "rsync -a" },
    front: "backup, no --delete",
    caption: "30 days, then swept",
    thumb: { front: "30 days" },
  },
  "compaction-in-claude-code-opencode-codex": {
    alt: "Compaction replaces the older part of a long session with a summary and keeps the recent turns, so the context window frees up.",
    kind: "compare",
    accent: "purple",
    pills: [["before compaction", "n4"], ["after compaction", "ok"]],
    left: { name: "context", bars: [100, 100, 100, 100], tone: "bad", label: "older turns", value: "full", sub: "close to the limit" },
    right: { name: "context", bars: [24, 24, 24, 24], tone: "ok", label: "summary + recent", value: "free", sub: "room to continue" },
    thumb: {
      left: { name: "before", bars: [100, 100, 100], tone: "bad", label: "", value: "full", sub: "" },
      right: { name: "after", bars: [24, 24, 24], tone: "ok", label: "", value: "free", sub: "" },
    },
  },
  "resume-claude-code-session-from-another-folder": {
    alt: "A session created in folder A is resumed from folder B: by id it works on Claude Code 2.1.329 and not on 2.1.173, by path it works on both.",
    kind: "move",
    accent: "blue",
    from: { name: "folder A", path: "~/code/app-a", file: "<id>.jsonl", has: true },
    to: { name: "folder B", path: "~/code/app-b", file: "--resume <id>", has: false },
    cmd: "--resume",
    chips: [["2.1.329: by id", "ok"], ["2.1.173: by path", "n4"]],
    thumb: { from: "A", to: "B", fromPath: "~/app-a", toPath: "~/app-b" },
  },
};

/** Ideas rendered only with `npm run cards -- --samples <folder>`; the docs have none yet. */
export const SAMPLES = {};
