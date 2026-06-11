import { describe, it, expect } from "vitest";
import { deriveFileChanges } from "../../../src/adapters/opencode/file-changes.js";
import type { CanonicalMessage } from "../../../src/core/canonical.js";

function msg(parts: CanonicalMessage["parts"]): CanonicalMessage {
  return {
    messageId: "m1",
    sessionId: "s1",
    role: "assistant",
    createdAt: "2026-06-11T00:00:00Z",
    parts,
  };
}

describe("deriveFileChanges", () => {
  it("returns empty summary when there are no tool parts", () => {
    const result = deriveFileChanges([msg([{ type: "text", text: "hi" }])]);
    expect(result).toEqual({ filesChanged: [], linesAdded: 0, linesRemoved: 0 });
  });

  it("counts edit tool line deltas from oldString/newString", () => {
    const result = deriveFileChanges([
      msg([
        {
          type: "tool",
          tool: "edit",
          input: { filePath: "/a.ts", oldString: "x\ny", newString: "x\ny\nz" },
        },
      ]),
    ]);
    expect(result.filesChanged).toEqual(["/a.ts"]);
    expect(result.linesAdded).toBe(3);
    expect(result.linesRemoved).toBe(2);
  });

  it("counts write tool content as added lines", () => {
    const result = deriveFileChanges([
      msg([{ type: "tool", tool: "write", input: { filePath: "/b.ts", content: "a\nb\nc" } }]),
    ]);
    expect(result.filesChanged).toEqual(["/b.ts"]);
    expect(result.linesAdded).toBe(3);
    expect(result.linesRemoved).toBe(0);
  });

  it("deduplicates the same file edited multiple times", () => {
    const result = deriveFileChanges([
      msg([
        { type: "tool", tool: "edit", input: { filePath: "/a.ts", oldString: "x", newString: "y" } },
        { type: "tool", tool: "edit", input: { filePath: "/a.ts", oldString: "p", newString: "q" } },
      ]),
    ]);
    expect(result.filesChanged).toEqual(["/a.ts"]);
    expect(result.linesAdded).toBe(2);
    expect(result.linesRemoved).toBe(2);
  });

  it("ignores non-edit/write tools and tools without a filePath", () => {
    const result = deriveFileChanges([
      msg([
        { type: "tool", tool: "bash", input: { command: "ls" } },
        { type: "tool", tool: "read", input: { filePath: "/c.ts" } },
        { type: "tool", tool: "edit", input: { oldString: "x", newString: "y" } },
      ]),
    ]);
    expect(result.filesChanged).toEqual([]);
  });

  it("collects multiple distinct files", () => {
    const result = deriveFileChanges([
      msg([
        { type: "tool", tool: "write", input: { filePath: "/a.ts", content: "a" } },
        { type: "tool", tool: "edit", input: { filePath: "/b.ts", oldString: "", newString: "x" } },
      ]),
    ]);
    expect(result.filesChanged.sort()).toEqual(["/a.ts", "/b.ts"]);
  });
});
