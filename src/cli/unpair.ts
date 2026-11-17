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
import { ConfigRepository } from "../infrastructure/config-repository.js";
import { EXIT_OK, type Terminal } from "./terminal.js";
import { askYesNo } from "./prompt.js";

export interface UnpairOptions {
  /** Skip confirmation prompt. */
  yes?: boolean;
}

export interface UnpairDeps {
  isPaired: () => Promise<boolean>;
  deleteDeviceToken: () => Promise<boolean>;
  clearLocalState: () => void;
  confirm: (question: string) => Promise<boolean>;
}

const realDeps: UnpairDeps = {
  isPaired,
  deleteDeviceToken,
  clearLocalState: () => new ConfigRepository().clearLocalState(),
  confirm: (question) => askYesNo(question),
};

export async function runUnpair(
  term: Terminal,
  opts: UnpairOptions = {},
  deps: UnpairDeps = realDeps,
): Promise<number> {
  if (!(await deps.isPaired())) {
    term.out("This machine is not currently paired — nothing to do.");
    return EXIT_OK;
  }

  if (!opts.yes) {
    const confirmed = await deps.confirm(
      "Remove device token from keychain and stop syncing on this machine? [y/N] ",
    );
    if (!confirmed) {
      term.out("Aborted.");
      return EXIT_OK;
    }
  }

  if (await deps.deleteDeviceToken()) {
    term.out("✓ Device token removed from keychain.");
  }

  deps.clearLocalState();

  const { paint } = term;
  term.out("✓ Local collector state cleared.");
  term.out();
  term.out("  To also revoke this device from your account,");
  term.out(`  go to ${paint.underline("https://agentsofmine.io")} → Devices → Revoke.`);
  term.out();
  term.out(`  Run ${paint.cyan("aom pair")} to re-pair this machine.`);
  return EXIT_OK;
}
