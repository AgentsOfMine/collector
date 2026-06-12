import { describe, it, expect } from "vitest";
import {
  createAccumulator,
  processEntry,
  finalizeSession,
} from "../../../src/adapters/pi/mapper.js";

const PI_FILE =
  "/home/user/.pi/agent/sessions/--home-user-proj--/2026-06-03T10-00-00-000Z_019ebc41-4486-7f9a-a94b-0ed9e6fa37d1.jsonl";

function feed(lines: unknown[]): ReturnType<typeof finalizeSession> {
  const acc = createAccumulator(PI_FILE);
  for (const line of lines) processEntry(acc, line);
  return finalizeSession(acc);
}

function accFor(lines: unknown[]) {
  const acc = createAccumulator(PI_FILE);
  for (const line of lines) processEntry(acc, line);
  return acc;
}

const header = {
  type: "session",
  version: 3,
  id: "sess-pi-1",
  timestamp: "2026-06-03T10:00:00.000Z",
  cwd: "/home/user/proj",
};

describe("pi mapper", () => {
  it("reads sessionId, cwd and startedAt from the session header", () => {
    const session = feed([
      header,
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-06-03T10:00:01.000Z",
        message: { role: "user", content: "fix the bug" },
      },
    ]);
    expect(session.sessionId).toBe("sess-pi-1");
    expect(session.provider).toBe("pi");
    expect(session.agentName).toBe("Pi");
    expect(session.projectPath).toBe("/home/user/proj");
    expect(session.startedAt).toBe("2026-06-03T10:00:00.000Z");
    expect(session.title).toBe("fix the bug");
  });

  it("derives modelLine as provider/model from the assistant message", () => {
    const session = feed([
      header,
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-03T10:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          provider: "anthropic",
          model: "claude-opus",
        },
      },
    ]);
    expect(session.modelLine).toBe("anthropic/claude-opus");
  });

  it("maps text, thinking and toolCall content into canonical parts", () => {
    const acc = accFor([
      header,
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-03T10:00:03.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "let me think" },
            { type: "text", text: "here you go" },
            { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
          ],
          provider: "openai",
          model: "gpt-4o",
        },
      },
    ]);
    const parts = acc.messages[0]?.parts ?? [];
    expect(parts.map((p) => p.type)).toEqual(["reasoning", "text", "tool"]);
    expect(parts[2]?.tool).toBe("bash");
    expect(parts[2]?.input).toEqual({ command: "ls" });
  });

  it("counts exact lines added/removed from an edit tool unified patch", () => {
    const patch = [
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,3 @@",
      " function foo() {",
      "-  return 42;",
      "+  return 43;",
      " }",
    ].join("\n");

    const session = feed([
      header,
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-03T10:00:04.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-edit",
              name: "edit",
              arguments: { path: "src/foo.ts", edits: [{ oldText: "42", newText: "43" }] },
            },
          ],
          provider: "anthropic",
          model: "claude-opus",
        },
      },
      {
        type: "message",
        id: "m2",
        timestamp: "2026-06-03T10:00:05.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-edit",
          toolName: "edit",
          content: [{ type: "text", text: "Successfully replaced 1 block." }],
          details: { patch },
          isError: false,
        },
      },
    ]);

    expect(session.linesAdded).toBe(1);
    expect(session.linesRemoved).toBe(1);
    expect(session.filesChanged).toEqual(["src/foo.ts"]);
    expect(session.filesChangedApproximate).toBe(false);
  });

  it("counts write tool content as lines added with no removals", () => {
    const session = feed([
      header,
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-03T10:00:06.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-write",
              name: "write",
              arguments: { path: "src/new.ts", content: "line1\nline2\nline3" },
            },
          ],
          provider: "anthropic",
          model: "claude-opus",
        },
      },
    ]);

    expect(session.linesAdded).toBe(3);
    expect(session.linesRemoved).toBeNull();
    expect(session.filesChanged).toEqual(["src/new.ts"]);
  });

  it("does not count an errored edit result", () => {
    const session = feed([
      header,
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-03T10:00:07.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-edit", name: "edit", arguments: { path: "src/foo.ts" } },
          ],
          provider: "anthropic",
          model: "claude-opus",
        },
      },
      {
        type: "message",
        id: "m2",
        timestamp: "2026-06-03T10:00:08.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-edit",
          toolName: "edit",
          content: [{ type: "text", text: "no match" }],
          isError: true,
        },
      },
    ]);

    expect(session.linesAdded).toBeNull();
    expect(session.filesChanged).toBeNull();
  });

  it("derives sessionId and projectPath from the file path when the header is missing", () => {
    const session = feed([
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-03T10:00:09.000Z",
        message: { role: "user", content: "hi" },
      },
    ]);
    expect(session.sessionId).toBe("019ebc41-4486-7f9a-a94b-0ed9e6fa37d1");
    expect(session.projectPath).toBe("/home/user/proj");
    expect(session.messageCount).toBe(1);
  });

  it("keeps path-derived identity stable on a mid-file resync that skips the header", () => {
    const headerless = feed([
      {
        type: "message",
        id: "m2",
        timestamp: "2026-06-03T10:05:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "more output" }] },
      },
    ]);
    const withHeader = feed([
      header,
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-03T10:00:01.000Z",
        message: { role: "user", content: "fix the bug" },
      },
    ]);
    expect(headerless.sessionId).toBe("019ebc41-4486-7f9a-a94b-0ed9e6fa37d1");
    expect(headerless.provider).toBe("pi");
    expect(headerless.projectPath).toBe("/home/user/proj");
    expect(headerless.sessionId).not.toContain(".jsonl");
    expect(withHeader.projectPath).toBe(headerless.projectPath);
  });

  it("lets the in-band header cwd override the lossy path-decoded projectPath", () => {
    const acc = createAccumulator(
      "/home/user/.pi/agent/sessions/--home-user-my-proj--/2026-06-03T10-00-00-000Z_019ebc41-4486-7f9a-a94b-0ed9e6fa37d1.jsonl",
    );
    processEntry(acc, { ...header, cwd: "/home/user/my-proj" });
    processEntry(acc, {
      type: "message",
      id: "m1",
      timestamp: "2026-06-03T10:00:01.000Z",
      message: { role: "user", content: "hi" },
    });
    const session = finalizeSession(acc);
    expect(session.projectPath).toBe("/home/user/my-proj");
  });
});
