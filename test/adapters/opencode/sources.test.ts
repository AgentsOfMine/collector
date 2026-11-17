import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { V1Source, V2Source } from "../../../src/adapters/opencode/sources.js";
import { OpenCodeAdapter } from "../../../src/adapters/opencode/index.js";
import { parseWatermark } from "../../../src/adapters/opencode/watermark.js";
import type { SyncItem } from "../../../src/adapters/adapter.js";

const T0 = 1_800_000_000_000;

function v1Db(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT, model TEXT,
      time_created INTEGER, time_updated INTEGER, summary_additions INTEGER, summary_deletions INTEGER,
      summary_files INTEGER, summary_diffs TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
  `);
  db.prepare("INSERT INTO project VALUES ('p1','/home/dev/repo')").run();
  db.prepare("INSERT INTO session VALUES ('old','p1',NULL,'Old session',NULL,?,?,NULL,NULL,NULL,NULL)").run(T0, T0 + 10);
  db.prepare("INSERT INTO message VALUES ('m1','old',?,?)").run(T0 + 1, JSON.stringify({ role: "user" }));
  db.prepare("INSERT INTO part VALUES ('p-1','m1',?)").run(JSON.stringify({ type: "text", text: "hello" }));
  db.prepare("INSERT INTO message VALUES ('m2','old',?,?)").run(T0 + 2, JSON.stringify({ role: "assistant" }));
  db.prepare("INSERT INTO part VALUES ('p-2','m2',?)").run(
    JSON.stringify({ type: "tool", tool: "write", state: { input: { filePath: "/a.ts", content: "x" } } }),
  );
  db.close();
}

function v2Db(path: string, nowMs: number): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT, model TEXT,
      time_created INTEGER, time_updated INTEGER, summary_additions INTEGER, summary_deletions INTEGER,
      summary_files INTEGER, summary_diffs TEXT);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
      time_created INTEGER, time_updated INTEGER, data TEXT);
  `);
  db.prepare("INSERT INTO project VALUES ('p1','/home/dev/repo')").run();
  const s = db.prepare("INSERT INTO session_v2 VALUES (?,?,NULL,?,NULL,?,?,NULL,NULL,NULL,NULL)");
  s.run("quiet", "p1", "Quiet", T0, T0 + 100);
  s.run("live", "p1", "Live", T0, nowMs);
  const m = db.prepare("INSERT INTO session_message VALUES (?,?,?,?,?,?,?)");
  const user = (id: string, sid: string, seq: number, t: number, text: string) =>
    m.run(id, sid, "user", seq, t, t, JSON.stringify({ time: { created: t }, text }));
  const asst = (id: string, sid: string, seq: number, t: number, finish: boolean) =>
    m.run(id, sid, "assistant", seq, t, t, JSON.stringify({
      time: { created: t },
      content: [{ type: "text", text: `reply ${id}` }],
      ...(finish ? { finish: "stop" } : {}),
    }));
  user("q1", "quiet", 1, T0 + 1, "hi");
  asst("q2", "quiet", 2, T0 + 2, true);
  user("l1", "live", 1, nowMs - 60_000, "go");
  asst("l2", "live", 2, nowMs - 30_000, false);
  db.close();
}

async function collect(adapter: OpenCodeAdapter, cursor: string | null): Promise<SyncItem[]> {
  const out: SyncItem[] = [];
  for await (const i of adapter.listNewSessions({ value: cursor })) out.push(i);
  return out;
}

describe("OpenCode sources", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aom-oc-src-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("V1Source sends a whole session once, cursor = its start time", () => {
    const path = join(dir, "v1.db");
    v1Db(path);
    const db = new Database(path, { readonly: true });
    const items = [...new V1Source().read(db, { value: null }, "/fallback")];
    db.close();

    expect(items).toHaveLength(1);
    expect(items[0]!.session.sessionId).toBe("old");
    expect(items[0]!.session.messages.map((m) => m.messageId)).toEqual(["m1", "m2"]);
    expect(items[0]!.session.filesChanged).toEqual(["/a.ts"]);
    expect(items[0]!.cursor).toBe(new Date(T0).toISOString());
  });

  it("V1Source skips sessions at or before the cursor", () => {
    const path = join(dir, "v1.db");
    v1Db(path);
    const db = new Database(path, { readonly: true });
    const items = [...new V1Source().read(db, { value: new Date(T0).toISOString() }, "/fallback")];
    db.close();
    expect(items).toEqual([]);
  });

  it("the adapter picks V1 or V2 by schema", async () => {
    const p1 = join(dir, "v1.db");
    const p2 = join(dir, "v2.db");
    v1Db(p1);
    v2Db(p2, Date.now() - 10 * 60_000);
    expect((await collect(new OpenCodeAdapter(p1, "/f"), null)).map((i) => i.session.sessionId)).toEqual(["old"]);
    expect((await collect(new OpenCodeAdapter(p2, "/f"), null)).map((i) => i.session.sessionId)).toEqual(["quiet", "live"]);
  });

  it("V2Source holds back a streaming message and keeps the watermark before it", () => {
    const now = 1_900_000_000_000;
    const path = join(dir, "v2.db");
    v2Db(path, now);
    const db = new Database(path, { readonly: true });
    const items = [...new V2Source(() => now).read(db, { value: null }, "/fallback")];
    db.close();

    const live = items.find((i) => i.session.sessionId === "live")!;
    expect(live.session.messages.map((m) => m.messageId)).toEqual(["l1"]);
    // the held message is older than the 5 s margin, so IT bounds the watermark
    expect(parseWatermark(items[items.length - 1]!.cursor)).toBe(now - 30_000 - 1);
  });

  it("V2Source: only the last item carries the advanced watermark", () => {
    const now = 1_900_000_000_000;
    const path = join(dir, "v2.db");
    v2Db(path, now - 10 * 60_000);
    const db = new Database(path, { readonly: true });
    const items = [...new V2Source(() => now).read(db, { value: null }, "/fallback")];
    db.close();

    expect(items.length).toBeGreaterThan(1);
    const cursors = items.map((i) => parseWatermark(i.cursor));
    expect(new Set(cursors.slice(0, -1))).toEqual(new Set([0]));
    expect(cursors[cursors.length - 1]).toBe(now - 5_000);
  });

  it("V2Source sends nothing when nothing is newer than the watermark", () => {
    const path = join(dir, "v2.db");
    v2Db(path, T0 + 500);
    const db = new Database(path, { readonly: true });
    const items = [...new V2Source(() => T0 + 10_000).read(db, { value: JSON.stringify({ v: 2, w: T0 + 1_000 }) }, "/f")];
    db.close();
    expect(items).toEqual([]);
  });
});
