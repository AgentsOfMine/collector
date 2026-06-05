import { describe, it, expect } from "vitest";
import {
  createAccumulator,
  processEvent,
  finalizeSession,
} from "../../../src/adapters/claude-code/mapper.js";

const SESSION_FILE = "/home/user/.claude/projects/myproject/session-abc.jsonl";

function makeAssistantEvent(
  uuid: string,
  content: unknown[],
  opts: { timestamp?: string; model?: string } = {},
) {
  return {
    type: "assistant",
    uuid,
    timestamp: opts.timestamp ?? "2026-06-03T10:01:00Z",
    message: { role: "assistant", content, model: opts.model ?? "claude-sonnet-4-6" },
  };
}

function makeUserEvent(uuid: string, content: unknown[], timestamp = "2026-06-03T10:00:00Z") {
  return { type: "user", uuid, timestamp, message: { role: "user", content } };
}

function makeEditToolUse(id: string, filePath: string, newString: string, oldString: string) {
  return { type: "tool_use", id, name: "Edit", input: { file_path: filePath, new_string: newString, old_string: oldString } };
}

function makeWriteToolUse(id: string, filePath: string, content: string) {
  return { type: "tool_use", id, name: "Write", input: { file_path: filePath, content } };
}

function makeToolResult(toolUseId: string, isError?: boolean) {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: "OK",
    ...(isError !== undefined ? { is_error: isError } : {}),
  };
}

describe("ClaudeCode mapper", () => {
  it("creates accumulator with correct sessionId from filename", () => {
    const acc = createAccumulator(SESSION_FILE);
    expect(acc.sessionId).toBe("session-abc");
  });

  describe("Edit tool events", () => {
    it("counts linesAdded and linesRemoved on successful Edit", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeEditToolUse("tu-1", "src/foo.ts", "line1\nline2\nline3", "old1\nold2")]));
      processEvent(acc, makeUserEvent("u1", [makeToolResult("tu-1")]));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBe(3);
      expect(session.linesRemoved).toBe(2);
      expect(session.filesChanged).toContain("src/foo.ts");
    });

    it("does NOT count Edit when tool_result has is_error: true", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeEditToolUse("tu-1", "src/foo.ts", "a\nb", "x")]));
      processEvent(acc, makeUserEvent("u1", [makeToolResult("tu-1", true)]));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBeNull();
      expect(session.linesRemoved).toBeNull();
      expect(session.filesChanged).toBeNull();
    });

    it("counts multiple Edit events across different files", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeEditToolUse("tu-1", "src/a.ts", "a\nb\nc", "x")]));
      processEvent(acc, makeUserEvent("u1", [makeToolResult("tu-1")]));
      processEvent(acc, makeAssistantEvent("a2", [makeEditToolUse("tu-2", "src/b.ts", "d\ne", "y\nz")]));
      processEvent(acc, makeUserEvent("u2", [makeToolResult("tu-2")]));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBe(5);
      expect(session.linesRemoved).toBe(3);
      expect(session.filesChanged).toContain("src/a.ts");
      expect(session.filesChanged).toContain("src/b.ts");
    });
  });

  describe("Write tool events", () => {
    it("counts linesAdded on successful Write", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeWriteToolUse("tu-1", "src/new.ts", "line1\nline2\nline3\nline4")]));
      processEvent(acc, makeUserEvent("u1", [makeToolResult("tu-1")]));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBe(4);
      expect(session.linesRemoved).toBeNull();
      expect(session.filesChanged).toContain("src/new.ts");
    });

    it("does NOT count Write when tool_result has is_error: true", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeWriteToolUse("tu-1", "src/new.ts", "a\nb")]));
      processEvent(acc, makeUserEvent("u1", [makeToolResult("tu-1", true)]));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBeNull();
    });
  });

  describe("Mixed session", () => {
    it("combines Edit and Write events", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [{ type: "text", text: "Fix the authentication bug" }]));
      processEvent(acc, makeAssistantEvent("a1", [makeEditToolUse("tu-1", "src/auth.ts", "new\nlines", "old")]));
      processEvent(acc, makeUserEvent("u2", [makeToolResult("tu-1")]));
      processEvent(acc, makeAssistantEvent("a2", [makeWriteToolUse("tu-2", "src/new-file.ts", "a\nb\nc")]));
      processEvent(acc, makeUserEvent("u3", [makeToolResult("tu-2")]));
      const session = finalizeSession(acc);
      expect(session.title).toBe("Fix the authentication bug");
      expect(session.linesAdded).toBe(5);
      expect(session.linesRemoved).toBe(1);
      expect(session.filesChanged).toHaveLength(2);
      expect(session.filesChangedApproximate).toBe(false);
      expect(session.provider).toBe("claude-code");
      expect(session.agentName).toBe("Claude Code");
    });

    it("deduplicates the same file edited multiple times", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeEditToolUse("tu-1", "src/auth.ts", "a", "b")]));
      processEvent(acc, makeUserEvent("u1", [makeToolResult("tu-1")]));
      processEvent(acc, makeAssistantEvent("a2", [makeEditToolUse("tu-2", "src/auth.ts", "c", "d")]));
      processEvent(acc, makeUserEvent("u2", [makeToolResult("tu-2")]));
      const session = finalizeSession(acc);
      expect(session.filesChanged).toHaveLength(1);
      expect(session.fileCount).toBe(1);
    });
  });

  describe("title extraction", () => {
    it("takes title from first user message", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [{ type: "text", text: "Please refactor the auth module" }]));
      processEvent(acc, makeUserEvent("u2", [{ type: "text", text: "Second message" }]));
      const session = finalizeSession(acc);
      expect(session.title).toBe("Please refactor the auth module");
    });

    it("truncates title at 80 chars", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [{ type: "text", text: "A".repeat(120) }]));
      const session = finalizeSession(acc);
      expect(session.title).toHaveLength(80);
    });

    it("returns null title when no user messages", () => {
      const acc = createAccumulator(SESSION_FILE);
      const session = finalizeSession(acc);
      expect(session.title).toBeNull();
    });
  });

  describe("model extraction", () => {
    it("captures model from assistant event message payload", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [{ type: "text", text: "hi" }], { model: "claude-opus-4-5" }));
      const session = finalizeSession(acc);
      expect(session.modelLine).toBe("claude-opus-4-5");
    });
  });
});
