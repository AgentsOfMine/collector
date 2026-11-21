import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Without this, every test run stamps the developer's real ~/.agentsofmine/last-sync.json.
vi.mock("../../src/core/last-sync-store.js", () => ({
  recordLastSync: vi.fn(),
  readLastSync: vi.fn(() => ({})),
}));

vi.mock("../../src/core/cursor-store.js", () => ({
  FileCursorStore: class {
    flush = vi.fn();
  },
}));

import { runSyncCommand } from "../../src/cli/sync.js";
import { memoryTerminal, type MemoryTerminal } from "./memory-terminal.js";
import { isPaired } from "../../src/keychain/index.js";
import { loadConfig } from "../../src/config.js";
import { KNOWN_PROVIDERS } from "../../src/core/providers.js";
import type { Adapter } from "../../src/adapters/adapter.js";

const PAIRED_CONFIG = {
  syncUrl: "https://api.example.com/sync",
  deviceId: "dev-test",
  deviceToken: "tok-test",
  collectorVersion: "0.1.0",
  opencodeDbPath: "/tmp/opencode.db",
  claudeProjectsGlob: "/tmp/.claude/projects/*/*.jsonl",
  codexSessionsDir: "/tmp/.codex/sessions",
  piSessionsDir: "/tmp/.pi/agent/sessions",
};

let term: MemoryTerminal;

beforeEach(() => {
  runSyncMock.mockReset();
  runSyncMock.mockResolvedValue({ synced: 0, failed: 0, errors: [] });
  vi.mocked(isPaired).mockReset();
  vi.mocked(loadConfig).mockReset();
  term = memoryTerminal();
});

describe("aom sync — paired guard", () => {
  it("exits 1 and does not sync when not paired", async () => {
    vi.mocked(isPaired).mockResolvedValue(false);

    expect(await runSyncCommand(term)).toBe(1);

    expect(runSyncMock).not.toHaveBeenCalled();
    expect(term.errText()).toContain("not paired");
  });

  it("exits 1 when paired but device token is missing", async () => {
    vi.mocked(isPaired).mockResolvedValue(true);
    vi.mocked(loadConfig).mockResolvedValue({ ...PAIRED_CONFIG, deviceToken: "" });

    expect(await runSyncCommand(term)).toBe(1);

    expect(runSyncMock).not.toHaveBeenCalled();
    expect(term.errText()).toContain("Device token missing");
  });
});

describe("aom sync — wiring", () => {
  beforeEach(() => {
    vi.mocked(isPaired).mockResolvedValue(true);
    vi.mocked(loadConfig).mockResolvedValue(PAIRED_CONFIG);
  });

  it("calls the core runSync engine with one adapter per registered provider", async () => {
    await runSyncCommand(term);

    expect(runSyncMock).toHaveBeenCalledOnce();
    const adapters = runSyncMock.mock.calls[0]?.[0] as Adapter[];
    const names = adapters.map((a) => a.name).sort();
    // Guard against CLI/registry drift: the sync path must cover every
    // provider in providers.json (this is exactly the bug where `aom sync`
    // shipped a 3-adapter list while the registry already had "pi").
    expect(names).toEqual([...KNOWN_PROVIDERS].sort());
  });

  it("passes the resolved sync config to the engine", async () => {
    await runSyncCommand(term);

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

    expect(await runSyncCommand(term)).toBe(0);
  });

  it("exits 1 when any session failed", async () => {
    runSyncMock.mockResolvedValue({
      synced: 2,
      failed: 1,
      errors: ["opencode/sess-9: rejected"],
    });

    expect(await runSyncCommand(term)).toBe(1);
  });
});

describe("aom sync --since", () => {
  const paired = { isPaired: async () => true };

  it("passes the cut-off date to performSync", async () => {
    const calls: unknown[] = [];
    const code = await runSyncCommand(term, { since: "2026-06-01" }, { ...paired, performSync: async (o) => { calls.push(o); return { synced: 2, failed: 0, errors: [] }; } });
    expect(code).toBe(0);
    expect((calls[0] as { since: Date }).since.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(term.text()).toContain("since 2026-06-01");
    expect(term.text()).toContain("saved positions are left as they are");
  });

  it("passes no window without the flag", async () => {
    const calls: unknown[] = [];
    await runSyncCommand(term, {}, { ...paired, performSync: async (o) => { calls.push(o); return { synced: 0, failed: 0, errors: [] }; } });
    expect(calls).toEqual([{}]);
    expect(term.text()).not.toContain("saved positions");
  });

  it("refuses a bad value, says why, and syncs nothing", async () => {
    let ran = false;
    const code = await runSyncCommand(term, { since: "yesterday" }, { ...paired, performSync: async () => { ran = true; return { synced: 0, failed: 0, errors: [] }; } });
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(term.errText()).toContain("--since yesterday");
  });

  it("checks the value before it checks pairing, so a typo is reported first", async () => {
    const code = await runSyncCommand(term, { since: "7x" }, { isPaired: async () => false, performSync: async () => ({ synced: 0, failed: 0, errors: [] }) });
    expect(code).toBe(1);
    expect(term.errText()).toContain("--since 7x");
    expect(term.errText()).not.toContain("not paired");
  });
});
