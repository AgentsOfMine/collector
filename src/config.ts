import { join } from "node:path";
import { homedir } from "node:os";
import { getDeviceToken } from "./keychain/index.js";
import { ConfigRepository } from "./infrastructure/config-repository.js";

export interface Config {
  syncUrl: string;
  deviceId: string;
  deviceToken: string;
  collectorVersion: string;
  opencodeDbPath: string;
  claudeProjectsGlob: string;
  codexSessionsDir: string;
  piSessionsDir: string;
}

const version = "0.1.0";

// Shared singleton for internal use — callers that need richer access
// should import ConfigRepository directly.
const configRepo = new ConfigRepository();

type KeychainTokenReader = () => Promise<string | null>;

export async function loadConfig(
  readKeychainToken: KeychainTokenReader = getDeviceToken,
  repo: ConfigRepository = configRepo,
): Promise<Config> {
  const syncUrl = process.env["AOM_SYNC_URL"] ?? "https://agentsofmine.io/sync";

  // Device ID: env override → config.json → device-id file → fallback
  const deviceId =
    process.env["AOM_DEVICE_ID"] ??
    repo.readPairingConfig()?.deviceId ??
    repo.readDeviceId() ??
    "dev_local";

  // Device token: env override → config.json field → OS keychain → empty string
  const tokenFromFile = repo.readDeviceToken();
  const deviceToken =
    process.env["AOM_DEVICE_TOKEN"] ??
    tokenFromFile ??
    (await readKeychainToken()) ??
    "";

  return {
    syncUrl,
    deviceId,
    deviceToken,
    collectorVersion: version,
    opencodeDbPath: join(homedir(), ".local", "share", "opencode", "opencode.db"),
    claudeProjectsGlob: join(homedir(), ".claude", "projects", "*", "*.jsonl"),
    codexSessionsDir: join(homedir(), ".codex", "sessions"),
    piSessionsDir: join(homedir(), ".pi", "agent", "sessions"),
  };
}
