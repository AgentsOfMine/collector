/**
 * `aom sync` — one-shot sync of new sessions to the cloud.
 *
 * Presentation only. All orchestration lives in `performSync()`; all
 * ingestion logic lives in the core `runSync()` engine.
 *
 * This is the manual counterpart to the daemon (`aom start`), which runs the
 * same `performSync()` automatically on file changes. Returns a non-zero exit
 * code if any session failed to sync, so it is CI-friendly.
 */

import { isPaired } from "../keychain/index.js";
import { performSync, NotPairedError } from "../core/perform-sync.js";
import type { SyncSummary } from "../core/sync-engine.js";
import { EXIT_FAILURE, EXIT_OK, type Terminal } from "./terminal.js";
import { printNotPaired, printTokenMissing } from "./messages.js";

export interface SyncOptions {
  /** Verbose logging — print per-error detail. */
  verbose?: boolean;
}

export interface SyncDeps {
  isPaired: () => Promise<boolean>;
  performSync: () => Promise<SyncSummary>;
}

const realDeps: SyncDeps = { isPaired, performSync };

export async function runSyncCommand(
  term: Terminal,
  opts: SyncOptions = {},
  deps: SyncDeps = realDeps,
): Promise<number> {
  if (!(await deps.isPaired())) {
    printNotPaired(term);
    return EXIT_FAILURE;
  }

  term.out("agentsofmine-collector — syncing…\n");

  let summary: SyncSummary;
  try {
    summary = await deps.performSync();
  } catch (err) {
    if (err instanceof NotPairedError) {
      printTokenMissing(term);
      return EXIT_FAILURE;
    }
    throw err;
  }

  printSummary(term, summary, opts.verbose ?? false);
  return summary.failed > 0 ? EXIT_FAILURE : EXIT_OK;
}

function printSummary(term: Terminal, summary: SyncSummary, verbose: boolean): void {
  const { paint } = term;
  term.out(`  ${paint.green("✓")} synced  ${summary.synced}`);
  if (summary.failed > 0) {
    term.out(`  ${paint.red("✗")} failed  ${summary.failed}`);
  }

  if (summary.errors.length > 0) {
    if (verbose) {
      term.out("\n  Errors:");
      for (const error of summary.errors) term.out(`    ${paint.red(error)}`);
    } else {
      term.out(`\n  ${summary.errors.length} error(s). Re-run with -v for detail.`);
    }
  }

  term.out();
}
