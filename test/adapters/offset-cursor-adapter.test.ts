import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  OffsetCursorAdapter,
  parseOffsetCursor,
  fileSize,
  type SessionFileReader,
} from "../../src/adapters/offset-cursor-adapter.js";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code/index.js";
import { PiAdapter } from "../../src/adapters/pi/index.js";
import type { CanonicalMessage, CanonicalSession } from "../../src/core/canonical.js";
import type { SyncItem } from "../../src/adapters/adapter.js";

/** A minimal adapter: every JSONL line `{"id","text"}` is one message. */
class LineAdapter extends OffsetCursorAdapter {
  readonly name = "line";
  constructor(private readonly files: string[]) {
    super();
  }
  protected findSessionFiles(): string[] {
    return this.files;
  }
  protected openReader(filePath: string): SessionFileReader {
    const messages: CanonicalMessage[] = [];
    return {
      apply: (line) => {
        const l = line as { id: string; text: string };
        messages.push({
          messageId: l.id,
          sessionId: filePath,
          role: "user",
          senderName: "You",
          createdAt: "2026-01-01T00:00:00.000Z",
          parts: [{ type: "text", text: l.text }],
        });
      },
      messageCount: () => messages.length,
      messages: () => messages,
      finalize: () =>
        ({
          sessionId: filePath,
          provider: "pi",
          title: `whole file has ${messages.length}`,
          startedAt: "2026-01-01T00:00:00.000Z",
        }) as unknown as CanonicalSession,
    };
  }
}

const row = (id: string, text = id) => JSON.stringify({ id, text }) + "\n";

describe("parseOffsetCursor", () => {
  it("returns {} for null, empty, malformed and non-object cursors", () => {
    expect(parseOffsetCursor(null)).toEqual({});
    expect(parseOffsetCursor("")).toEqual({});
    expect(parseOffsetCursor("not json")).toEqual({});
    expect(parseOffsetCursor("42")).toEqual({});
    expect(parseOffsetCursor("[1,2]")).toEqual({});
  });

  it("parses a per-file offset map", () => {
    expect(parseOffsetCursor('{"/a.jsonl":10}')).toEqual({ "/a.jsonl": 10 });
  });
});

describe("fileSize", () => {
  it("is -1 for a missing file", () => {
    expect(fileSize("/definitely/not/here.jsonl")).toBe(-1);
  });
});

describe("OffsetCursorAdapter", () => {
  let dir: string;
  let a: string;
  let b: string;
  let cursor: string | null;

  async function pass(adapter: OffsetCursorAdapter): Promise<SyncItem[]> {
    const out: SyncItem[] = [];
    for await (const item of adapter.listNewSessions({ value: cursor })) {
      out.push(item);
      cursor = item.cursor;
    }
    return out;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aom-offset-"));
    a = join(dir, "a.jsonl");
    b = join(dir, "b.jsonl");
    cursor = null;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("sends a whole new file, with session fields taken from the whole file", async () => {
    writeFileSync(a, row("m1") + row("m2"));
    const out = await pass(new LineAdapter([a]));
    expect(out).toHaveLength(1);
    expect(out[0]!.session.messages.map((m) => m.messageId)).toEqual(["m1", "m2"]);
    expect(out[0]!.session.title).toBe("whole file has 2");
  });

  it("sends only appended messages, but describes the whole file", async () => {
    writeFileSync(a, row("m1") + row("m2"));
    const adapter = new LineAdapter([a]);
    await pass(adapter);

    appendFileSync(a, row("m3"));
    const out = await pass(adapter);
    expect(out).toHaveLength(1);
    expect(out[0]!.session.messages.map((m) => m.messageId)).toEqual(["m3"]);
    expect(out[0]!.session.title).toBe("whole file has 3");
  });

  it("emits nothing when no file has grown", async () => {
    writeFileSync(a, row("m1"));
    const adapter = new LineAdapter([a]);
    await pass(adapter);
    expect(await pass(adapter)).toEqual([]);
  });

  it("leaves a half-written last line for the next pass", async () => {
    writeFileSync(a, row("m1") + '{"id":"m2","te');
    const adapter = new LineAdapter([a]);
    const first = await pass(adapter);
    expect(first[0]!.session.messages.map((m) => m.messageId)).toEqual(["m1"]);

    appendFileSync(a, 'xt":"m2"}\n');
    const second = await pass(adapter);
    expect(second[0]!.session.messages.map((m) => m.messageId)).toEqual(["m2"]);
  });

  it("tracks each file's offset independently in one cursor", async () => {
    writeFileSync(a, row("a1"));
    writeFileSync(b, row("b1"));
    const adapter = new LineAdapter([a, b]);
    expect(await pass(adapter)).toHaveLength(2);

    appendFileSync(b, row("b2"));
    const out = await pass(adapter);
    expect(out).toHaveLength(1);
    expect(out[0]!.session.messages.map((m) => m.messageId)).toEqual(["b2"]);
    expect(Object.keys(JSON.parse(cursor!) as object).sort()).toEqual([a, b].sort());
  });

  it("skips files that have disappeared", async () => {
    expect(await pass(new LineAdapter([join(dir, "gone.jsonl")]))).toEqual([]);
  });

  it("restarts from 0 when a file was replaced by a shorter one", async () => {
    writeFileSync(a, row("m1") + row("m2") + row("m3"));
    const adapter = new LineAdapter([a]);
    await pass(adapter);

    writeFileSync(a, row("n1"));
    const out = await pass(adapter);
    expect(out[0]!.session.messages.map((m) => m.messageId)).toEqual(["n1"]);
  });

  it("applies the message cap to what it sends", async () => {
    writeFileSync(a, Array.from({ length: 200 }, (_, i) => row(`m${i}`)).join(""));
    const out = await pass(new LineAdapter([a]));
    expect(out[0]!.session.messages).toHaveLength(150);
  });
});

describe("shared base", () => {
  it("is what both JSONL adapters are built on", () => {
    expect(new ClaudeCodeAdapter("/nowhere/*/*.jsonl")).toBeInstanceOf(OffsetCursorAdapter);
    expect(new PiAdapter("/nowhere")).toBeInstanceOf(OffsetCursorAdapter);
  });

  it("keeps the provider names the cursor store keys on", () => {
    expect(new ClaudeCodeAdapter("/nowhere/*/*.jsonl").name).toBe("claude-code");
    expect(new PiAdapter("/nowhere").name).toBe("pi");
  });
});
