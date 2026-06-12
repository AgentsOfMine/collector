/**
 * Shared sync orchestration — the single place that wires config, adapters,
 * cursor store, and the core `runSync()` engine together.
 *
 * Both the manual `aom sync` command and the background daemon
 * (file watcher + MCP server) call this, so there is exactly one code path
 * that actually uploads sessions.
 */

import { loadConfig } from "../config.js";
import { runSync, type SyncConfig, type SyncSummary } from "./sync-engine.js";
import { FileCursorStore } from "./cursor-store.js";
import { OpenCodeAdapter } from "../adapters/opencode/index.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code/index.js";
import { CodexAdapter } from "../adapters/codex/index.js";
import { PiAdapter } from "../adapters/pi/index.js";
import type { Adapter } from "../adapters/adapter.js";
import { setLastSyncResult } from "../mcp-tools/status.js";
import { recordLastSync } from "./last-sync-store.js";

export class NotPairedError extends Error {
  constructor() {
    super("Device token missing — run `aom pair`.");
    this.name = "NotPairedError";
  }
}

/**
 * Run a single sync pass across all provider adapters.
 *
 * Resolves config from the environment / keychain, builds the three adapters,
 * and delegates to the core engine. The cursor store is flushed before
 * returning so progress is durable even if the process is killed afterwards.
 *
 * @throws {NotPairedError} when no device token is available.
 */
export async function performSync(): Promise<SyncSummary> {
  const config = await loadConfig();

  if (!config.deviceToken) {
    throw new NotPairedError();
  }

  const syncConfig: SyncConfig = {
    syncUrl: config.syncUrl,
    deviceId: config.deviceId,
    deviceToken: config.deviceToken,
    collectorVersion: config.collectorVersion,
  };

  const adapters: Adapter[] = [
    new OpenCodeAdapter(config.opencodeDbPath),
    new ClaudeCodeAdapter(config.claudeProjectsGlob),
    new CodexAdapter(config.codexSessionsDir),
    new PiAdapter(config.piSessionsDir),
  ];

  const cursorStore = new FileCursorStore();

  const summary = await runSync(adapters, syncConfig, cursorStore);
  cursorStore.flush();
  setLastSyncResult(summary);
  recordLastSync("sync");

  return summary;
}
