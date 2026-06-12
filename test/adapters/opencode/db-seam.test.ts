import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenCodeAdapter } from "../../../src/adapters/opencode/index.js";
import type { OpenCodeRow } from "../../../src/adapters/opencode/sqlite-reader.js";
import type { SyncItem } from "../../../src/adapters/adapter.js";

// querySessions / queryMessages both call db.prepare(sql).all(args). We route
// by SQL keyword so one fake db serves both queries through the injected opener.
function fakeDb(sessions: OpenCodeRow[], partRows: Record<string, unknown>[]) {
  let closed = false;
  const db = {
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        void _args;
        return sql.includes("FROM session") ? sessions : partRows;
      },
    }),
    close: () => {
      closed = true;
    },
  };
  return { db, wasClosed: () => closed };
}

function row(overrides: Partial<OpenCodeRow> = {}): OpenCodeRow {
  return {
    id: "sess-1",
    project_id: "proj-1",
    project_worktree: "/home/dev/repo",
    title: "Test session",
    model: "anthropic/claude",
    time_created: 1_700_000_000_000,
    time_updated: 1_700_000_100_000,
    summary_additions: null,
    summary_deletions: null,
    summary_files: null,
    summary_diffs: null,
    ...overrides,
  };
}

async function collect(adapter: OpenCodeAdapter): Promise<SyncItem[]> {
  const out: SyncItem[] = [];
  for await (const item of adapter.listNewSessions({ value: null })) {
    out.push(item);
  }
  return out;
}

describe("OpenCodeAdapter — db-opener seam", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aom-ocdb-"));
    // A real file so the adapter's existsSync(dbPath) guard passes; the
    // injected opener never actually reads it.
    dbPath = join(tmpDir, "opencode.db");
    writeFileSync(dbPath, "", "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("yields nothing when the db file does not exist (no opener call)", async () => {
    let opened = false;
    const adapter = new OpenCodeAdapter(join(tmpDir, "missing.db"), "/home/dev", (() => {
      opened = true;
      throw new Error("should not open");
    }) as never);
    expect(await collect(adapter)).toEqual([]);
    expect(opened).toBe(false);
  });

  it("opens the injected db, maps a session, and closes the handle", async () => {
    const { db, wasClosed } = fakeDb(
      [row()],
      [
        {
          message_id: "m1",
          session_id: "sess-1",
          role: "user",
          time_created: 1_700_000_000_000,
          part_data: JSON.stringify({ type: "text", text: "hello" }),
        },
      ],
    );

    const adapter = new OpenCodeAdapter(dbPath, "/fallback", (() => db) as never);
    const items = await collect(adapter);

    expect(items.length).toBe(1);
    expect(items[0]?.session.sessionId).toBe("sess-1");
    expect(items[0]?.session.messages.length).toBe(1);
    expect(wasClosed()).toBe(true);
  });

  it("swallows SQLITE_BUSY but still closes the handle", async () => {
    let closed = false;
    const busyDb = {
      prepare: () => {
        throw new Error("SQLITE_BUSY: database is locked");
      },
      close: () => {
        closed = true;
      },
    };
    const adapter = new OpenCodeAdapter(dbPath, "/fallback", (() => busyDb) as never);
    expect(await collect(adapter)).toEqual([]);
    expect(closed).toBe(true);
  });

  it("rethrows non-SQLITE_BUSY db errors", async () => {
    const brokenDb = {
      prepare: () => {
        throw new Error("SQLITE_CORRUPT: malformed");
      },
      close: () => {},
    };
    const adapter = new OpenCodeAdapter(dbPath, "/fallback", (() => brokenDb) as never);
    await expect(collect(adapter)).rejects.toThrow(/SQLITE_CORRUPT/);
  });
});
