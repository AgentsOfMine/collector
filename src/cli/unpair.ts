/**
 * `aom unpair` — revoke this device's token and clear the keychain entry.
 *
 * Does NOT call DELETE /devices/{deviceId} automatically (that would require
 * the user to also be signed in to Cognito). Instead it:
 *  1. Clears the device token from the OS keychain.
 *  2. Prints a reminder to revoke the device from the mobile app if desired.
 *
 * The device token becomes useless the moment the backend revokes it
 * (via DELETE /devices/{deviceId} from the mobile app), but clearing it
 * locally is the immediate trust boundary.
 */

import { deleteDeviceToken, isPaired } from "../keychain/index.js";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".agentsofmine");
const DEVICE_ID_FILE = join(STATE_DIR, "device-id");
const LAST_SYNC_FILE = join(STATE_DIR, "last-sync.json");

export interface UnpairOptions {
  /** Skip confirmation prompt. */
  yes?: boolean;
}

export async function runUnpair(opts: UnpairOptions = {}): Promise<void> {
  if (!(await isPaired())) {
    console.log("This machine is not currently paired — nothing to do.");
    return;
  }

  if (!opts.yes) {
    const confirmed = await confirm(
      "Remove device token from keychain and stop syncing on this machine? [y/N] ",
    );
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  const deleted = await deleteDeviceToken();
  if (deleted) {
    console.log("✓ Device token removed from keychain.");
  }

  // Clear local state files
  if (existsSync(LAST_SYNC_FILE)) rmSync(LAST_SYNC_FILE);
  if (existsSync(DEVICE_ID_FILE)) rmSync(DEVICE_ID_FILE);

  console.log("✓ Local collector state cleared.");
  console.log();
  console.log("  To also revoke this device from your account,");
  console.log("  go to \x1b[4mhttps://agentsofmine.io\x1b[0m → Devices → Revoke.");
  console.log();
  console.log("  Run \x1b[36maom pair\x1b[0m to re-pair this machine.");
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk: string) => {
      const answer = chunk.trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
}
