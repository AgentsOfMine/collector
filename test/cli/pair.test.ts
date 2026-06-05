import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigRepository } from "../../src/infrastructure/config-repository.js";

let tmpDir: string;
let repo: ConfigRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aom-pair-"));
  repo = new ConfigRepository(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PairingService preconditions — already-paired check", () => {
  it("returns existing config when paired", () => {
    repo.writePairingConfig({ deviceId: "dev-abc", deviceToken: "tok-xyz", pairedAt: "2026-06-03T00:00:00Z" });
    const result = repo.readPairingConfig();
    expect(result?.deviceId).toBe("dev-abc");
    expect(result?.deviceToken).toBe("tok-xyz");
  });

  it("returns null when not paired", () => {
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("treats non-empty token as already paired", () => {
    repo.writePairingConfig({ deviceId: "d", deviceToken: "tok-1", pairedAt: "2026-01-01T00:00:00Z" });
    const config = repo.readPairingConfig();
    expect(config?.deviceToken?.length).toBeGreaterThan(0);
  });

  it("treats empty token as not paired", () => {
    repo.clearPairingConfig();
    expect(repo.readDeviceToken()).toBeNull();
  });
});

describe("PairingService preconditions — --reset / --force flag", () => {
  it("clearPairingConfig makes subsequent reads return null", () => {
    repo.writePairingConfig({ deviceId: "old", deviceToken: "old-tok", pairedAt: "2026-01-01T00:00:00Z" });
    repo.clearPairingConfig();
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("can write a new config after clear", () => {
    repo.writePairingConfig({ deviceId: "old", deviceToken: "old-tok", pairedAt: "2026-01-01T00:00:00Z" });
    repo.clearPairingConfig();
    repo.writePairingConfig({ deviceId: "new", deviceToken: "new-tok", pairedAt: "2026-06-03T00:00:00Z" });
    expect(repo.readPairingConfig()?.deviceId).toBe("new");
  });
});

describe("PairingService preconditions — malformed config.json", () => {
  it("returns null on malformed JSON", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmpDir, "config.json"), "not-json", "utf8");
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("returns null on JSON array", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmpDir, "config.json"), '["something"]', "utf8");
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tmpDir, "config.json"), '{"foo": "bar"}', "utf8");
    expect(repo.readPairingConfig()).toBeNull();
  });
});
