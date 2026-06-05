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
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PairingConfig {
  deviceId: string;
  deviceToken: string;
  pairedAt: string;
}

// ---------------------------------------------------------------------------
// Internal file shape (may be a subset of PairingConfig during partial writes)
// ---------------------------------------------------------------------------

interface RawConfigFile {
  deviceId?: string;
  deviceToken?: string;
  pairedAt?: string;
}

// ---------------------------------------------------------------------------
// ConfigRepository
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".agentsofmine");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEVICE_ID_FILE = join(CONFIG_DIR, "device-id");

export class ConfigRepository {
  // ----- Device ID (plain-text file) ----------------------------------------

  /** Read the persisted device UUID, or null if not yet created. */
  readDeviceId(): string | null {
    try {
      if (existsSync(DEVICE_ID_FILE)) {
        const id = readFileSync(DEVICE_ID_FILE, "utf8").trim();
        return id.length > 0 ? id : null;
      }
    } catch {
      // unreadable — treat as absent
    }
    return null;
  }

  /**
   * Persist the device UUID.
   * Mode 0o600 so only the owner can read it.
   */
  writeDeviceId(id: string): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(DEVICE_ID_FILE, id, { encoding: "utf8", mode: 0o600 });
  }

  // ----- Pairing config (JSON file) -----------------------------------------

  /**
   * Read the full pairing config.
   * Returns null if the file is missing, malformed, or missing required fields.
   */
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

  /**
   * Read just the device token stored in config.json (legacy path before
   * keychain was introduced).  Returns null if absent.
   */
  readDeviceToken(): string | null {
    const raw = this.readRawConfigFile();
    return typeof raw.deviceToken === "string" && raw.deviceToken.length > 0
      ? raw.deviceToken
      : null;
  }

  /**
   * Atomically write the full pairing config.
   * Uses a .tmp → rename pattern to avoid partial writes.
   */
  writePairingConfig(config: PairingConfig): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const tmp = CONFIG_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
    renameSync(tmp, CONFIG_FILE);
  }

  /**
   * Reset the pairing config to an empty object.
   * Leaves the file in place so subsequent reads return null cleanly.
   */
  clearPairingConfig(): void {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(CONFIG_FILE, "{}", "utf8");
    } catch {
      // ignore — if the file can't be cleared it's already gone or unwritable
    }
  }

  // ----- Private helpers ----------------------------------------------------

  private readRawConfigFile(): RawConfigFile {
    try {
      const content = readFileSync(CONFIG_FILE, "utf8");
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
