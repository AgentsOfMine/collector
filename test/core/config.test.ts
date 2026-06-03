import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface PairingConfigFile {
  deviceId?: unknown;
  deviceToken?: unknown;
}

function loadConfigFromFile(configFile: string): PairingConfigFile {
  try {
    const raw = readFileSync(configFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as PairingConfigFile;
    }
  } catch {
    // missing or malformed
  }
  return {};
}

function resolveDeviceId(
  envValue: string | undefined,
  fileConfig: PairingConfigFile,
): string {
  if (envValue !== undefined) return envValue;
  if (typeof fileConfig.deviceId === "string" && fileConfig.deviceId) {
    return fileConfig.deviceId;
  }
  return "dev_local";
}

function resolveDeviceToken(
  envValue: string | undefined,
  fileConfig: PairingConfigFile,
): string {
  if (envValue !== undefined) return envValue;
  if (typeof fileConfig.deviceToken === "string") {
    return fileConfig.deviceToken;
  }
  return "";
}

describe("loadConfig — priority: env var > config file > defaults", () => {
  let tmpDir: string;
  let configFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "aom-config-test-"));
    configFile = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("env var AOM_DEVICE_ID takes priority over config file", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ deviceId: "file-device", deviceToken: "file-token", pairedAt: "2026-01-01" }),
      "utf8",
    );

    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceId("env-device", fc)).toBe("env-device");
  });

  it("env var AOM_DEVICE_TOKEN takes priority over config file", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ deviceId: "file-device", deviceToken: "file-token", pairedAt: "2026-01-01" }),
      "utf8",
    );

    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceToken("env-token", fc)).toBe("env-token");
  });

  it("config file deviceId used when env var absent", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ deviceId: "file-device", deviceToken: "file-token", pairedAt: "2026-01-01" }),
      "utf8",
    );

    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceId(undefined, fc)).toBe("file-device");
  });

  it("config file deviceToken used when env var absent", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ deviceId: "file-device", deviceToken: "file-token", pairedAt: "2026-01-01" }),
      "utf8",
    );

    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceToken(undefined, fc)).toBe("file-token");
  });

  it("returns default deviceId when config file is missing", () => {
    // don't write any config file
    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceId(undefined, fc)).toBe("dev_local");
  });

  it("returns empty deviceToken when config file is missing", () => {
    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceToken(undefined, fc)).toBe("");
  });

  it("returns defaults when config file is malformed JSON", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(configFile, "INVALID JSON {{", "utf8");

    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceId(undefined, fc)).toBe("dev_local");
    expect(resolveDeviceToken(undefined, fc)).toBe("");
  });

  it("falls back to default deviceId when config file has empty string deviceId", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ deviceId: "", deviceToken: "tok-valid", pairedAt: "2026-01-01" }),
      "utf8",
    );

    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceId(undefined, fc)).toBe("dev_local"); // empty string → default
    expect(resolveDeviceToken(undefined, fc)).toBe("tok-valid");
  });

  it("env var overrides config file for both fields", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({ deviceId: "file-device", deviceToken: "file-token", pairedAt: "2026-01-01" }),
      "utf8",
    );

    const fc = loadConfigFromFile(configFile);
    expect(resolveDeviceId("env-device", fc)).toBe("env-device");
    expect(resolveDeviceToken("env-token", fc)).toBe("env-token");
  });
});
