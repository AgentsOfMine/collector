/**
 * `aom pair` — one-time device pairing.
 *
 * Presentation layer only: QR rendering, spinner, terminal output and error
 * messages. It returns an exit code; it never calls process.exit().
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
import { PairingService, type PairFlowOptions, type PairFlowResult } from "../services/pairing-service.js";
import { isPaired } from "../keychain/index.js";
import { EXIT_FAILURE, EXIT_OK, type Terminal } from "./terminal.js";

export interface PairOptions {
  /** Skip auto-opening the browser. Defaults to false. */
  noBrowser?: boolean;
  /** Base URL override for staging / development. */
  apiBaseUrl?: string;
  /** Re-pair even if already paired. */
  force?: boolean;
}

export interface PairDeps {
  isPaired: () => Promise<boolean>;
  runPairFlow: (flow: PairFlowOptions, apiBaseUrl: string | undefined) => Promise<PairFlowResult>;
  openBrowser: (url: string) => Promise<unknown>;
  /** Render a QR code for `url` as lines of text. */
  renderQr: (url: string) => string;
}

const realDeps: PairDeps = {
  isPaired,
  runPairFlow: (flow, apiBaseUrl) =>
    new PairingService(new PairingClient(apiBaseUrl), new ConfigRepository()).runPairFlow(flow),
  openBrowser: (url) => openBrowser(url),
  renderQr: (url) => {
    let out = "";
    qrcode.generate(url, { small: true }, (code: string) => {
      out = code;
    });
    return out;
  },
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function runPair(
  term: Terminal,
  opts: PairOptions = {},
  deps: PairDeps = realDeps,
): Promise<number> {
  const { paint } = term;

  if (!opts.force && (await deps.isPaired())) {
    term.out("✓ This machine is already paired.");
    term.out(`  Run ${paint.cyan("aom status")} to see sync state.`);
    term.out(`  Use ${paint.cyan("aom pair --force")} to re-pair.`);
    return EXIT_OK;
  }

  term.write("Requesting pairing code… ");

  let result: PairFlowResult;
  try {
    result = await deps.runPairFlow(
      {
        reset: opts.force ?? false,

        onInitSuccess: ({ pairingCode, qrUrl, expiresInMinutes }) => {
          term.out("done\n");
          printPairingUi(term, deps.renderQr(qrUrl), qrUrl, pairingCode, expiresInMinutes);

          if (!opts.noBrowser) {
            // Best-effort: failing to open a browser is not a pairing failure.
            deps.openBrowser(qrUrl).catch(() => {});
          }

          term.out("Waiting for approval on your phone…\n");
        },

        onPollTick: (tick) => {
          const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? "·";
          term.write(`\r${frame} Waiting…`);
        },
      },
      opts.apiBaseUrl,
    );
  } catch (err) {
    term.write("\n");
    printApiError(term, err);
    return EXIT_FAILURE;
  }

  term.write("\n\n");

  switch (result.status) {
    case "approved":
      term.out(`✓ ${paint.green("Paired!")} Device token stored in keychain.`);
      term.out(`  Run ${paint.cyan("aom start")} to begin syncing sessions.`);
      return EXIT_OK;

    case "denied":
      term.err("✗ Pairing was denied on your phone.");
      term.err(`  Run ${paint.cyan("aom pair")} again to start a new pairing.`);
      return EXIT_FAILURE;

    case "expired":
      term.err("✗ Pairing code expired (5 minutes).");
      term.err(`  Run ${paint.cyan("aom pair")} again to get a fresh code.`);
      return EXIT_FAILURE;
  }
}

const RULE = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

function printPairingUi(
  term: Terminal,
  qr: string,
  qrUrl: string,
  pairingCode: string,
  expiresInMinutes: number,
): void {
  const { paint } = term;
  term.out(RULE);
  term.out("  AgentsOfMine — Pair this machine");
  term.out(`${RULE}\n`);

  if (qr) term.out(qr);

  term.out(`\n  ${paint.bold("Pairing code:")}  ${paint.cyan(pairingCode)}`);
  term.out(`  ${paint.dim(`Expires in ~${expiresInMinutes} minutes`)}\n`);
  term.out("  Or open this URL on your phone:");
  term.out(`  ${paint.underline(qrUrl)}\n`);
  term.out(`  ${paint.yellow("Only approve if you just ran this command.")}`);
  term.out(`  ${paint.yellow("Verify the pairing code matches what your phone shows.")}\n`);
  term.out(`${RULE}\n`);
}

function printApiError(term: Terminal, err: unknown): void {
  if (err instanceof PairingApiError) {
    term.err(`\n✗ Pairing API returned HTTP ${err.statusCode}`);
    if (err.statusCode === 429) {
      term.err("  Too many requests — wait a moment and try again.");
    } else if (err.statusCode >= 500) {
      term.err("  Server error — please try again in a few seconds.");
    } else {
      term.err(`  ${err.body}`);
    }
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  term.err(`\n✗ Network error during pairing: ${message}`);
  term.err("  Check your internet connection and try again.");
}
