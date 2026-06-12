import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config.js";
import { ConfigRepository } from "../../src/infrastructure/config-repository.js";

const TOKEN_ENV_KEYS = ["AOM_DEVICE_TOKEN", "AOM_DEVICE_ID", "AOM_SYNC_URL"] as const;

describe("loadConfig — keychain provider seam", () => {
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;
  let repo: ConfigRepository;

  beforeEach(() => {
    for (const k of TOKEN_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    // Empty temp config dir => no on-disk token, so the keychain seam is the
    // only token source and the test is deterministic on any machine.
    tmpDir = mkdtempSync(join(tmpdir(), "aom-cfg-"));
    repo = new ConfigRepository(tmpDir);
  });

  afterEach(() => {
    for (const k of TOKEN_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads the device token from the injected keychain provider", async () => {
    const config = await loadConfig(async () => "tok-from-keychain", repo);
    expect(config.deviceToken).toBe("tok-from-keychain");
  });

  it("falls back to empty string when the keychain returns null", async () => {
    const config = await loadConfig(async () => null, repo);
    expect(config.deviceToken).toBe("");
  });

  it("env var AOM_DEVICE_TOKEN takes precedence over the keychain", async () => {
    process.env["AOM_DEVICE_TOKEN"] = "env-token";
    let called = false;
    const config = await loadConfig(async () => {
      called = true;
      return "keychain-token";
    }, repo);
    expect(config.deviceToken).toBe("env-token");
    expect(called).toBe(false);
  });

  it("a config.json file token short-circuits before the keychain", async () => {
    repo.writePairingConfig({
      deviceId: "dev-file",
      deviceToken: "file-token",
      pairedAt: "2026-06-12T00:00:00Z",
    });
    let called = false;
    const config = await loadConfig(async () => {
      called = true;
      return "keychain-token";
    }, repo);
    expect(config.deviceToken).toBe("file-token");
    expect(called).toBe(false);
  });

  it("does not require a real OS keychain (provider is fully injectable)", async () => {
    const config = await loadConfig(async () => "x", repo);
    expect(config.collectorVersion).toBe("0.1.0");
    expect(config.syncUrl).toContain("agentsofmine.io");
  });
});
