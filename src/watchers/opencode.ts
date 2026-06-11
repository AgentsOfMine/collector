/**
 * OpenCode session watcher.
 *
 * OpenCode persists sessions to a SQLite database at
 * ~/.local/share/opencode/opencode.db. This watcher detects writes to that
 * database (and its WAL sidecar) and asks the shared SyncRunner to sync.
 *
 * It deliberately watches the *real* data source — the SQLite DB — not the
 * legacy ~/.opencode/sessions/ directory, which OpenCode no longer uses.
 *
 * The watcher does not parse anything itself: it only signals "something
 * changed". The OpenCodeAdapter (driven by performSync) does the actual
 * incremental read from the cursor.
 */

import { watch, existsSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import type { DaemonState } from "../daemon/state.js";
import type { SyncRunner } from "../daemon/sync-runner.js";

const OPENCODE_DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

export class OpenCodeWatcher {
  readonly name = "opencode";
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly state: DaemonState,
    private readonly syncRunner: SyncRunner,
    private readonly dbPath: string = OPENCODE_DB_PATH,
  ) {}

  async start(): Promise<void> {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      // OpenCode hasn't run on this machine yet. Nothing to watch; the daemon
      // stays up and a future `aom start` (or restart) will pick it up.
      this.state.log(`OpenCode watcher: ${dir} does not exist yet — not watching`);
      return;
    }

    const dbName = basename(this.dbPath);

    // Watch the containing directory rather than the DB file directly: SQLite
    // WAL mode writes to `<db>-wal` / `<db>-shm` sidecars and atomic renames
    // can break a file-level watch. Directory watch catches all of it.
    this.watcher = watch(dir, (_event, filename) => {
      if (!filename) return;
      // Only react to the opencode DB family (db, db-wal, db-shm).
      if (!filename.startsWith(dbName)) return;
      this.syncRunner.trigger(`opencode db change: ${filename}`);
    });

    this.state.log(`OpenCode watcher: watching ${this.dbPath}`);
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;
    this.state.log("OpenCode watcher: stopped");
  }
}
