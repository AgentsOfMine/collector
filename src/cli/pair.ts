/**
 * `aom pair` — one-time device pairing.
 *
 * Flow (mirrors ADR 0006 / D015):
 *  1. Generate a stable deviceId (UUIDv4), persisted locally.
 *  2. POST /pair/init → receive pairingCode + qrUrl.
 *  3. Print URL + ASCII QR to terminal.
 *  4. Optionally open browser automatically (--no-browser to skip).
 *  5. Poll GET /pair/status every pollInterval seconds.
 *  6. On "approved" → store deviceToken in OS keychain.
 *  7. On "denied" / "expired" → exit non-zero with a clear message.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-terminal";
import openBrowser from "open";
import { PairingClient, PairingApiError } from "../api/pairing-client.js";
import { storeDeviceToken, isPaired } from "../keychain/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory for persistent local state (deviceId, last-sync timestamps). */
const STATE_DIR = join(homedir(), ".agentsofmine");
const DEVICE_ID_FILE = join(STATE_DIR, "device-id");

// ---------------------------------------------------------------------------
// Public command handler
// ---------------------------------------------------------------------------

export interface PairOptions {
  /** Skip auto-opening the browser. Defaults to false. */
  noBrowser?: boolean;
  /** Base URL override for staging / development. */
  apiBaseUrl?: string;
  /** Re-pair even if already paired. */
  force?: boolean;
}

export async function runPair(opts: PairOptions = {}): Promise<void> {
  // Guard: already paired
  if (!opts.force && (await isPaired())) {
    console.log("✓ This machine is already paired.");
    console.log("  Run \x1b[36maom status\x1b[0m to see sync state.");
    console.log("  Use \x1b[36maom pair --force\x1b[0m to re-pair.");
    return;
  }

  const client = new PairingClient(opts.apiBaseUrl);
  const deviceId = getOrCreateDeviceId();

  // Step 1 — POST /pair/init
  let pairInit: Awaited<ReturnType<typeof client.initPairing>>;
  try {
    process.stdout.write("Requesting pairing code… ");
    pairInit = await client.initPairing(deviceId);
    console.log("done\n");
  } catch (err) {
    handleApiError("POST /pair/init", err);
    return; // unreachable — handleApiError always throws/exits
  }

  const { pairingCode, qrUrl, pollInterval, expiresAt } = pairInit;
  const expiresIn = Math.round((expiresAt - Date.now() / 1000) / 60);

  // Step 2 — Display
  printPairingUI(qrUrl, pairingCode, expiresIn);

  // Step 3 — Optionally open browser
  if (!opts.noBrowser) {
    try {
      await openBrowser(qrUrl);
    } catch {
      // Non-fatal: browser open is best-effort
    }
  }

  // Step 4 — Poll
  console.log("Waiting for approval on your phone…\n");
  await pollUntilResolved(client, deviceId, pollInterval * 1000);
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

async function pollUntilResolved(
  client: PairingClient,
  deviceId: string,
  intervalMs: number,
): Promise<void> {
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let tick = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(intervalMs);

    const frame = spinnerFrames[tick % spinnerFrames.length] ?? "·";
    process.stdout.write(`\r${frame} Waiting…`);
    tick++;

    let status: Awaited<ReturnType<typeof client.pollStatus>>;
    try {
      status = await client.pollStatus(deviceId);
    } catch (err) {
      if (err instanceof PairingApiError && err.statusCode >= 500) {
        // Transient server error — keep polling
        continue;
      }
      process.stdout.write("\n");
      handleApiError("GET /pair/status", err);
      return;
    }

    switch (status.status) {
      case "pending":
        continue;

      case "approved": {
        process.stdout.write("\n\n");
        if (!status.deviceToken) {
          console.error("✗ Server returned approved but no deviceToken — please try again.");
          process.exit(1);
        }
        await storeDeviceToken(status.deviceToken);
        console.log("✓ \x1b[32mPaired!\x1b[0m Device token stored in keychain.");
        console.log("  Run \x1b[36maom start\x1b[0m to begin syncing sessions.");
        return;
      }

      case "denied":
        process.stdout.write("\n\n");
        console.error("✗ Pairing was denied on your phone.");
        console.error("  Run \x1b[36maom pair\x1b[0m again to start a new pairing.");
        process.exit(1);
        break;

      case "expired":
        process.stdout.write("\n\n");
        console.error("✗ Pairing code expired (5 minutes).");
        console.error("  Run \x1b[36maom pair\x1b[0m again to get a fresh code.");
        process.exit(1);
        break;

      default:
        // Unknown status — keep polling conservatively
        continue;
    }
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function printPairingUI(qrUrl: string, pairingCode: string, expiresInMinutes: number): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  AgentsOfMine — Pair this machine");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  qrcode.generate(qrUrl, { small: true });

  console.log(`\n  \x1b[1mPairing code:\x1b[0m  \x1b[36m${pairingCode}\x1b[0m`);
  console.log(`  \x1b[2mExpires in ~${expiresInMinutes} minutes\x1b[0m\n`);
  console.log("  Or open this URL on your phone:");
  console.log(`  \x1b[4m${qrUrl}\x1b[0m\n`);
  console.log("  \x1b[33mOnly approve if you just ran this command.\x1b[0m");
  console.log("  \x1b[33mVerify the pairing code matches what your phone shows.\x1b[0m\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

// ---------------------------------------------------------------------------
// DeviceId persistence
// ---------------------------------------------------------------------------

function getOrCreateDeviceId(): string {
  if (existsSync(DEVICE_ID_FILE)) {
    const id = readFileSync(DEVICE_ID_FILE, "utf8").trim();
    if (id.length > 0) return id;
  }
  const id = randomUUID();
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(DEVICE_ID_FILE, id, { encoding: "utf8", mode: 0o600 });
  return id;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function handleApiError(endpoint: string, err: unknown): never {
  if (err instanceof PairingApiError) {
    console.error(`\n✗ ${endpoint} returned HTTP ${err.statusCode}`);
    if (err.statusCode === 429) {
      console.error("  Too many requests — wait a moment and try again.");
    } else if (err.statusCode >= 500) {
      console.error("  Server error — please try again in a few seconds.");
    } else {
      console.error(`  ${err.body}`);
    }
  } else {
    console.error(`\n✗ Network error calling ${endpoint}:`, (err as Error).message);
    console.error("  Check your internet connection and try again.");
  }
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
