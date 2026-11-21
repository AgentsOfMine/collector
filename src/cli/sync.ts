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
import { parseSince } from "../core/since.js";
import type { SyncSummary } from "../core/sync-engine.js";
import { EXIT_FAILURE, EXIT_OK, type Terminal } from "./terminal.js";
import { printNotPaired, printTokenMissing } from "./messages.js";

export interface SyncOptions {
  /** Verbose logging — print per-error detail. */
  verbose?: boolean;
  /** `--since` value: re-send a time window (7d, 12h, 2w, 2026-06-01, all) without moving the cursors. */
  since?: string;
}

export interface SyncDeps {
  isPaired: () => Promise<boolean>;
  performSync: (options?: { since?: Date }) => Promise<SyncSummary>;
}

const realDeps: SyncDeps = { isPaired, performSync };

export async function runSyncCommand(
  term: Terminal,
  opts: SyncOptions = {},
  deps: SyncDeps = realDeps,
): Promise<number> {
  let since: Date | undefined;
  if (opts.since !== undefined) {
    const parsed = parseSince(opts.since);
    if (!parsed.ok) {
      term.err(parsed.error);
      return EXIT_FAILURE;
    }
    since = parsed.since;
  }

  if (!(await deps.isPaired())) {
    printNotPaired(term);
    return EXIT_FAILURE;
  }

  term.out(
    since === undefined
      ? "agentsofmine-collector — syncing…\n"
      : `agentsofmine-collector — re-sending sessions active since ${since.toISOString().slice(0, 10)} (saved positions are left as they are)…\n`,
  );

  let summary: SyncSummary;
  try {
    summary = await deps.performSync(since === undefined ? {} : { since });
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
