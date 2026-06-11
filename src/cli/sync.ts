/**
 * `aom sync` — one-shot sync of new sessions to the cloud.
 *
 * Presentation only. All orchestration lives in `performSync()`; all
 * ingestion logic lives in the core `runSync()` engine.
 *
 * This is the manual counterpart to the daemon (`aom start`), which runs the
 * same `performSync()` automatically on file changes. Exits non-zero if any
 * session failed to sync, so it is CI-friendly.
 */

import { isPaired } from "../keychain/index.js";
import { performSync, NotPairedError } from "../core/perform-sync.js";

export interface SyncOptions {
  /** Verbose logging — print per-error detail. */
  verbose?: boolean;
}

export async function runSyncCommand(opts: SyncOptions = {}): Promise<void> {
  // Guard: must be paired
  if (!(await isPaired())) {
    console.error("✗ This machine is not paired yet.");
    console.error("  Run \x1b[36maom pair\x1b[0m first.");
    process.exit(1);
  }

  console.log("agentsofmine-collector — syncing…\n");

  let summary;
  try {
    summary = await performSync();
  } catch (err) {
    if (err instanceof NotPairedError) {
      console.error("✗ Device token missing — run \x1b[36maom pair\x1b[0m again.");
      process.exit(1);
    }
    throw err;
  }

  console.log(`  ✓ synced  ${summary.synced}`);
  if (summary.failed > 0) {
    console.log(`  ✗ failed  ${summary.failed}`);
  }

  if (opts.verbose && summary.errors.length > 0) {
    console.log("\n  Errors:");
    for (const err of summary.errors) {
      console.log(`    \x1b[31m${err}\x1b[0m`);
    }
  } else if (summary.errors.length > 0) {
    console.log(`\n  ${summary.errors.length} error(s). Re-run with -v for detail.`);
  }

  console.log();

  if (summary.failed > 0) {
    process.exit(1);
  }
}
