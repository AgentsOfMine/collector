import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileCursorStore } from "../../src/core/cursor-store.js";

let tmpDir: string;
let store: FileCursorStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aom-cursor-"));
  store = new FileCursorStore(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("FileCursorStore", () => {
  it("returns null when adapter has no cursor", () => {
    expect(store.get("opencode")).toBeNull();
    expect(store.get("claude-code")).toBeNull();
  });

  it("persists a cursor and retrieves it", () => {
    store.set("opencode", "2026-06-03T10:00:00Z");
    expect(store.get("opencode")).toBe("2026-06-03T10:00:00Z");
  });

  it("stores multiple adapters independently", () => {
    store.set("opencode", "cursor-a");
    store.set("claude-code", "cursor-b");
    store.set("codex", "cursor-c");
    expect(store.get("opencode")).toBe("cursor-a");
    expect(store.get("claude-code")).toBe("cursor-b");
    expect(store.get("codex")).toBe("cursor-c");
  });

  it("overwrites existing cursor on set", () => {
    store.set("opencode", "old-value");
    store.set("opencode", "new-value");
    expect(store.get("opencode")).toBe("new-value");
  });

  it("uses tmp → rename for atomic writes", () => {
    store.set("opencode", "test-value");
    expect(existsSync(join(tmpDir, "cursors.json.tmp"))).toBe(false);
    expect(existsSync(join(tmpDir, "cursors.json"))).toBe(true);
  });

  it("survives rapid sequential writes without corruption", () => {
    for (let i = 0; i < 20; i++) {
      store.set("opencode", `cursor-${i}`);
    }
    expect(store.get("opencode")).toBe("cursor-19");
  });

  it("flush() is a no-op on a fresh store and does not throw", () => {
    expect(() => store.flush()).not.toThrow();
  });

  it("persists across new instances pointing to the same dir", () => {
    store.set("opencode", "persisted-value");
    const store2 = new FileCursorStore(tmpDir);
    expect(store2.get("opencode")).toBe("persisted-value");
  });
});
