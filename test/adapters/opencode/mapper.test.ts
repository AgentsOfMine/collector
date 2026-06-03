import { describe, it, expect } from "vitest";
import { mapRow } from "../../../src/adapters/opencode/mapper.js";
import type { OpenCodeRow } from "../../../src/adapters/opencode/sqlite-reader.js";

const baseRow: OpenCodeRow = {
  id: "sess-opencode-001",
  project_id: "proj-123",
  title: "Refactor auth module",
  model: "claude-3-5-sonnet-20241022",
  created_at: "2026-06-03T10:00:00Z",
  updated_at: "2026-06-03T10:45:00Z",
  summary_additions: 120,
  summary_deletions: 30,
  summary_files: 3,
  patch: JSON.stringify({
    files: [
      { path: "src/auth.ts" },
      { path: "src/middleware.ts" },
      { path: "test/auth.test.ts" },
    ],
  }),
};

describe("OpenCode mapper", () => {
  it("maps a full row to CanonicalSession", () => {
    const session = mapRow(baseRow, "/home/user/project");
    expect(session.sessionId).toBe("sess-opencode-001");
    expect(session.provider).toBe("opencode");
    expect(session.agentName).toBe("OpenCode");
    expect(session.title).toBe("Refactor auth module");
    expect(session.modelLine).toBe("claude-3-5-sonnet-20241022");
    expect(session.startedAt).toBe("2026-06-03T10:00:00Z");
    expect(session.endedAt).toBe("2026-06-03T10:45:00Z");
    expect(session.linesAdded).toBe(120);
    expect(session.linesRemoved).toBe(30);
    expect(session.fileCount).toBe(3);
    expect(session.filesChangedApproximate).toBe(false);
  });

  it("extracts filesChanged from patch JSON", () => {
    const session = mapRow(baseRow, "/home/user/project");
    expect(session.filesChanged).toEqual(["src/auth.ts", "src/middleware.ts", "test/auth.test.ts"]);
  });

  it("sets filesChanged to null when patch is null", () => {
    const session = mapRow({ ...baseRow, patch: null }, "/home/user/project");
    expect(session.filesChanged).toBeNull();
  });

  it("sets filesChanged to null when patch is empty string", () => {
    const session = mapRow({ ...baseRow, patch: "" }, "/home/user/project");
    expect(session.filesChanged).toBeNull();
  });

  it("handles invalid patch JSON gracefully", () => {
    const session = mapRow({ ...baseRow, patch: "not-json{{{" }, "/home/user/project");
    expect(session.filesChanged).toBeNull();
  });

  it("handles patch with no files array", () => {
    const session = mapRow({ ...baseRow, patch: JSON.stringify({ other: "data" }) }, "/home/user/project");
    expect(session.filesChanged).toBeNull();
  });

  it("computes projectId as sha256 hex prefix (16 chars)", () => {
    const session = mapRow(baseRow, "/home/user/project");
    expect(session.projectId).toHaveLength(16);
    expect(session.projectId).toMatch(/^[0-9a-f]+$/);
  });

  it("handles null summary fields", () => {
    const session = mapRow(
      { ...baseRow, summary_additions: null, summary_deletions: null, summary_files: null },
      "/home/user/project",
    );
    expect(session.linesAdded).toBeNull();
    expect(session.linesRemoved).toBeNull();
    expect(session.fileCount).toBeNull();
  });

  it("filesChangedApproximate is always false", () => {
    const session = mapRow(baseRow, "/home/user/project");
    expect(session.filesChangedApproximate).toBe(false);
  });
});
