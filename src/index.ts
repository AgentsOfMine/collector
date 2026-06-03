/**
 * Public surface of the agentsofmine-collector package.
 *
 * Exports the keychain helpers and API client so the VS Code extension
 * wrapper can import them without spawning a subprocess.
 */

export { getDeviceToken, storeDeviceToken, deleteDeviceToken, isPaired } from "./keychain/index.js";
export { PairingClient, PairingApiError } from "./api/pairing-client.js";
export type {
  PairInitRequest,
  PairInitResponse,
  PairStatusResponse,
  PairingStatus,
} from "./api/pairing-client.js";
export { DaemonState } from "./daemon/state.js";
