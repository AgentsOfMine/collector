/**
 * Daemon shared state — passed to all watchers and the MCP server.
 *
 * Holds the device token, verbose flag, sync-timestamp bookkeeping, and an
 * optional reference to the shared SyncRunner so the MCP server can trigger
 * real syncs on session_event pushes.
 */

import { mkdirSync } from "node:fs";
import type { SyncRunner } from "./sync-runner.js";
import { recordLastSync } from "../core/last-sync-store.js";
import { stateDir } from "../core/paths.js";

export interface DaemonStateOptions {
  deviceToken: string;
  verbose: boolean;
}

export class DaemonState {
  readonly deviceToken: string;
  readonly verbose: boolean;
  /** Set by `aom start` once the SyncRunner is constructed. */
  syncRunner: SyncRunner | null = null;

  constructor(opts: DaemonStateOptions) {
    this.deviceToken = opts.deviceToken;
    this.verbose = opts.verbose;
    mkdirSync(stateDir(), { recursive: true });
  }

  markSynced(watcher: string): void {
    recordLastSync(watcher);
  }

  log(msg: string): void {
    if (this.verbose) {
      console.log(`[aom] ${msg}`);
    }
  }
}
