/**
 * ConfigRepository — all local config I/O in one place.
 *
 * Knows about:
 *   - ~/.agentsofmine/device-id       (plain text, UUID)
 *   - ~/.agentsofmine/config.json     (JSON with deviceId, deviceToken, pairedAt)
 *
 * Does NOT touch env vars or the OS keychain — callers (loadConfig, PairingService)
 * are responsible for that.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PairingConfig {
  deviceId: string;
  deviceToken: string;
  pairedAt: string;
}

interface RawConfigFile {
  deviceId?: string;
  deviceToken?: string;
  pairedAt?: string;
}

export class ConfigRepository {
  private readonly configDir: string;
  private readonly configFile: string;
  private readonly deviceIdFile: string;

  constructor(baseDir: string = join(homedir(), ".agentsofmine")) {
    this.configDir = baseDir;
    this.configFile = join(baseDir, "config.json");
    this.deviceIdFile = join(baseDir, "device-id");
  }

  readDeviceId(): string | null {
    try {
      if (existsSync(this.deviceIdFile)) {
        const id = readFileSync(this.deviceIdFile, "utf8").trim();
        return id.length > 0 ? id : null;
      }
    } catch {
      // unreadable — treat as absent
    }
    return null;
  }

  writeDeviceId(id: string): void {
    mkdirSync(this.configDir, { recursive: true });
    writeFileSync(this.deviceIdFile, id, { encoding: "utf8", mode: 0o600 });
  }

  readPairingConfig(): PairingConfig | null {
    const raw = this.readRawConfigFile();
    if (
      typeof raw.deviceId === "string" &&
      typeof raw.deviceToken === "string" &&
      typeof raw.pairedAt === "string"
    ) {
      return {
        deviceId: raw.deviceId,
        deviceToken: raw.deviceToken,
        pairedAt: raw.pairedAt,
      };
    }
    return null;
  }

  readDeviceToken(): string | null {
    const raw = this.readRawConfigFile();
    return typeof raw.deviceToken === "string" && raw.deviceToken.length > 0
      ? raw.deviceToken
      : null;
  }

  writePairingConfig(config: PairingConfig): void {
    mkdirSync(this.configDir, { recursive: true });
    const tmp = this.configFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.configFile);
  }

  clearPairingConfig(): void {
    try {
      mkdirSync(this.configDir, { recursive: true });
      writeFileSync(this.configFile, "{}", "utf8");
    } catch {
      // ignore — file already gone or unwritable
    }
  }

  /**
   * Delete config.json + device-id from disk (idempotent).
   * Does NOT touch the OS keychain — the caller owns the device token.
   */
  clearLocalState(): void {
    for (const file of [this.configFile, this.deviceIdFile]) {
      try {
        if (existsSync(file)) rmSync(file);
      } catch {
        // ignore — already gone or unwritable
      }
    }
  }

  private readRawConfigFile(): RawConfigFile {
    try {
      const content = readFileSync(this.configFile, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as RawConfigFile;
      }
    } catch {
      // missing or malformed — return empty
    }
    return {};
  }
}
