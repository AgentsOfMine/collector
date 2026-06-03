/**
 * OS keychain abstraction for the AgentsOfMine device token.
 *
 * Wraps `keytar` (macOS Keychain / Windows Credential Manager / Linux
 * libsecret) with a thin typed interface so callers never import keytar
 * directly. All methods throw `KeychainError` on failure.
 */

import keytar from "keytar";

const SERVICE = "agentsofmine-collector";
const ACCOUNT = "device-token";

export class KeychainError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "KeychainError";
  }
}

/**
 * Store the device token in the OS keychain.
 * Overwrites any existing value for the same service+account.
 */
export async function storeDeviceToken(token: string): Promise<void> {
  try {
    await keytar.setPassword(SERVICE, ACCOUNT, token);
  } catch (err) {
    throw new KeychainError("Failed to store device token in keychain", err);
  }
}

/**
 * Retrieve the device token from the OS keychain.
 * Returns `null` if not paired yet.
 */
export async function getDeviceToken(): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, ACCOUNT);
  } catch (err) {
    throw new KeychainError("Failed to read device token from keychain", err);
  }
}

/**
 * Delete the device token from the OS keychain.
 * Returns `true` if a token was found and deleted, `false` if not found.
 */
export async function deleteDeviceToken(): Promise<boolean> {
  try {
    return await keytar.deletePassword(SERVICE, ACCOUNT);
  } catch (err) {
    throw new KeychainError("Failed to delete device token from keychain", err);
  }
}

/**
 * Returns `true` if a device token is stored (machine is paired).
 */
export async function isPaired(): Promise<boolean> {
  const token = await getDeviceToken();
  return token !== null;
}
