import { describe, it, expect } from "vitest";
import { validateSession, CanonicalSessionSchema } from "../../src/core/canonical.js";

const baseSession = {
  sessionId: "sess-001",
  provider: "opencode" as const,
  projectId: "abc123def456abcd",
  projectPath: "/home/user/project",
  agentName: "OpenCode",
  title: "Fix the bug",
  modelLine: "claude-3-5-sonnet",
  startedAt: "2026-06-03T10:00:00Z",
  endedAt: "2026-06-03T10:30:00Z",
  messageCount: 42,
  fileCount: 3,
  linesAdded: 100,
  linesRemoved: 20,
  filesChanged: ["src/foo.ts", "src/bar.ts"],
  filesChangedApproximate: false,
  extensions: {},
};

describe("validateSession", () => {
  it("accepts a valid session", () => {
    const result = validateSession(baseSession);
    expect(result.sessionId).toBe("sess-001");
    expect(result.provider).toBe("opencode");
  });

  it("accepts all three provider values", () => {
    for (const provider of ["claude-code", "opencode", "codex"] as const) {
      const result = validateSession({ ...baseSession, provider });
      expect(result.provider).toBe(provider);
    }
  });

  it("throws ZodError on missing required field (sessionId)", () => {
    const { sessionId: _, ...rest } = baseSession;
    expect(() => validateSession(rest)).toThrow();
  });

  it("throws ZodError on invalid provider", () => {
    expect(() => validateSession({ ...baseSession, provider: "unknown-agent" })).toThrow();
  });

  it("accepts null nullable fields", () => {
    const result = validateSession({
      ...baseSession,
      title: null,
      modelLine: null,
      endedAt: null,
      messageCount: null,
      fileCount: null,
      linesAdded: null,
      linesRemoved: null,
      filesChanged: null,
    });
    expect(result.title).toBeNull();
    expect(result.filesChanged).toBeNull();
  });

  it("filesChangedApproximate defaults to boolean", () => {
    const result = validateSession({ ...baseSession, filesChangedApproximate: true });
    expect(result.filesChangedApproximate).toBe(true);

    const result2 = validateSession({ ...baseSession, filesChangedApproximate: false });
    expect(result2.filesChangedApproximate).toBe(false);
  });

  it("throws when filesChangedApproximate is missing", () => {
    const { filesChangedApproximate: _, ...rest } = baseSession;
    expect(() => validateSession(rest)).toThrow();
  });

  it("extensions can hold arbitrary keys", () => {
    const result = validateSession({ ...baseSession, extensions: { foo: "bar", num: 42 } });
    expect(result.extensions["foo"]).toBe("bar");
  });
});
