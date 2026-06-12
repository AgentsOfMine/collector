import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let dir: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => dir };
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aom-lastsync-"));
  vi.resetModules();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return import("../../src/core/last-sync-store.js");
}

describe("last-sync-store", () => {
  it("readLastSync returns empty when the file is absent", async () => {
    const { readLastSync } = await load();
    expect(readLastSync()).toEqual({});
  });

  it("recordLastSync writes an ISO timestamp for the source", async () => {
    const { recordLastSync, readLastSync } = await load();
    recordLastSync("sync");
    const data = readLastSync();
    expect(Object.keys(data)).toEqual(["sync"]);
    expect(() => new Date(data["sync"]!).toISOString()).not.toThrow();
  });

  it("merges rather than clobbering other sources", async () => {
    const { recordLastSync, readLastSync } = await load();
    recordLastSync("daemon");
    recordLastSync("sync");
    recordLastSync("mcp");
    expect(Object.keys(readLastSync()).sort()).toEqual(["daemon", "mcp", "sync"]);
  });

  it("tolerates a corrupt file by treating it as empty", async () => {
    mkdirSync(join(dir, ".agentsofmine"), { recursive: true });
    writeFileSync(join(dir, ".agentsofmine", "last-sync.json"), "not json");
    const { readLastSync } = await load();
    expect(readLastSync()).toEqual({});
  });

  it("creates the state dir and a real file on first write", async () => {
    const { recordLastSync } = await load();
    recordLastSync("sync");
    const file = join(dir, ".agentsofmine", "last-sync.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveProperty("sync");
  });
});
