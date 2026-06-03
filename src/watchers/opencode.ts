/**
 * OpenCode session file watcher.
 *
 * OpenCode writes session state to ~/.opencode/sessions/<sessionId>/.
 * This watcher detects new/modified session files and queues them for sync.
 *
 * Phase 1 stub — file discovery only. Actual normalisation + upload via
 * POST /sync ships in Phase 1.5 once the session-event schema is locked.
 */

import { watch, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DaemonState } from "../daemon/state.js";

const OPENCODE_SESSIONS_DIR = join(homedir(), ".opencode", "sessions");

export class OpenCodeWatcher {
  readonly name = "opencode";
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(private readonly state: DaemonState) {}

  async start(): Promise<void> {
    // Ensure the directory exists (opencode may not have run yet)
    if (!existsSync(OPENCODE_SESSIONS_DIR)) {
      mkdirSync(OPENCODE_SESSIONS_DIR, { recursive: true });
    }

    this.watcher = watch(OPENCODE_SESSIONS_DIR, { recursive: true }, (event, filename) => {
      if (!filename) return;
      this.state.log(`OpenCode watcher: ${event} → ${filename}`);
      // TODO(phase-1.5): parse session file, normalise, enqueue for POST /sync
      this.state.markSynced(this.name);
    });

    this.state.log(`OpenCode watcher: watching ${OPENCODE_SESSIONS_DIR}`);
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;
    this.state.log("OpenCode watcher: stopped");
  }
}
