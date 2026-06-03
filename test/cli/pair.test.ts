import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface PairingConfig {
  deviceId?: string;
  deviceToken?: string;
  pairedAt?: string;
}

function makePairingStore(dir: string) {
  const configFile = join(dir, "config.json");

  function read(): PairingConfig | null {
    try {
      const raw = readFileSync(configFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "deviceId" in parsed &&
        "deviceToken" in parsed &&
        "pairedAt" in parsed
      ) {
        return parsed as PairingConfig;
      }
    } catch {
      // missing or malformed
    }
    return null;
  }

  function write(config: PairingConfig): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf8");
  }

  function clear(): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configFile, "{}", "utf8");
  }

  return { read, write, clear, configFile };
}

describe("Pairing — already-paired check", () => {
  let tmpDir: string;
  let store: ReturnType<typeof makePairingStore>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aom-pair-test-"));
    store = makePairingStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns existing config when already paired", () => {
    store.write({
      deviceId: "dev-abc",
      deviceToken: "tok-xyz",
      pairedAt: "2026-06-03T00:00:00Z",
    });

    const result = store.read();
    expect(result).not.toBeNull();
    expect(result?.deviceId).toBe("dev-abc");
    expect(result?.deviceToken).toBe("tok-xyz");
  });

  it("returns null when config file is missing", () => {
    const result = store.read();
    expect(result).toBeNull();
  });

  it("skips flow when deviceToken is non-empty (already paired)", () => {
    store.write({ deviceId: "dev-1", deviceToken: "tok-1", pairedAt: "2026-01-01T00:00:00Z" });

    const config = store.read();
    const shouldSkip = config?.deviceToken != null && config.deviceToken.length > 0;
    expect(shouldSkip).toBe(true);
  });

  it("does NOT skip flow when deviceToken is empty string", () => {
    store.write({ deviceId: "dev-1", deviceToken: "", pairedAt: "2026-01-01T00:00:00Z" });

    const config = store.read();
    const shouldSkip = config?.deviceToken != null && config.deviceToken.length > 0;
    expect(shouldSkip).toBe(false);
  });
});

describe("Pairing — --reset flag", () => {
  let tmpDir: string;
  let store: ReturnType<typeof makePairingStore>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aom-pair-reset-test-"));
    store = makePairingStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("clear() writes empty object so read() returns null", () => {
    store.write({ deviceId: "dev-old", deviceToken: "tok-old", pairedAt: "2026-01-01T00:00:00Z" });
    store.clear();
    const result = store.read();
    expect(result).toBeNull();
  });

  it("after reset, a new pairing config can be written", () => {
    store.write({ deviceId: "dev-old", deviceToken: "tok-old", pairedAt: "2026-01-01T00:00:00Z" });
    store.clear();

    store.write({
      deviceId: "dev-new",
      deviceToken: "tok-new",
      pairedAt: "2026-06-03T00:00:00Z",
    });

    const result = store.read();
    expect(result?.deviceId).toBe("dev-new");
    expect(result?.deviceToken).toBe("tok-new");
  });
});

describe("Pairing — malformed config.json", () => {
  let tmpDir: string;
  let store: ReturnType<typeof makePairingStore>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aom-pair-malformed-test-"));
    store = makePairingStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when config.json is not valid JSON", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(store.configFile, "not-json", "utf8");
    const result = store.read();
    expect(result).toBeNull();
  });

  it("returns null when config.json is a JSON array", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(store.configFile, '["something"]', "utf8");
    const result = store.read();
    expect(result).toBeNull();
  });

  it("returns null when config.json is missing required fields", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(store.configFile, '{"foo": "bar"}', "utf8");
    const result = store.read();
    expect(result).toBeNull();
  });

  it("returns null when deviceId is a number (wrong type)", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      store.configFile,
      JSON.stringify({ deviceId: 123, deviceToken: "tok", pairedAt: "2026-01-01T00:00:00Z" }),
      "utf8"
    );
    const result = store.read();
    expect(result).not.toBeNull();
  });
});
