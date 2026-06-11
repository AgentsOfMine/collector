import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the side-effectful dependencies so we can assert wiring without
// touching the OS keychain, the filesystem, or the network.
const runSyncMock = vi.fn();

vi.mock("../../src/keychain/index.js", () => ({
  isPaired: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/core/sync-engine.js", () => ({
  runSync: (...args: unknown[]) => runSyncMock(...args),
}));

vi.mock("../../src/core/cursor-store.js", () => ({
  FileCursorStore: class {
    flush = vi.fn();
  },
}));

import { runSyncCommand } from "../../src/cli/sync.js";
import { isPaired } from "../../src/keychain/index.js";
import { loadConfig } from "../../src/config.js";
import type { Adapter } from "../../src/adapters/adapter.js";

const PAIRED_CONFIG = {
  syncUrl: "https://api.example.com/sync",
  deviceId: "dev-test",
  deviceToken: "tok-test",
  collectorVersion: "0.1.0",
  opencodeDbPath: "/tmp/opencode.db",
  claudeProjectsGlob: "/tmp/.claude/projects/*/*.jsonl",
  codexSessionsDir: "/tmp/.codex/sessions",
};

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  runSyncMock.mockReset();
  runSyncMock.mockResolvedValue({ synced: 0, failed: 0, errors: [] });
  vi.mocked(isPaired).mockReset();
  vi.mocked(loadConfig).mockReset();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
    throw new Error("process.exit");
  }) as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe("aom sync — paired guard", () => {
  it("exits 1 and does not sync when not paired", async () => {
    vi.mocked(isPaired).mockResolvedValue(false);

    await expect(runSyncCommand()).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("exits 1 when paired but device token is missing", async () => {
    vi.mocked(isPaired).mockResolvedValue(true);
    vi.mocked(loadConfig).mockResolvedValue({ ...PAIRED_CONFIG, deviceToken: "" });

    await expect(runSyncCommand()).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(runSyncMock).not.toHaveBeenCalled();
  });
});

describe("aom sync — wiring", () => {
  beforeEach(() => {
    vi.mocked(isPaired).mockResolvedValue(true);
    vi.mocked(loadConfig).mockResolvedValue(PAIRED_CONFIG);
  });

  it("calls the core runSync engine with all three provider adapters", async () => {
    await runSyncCommand();

    expect(runSyncMock).toHaveBeenCalledOnce();
    const adapters = runSyncMock.mock.calls[0]?.[0] as Adapter[];
    const names = adapters.map((a) => a.name).sort();
    expect(names).toEqual(["claude-code", "codex", "opencode"]);
  });

  it("passes the resolved sync config to the engine", async () => {
    await runSyncCommand();

    const syncConfig = runSyncMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(syncConfig).toMatchObject({
      syncUrl: PAIRED_CONFIG.syncUrl,
      deviceId: PAIRED_CONFIG.deviceId,
      deviceToken: PAIRED_CONFIG.deviceToken,
      collectorVersion: PAIRED_CONFIG.collectorVersion,
    });
  });

  it("does not exit non-zero on a clean sync", async () => {
    runSyncMock.mockResolvedValue({ synced: 5, failed: 0, errors: [] });

    await runSyncCommand();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 when any session failed", async () => {
    runSyncMock.mockResolvedValue({
      synced: 2,
      failed: 1,
      errors: ["opencode/sess-9: rejected"],
    });

    await expect(runSyncCommand()).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
