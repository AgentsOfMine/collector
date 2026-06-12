import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Adapter, SyncItem } from "../../src/adapters/adapter.js";
import { PiAdapter } from "../../src/adapters/pi/index.js";
import { ClaudeCodeAdapter } from "../../src/adapters/claude-code/index.js";
import { CodexAdapter } from "../../src/adapters/codex/index.js";
import { validateSession } from "../../src/core/canonical.js";
import { KNOWN_PROVIDERS } from "../../src/core/providers.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aom-hello-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function firstSession(adapter: Adapter): Promise<SyncItem | null> {
  for await (const item of adapter.listNewSessions({ value: null })) {
    return item;
  }
  return null;
}

describe("hello-world session per file-based connector", () => {
  it("pi: parses a minimal hello-world session", async () => {
    const dir = join(root, "pi", "--proj--");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-01-01T00-00-00-000Z_hello.jsonl"),
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "pi-hello",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: "/proj",
        }),
        JSON.stringify({
          type: "message",
          id: "u1",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: "print hello world in python" },
        }),
        JSON.stringify({
          type: "message",
          id: "a1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "print('hello world')" }],
            provider: "openai",
            model: "gpt-4o",
          },
        }),
      ].join("\n") + "\n",
    );

    const item = await firstSession(new PiAdapter(join(root, "pi")));
    expect(item).not.toBeNull();
    const session = validateSession(item!.session);
    expect(session.provider).toBe("pi");
    expect(session.sessionId).toBe("pi-hello");
    expect(session.messageCount).toBe(2);
    expect(item!.session.messages?.length).toBe(2);
  });

  it("claude-code: parses a minimal hello-world session", async () => {
    const dir = join(root, "claude", "projects", "proj");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "hello.jsonl"),
      [
        JSON.stringify({
          uuid: "u1",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { role: "user", content: "print hello world in python" },
        }),
        JSON.stringify({
          uuid: "a1",
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            role: "assistant",
            model: "claude-3-5-sonnet",
            content: [{ type: "text", text: "print('hello world')" }],
          },
        }),
      ].join("\n") + "\n",
    );

    const item = await firstSession(
      new ClaudeCodeAdapter(join(root, "claude", "projects", "*", "*.jsonl")),
    );
    expect(item).not.toBeNull();
    const session = validateSession(item!.session);
    expect(session.provider).toBe("claude-code");
    expect(session.messageCount).toBeGreaterThan(0);
  });

  it("codex: parses a minimal hello-world rollout", async () => {
    const dir = join(root, "codex", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "rollout-2026-01-01-hello.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-01-01T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-hello", cwd: "/proj" },
        }),
        JSON.stringify({
          timestamp: "2026-01-01T00:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "print hello world" }],
          },
        }),
      ].join("\n") + "\n",
    );

    const item = await firstSession(new CodexAdapter(join(root, "codex", "sessions")));
    expect(item).not.toBeNull();
    const session = validateSession(item!.session);
    expect(session.provider).toBe("codex");
    expect(session.sessionId).toBe("codex-hello");
  });

  it("every registered provider has a coverage entry here", () => {
    const covered = new Set(["pi", "claude-code", "codex", "opencode"]);
    for (const p of KNOWN_PROVIDERS) {
      expect(covered.has(p)).toBe(true);
    }
  });
});
