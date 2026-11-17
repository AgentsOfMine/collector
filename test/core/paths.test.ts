import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";

let fakeHome = "/home/dev";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome };
});

import {
  stateDir,
  configFile,
  deviceIdFile,
  cursorsFile,
  lastSyncFile,
  opencodeDbPath,
  claudeProjectsGlob,
  codexSessionsDir,
  piSessionsDir,
  claudeProjectsDirFromGlob,
} from "../../src/core/paths.js";

describe("state paths", () => {
  it("live under ~/.agentsofmine", () => {
    fakeHome = "/home/dev";
    expect(stateDir()).toBe(join("/home/dev", ".agentsofmine"));
    expect(configFile()).toBe(join("/home/dev", ".agentsofmine", "config.json"));
    expect(deviceIdFile()).toBe(join("/home/dev", ".agentsofmine", "device-id"));
    expect(cursorsFile()).toBe(join("/home/dev", ".agentsofmine", "cursors.json"));
    expect(lastSyncFile()).toBe(join("/home/dev", ".agentsofmine", "last-sync.json"));
  });

  it("follow HOME when it changes between calls (not frozen at import)", () => {
    fakeHome = "/home/one";
    const first = stateDir();
    fakeHome = "/home/two";
    expect(stateDir()).not.toBe(first);
    expect(stateDir()).toBe(join("/home/two", ".agentsofmine"));
  });

  it("accept an explicit base directory", () => {
    expect(cursorsFile("/tmp/base")).toBe(join("/tmp/base", "cursors.json"));
    expect(lastSyncFile("/tmp/base")).toBe(join("/tmp/base", "last-sync.json"));
  });
});

describe("agent session locations", () => {
  it("point at each agent's default store", () => {
    fakeHome = "/home/dev";
    expect(opencodeDbPath()).toBe(join("/home/dev", ".local", "share", "opencode", "opencode.db"));
    expect(claudeProjectsGlob()).toBe(join("/home/dev", ".claude", "projects", "*", "*.jsonl"));
    expect(codexSessionsDir()).toBe(join("/home/dev", ".codex", "sessions"));
    expect(piSessionsDir()).toBe(join("/home/dev", ".pi", "agent", "sessions"));
  });
});

describe("claudeProjectsDirFromGlob", () => {
  it("strips a two-level glob", () => {
    expect(claudeProjectsDirFromGlob("/h/.claude/projects/*/*.jsonl")).toBe("/h/.claude/projects");
  });

  it("strips a one-level glob", () => {
    expect(claudeProjectsDirFromGlob("/h/.claude/projects/*.jsonl")).toBe("/h/.claude/projects");
  });

  it("handles Windows separators", () => {
    expect(claudeProjectsDirFromGlob("C:\\Users\\d\\.claude\\projects\\*\\*.jsonl")).toBe(
      "C:\\Users\\d\\.claude\\projects",
    );
  });

  it("leaves a plain directory unchanged", () => {
    expect(claudeProjectsDirFromGlob("/h/.claude/projects")).toBe("/h/.claude/projects");
  });
});
