import { describe, it, expect } from "vitest";
import {
  createAccumulator,
  processEvent,
} from "../../../src/adapters/claude-code/mapper.js";

const SESSION_FILE = "/home/user/.claude/projects/myproject/session-abc.jsonl";

function makeUserEvent(uuid: string, content: unknown[], timestamp = "2026-06-03T10:00:00Z") {
  return { type: "user", uuid, timestamp, message: { role: "user", content } };
}

function makeAssistantEvent(
  uuid: string,
  content: unknown[],
  timestamp = "2026-06-03T10:01:00Z",
  model = "claude-sonnet-4-6",
) {
  return { type: "assistant", uuid, timestamp, message: { role: "assistant", content, model } };
}

function makeTextBlock(text: string) {
  return { type: "text", text };
}

function makeThinkingBlock(thinking: string) {
  return { type: "thinking", thinking };
}

function makeToolUseBlock(id: string, name: string, input: Record<string, unknown>) {
  return { type: "tool_use", id, name, input };
}

function makeToolResultBlock(toolUseId: string, content: string, isError?: boolean) {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content,
    ...(isError !== undefined ? { is_error: isError } : {}),
  };
}

function makeBase64ImageBlock(data: string, mediaType = "image/png") {
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

describe("Claude Code message extraction", () => {
  describe("empty session", () => {
    it("yields no messages when no events processed", () => {
      const acc = createAccumulator(SESSION_FILE);
      expect(acc.messages).toHaveLength(0);
    });

    it("ignores non-message event types (queue-operation, skill_listing)", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, { type: "queue-operation", operation: "enqueue", timestamp: "2026-06-03T10:00:00Z" });
      processEvent(acc, { type: "skill_listing", content: "some skills" });
      expect(acc.messages).toHaveLength(0);
    });
  });

  describe("malformed input", () => {
    it("ignores null", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, null);
      expect(acc.messages).toHaveLength(0);
    });

    it("ignores primitive values", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, "raw string");
      processEvent(acc, 42);
      expect(acc.messages).toHaveLength(0);
    });

    it("ignores event with no message payload", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, { type: "user", uuid: "u1", timestamp: "2026-06-03T10:00:00Z" });
      expect(acc.messages).toHaveLength(0);
    });

    it("ignores unknown roles", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, { type: "system", uuid: "u1", timestamp: "2026-06-03T10:00:00Z", message: { role: "system", content: [makeTextBlock("hi")] } });
      expect(acc.messages).toHaveLength(0);
    });

    it("ignores message with empty content array", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", []));
      expect(acc.messages).toHaveLength(0);
    });
  });

  describe("text messages", () => {
    it("extracts text part from user event with correct role and senderName", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [makeTextBlock("Hello")]));
      expect(acc.messages).toHaveLength(1);
      expect(acc.messages[0]!.role).toBe("user");
      expect(acc.messages[0]!.senderName).toBe("You");
      expect(acc.messages[0]!.parts).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("extracts text part from assistant event with correct senderName", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeTextBlock("I'll help.")]));
      expect(acc.messages[0]!.role).toBe("assistant");
      expect(acc.messages[0]!.senderName).toBe("Claude Code");
    });

    it("sets messageId from event uuid", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("uuid-123", [makeTextBlock("test")]));
      expect(acc.messages[0]!.messageId).toBe("uuid-123");
    });

    it("sets createdAt from event timestamp", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [makeTextBlock("test")], "2026-06-03T12:30:00Z"));
      expect(acc.messages[0]!.createdAt).toBe("2026-06-03T12:30:00Z");
    });

    it("generates a fallback messageId when uuid is absent", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, { type: "user", timestamp: "2026-06-03T10:00:00Z", message: { role: "user", content: [makeTextBlock("test")] } });
      expect(acc.messages[0]!.messageId).toMatch(/^session-abc-/);
    });
  });

  describe("thinking blocks", () => {
    it("maps thinking to reasoning part", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeThinkingBlock("my plan"), makeTextBlock("response")]));
      const parts = acc.messages[0]!.parts;
      expect(parts[0]).toEqual({ type: "reasoning", text: "my plan" });
      expect(parts[1]).toEqual({ type: "text", text: "response" });
    });

    it("skips empty thinking block", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeThinkingBlock(""), makeTextBlock("response")]));
      expect(acc.messages[0]!.parts).toHaveLength(1);
      expect(acc.messages[0]!.parts[0]!.type).toBe("text");
    });
  });

  describe("tool_use / tool_result pairs", () => {
    it("maps tool_use to tool part with callId and input", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeToolUseBlock("toolu_01", "Bash", { command: "ls" })]));
      const part = acc.messages[0]!.parts[0]!;
      expect(part.type).toBe("tool");
      expect(part.tool).toBe("Bash");
      expect(part.callId).toBe("toolu_01");
      expect(part.input).toEqual({ command: "ls" });
    });

    it("maps tool_result to tool part with resolved tool name and output", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeToolUseBlock("toolu_01", "Bash", { command: "ls" })]));
      processEvent(acc, makeUserEvent("u1", [makeToolResultBlock("toolu_01", "file1\nfile2")]));
      const resultMsg = acc.messages.find((m) => m.role === "user")!;
      const part = resultMsg.parts[0]!;
      expect(part.tool).toBe("Bash");
      expect(part.output).toBe("file1\nfile2");
    });

    it("uses 'unknown' when tool_result arrives before tool_use", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [makeToolResultBlock("orphan", "output")]));
      expect(acc.messages[0]!.parts[0]!.tool).toBe("unknown");
    });

    it("truncates tool result output to 500 chars", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeAssistantEvent("a1", [makeToolUseBlock("tu1", "Read", {})]));
      processEvent(acc, makeUserEvent("u1", [makeToolResultBlock("tu1", "x".repeat(600))]));
      const part = acc.messages.find((m) => m.role === "user")!.parts[0]!;
      expect(part.output!.length).toBeLessThanOrEqual(500);
    });
  });

  describe("image attachments", () => {
    it("maps base64 image to image_url part", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [makeBase64ImageBlock("iVBORw0KGgo=", "image/png")]));
      const part = acc.messages[0]!.parts[0]!;
      expect(part.type).toBe("image_url");
      expect(part.mediaType).toBe("image/png");
      expect(part.imageUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("maps url-type image source to image_url part", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [{ type: "image", source: { type: "url", url: "https://example.com/img.png", media_type: "image/png" } }]));
      const part = acc.messages[0]!.parts[0]!;
      expect(part.type).toBe("image_url");
      expect(part.imageUrl).toBe("https://example.com/img.png");
    });

    it("skips image block with no source and falls back to other parts", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [{ type: "image" }, makeTextBlock("fallback")]));
      expect(acc.messages[0]!.parts).toHaveLength(1);
      expect(acc.messages[0]!.parts[0]!.type).toBe("text");
    });
  });

  describe("message ordering and stats alignment", () => {
    it("preserves message order", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [makeTextBlock("first")], "2026-06-03T10:00:00Z"));
      processEvent(acc, makeAssistantEvent("a1", [makeTextBlock("second")], "2026-06-03T10:01:00Z"));
      processEvent(acc, makeUserEvent("u2", [makeTextBlock("third")], "2026-06-03T10:02:00Z"));
      expect(acc.messages.map((m) => m.messageId)).toEqual(["u1", "a1", "u2"]);
    });

    it("messageCount matches messages array length", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [makeTextBlock("q")]));
      processEvent(acc, makeAssistantEvent("a1", [makeTextBlock("a")]));
      expect(acc.messageCount).toBe(2);
      expect(acc.messages).toHaveLength(2);
    });

    it("session stats and messages coexist correctly", () => {
      const acc = createAccumulator(SESSION_FILE);
      processEvent(acc, makeUserEvent("u1", [makeTextBlock("Fix auth")]));
      processEvent(acc, makeAssistantEvent("a1", [
        makeTextBlock("Sure."),
        { type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "src/auth.ts", new_string: "line1\nline2", old_string: "old" } },
      ]));
      processEvent(acc, makeUserEvent("u2", [{ type: "tool_result", tool_use_id: "tu1", content: "OK" }]));
      expect(acc.linesAdded).toBe(2);
      expect(acc.linesRemoved).toBe(1);
      expect(acc.filesChanged.has("src/auth.ts")).toBe(true);
      expect(acc.messages).toHaveLength(3);
    });
  });
});
