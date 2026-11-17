import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiAdapter } from "../../../src/adapters/pi/index.js";
import type { SyncItem } from "../../../src/adapters/adapter.js";

const header =
  JSON.stringify({ type: "session", version: 3, id: "pi-sess-1", timestamp: "2026-06-03T10:00:00.000Z", cwd: "/home/user/proj" }) + "\n";

function msg(id: string, ts: string, role: "user" | "assistant", text: string): string {
  return (
    JSON.stringify({
      type: "message",
      id,
      timestamp: ts,
      message: { role, content: role === "user" ? text : [{ type: "text", text }], ...(role === "assistant" ? { model: "m", provider: "p" } : {}) },
    }) + "\n"
  );
}

describe("PiAdapter — repeated passes over a growing session file", () => {
  let root: string;
  let file: string;
  let adapter: PiAdapter;
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
    root = mkdtempSync(join(tmpdir(), "aom-pi-inc-"));
    const dir = join(root, "--home-user-proj--");
    mkdirSync(dir, { recursive: true });
    file = join(dir, "2026-06-03T10-00-00-000Z_019ebc41-4486-7f9a-a94b-0ed9e6fa37d1.jsonl");
    writeFileSync(file, header + msg("m1", "2026-06-03T10:00:01.000Z", "user", "first task") + msg("m2", "2026-06-03T10:00:03.000Z", "assistant", "done"));
    adapter = new PiAdapter(root);
    cursor = null;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("keeps the true startedAt, title and count across passes", async () => {
    expect(await pass()).toHaveLength(1);
    appendFileSync(file, msg("m3", "2026-06-03T10:09:00.000Z", "user", "exit"));
    const items = await pass();
    expect(items).toHaveLength(1);
    const s = items[0]!.session;
    expect(s.startedAt).toBe("2026-06-03T10:00:00.000Z");
    expect(s.title).toBe("first task");
    expect(s.messageCount).toBe(3);
    expect(s.messages.map((m) => m.messageId)).toEqual(["m3"]);
  });

  it("emits nothing when the file has not changed", async () => {
    await pass();
    expect(await pass()).toHaveLength(0);
    expect(await pass()).toHaveLength(0);
  });
});
