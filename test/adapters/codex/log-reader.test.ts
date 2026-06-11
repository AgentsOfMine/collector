import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCodexSessions } from "../../../src/adapters/codex/log-reader.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aom-codex-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeRollout(relPath: string, lines: object[]): void {
  const full = join(dir, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const META = {
  timestamp: "2026-06-10T07:26:05.003Z",
  type: "session_meta",
  payload: {
    id: "019eb06c-8a06-7020-b900-3db271769b93",
    timestamp: "2026-06-10T07:26:03.820Z",
    cwd: "/Users/dev/project",
  },
};

describe("readCodexSessions", () => {
  it("returns empty array for a non-existent directory", () => {
    expect(readCodexSessions(join(dir, "nope"))).toEqual([]);
  });

  it("parses a rollout file nested under YYYY/MM/DD", () => {
    writeRollout("2026/06/10/rollout-2026-06-10T09-26-03-019eb06c.jsonl", [
      META,
      {
        timestamp: "2026-06-10T07:30:00.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: "hi" },
      },
    ]);

    const sessions = readCodexSessions(dir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("019eb06c-8a06-7020-b900-3db271769b93");
    expect(sessions[0].projectPath).toBe("/Users/dev/project");
    expect(sessions[0].startedAt).toBe("2026-06-10T07:26:03.820Z");
    expect(sessions[0].messageCount).toBe(1);
  });

  it("collects shell commands from exec_command function calls", () => {
    writeRollout("2026/06/10/rollout-a.jsonl", [
      META,
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "git add file.ts", workdir: "/x" }),
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "npm test" }),
        },
      },
    ]);

    expect(readCodexSessions(dir)[0].commands).toEqual(["git add file.ts", "npm test"]);
  });

  it("ignores non-exec function calls like update_plan", () => {
    writeRollout("2026/06/10/rollout-b.jsonl", [
      META,
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "update_plan",
          arguments: JSON.stringify({ plan: [] }),
        },
      },
    ]);

    expect(readCodexSessions(dir)[0].commands).toEqual([]);
  });

  it("uses turn_context cwd when session_meta lacks one", () => {
    writeRollout("2026/06/10/rollout-c.jsonl", [
      { type: "session_meta", payload: { id: "s1", timestamp: "2026-06-10T00:00:00Z" } },
      { type: "turn_context", payload: { cwd: "/from/turn" } },
    ]);

    expect(readCodexSessions(dir)[0].projectPath).toBe("/from/turn");
  });

  it("sets endedAt to the last line timestamp", () => {
    writeRollout("2026/06/10/rollout-d.jsonl", [
      META,
      { timestamp: "2026-06-10T08:00:00.000Z", type: "event_msg", payload: {} },
    ]);

    expect(readCodexSessions(dir)[0].endedAt).toBe("2026-06-10T08:00:00.000Z");
  });

  it("skips files with no session_meta id", () => {
    writeRollout("2026/06/10/rollout-e.jsonl", [
      { type: "turn_context", payload: { cwd: "/x" } },
    ]);

    expect(readCodexSessions(dir)).toHaveLength(0);
  });

  it("tolerates malformed JSONL lines without throwing", () => {
    const full = join(dir, "2026/06/10/rollout-f.jsonl");
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(META) + "\nnot-json\n{also bad\n");

    const sessions = readCodexSessions(dir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("019eb06c-8a06-7020-b900-3db271769b93");
  });

  it("finds multiple rollout files across different date directories", () => {
    writeRollout("2026/06/10/rollout-x.jsonl", [
      { type: "session_meta", payload: { id: "day10", timestamp: "2026-06-10T00:00:00Z", cwd: "/a" } },
    ]);
    writeRollout("2026/06/11/rollout-y.jsonl", [
      { type: "session_meta", payload: { id: "day11", timestamp: "2026-06-11T00:00:00Z", cwd: "/b" } },
    ]);

    const ids = readCodexSessions(dir).map((s) => s.sessionId).sort();
    expect(ids).toEqual(["day10", "day11"]);
  });

  it("extracts user and assistant messages with text, skipping developer", () => {
    writeRollout("2026/06/10/rollout-msg.jsonl", [
      META,
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "system prompt, ignore" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello codex" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi there" }],
        },
      },
    ]);

    const session = readCodexSessions(dir)[0];
    expect(session.messages).toHaveLength(2);
    expect(session.messageCount).toBe(2);
    expect(session.messages[0]).toMatchObject({ role: "user", senderName: "You" });
    expect(session.messages[0].parts[0]).toMatchObject({ type: "text", text: "hello codex" });
    expect(session.messages[1]).toMatchObject({ role: "assistant", senderName: "Codex" });
    expect(session.messages[1].parts[0].text).toBe("hi there");
  });

  it("skips messages with empty content", () => {
    writeRollout("2026/06/10/rollout-empty.jsonl", [
      META,
      { type: "response_item", payload: { type: "message", role: "user", content: [] } },
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "real" }] },
      },
    ]);

    const session = readCodexSessions(dir)[0];
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe("assistant");
  });

  it("derives a title from the first real user prompt, skipping injected context", () => {
    writeRollout("2026/06/10/rollout-title.jsonl", [
      META,
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# AGENTS.md instructions for /x" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "what is a good sorting algorithm for words please explain clearly" }],
        },
      },
    ]);

    expect(readCodexSessions(dir)[0].title).toBe(
      "what is a good sorting algorithm for words please explain",
    );
  });

  it("derives title from a short prompt verbatim", () => {
    writeRollout("2026/06/10/rollout-short.jsonl", [
      META,
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello codex" }] },
      },
    ]);

    expect(readCodexSessions(dir)[0].title).toBe("hello codex");
  });

  it("title is null when only injected context exists", () => {
    writeRollout("2026/06/10/rollout-notitle.jsonl", [
      META,
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>cwd=/x</environment_context>" }],
        },
      },
    ]);

    expect(readCodexSessions(dir)[0].title).toBeNull();
  });
});
