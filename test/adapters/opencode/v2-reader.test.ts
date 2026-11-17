import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenCodeAdapter } from "../../../src/adapters/opencode/index.js";
import { detectSchema } from "../../../src/adapters/opencode/sqlite-reader.js";
import { queryMessagesV2 } from "../../../src/adapters/opencode/v2-reader.js";
import type { SyncItem } from "../../../src/adapters/adapter.js";

const V2_SCHEMA = `
  CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
  CREATE TABLE session_v2 (
    id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT, model TEXT,
    time_created INTEGER, time_updated INTEGER,
    summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER, summary_diffs TEXT
  );
  CREATE TABLE session_message (
    id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
    time_created INTEGER, time_updated INTEGER, data TEXT
  );
`;

describe("OpenCode v2 schema", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aom-oc-v2-"));
    dbPath = join(dir, "opencode.db");
    const db = new Database(dbPath);
    db.exec(V2_SCHEMA);
    db.prepare("INSERT INTO project VALUES (?, ?)").run("p1", "/home/dev/repo");
    const s = db.prepare("INSERT INTO session_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    s.run("ses_new", "p1", null, "New session", '{"id":"m","variant":"default"}', 1_800_000_000_000, 1_800_000_100_000, null, null, null, null);
    s.run("ses_child", "p1", "ses_new", "Child", null, 1_800_000_050_000, 1_800_000_060_000, null, null, null, null);
    const m = db.prepare("INSERT INTO session_message VALUES (?,?,?,?,?,?,?)");
    m.run("m1", "ses_new", "user", 1, 1_800_000_001_000, 1_800_000_001_000, JSON.stringify({ time: { created: 1_800_000_001_000 }, text: "fix it", files: [], agents: [] }));
    m.run("m2", "ses_new", "system", 2, 1_800_000_002_000, 1_800_000_002_000, JSON.stringify({ text: "sys" }));
    m.run("m3", "ses_new", "assistant", 3, 1_800_000_003_000, 1_800_000_003_000, JSON.stringify({
      time: { created: 1_800_000_003_000 },
      finish: "stop",
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "done" },
        { type: "tool", id: "t1", name: "edit", state: { status: "completed", input: { filePath: "/a.ts", oldString: "x", newString: "y\nz" }, content: [{ type: "text", text: "ok" }] } },
        { type: "unknown-thing" },
      ],
    }));
    m.run("m4", "ses_new", "idle", 4, 1_800_000_004_000, 1_800_000_004_000, JSON.stringify({ outcome: "succeeded" }));
    db.close();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("detects v2 when session_v2 exists and v1 otherwise", () => {
    const db = new Database(dbPath, { readonly: true });
    expect(detectSchema(db)).toBe("v2");
    db.close();
    const legacy = new Database(join(dir, "legacy.db"));
    legacy.exec("CREATE TABLE session (id TEXT)");
    expect(detectSchema(legacy)).toBe("v1");
    legacy.close();
  });

  it("maps user and assistant messages, skipping system and idle rows", () => {
    const db = new Database(dbPath, { readonly: true });
    const msgs = queryMessagesV2(db, "ses_new");
    db.close();
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[0]!.parts).toEqual([{ type: "text", text: "fix it" }]);
    expect(msgs[1]!.parts.map((p) => p.type)).toEqual(["reasoning", "text", "tool"]);
    expect(msgs[1]!.parts[2]).toMatchObject({ type: "tool", tool: "edit", callId: "t1", output: "ok" });
  });

  it("yields top-level v2 sessions with messages and derived file changes", async () => {
    const out: SyncItem[] = [];
    for await (const item of new OpenCodeAdapter(dbPath, "/home/dev").listNewSessions({ value: null })) out.push(item);
    expect(out).toHaveLength(1);
    const s = out[0]!.session;
    expect(s.sessionId).toBe("ses_new");
    expect(s.title).toBe("New session");
    expect(s.filesChanged).toEqual(["/a.ts"]);
    expect(s.messages).toHaveLength(2);
  });

  it("sends nothing when the watermark is past every message", async () => {
    const out: SyncItem[] = [];
    const cursor = { value: JSON.stringify({ v: 2, w: 1_800_000_010_000 }) };
    for await (const item of new OpenCodeAdapter(dbPath, "/home/dev").listNewSessions(cursor)) out.push(item);
    expect(out).toHaveLength(0);
  });

  it("re-sends an existing session with only the messages past the watermark", async () => {
    const db = new Database(dbPath);
    db.prepare("INSERT INTO session_message VALUES (?,?,?,?,?,?,?)").run(
      "m5", "ses_new", "user", 5, 1_800_000_020_000, 1_800_000_020_000,
      JSON.stringify({ time: { created: 1_800_000_020_000 }, text: "one more thing" }),
    );
    db.close();

    const out: SyncItem[] = [];
    const cursor = { value: JSON.stringify({ v: 2, w: 1_800_000_010_000 }) };
    for await (const item of new OpenCodeAdapter(dbPath, "/home/dev").listNewSessions(cursor)) out.push(item);

    expect(out).toHaveLength(1);
    const s = out[0]!.session;
    expect(s.sessionId).toBe("ses_new");
    expect(s.startedAt).toBe(new Date(1_800_000_000_000).toISOString());
    expect(s.messages.map((m) => m.messageId)).toEqual(["m5"]);
    // session-level counts still describe the whole session, not just the delta
    expect(s.filesChanged).toEqual(["/a.ts"]);
  });

  it("holds back a trailing assistant message that is still streaming", async () => {
    const db = new Database(dbPath);
    const now = Date.now();
    db.prepare("UPDATE session_v2 SET time_updated = ? WHERE id = 'ses_new'").run(now);
    db.prepare("INSERT INTO session_message VALUES (?,?,?,?,?,?,?)").run(
      "m6", "ses_new", "assistant", 6, now - 1_000, now - 1_000,
      JSON.stringify({ time: { created: now - 1_000 }, content: [{ type: "text", text: "partial" }] }),
    );
    db.close();

    const out: SyncItem[] = [];
    const cursor = { value: JSON.stringify({ v: 2, w: 1_800_000_010_000 }) };
    for await (const item of new OpenCodeAdapter(dbPath, "/home/dev").listNewSessions(cursor)) out.push(item);

    expect(out).toHaveLength(0);
  });

  it("advances the watermark only on the final item", async () => {
    const out: SyncItem[] = [];
    for await (const item of new OpenCodeAdapter(dbPath, "/home/dev").listNewSessions({ value: null })) out.push(item);
    const cursors = out.map((i) => JSON.parse(i.cursor) as { v: number; w: number });
    expect(cursors[cursors.length - 1]!.v).toBe(2);
    // never ahead of the wall clock, so a later-committed row can't be skipped
    expect(cursors[cursors.length - 1]!.w).toBeLessThanOrEqual(Date.now());
    expect(cursors[cursors.length - 1]!.w).toBeGreaterThan(0);
  });

  it("treats a legacy ISO cursor as a watermark", async () => {
    const out: SyncItem[] = [];
    const cursor = { value: new Date(1_800_000_002_500).toISOString() };
    for await (const item of new OpenCodeAdapter(dbPath, "/home/dev").listNewSessions(cursor)) out.push(item);
    expect(out).toHaveLength(1);
    expect(out[0]!.session.messages.map((m) => m.messageId)).toEqual(["m3"]);
  });
});
