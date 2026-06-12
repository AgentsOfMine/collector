import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeAdapter, type FsReader } from "../../../src/adapters/claude-code/index.js";
import type { SyncItem } from "../../../src/adapters/adapter.js";

function dirent(name: string, kind: "dir" | "file"): Dirent {
  return {
    name,
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
  } as unknown as Dirent;
}

function fakeFs(tree: Record<string, Dirent[]>, existing: Set<string>): FsReader {
  return {
    existsSync: (p) => existing.has(p),
    readdirSync: (p) => {
      const entries = tree[p];
      if (!entries) throw new Error(`ENOENT: ${p}`);
      return entries;
    },
  };
}

async function collect(adapter: ClaudeCodeAdapter): Promise<SyncItem[]> {
  const out: SyncItem[] = [];
  for await (const item of adapter.listNewSessions({ value: null })) {
    out.push(item);
  }
  return out;
}

describe("ClaudeCodeAdapter — file discovery seam", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aom-cc-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("yields nothing when the projects dir does not exist", async () => {
    const fs = fakeFs({}, new Set());
    const adapter = new ClaudeCodeAdapter(join(tmpDir, "projects", "*", "*.jsonl"), fs);
    expect(await collect(adapter)).toEqual([]);
  });

  it("discovers and parses .jsonl files across project dirs", async () => {
    const projectsDir = join(tmpDir, "projects");
    const projA = join(projectsDir, "proj-a");
    const sessionFile = join(projA, "session1.jsonl");

    mkdirSync(projA, { recursive: true });
    // Real on-disk jsonl so the reader can stream it; one user message event.
    writeFileSync(
      sessionFile,
      JSON.stringify({
        type: "user",
        timestamp: "2026-06-12T00:00:00Z",
        message: { role: "user", content: "hello" },
      }) + "\n",
      "utf8",
    );

    const fs = fakeFs(
      {
        [projectsDir]: [dirent("proj-a", "dir")],
        [projA]: [dirent("session1.jsonl", "file"), dirent("ignore.txt", "file")],
      },
      new Set([projectsDir, projA, sessionFile]),
    );

    const adapter = new ClaudeCodeAdapter(join(projectsDir, "*", "*.jsonl"), fs);
    const items = await collect(adapter);

    expect(items.length).toBe(1);
    expect(items[0]?.session.messages.length).toBeGreaterThan(0);
  });

  it("skips a project subdir that throws on read (best-effort discovery)", async () => {
    const projectsDir = join(tmpDir, "projects");
    const projGood = join(projectsDir, "good");
    const projBad = join(projectsDir, "bad");
    const goodFile = join(projGood, "s.jsonl");

    mkdirSync(projGood, { recursive: true });
    writeFileSync(
      goodFile,
      JSON.stringify({
        type: "user",
        timestamp: "2026-06-12T00:00:00Z",
        message: { role: "user", content: "hi" },
      }) + "\n",
      "utf8",
    );

    const fs: FsReader = {
      existsSync: (p) => new Set([projectsDir, projGood, projBad, goodFile]).has(p),
      readdirSync: (p) => {
        if (p === projectsDir) return [dirent("good", "dir"), dirent("bad", "dir")];
        if (p === projGood) return [dirent("s.jsonl", "file")];
        if (p === projBad) throw new Error("EACCES");
        throw new Error(`ENOENT: ${p}`);
      },
    };

    const adapter = new ClaudeCodeAdapter(join(projectsDir, "*", "*.jsonl"), fs);
    const items = await collect(adapter);

    // The unreadable dir is skipped; the good file still yields.
    expect(items.length).toBe(1);
  });
});
