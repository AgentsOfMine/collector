/**
 * `aom pair` — one-time device pairing.
 *
 * Presentation layer only: QR rendering, spinner, terminal output, error
 * messages, process.exit() calls.
 *
 * All orchestration (init → poll → token storage → config write) lives in
 * PairingService. All file I/O lives in ConfigRepository.
 *
 * Flow (mirrors ADR 0006 / D015):
 *  1. Generate a stable deviceId (UUIDv4), persisted locally via ConfigRepository.
 *  2. POST /pair/init → receive pairingCode + qrUrl.
 *  3. Print URL + ASCII QR to terminal.
 *  4. Optionally open browser automatically (--no-browser to skip).
 *  5. Poll GET /pair/status every pollInterval seconds (via PairingService).
 *  6. On "approved" → PairingService stores deviceToken in OS keychain.
 *  7. On "denied" / "expired" → exit non-zero with a clear message.
 */

import qrcode from "qrcode-terminal";
import openBrowser from "open";
import { PairingClient, PairingApiError } from "../api/pairing-client.js";
import { ConfigRepository } from "../infrastructure/config-repository.js";
import { PairingService } from "../services/pairing-service.js";
import { isPaired } from "../keychain/index.js";


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
  const configRepo = new ConfigRepository();
  const service = new PairingService(client, configRepo);

  process.stdout.write("Requesting pairing code… ");

  let result: Awaited<ReturnType<typeof service.runPairFlow>>;
  try {
    result = await service.runPairFlow({
      reset: opts.force ?? false,

      onInitSuccess: ({ pairingCode, qrUrl, expiresInMinutes, pollIntervalMs: _unused }) => {
        void _unused;
        console.log("done\n");
        printPairingUI(qrUrl, pairingCode, expiresInMinutes);

        if (!opts.noBrowser) {
          openBrowser(qrUrl).catch(() => {
            // Non-fatal: browser open is best-effort
          });
        }

        console.log("Waiting for approval on your phone…\n");
      },

      onPollTick: (tick) => {
        const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        const frame = spinnerFrames[tick % spinnerFrames.length] ?? "·";
        process.stdout.write(`\r${frame} Waiting…`);
      },
    });
  } catch (err) {
    process.stdout.write("\n");
    handleApiError(err);
    return;
  }

  process.stdout.write("\n\n");

  switch (result.status) {
    case "approved":
      console.log("✓ \x1b[32mPaired!\x1b[0m Device token stored in keychain.");
      console.log("  Run \x1b[36maom start\x1b[0m to begin syncing sessions.");
      return;

    case "denied":
      console.error("✗ Pairing was denied on your phone.");
      console.error("  Run \x1b[36maom pair\x1b[0m again to start a new pairing.");
      process.exit(1);
      break;

    case "expired":
      console.error("✗ Pairing code expired (5 minutes).");
      console.error("  Run \x1b[36maom pair\x1b[0m again to get a fresh code.");
      process.exit(1);
      break;
  }
}


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


function handleApiError(err: unknown): never {
  if (err instanceof PairingApiError) {
    console.error(`\n✗ Pairing API returned HTTP ${err.statusCode}`);
    if (err.statusCode === 429) {
      console.error("  Too many requests — wait a moment and try again.");
    } else if (err.statusCode >= 500) {
      console.error("  Server error — please try again in a few seconds.");
    } else {
      console.error(`  ${err.body}`);
    }
  } else {
    console.error(`\n✗ Network error during pairing:`, (err as Error).message);
    console.error("  Check your internet connection and try again.");
  }
  process.exit(1);
}
