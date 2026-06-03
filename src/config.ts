import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

export interface Config {
  syncUrl: string;
  deviceId: string;
  deviceToken: string;
  collectorVersion: string;
  opencodeDbPath: string;
  claudeProjectsGlob: string;
  codexSessionsDir: string;
}

const version = "0.1.0";

const CONFIG_DIR = join(homedir(), ".agentsofmine");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface PairingConfigFile {
  deviceId?: string;
  deviceToken?: string;
}

function readPairingConfigFile(): PairingConfigFile {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as PairingConfigFile;
    }
  } catch {
    // missing or malformed — return empty
  }
  return {};
}

export function loadConfig(): Config {
  const fileConfig = readPairingConfigFile();

  // Priority: env var > config file > defaults
  const syncUrl = process.env["AOM_SYNC_URL"] ?? "https://agentsofmine.io/sync";
  const deviceId =
    process.env["AOM_DEVICE_ID"] ??
    (typeof fileConfig.deviceId === "string" && fileConfig.deviceId
      ? fileConfig.deviceId
      : "dev_local");
  const deviceToken =
    process.env["AOM_DEVICE_TOKEN"] ??
    (typeof fileConfig.deviceToken === "string" ? fileConfig.deviceToken : "");

  return {
    syncUrl,
    deviceId,
    deviceToken,
    collectorVersion: version,
    opencodeDbPath: join(homedir(), ".local", "share", "opencode", "opencode.db"),
    claudeProjectsGlob: join(homedir(), ".claude", "projects", "*", "*.jsonl"),
    codexSessionsDir: join(homedir(), ".codex", "sessions"),
  };
}
