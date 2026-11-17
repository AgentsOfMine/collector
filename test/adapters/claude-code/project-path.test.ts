import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code/index.js";
import type { SyncItem } from "../../../src/adapters/adapter.js";

async function collect(adapter: ClaudeCodeAdapter): Promise<SyncItem[]> {
  const out: SyncItem[] = [];
  for await (const item of adapter.listNewSessions({ value: null })) out.push(item);
  return out;
}

describe("ClaudeCodeAdapter — project path from a real file", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aom-cc-path-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports the recorded cwd, so sessions group by project instead of by ~/.claude/projects", async () => {
    const projects = join(root, ".claude", "projects");
    const keyDir = join(projects, "-Users-dev-Projects-my-app");
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(
      join(keyDir, "sess-1.jsonl"),
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-01T10:00:00.000Z",
          cwd: "/Users/dev/Projects/my-app",
          message: { role: "user", content: "hello" },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-01T10:00:05.000Z",
          cwd: "/Users/dev/Projects/my-app",
          message: { role: "assistant", model: "claude-x", content: [{ type: "text", text: "hi" }] },
        }),
      ].join("\n") + "\n",
    );

    const items = await collect(new ClaudeCodeAdapter(join(projects, "*", "*.jsonl")));

    expect(items).toHaveLength(1);
    const session = items[0]!.session;
    expect(session.projectPath).toBe("/Users/dev/Projects/my-app");
    expect(session.projectPath).not.toBe(projects);
    expect(session.projectIdentity?.local.basename).toBe("my-app");
  });

  it("gives two projects two different paths", async () => {
    const projects = join(root, ".claude", "projects");
    for (const [key, cwd] of [
      ["-work-alpha", "/work/alpha"],
      ["-work-beta", "/work/beta"],
    ] as const) {
      mkdirSync(join(projects, key), { recursive: true });
      writeFileSync(
        join(projects, key, "s.jsonl"),
        JSON.stringify({
          type: "user",
          timestamp: "2026-06-01T10:00:00.000Z",
          cwd,
          message: { role: "user", content: "x" },
        }) + "\n",
      );
    }

    const items = await collect(new ClaudeCodeAdapter(join(projects, "*", "*.jsonl")));
    const paths = items.map((i) => i.session.projectPath).sort();
    expect(paths).toEqual(["/work/alpha", "/work/beta"]);
  });
});
