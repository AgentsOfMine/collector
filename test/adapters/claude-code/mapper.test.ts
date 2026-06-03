import { describe, it, expect } from "vitest";
import {
  createAccumulator,
  processEvent,
  finalizeSession,
} from "../../../src/adapters/claude-code/mapper.js";

function makeEditToolUse(id: string, filePath: string, newString: string, oldString: string) {
  return {
    type: "tool_use",
    id,
    name: "Edit",
    input: { file_path: filePath, new_string: newString, old_string: oldString },
  };
}

function makeWriteToolUse(id: string, filePath: string, content: string) {
  return {
    type: "tool_use",
    id,
    name: "Write",
    input: { file_path: filePath, content },
  };
}

function makeToolResult(toolUseId: string, isError?: boolean) {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    ...(isError !== undefined ? { is_error: isError } : {}),
  };
}

function makeHumanMessage(text: string) {
  return { role: "human", content: text, timestamp: "2026-06-03T10:00:00Z" };
}

describe("ClaudeCode mapper", () => {
  const testFile = "/home/user/.claude/projects/myproject/session-abc.jsonl";

  it("creates accumulator with correct sessionId from filename", () => {
    const acc = createAccumulator(testFile);
    expect(acc.sessionId).toBe("session-abc");
  });

  describe("Edit tool events", () => {
    it("counts linesAdded and linesRemoved on successful Edit", () => {
      const acc = createAccumulator(testFile);
      const newStr = "line1\nline2\nline3"; // 3 lines
      const oldStr = "old1\nold2";          // 2 lines
      processEvent(acc, makeEditToolUse("tu-1", "src/foo.ts", newStr, oldStr));
      processEvent(acc, makeToolResult("tu-1")); // no is_error = success
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBe(3);
      expect(session.linesRemoved).toBe(2);
      expect(session.filesChanged).toContain("src/foo.ts");
    });

    it("does NOT count Edit when tool_result has is_error: true", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, makeEditToolUse("tu-1", "src/foo.ts", "a\nb", "x"));
      processEvent(acc, makeToolResult("tu-1", true));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBeNull();
      expect(session.linesRemoved).toBeNull();
      expect(session.filesChanged).toBeNull();
    });

    it("counts multiple Edit events across different files", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, makeEditToolUse("tu-1", "src/a.ts", "a\nb\nc", "x")); // +3, -1
      processEvent(acc, makeToolResult("tu-1"));
      processEvent(acc, makeEditToolUse("tu-2", "src/b.ts", "d\ne", "y\nz")); // +2, -2
      processEvent(acc, makeToolResult("tu-2"));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBe(5);
      expect(session.linesRemoved).toBe(3);
      expect(session.filesChanged).toContain("src/a.ts");
      expect(session.filesChanged).toContain("src/b.ts");
    });
  });

  describe("Write tool events", () => {
    it("counts linesAdded on successful Write", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, makeWriteToolUse("tu-1", "src/new.ts", "line1\nline2\nline3\nline4"));
      processEvent(acc, makeToolResult("tu-1"));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBe(4);
      expect(session.linesRemoved).toBeNull(); // Write has no linesRemoved
      expect(session.filesChanged).toContain("src/new.ts");
    });

    it("does NOT count Write when tool_result has is_error: true", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, makeWriteToolUse("tu-1", "src/new.ts", "a\nb"));
      processEvent(acc, makeToolResult("tu-1", true));
      const session = finalizeSession(acc);
      expect(session.linesAdded).toBeNull();
    });
  });

  describe("Mixed session", () => {
    it("combines Edit and Write events", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, makeHumanMessage("Fix the authentication bug"));
      processEvent(acc, makeEditToolUse("tu-1", "src/auth.ts", "new\nlines", "old"));
      processEvent(acc, makeToolResult("tu-1"));
      processEvent(acc, makeWriteToolUse("tu-2", "src/new-file.ts", "a\nb\nc"));
      processEvent(acc, makeToolResult("tu-2"));
      const session = finalizeSession(acc);
      expect(session.title).toBe("Fix the authentication bug");
      expect(session.linesAdded).toBe(5); // 2 from Edit + 3 from Write
      expect(session.linesRemoved).toBe(1);
      expect(session.filesChanged).toHaveLength(2);
      expect(session.filesChangedApproximate).toBe(false);
      expect(session.provider).toBe("claude-code");
      expect(session.agentName).toBe("Claude Code");
    });

    it("deduplicates the same file edited multiple times", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, makeEditToolUse("tu-1", "src/auth.ts", "a", "b"));
      processEvent(acc, makeToolResult("tu-1"));
      processEvent(acc, makeEditToolUse("tu-2", "src/auth.ts", "c", "d"));
      processEvent(acc, makeToolResult("tu-2"));
      const session = finalizeSession(acc);
      expect(session.filesChanged).toHaveLength(1);
      expect(session.fileCount).toBe(1);
    });
  });

  describe("title extraction", () => {
    it("takes title from first human message", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, makeHumanMessage("Please refactor the auth module"));
      processEvent(acc, { role: "human", content: "Second message" });
      const session = finalizeSession(acc);
      expect(session.title).toBe("Please refactor the auth module");
    });

    it("truncates title at 80 chars", () => {
      const acc = createAccumulator(testFile);
      const longMsg = "A".repeat(120);
      processEvent(acc, makeHumanMessage(longMsg));
      const session = finalizeSession(acc);
      expect(session.title).toHaveLength(80);
    });

    it("returns null title when no human messages", () => {
      const acc = createAccumulator(testFile);
      const session = finalizeSession(acc);
      expect(session.title).toBeNull();
    });
  });

  describe("model extraction", () => {
    it("captures model from event", () => {
      const acc = createAccumulator(testFile);
      processEvent(acc, { model: "claude-opus-4-5", role: "assistant" });
      const session = finalizeSession(acc);
      expect(session.modelLine).toBe("claude-opus-4-5");
    });
  });
});
