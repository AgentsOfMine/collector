import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../src/keychain/index.js", () => ({
  isPaired: vi.fn(),
  getDeviceToken: vi.fn(),
}));

import { isPaired } from "../../src/keychain/index.js";

let tmpHome: string;

// os.homedir() ignores process.env.HOME changes made inside a vitest worker, so
// mock it the same way the other state-file tests do.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => tmpHome };
});

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "aom-status-"));
  mkdirSync(join(tmpHome, ".agentsofmine"), { recursive: true });
  vi.resetModules();
  vi.mocked(isPaired).mockReset();
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

async function loadBuildStatus() {
  const mod = await import("../../src/cli/status.js");
  return mod.buildStatus;
}

describe("aom status --json (buildStatus)", () => {
  it("reports not paired with null fields and stable placeholders", async () => {
    vi.mocked(isPaired).mockResolvedValue(false);
    const buildStatus = await loadBuildStatus();
    const status = await buildStatus();
    expect(status.paired).toBe(false);
    expect(status.lastSyncAt).toBeNull();
    expect(status.queueDepth).toBe(0);
    expect(status.lastError).toBeNull();
  });

  it("reports deviceId when the device-id file exists", async () => {
    vi.mocked(isPaired).mockResolvedValue(true);
    writeFileSync(join(tmpHome, ".agentsofmine", "device-id"), "dev-123\n");
    const buildStatus = await loadBuildStatus();
    const status = await buildStatus();
    expect(status.paired).toBe(true);
    expect(status.deviceId).toBe("dev-123");
  });

  it("returns the newest timestamp across all watchers as lastSyncAt", async () => {
    vi.mocked(isPaired).mockResolvedValue(true);
    writeFileSync(
      join(tmpHome, ".agentsofmine", "last-sync.json"),
      JSON.stringify({
        opencode: "2026-06-10T10:00:00.000Z",
        claude: "2026-06-13T12:30:00.000Z",
        codex: "2026-06-11T08:00:00.000Z",
      }),
    );
    const buildStatus = await loadBuildStatus();
    const status = await buildStatus();
    expect(status.lastSyncAt).toBe("2026-06-13T12:30:00.000Z");
  });

  it("treats an unparseable last-sync.json as no sync", async () => {
    vi.mocked(isPaired).mockResolvedValue(true);
    writeFileSync(join(tmpHome, ".agentsofmine", "last-sync.json"), "{ not json");
    const buildStatus = await loadBuildStatus();
    const status = await buildStatus();
    expect(status.lastSyncAt).toBeNull();
  });
});
