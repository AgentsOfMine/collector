import { getDeviceToken } from "./keychain/index.js";
import { ConfigRepository } from "./infrastructure/config-repository.js";
import { COLLECTOR_VERSION } from "./core/version.js";
import { opencodeDbPath, claudeProjectsGlob, codexSessionsDir, piSessionsDir } from "./core/paths.js";

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
    collectorVersion: COLLECTOR_VERSION,
    opencodeDbPath: opencodeDbPath(),
    claudeProjectsGlob: claudeProjectsGlob(),
    codexSessionsDir: codexSessionsDir(),
    piSessionsDir: piSessionsDir(),
  };
}
