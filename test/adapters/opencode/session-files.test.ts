import { describe, it, expect } from "vitest";
import { applyDerivedFileChanges } from "../../../src/adapters/opencode/session-files.js";
import type { CanonicalMessage, CanonicalSession } from "../../../src/core/canonical.js";

function session(over: Partial<CanonicalSession> = {}): CanonicalSession {
  return {
    sessionId: "s",
    provider: "opencode",
    filesChanged: null,
    fileCount: null,
    linesAdded: null,
    linesRemoved: null,
    ...over,
  } as unknown as CanonicalSession;
}

function toolMessage(tool: string, input: unknown): CanonicalMessage {
  return {
    messageId: "m",
    sessionId: "s",
    role: "assistant",
    senderName: "OpenCode",
    createdAt: new Date(0).toISOString(),
    parts: [{ type: "tool", tool, input }],
  };
}

describe("applyDerivedFileChanges", () => {
  it("fills the file list and line counts from edit/write tool parts", () => {
    const s = applyDerivedFileChanges(session(), [
      toolMessage("write", { filePath: "/a.ts", content: "x\ny\nz" }),
      toolMessage("edit", { filePath: "/b.ts", oldString: "a", newString: "b\nc" }),
    ]);
    expect(s.filesChanged).toEqual(["/a.ts", "/b.ts"]);
    expect(s.fileCount).toBe(2);
    expect(s.linesAdded).toBe(5);
    expect(s.linesRemoved).toBe(1);
  });

  it("understands the v2 write tool's `path` input", () => {
    const s = applyDerivedFileChanges(session(), [toolMessage("write", { path: "/v2.md", content: "one" })]);
    expect(s.filesChanged).toEqual(["/v2.md"]);
  });

  it("keeps a file list the database already provided", () => {
    const s = applyDerivedFileChanges(
      session({ filesChanged: ["/from-db"], fileCount: 1, linesAdded: 7, linesRemoved: 3 }),
      [toolMessage("write", { filePath: "/derived.ts", content: "x" })],
    );
    expect(s.filesChanged).toEqual(["/from-db"]);
    expect(s.linesAdded).toBe(7);
  });

  it("derives when the database list is present but empty", () => {
    const s = applyDerivedFileChanges(session({ filesChanged: [] }), [
      toolMessage("write", { filePath: "/a.ts", content: "x" }),
    ]);
    expect(s.filesChanged).toEqual(["/a.ts"]);
  });

  it("leaves the session untouched when there are no edits", () => {
    const s = applyDerivedFileChanges(session(), [toolMessage("bash", { command: "ls" })]);
    expect(s.filesChanged).toBeNull();
    expect(s.fileCount).toBeNull();
  });
});
