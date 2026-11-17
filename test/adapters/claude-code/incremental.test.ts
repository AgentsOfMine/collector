import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code/index.js";
import type { SyncItem } from "../../../src/adapters/adapter.js";

const CWD = "/Users/dev/Projects/my-app";

function user(ts: string, text: string, uuid: string): string {
  return JSON.stringify({ type: "user", uuid, timestamp: ts, cwd: CWD, message: { role: "user", content: text } }) + "\n";
}
function assistant(ts: string, text: string, uuid: string): string {
  return (
    JSON.stringify({
      type: "assistant",
      uuid,
      timestamp: ts,
      cwd: CWD,
      message: { role: "assistant", model: "claude-x", content: [{ type: "text", text }] },
    }) + "\n"
  );
}

describe("ClaudeCodeAdapter — repeated passes over a growing session file", () => {
  let root: string;
  let file: string;
  let adapter: ClaudeCodeAdapter;
  let cursor: string | null;

  async function pass(): Promise<SyncItem[]> {
    const out: SyncItem[] = [];
    for await (const item of adapter.listNewSessions({ value: cursor })) {
      out.push(item);
      cursor = item.cursor;
    }
    return out;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aom-cc-inc-"));
    const projects = join(root, "projects");
    const keyDir = join(projects, "-Users-dev-Projects-my-app");
    mkdirSync(keyDir, { recursive: true });
    file = join(keyDir, "sess-1.jsonl");
    writeFileSync(
      file,
      user("2026-06-01T10:00:00.000Z", "build the thing", "u1") + assistant("2026-06-01T10:00:05.000Z", "ok", "a1"),
    );
    adapter = new ClaudeCodeAdapter(join(projects, "*", "*.jsonl"));
    cursor = null;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("keeps the session's true startedAt, title and count when lines are appended", async () => {
    const first = await pass();
    expect(first).toHaveLength(1);

    appendFileSync(file, user("2026-06-01T10:05:00.000Z", "now add tests", "u2") + assistant("2026-06-01T10:05:09.000Z", "done", "a2"));
    const second = await pass();

    expect(second).toHaveLength(1);
    const s = second[0]!.session;
    expect(s.startedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(s.endedAt).toBe("2026-06-01T10:05:09.000Z");
    expect(s.title).toBe("build the thing");
    expect(s.messageCount).toBe(4);
    expect(s.messages.map((m) => m.messageId)).toEqual(["u2", "a2"]);
  });

  it("sends nothing when the file has not changed", async () => {
    await pass();
    expect(await pass()).toHaveLength(0);
    expect(await pass()).toHaveLength(0);
  });

  it("sends only the new messages after an append, never the last old one again", async () => {
    await pass();
    appendFileSync(file, user("2026-06-01T10:05:00.000Z", "more", "u2"));
    const items = await pass();
    expect(items[0]!.session.messages.map((m) => m.messageId)).toEqual(["u2"]);
    expect(await pass()).toHaveLength(0);
  });

  it("does not skip a half-written last line; it is picked up once complete", async () => {
    await pass();
    const full = user("2026-06-01T10:05:00.000Z", "late", "u2");
    appendFileSync(file, full.slice(0, 40));
    expect(await pass()).toHaveLength(0);

    appendFileSync(file, full.slice(40));
    const items = await pass();
    expect(items).toHaveLength(1);
    expect(items[0]!.session.messages.map((m) => m.messageId)).toEqual(["u2"]);
    expect(items[0]!.session.startedAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("counts lines from an edit whose result arrives in a later pass", async () => {
    await pass();
    appendFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        uuid: "a2",
        timestamp: "2026-06-01T10:06:00.000Z",
        cwd: CWD,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "/x/a.ts", content: "a\nb\nc" } }],
        },
      }) + "\n",
    );
    await pass();
    appendFileSync(
      file,
      JSON.stringify({
        type: "user",
        uuid: "u3",
        timestamp: "2026-06-01T10:06:01.000Z",
        cwd: CWD,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      }) + "\n",
    );
    const items = await pass();
    expect(items).toHaveLength(1);
    expect(items[0]!.session.linesAdded).toBe(3);
    expect(items[0]!.session.filesChanged).toEqual(["/x/a.ts"]);
  });

  it("starts again from the top if the file was replaced by a shorter one", async () => {
    await pass();
    writeFileSync(file, user("2026-06-02T09:00:00.000Z", "fresh", "n1"));
    const items = await pass();
    expect(items).toHaveLength(1);
    expect(items[0]!.session.startedAt).toBe("2026-06-02T09:00:00.000Z");
    expect(items[0]!.session.messages.map((m) => m.messageId)).toEqual(["n1"]);
  });

  it("re-sends one message at most when resuming from a cursor written by 0.1.0", async () => {
    // 0.1.0 stored the byte offset of the START of the last line it read.
    const lastLineStart = Buffer.byteLength(user("2026-06-01T10:00:00.000Z", "build the thing", "u1"));
    cursor = JSON.stringify({ [file]: lastLineStart });
    const items = await pass();
    expect(items).toHaveLength(1);
    expect(items[0]!.session.startedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(items[0]!.session.messages.map((m) => m.messageId)).toEqual(["a1"]);
    expect(await pass()).toHaveLength(0);
  });
});

describe("ClaudeCodeAdapter — unchanged files are not re-read", () => {
  it("skips a file whose size equals the saved offset", async () => {
    const root = mkdtempSync(join(tmpdir(), "aom-cc-skip-"));
    try {
      const projects = join(root, "projects");
      const keyDir = join(projects, "-Users-dev-Projects-my-app");
      mkdirSync(keyDir, { recursive: true });
      const file = join(keyDir, "s.jsonl");
      const body = user("2026-06-01T10:00:00.000Z", "hi", "u1");
      writeFileSync(file, body);
      const adapter = new ClaudeCodeAdapter(join(projects, "*", "*.jsonl"));
      const first: SyncItem[] = [];
      for await (const i of adapter.listNewSessions({ value: null })) first.push(i);
      expect(JSON.parse(first[0]!.cursor)).toEqual({ [file]: Buffer.byteLength(body) });
      const again: SyncItem[] = [];
      for await (const i of adapter.listNewSessions({ value: first[0]!.cursor })) again.push(i);
      expect(again).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
