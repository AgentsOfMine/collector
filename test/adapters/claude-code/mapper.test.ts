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

describe("ClaudeCode mapper — project path", () => {
  const FILE = "/home/user/.claude/projects/-Users-dev-Projects-my-app/session-abc.jsonl";

  function withCwd(event: Record<string, unknown>, cwd: string) {
    return { ...event, cwd };
  }

  it("uses the cwd recorded in the session, not the ~/.claude/projects directory", () => {
    const acc = createAccumulator(FILE);
    processEvent(acc, withCwd(makeUserEvent("u1", [{ type: "text", text: "hi" }]), "/Users/dev/Projects/my-app"));
    expect(finalizeSession(acc).projectPath).toBe("/Users/dev/Projects/my-app");
  });

  it("keeps the first cwd seen when a later event reports another directory", () => {
    const acc = createAccumulator(FILE);
    processEvent(acc, withCwd(makeUserEvent("u1", [{ type: "text", text: "a" }]), "/Users/dev/Projects/my-app"));
    processEvent(acc, withCwd(makeAssistantEvent("a1", [{ type: "text", text: "b" }]), "/Users/dev/Projects/my-app/packages/x"));
    expect(finalizeSession(acc).projectPath).toBe("/Users/dev/Projects/my-app");
  });

  it("finds cwd on a later event when earlier lines carry none (mid-file resume)", () => {
    const acc = createAccumulator(FILE);
    processEvent(acc, { type: "summary", summary: "compaction marker" });
    processEvent(acc, withCwd(makeAssistantEvent("a1", [{ type: "text", text: "x" }]), "/Users/dev/Projects/my-app"));
    expect(finalizeSession(acc).projectPath).toBe("/Users/dev/Projects/my-app");
  });

  it("ignores a non-string or empty cwd", () => {
    const acc = createAccumulator(FILE);
    processEvent(acc, { ...makeUserEvent("u1", [{ type: "text", text: "a" }]), cwd: 42 });
    processEvent(acc, { ...makeUserEvent("u2", [{ type: "text", text: "b" }]), cwd: "" });
    // Neither value is usable, so this degrades to the decoded directory name.
    expect(finalizeSession(acc).projectPath).toBe("/Users/dev/Projects/my/app");
  });

  it("falls back to the decoded project-key directory, never to ~/.claude/projects", () => {
    const acc = createAccumulator(FILE);
    processEvent(acc, makeUserEvent("u1", [{ type: "text", text: "hi" }]));
    const path = finalizeSession(acc).projectPath;
    expect(path).not.toContain(".claude");
    // Lossy by nature: "-" in the real path ("my-app") cannot be told from "/".
    // A cwd on any event overrides this, which is the normal case.
    expect(path).toBe("/Users/dev/Projects/my/app");
  });

  it("does not guess a path from a key that is not an encoded absolute path", () => {
    const acc = createAccumulator("/home/user/.claude/projects/myproject/session-abc.jsonl");
    expect(acc.projectPath).toBe("myproject");
  });
});

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
