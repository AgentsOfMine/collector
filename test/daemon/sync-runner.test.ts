import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncRunner } from "../../src/daemon/sync-runner.js";
import { NotPairedError } from "../../src/core/perform-sync.js";
import type { SyncSummary } from "../../src/core/sync-engine.js";

const OK: SyncSummary = { synced: 1, failed: 0, errors: [] };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SyncRunner — debounce", () => {
  it("coalesces a burst of triggers into a single sync", async () => {
    const syncFn = vi.fn().mockResolvedValue(OK);
    const runner = new SyncRunner({ debounceMs: 100, syncFn });

    runner.trigger("a");
    runner.trigger("b");
    runner.trigger("c");

    expect(syncFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(syncFn).toHaveBeenCalledOnce();
  });

  it("resets the debounce window on each new trigger", async () => {
    const syncFn = vi.fn().mockResolvedValue(OK);
    const runner = new SyncRunner({ debounceMs: 100, syncFn });

    runner.trigger("a");
    await vi.advanceTimersByTimeAsync(60);
    runner.trigger("b");
    await vi.advanceTimersByTimeAsync(60);

    expect(syncFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(40);

    expect(syncFn).toHaveBeenCalledOnce();
  });
});

describe("SyncRunner — single-flight", () => {
  it("does not run two syncs concurrently and queues exactly one rerun", async () => {
    const gate = deferred<SyncSummary>();
    const syncFn = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(OK);

    const runner = new SyncRunner({ debounceMs: 0, syncFn });

    const firstRun = runner.runNow();
    expect(syncFn).toHaveBeenCalledTimes(1);

    runner.trigger("mid-flight-1");
    runner.trigger("mid-flight-2");
    expect(syncFn).toHaveBeenCalledTimes(1);

    gate.resolve(OK);
    await firstRun;
    await vi.runAllTimersAsync();

    expect(syncFn).toHaveBeenCalledTimes(2);
  });
});

describe("SyncRunner — error handling", () => {
  it("swallows NotPairedError without throwing", async () => {
    const syncFn = vi.fn().mockRejectedValue(new NotPairedError());
    const runner = new SyncRunner({ debounceMs: 0, syncFn });

    await expect(runner.runNow()).resolves.toBeUndefined();
  });

  it("swallows generic sync errors without throwing", async () => {
    const syncFn = vi.fn().mockRejectedValue(new Error("network down"));
    const runner = new SyncRunner({ debounceMs: 0, syncFn });

    await expect(runner.runNow()).resolves.toBeUndefined();
  });

  it("calls onSynced with the summary after a successful sync", async () => {
    const onSynced = vi.fn();
    const syncFn = vi.fn().mockResolvedValue({ synced: 3, failed: 0, errors: [] });
    const runner = new SyncRunner({ debounceMs: 0, syncFn, onSynced });

    await runner.runNow();

    expect(onSynced).toHaveBeenCalledWith({ synced: 3, failed: 0, errors: [] });
  });
});

describe("SyncRunner — stop", () => {
  it("cancels a pending debounced sync", async () => {
    const syncFn = vi.fn().mockResolvedValue(OK);
    const runner = new SyncRunner({ debounceMs: 100, syncFn });

    runner.trigger("a");
    runner.stop();
    await vi.advanceTimersByTimeAsync(200);

    expect(syncFn).not.toHaveBeenCalled();
  });
});
