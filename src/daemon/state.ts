/**
 * Daemon shared state — passed to all watchers and the MCP server.
 *
 * Holds the device token, verbose flag, and sync-timestamp bookkeeping.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".agentsofmine");
const LAST_SYNC_FILE = join(STATE_DIR, "last-sync.json");

export interface DaemonStateOptions {
  deviceToken: string;
  verbose: boolean;
}

export class DaemonState {
  readonly deviceToken: string;
  readonly verbose: boolean;
  private readonly lastSync: Record<string, string> = {};

  constructor(opts: DaemonStateOptions) {
    this.deviceToken = opts.deviceToken;
    this.verbose = opts.verbose;
    mkdirSync(STATE_DIR, { recursive: true });
  }

  markSynced(watcher: string): void {
    this.lastSync[watcher] = new Date().toISOString();
    writeFileSync(LAST_SYNC_FILE, JSON.stringify(this.lastSync, null, 2), "utf8");
  }

  log(msg: string): void {
    if (this.verbose) {
      console.log(`[aom] ${msg}`);
    }
  }
}
