import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { getDeviceToken } from "./keychain/index.js";

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
const DEVICE_ID_FILE = join(CONFIG_DIR, "device-id");

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

function readDeviceIdFile(): string | null {
  try {
    if (existsSync(DEVICE_ID_FILE)) {
      const id = readFileSync(DEVICE_ID_FILE, "utf8").trim();
      return id.length > 0 ? id : null;
    }
  } catch {
  }
  return null;
}

export async function loadConfig(): Promise<Config> {
  const fileConfig = readPairingConfigFile();

  const syncUrl = process.env["AOM_SYNC_URL"] ?? "https://agentsofmine.io/sync";

  const deviceId =
    process.env["AOM_DEVICE_ID"] ??
    (typeof fileConfig.deviceId === "string" && fileConfig.deviceId
      ? fileConfig.deviceId
      : readDeviceIdFile() ?? "dev_local");

  const tokenFromFile =
    typeof fileConfig.deviceToken === "string" && fileConfig.deviceToken
      ? fileConfig.deviceToken
      : null;

  const deviceToken =
    process.env["AOM_DEVICE_TOKEN"] ??
    tokenFromFile ??
    (await getDeviceToken()) ??
    "";

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
