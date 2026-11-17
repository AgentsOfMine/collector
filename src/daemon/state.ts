/**
 * Daemon shared state — passed to all watchers.
 *
 * Holds the device token, verbose flag, and sync-timestamp bookkeeping.
 */

import { mkdirSync } from "node:fs";
import { recordLastSync } from "../core/last-sync-store.js";
import { stateDir } from "../core/paths.js";

export interface DaemonStateOptions {
  deviceToken: string;
  verbose: boolean;
}

export class DaemonState {
  readonly deviceToken: string;
  readonly verbose: boolean;

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
