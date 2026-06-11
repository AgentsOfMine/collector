import { describe, it, expect, vi } from "vitest";
import { runSync } from "../../src/core/sync-engine.js";
import type { Adapter, Cursor } from "../../src/adapters/adapter.js";
import type { SessionWithMessages } from "../../src/core/canonical.js";
import type { CursorStore } from "../../src/core/cursor-store.js";
import type { SyncConfig } from "../../src/core/sync-engine.js";

const BASE_CONFIG: SyncConfig = {
  syncUrl: "https://api.example.com/sync",
  deviceId: "dev-test",
  collectorVersion: "0.1.0",
  deviceToken: "tok-test",
  batchSize: 3,
};

function makeSession(id: string, startedAt = "2026-06-03T10:00:00Z"): SessionWithMessages {
  return {
    sessionId: id,
    provider: "opencode",
    projectId: "proj-1",
    projectPath: "/home/user/project",
    agentName: "OpenCode",
    title: null,
    modelLine: null,
    startedAt,
    endedAt: null,
    messageCount: null,
    fileCount: null,
    linesAdded: null,
    linesRemoved: null,
    filesChanged: null,
    filesChangedApproximate: false,
    extensions: {},
    messages: [],
  };
}

function makeAdapter(name: string, sessions: SessionWithMessages[]): Adapter {
  return {
    name,
    async *listNewSessions(_cursor: Cursor) {
      for (const s of sessions) yield { session: s, cursor: s.startedAt };
    },
  };
}

function makeSuccessPost(accepted: string[] = [], rejected: { sessionId: string; reason: string }[] = []) {
  return vi.fn().mockResolvedValue({ accepted, rejected });
}

function makeCursorStore(): CursorStore & { stored: Record<string, string> } {
  const stored: Record<string, string> = {};
  return {
    stored,
    get(name: string) { return stored[name] ?? null; },
    set(name: string, value: string) { stored[name] = value; },
    flush() {},
  };
}

describe("runSync — basic flow", () => {
  it("returns zero counts when no sessions", async () => {
    const adapter = makeAdapter("opencode", []);
    const post = makeSuccessPost();
    const result = await runSync([adapter], BASE_CONFIG, makeCursorStore(), post);
    expect(result).toEqual({ synced: 0, failed: 0, errors: [] });
    expect(post).not.toHaveBeenCalled();
  });

  it("posts sessions and counts accepted", async () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    const adapter = makeAdapter("opencode", sessions);
    const post = makeSuccessPost(["s1", "s2"]);
    const result = await runSync([adapter], BASE_CONFIG, makeCursorStore(), post);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("counts rejected sessions in failed", async () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    const adapter = makeAdapter("opencode", sessions);
    const post = makeSuccessPost(["s1"], [{ sessionId: "s2", reason: "invalid" }]);
    const result = await runSync([adapter], BASE_CONFIG, makeCursorStore(), post);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("s2");
  });
});

describe("runSync — batching", () => {
  it("flushes in batches of batchSize", async () => {
    const sessions = [makeSession("s1"), makeSession("s2"), makeSession("s3"), makeSession("s4")];
    const adapter = makeAdapter("opencode", sessions);
    const post = vi.fn().mockResolvedValue({ accepted: [], rejected: [] });
    await runSync([adapter], { ...BASE_CONFIG, batchSize: 2 }, makeCursorStore(), post);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("sends all sessions when count < batchSize", async () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    const adapter = makeAdapter("opencode", sessions);
    const post = vi.fn().mockResolvedValue({ accepted: ["s1", "s2"], rejected: [] });
    await runSync([adapter], { ...BASE_CONFIG, batchSize: 10 }, makeCursorStore(), post);
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0]?.[1] as { sessions: SessionWithMessages[] };
    expect(body.sessions).toHaveLength(2);
  });
});

describe("runSync — cursor advancement", () => {
  it("advances the cursor to the last session startedAt on success", async () => {
    const sessions = [makeSession("s1", "2026-06-01T00:00:00Z"), makeSession("s2", "2026-06-02T00:00:00Z")];
    const adapter = makeAdapter("opencode", sessions);
    const cursors = makeCursorStore();
    const post = makeSuccessPost(["s1", "s2"]);
    await runSync([adapter], BASE_CONFIG, cursors, post);
    expect(cursors.stored["opencode"]).toBe("2026-06-02T00:00:00Z");
  });

  it("does not advance cursor when HTTP post throws", async () => {
    const sessions = [makeSession("s1", "2026-06-01T00:00:00Z")];
    const adapter = makeAdapter("opencode", sessions);
    const cursors = makeCursorStore();
    const post = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await runSync([adapter], BASE_CONFIG, cursors, post);
    expect(cursors.stored["opencode"]).toBeUndefined();
    expect(result.errors[0]).toContain("network error");
  });
});

describe("runSync — multiple adapters", () => {
  it("processes all adapters independently", async () => {
    const a1 = makeAdapter("opencode", [makeSession("s1")]);
    const a2 = makeAdapter("claude-code", [makeSession("s2"), makeSession("s3")]);
    const post = vi.fn().mockResolvedValue({ accepted: [], rejected: [] });
    await runSync([a1, a2], BASE_CONFIG, makeCursorStore(), post);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("runSync — error resilience", () => {
  it("records iteration error and continues to next adapter", async () => {
    const broken: Adapter = {
      name: "broken",
      async *listNewSessions() {
        yield makeSession("s1");
        throw new Error("read failure");
      },
    };
    const good = makeAdapter("opencode", [makeSession("s2")]);
    const post = vi.fn().mockResolvedValue({ accepted: ["s2"], rejected: [] });
    const result = await runSync([broken, good], BASE_CONFIG, makeCursorStore(), post);
    expect(result.errors.some((e) => e.includes("read failure"))).toBe(true);
    expect(result.synced).toBe(1);
  });

  it("sends correct body shape to httpPost", async () => {
    const session = makeSession("s1");
    const adapter = makeAdapter("opencode", [session]);
    const post = makeSuccessPost(["s1"]);
    await runSync([adapter], BASE_CONFIG, makeCursorStore(), post);
    const [url, body, token] = post.mock.calls[0]!;
    expect(url).toBe(BASE_CONFIG.syncUrl);
    expect(token).toBe(BASE_CONFIG.deviceToken);
    const b = body as { deviceId: string; collectorVersion: string; sentAt: string; sessions: unknown[] };
    expect(b.deviceId).toBe(BASE_CONFIG.deviceId);
    expect(b.collectorVersion).toBe(BASE_CONFIG.collectorVersion);
    expect(typeof b.sentAt).toBe("string");
    expect(b.sessions).toHaveLength(1);
  });
});
