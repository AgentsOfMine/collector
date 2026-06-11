/**
 * Generic recursive directory watcher.
 *
 * Claude Code and Codex persist sessions as files under a directory tree
 * (JSONL files for Claude, session logs for Codex), unlike OpenCode's single
 * SQLite DB. This watcher signals the shared SyncRunner whenever anything
 * under the watched directory changes. It does not parse anything — the
 * adapters (driven by performSync) do the incremental read from the cursor.
 */

import { watch, existsSync, type FSWatcher } from "node:fs";
import type { DaemonState } from "../daemon/state.js";
import type { SyncRunner } from "../daemon/sync-runner.js";

export class DirectoryWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    readonly name: string,
    private readonly dir: string,
    private readonly state: DaemonState,
    private readonly syncRunner: SyncRunner,
    /** Only react to files matching this predicate (default: all). */
    private readonly matches: (filename: string) => boolean = () => true,
  ) {}

  async start(): Promise<void> {
    if (!existsSync(this.dir)) {
      this.state.log(`${this.name} watcher: ${this.dir} does not exist yet — not watching`);
      return;
    }

    this.watcher = watch(this.dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (!this.matches(filename)) return;
      this.syncRunner.trigger(`${this.name} change: ${filename}`);
    });

    this.state.log(`${this.name} watcher: watching ${this.dir}`);
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;
    this.state.log(`${this.name} watcher: stopped`);
  }
}
