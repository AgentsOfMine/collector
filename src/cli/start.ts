/**
 * `aom start` — start the collector daemon.
 *
 * Starts:
 *  1. File watchers for each supported agent (opencode, claude-code, codex).
 *  2. The MCP server (stdio transport) so agents can push events directly.
 *
 * Exits with a clear message if the machine is not yet paired.
 */

import { isPaired, getDeviceToken } from "../keychain/index.js";
import { startMcpServer } from "../mcp/server.js";
import { OpenCodeWatcher } from "../watchers/opencode.js";
import { DaemonState } from "../daemon/state.js";

export interface StartOptions {
  /** Override MCP server port (default: stdio). */
  mcpPort?: number;
  /** Verbose logging. */
  verbose?: boolean;
}

export async function runStart(opts: StartOptions = {}): Promise<void> {
  // Guard: must be paired
  if (!(await isPaired())) {
    console.error("✗ This machine is not paired yet.");
    console.error("  Run \x1b[36maom pair\x1b[0m first.");
    process.exit(1);
  }

  const deviceToken = await getDeviceToken();
  if (!deviceToken) {
    console.error("✗ Device token missing — run \x1b[36maom pair\x1b[0m again.");
    process.exit(1);
  }

  const state = new DaemonState({ deviceToken, verbose: opts.verbose ?? false });

  console.log("agentsofmine-collector starting…\n");

  // Start file watchers
  const watchers = [new OpenCodeWatcher(state)];
  for (const w of watchers) {
    await w.start();
    console.log(`  ✓ ${w.name} watcher active`);
  }

  // Start MCP server (stdio — agents attach via their MCP config)
  await startMcpServer(state);
  console.log("  ✓ MCP server listening (stdio)");

  console.log("\nCollector is running. Press Ctrl+C to stop.\n");

  // Keep alive until signal
  setupSignalHandlers(watchers);
}

function setupSignalHandlers(watchers: Array<{ stop: () => Promise<void> }>): void {
  const shutdown = async () => {
    console.log("\nShutting down…");
    for (const w of watchers) {
      await w.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
