/**
 * `aom start` — start the collector daemon.
 *
 * Starts:
 *  1. A shared SyncRunner (debounced, single-flight) that uploads new sessions.
 *  2. File watchers for each supported agent (OpenCode DB, Claude Code and
 *     Codex session directories). Each watcher triggers the SyncRunner.
 *  3. The MCP server (stdio transport) so agents can push events directly;
 *     those pushes also trigger the SyncRunner.
 *
 * An initial sync runs at startup so a freshly started daemon catches up on
 * anything written while it was down. Exits with a clear message if the
 * machine is not yet paired.
 */

import { isPaired, getDeviceToken } from "../keychain/index.js";
import { loadConfig } from "../config.js";
import { startMcpServer } from "../mcp/server.js";
import { OpenCodeWatcher } from "../watchers/opencode.js";
import { DirectoryWatcher } from "../watchers/directory-watcher.js";
import { DaemonState } from "../daemon/state.js";
import { SyncRunner } from "../daemon/sync-runner.js";

export interface StartOptions {
  /** Override MCP server port (default: stdio). */
  mcpPort?: number;
  /** Verbose logging. */
  verbose?: boolean;
}

interface Watcher {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function runStart(opts: StartOptions = {}): Promise<void> {
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

  const config = await loadConfig();
  const state = new DaemonState({ deviceToken, verbose: opts.verbose ?? false });

  const syncRunner = new SyncRunner({
    log: (msg) => state.log(msg),
    onSynced: (summary) => {
      if (summary.synced > 0 || summary.failed > 0) {
        state.markSynced("daemon");
      }
    },
  });
  state.syncRunner = syncRunner;

  console.log("agentsofmine-collector starting…\n");

  const codexDir = config.codexSessionsDir;
  const claudeProjectsDir = config.claudeProjectsGlob
    .replace(/[/\\]\*[/\\]\*\.jsonl$/, "")
    .replace(/[/\\]\*\.jsonl$/, "");

  const watchers: Watcher[] = [
    new OpenCodeWatcher(state, syncRunner, config.opencodeDbPath),
    new DirectoryWatcher("claude-code", claudeProjectsDir, state, syncRunner, (f) =>
      f.endsWith(".jsonl"),
    ),
    new DirectoryWatcher("codex", codexDir, state, syncRunner),
    new DirectoryWatcher("pi", config.piSessionsDir, state, syncRunner, (f) =>
      f.endsWith(".jsonl"),
    ),
  ];

  for (const w of watchers) {
    await w.start();
    console.log(`  ✓ ${w.name} watcher active`);
  }

  await startMcpServer(state);
  console.log("  ✓ MCP server listening (stdio)");

  console.log("\nRunning initial sync…");
  await syncRunner.runNow();

  console.log("\nCollector is running. Watching for changes. Press Ctrl+C to stop.\n");

  setupSignalHandlers(watchers, syncRunner);
}

function setupSignalHandlers(watchers: Watcher[], syncRunner: SyncRunner): void {
  const shutdown = async () => {
    console.log("\nShutting down…");
    syncRunner.stop();
    for (const w of watchers) {
      await w.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
