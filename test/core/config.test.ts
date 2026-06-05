import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigRepository } from "../../src/infrastructure/config-repository.js";

let tmpDir: string;
let repo: ConfigRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "aom-config-"));
  repo = new ConfigRepository(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ConfigRepository — device ID", () => {
  it("returns null before any write", () => {
    expect(repo.readDeviceId()).toBeNull();
  });

  it("round-trips a written device ID", () => {
    repo.writeDeviceId("dev-abc-123");
    expect(repo.readDeviceId()).toBe("dev-abc-123");
  });

  it("returns null for an empty string device ID file", () => {
    writeFileSync(join(tmpDir, "device-id"), "   ", "utf8");
    expect(repo.readDeviceId()).toBeNull();
  });
});

describe("ConfigRepository — pairing config", () => {
  it("returns null when config.json is missing", () => {
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("round-trips a written pairing config", () => {
    const config = {
      deviceId: "dev-1",
      deviceToken: "tok-xyz",
      pairedAt: "2026-06-03T00:00:00Z",
    };
    repo.writePairingConfig(config);
    expect(repo.readPairingConfig()).toEqual(config);
  });

  it("returns null when config.json is malformed JSON", () => {
    writeFileSync(join(tmpDir, "config.json"), "NOT JSON {{", "utf8");
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("returns null when config.json is missing required fields", () => {
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ foo: "bar" }), "utf8");
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("returns null when config.json is a JSON array", () => {
    writeFileSync(join(tmpDir, "config.json"), '["a"]', "utf8");
    expect(repo.readPairingConfig()).toBeNull();
  });
});

describe("ConfigRepository — readDeviceToken", () => {
  it("returns null when no config file", () => {
    expect(repo.readDeviceToken()).toBeNull();
  });

  it("returns token from config file", () => {
    repo.writePairingConfig({ deviceId: "d", deviceToken: "tok-123", pairedAt: "2026-01-01T00:00:00Z" });
    expect(repo.readDeviceToken()).toBe("tok-123");
  });

  it("returns null when token is empty string", () => {
    writeFileSync(join(tmpDir, "config.json"), JSON.stringify({ deviceId: "d", deviceToken: "", pairedAt: "now" }), "utf8");
    expect(repo.readDeviceToken()).toBeNull();
  });
});

describe("ConfigRepository — clearPairingConfig", () => {
  it("makes readPairingConfig return null after clearing", () => {
    repo.writePairingConfig({ deviceId: "d", deviceToken: "t", pairedAt: "2026-01-01T00:00:00Z" });
    repo.clearPairingConfig();
    expect(repo.readPairingConfig()).toBeNull();
  });

  it("is safe to call when no config file exists", () => {
    expect(() => repo.clearPairingConfig()).not.toThrow();
  });

  it("allows writing a new config after clear", () => {
    repo.writePairingConfig({ deviceId: "old", deviceToken: "old-tok", pairedAt: "2026-01-01T00:00:00Z" });
    repo.clearPairingConfig();
    repo.writePairingConfig({ deviceId: "new", deviceToken: "new-tok", pairedAt: "2026-06-03T00:00:00Z" });
    expect(repo.readPairingConfig()?.deviceId).toBe("new");
  });
});
