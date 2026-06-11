import { describe, it, expect, vi } from "vitest";
import { SyncStatusStore, setLastSyncResult, getStatusPayload } from "../../src/mcp-tools/status.js";
import { syncNow } from "../../src/mcp-tools/sync-now.js";

describe("SyncStatusStore", () => {
  it("defaults to empty status before any record", () => {
    const store = new SyncStatusStore();
    expect(store.get()).toEqual({ lastSyncAt: null, synced: 0, failed: 0, errors: [] });
  });

  it("records a summary and exposes it", () => {
    const store = new SyncStatusStore();
    store.record({ synced: 3, failed: 1, errors: ["x"] });
    const status = store.get();
    expect(status.synced).toBe(3);
    expect(status.failed).toBe(1);
    expect(status.errors).toEqual(["x"]);
    expect(status.lastSyncAt).not.toBeNull();
  });

  it("module-level setLastSyncResult/getStatusPayload round-trip", () => {
    setLastSyncResult({ synced: 5, failed: 0, errors: [] });
    expect(getStatusPayload().synced).toBe(5);
  });
});

describe("syncNow", () => {
  it("delegates to runSync and records the result", async () => {
    const summary = { synced: 2, failed: 0, errors: [] };
    const adapters = [
      {
        name: "fake",
        listNewSessions: async function* () {
          yield* [];
        },
      },
    ];
    const cursorStore = { get: vi.fn(() => null), set: vi.fn() };
    const config = {
      syncUrl: "https://x",
      deviceId: "d",
      collectorVersion: "0",
      deviceToken: "t",
    };
    const httpPost = vi.fn(async () => ({ accepted: [], rejected: [] }));

    const result = await syncNow(adapters as never, { ...config, httpPost } as never, cursorStore as never);

    expect(result).toHaveProperty("synced");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("errors");
    expect(getStatusPayload().lastSyncAt).not.toBeNull();
    void summary;
  });
});
