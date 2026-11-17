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
import { startMcpServer, type McpServerHandle } from "../mcp/server.js";
import { OpenCodeWatcher } from "../watchers/opencode.js";
import { DirectoryWatcher } from "../watchers/directory-watcher.js";
import { DaemonState } from "../daemon/state.js";
import { SyncRunner } from "../daemon/sync-runner.js";
import { claudeProjectsDirFromGlob } from "../core/paths.js";
import { EXIT_FAILURE, EXIT_OK, type Terminal } from "./terminal.js";
import { printNotPaired, printTokenMissing } from "./messages.js";

export interface StartOptions {
  /** Override MCP server port (default: stdio). */
  mcpPort?: number;
  /** Verbose logging. */
  verbose?: boolean;
}

export interface Watcher {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** What `runStart` needs from the outside world; replaceable in tests. */
export interface StartDeps {
  isPaired: () => Promise<boolean>;
  getDeviceToken: () => Promise<string | null>;
  /** Build the watchers for this run. */
  createWatchers: (state: DaemonState, runner: SyncRunner, config: Awaited<ReturnType<typeof loadConfig>>) => Watcher[];
  startMcpServer: (state: DaemonState) => Promise<McpServerHandle>;
  createRunner: (state: DaemonState) => SyncRunner;
  /** Resolves when the process is asked to stop (Ctrl+C / SIGTERM). */
  untilStopped: () => Promise<void>;
  loadConfig: typeof loadConfig;
  createState: (opts: { deviceToken: string; verbose: boolean }) => DaemonState;
}

export function defaultWatchers(
  state: DaemonState,
  runner: SyncRunner,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Watcher[] {
  const jsonl = (f: string): boolean => f.endsWith(".jsonl");
  return [
    new OpenCodeWatcher(state, runner, config.opencodeDbPath),
    new DirectoryWatcher("claude-code", claudeProjectsDirFromGlob(config.claudeProjectsGlob), state, runner, jsonl),
    new DirectoryWatcher("codex", config.codexSessionsDir, state, runner),
    new DirectoryWatcher("pi", config.piSessionsDir, state, runner, jsonl),
  ];
}

/** Resolves on the first SIGINT or SIGTERM. */
export function untilSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

const realDeps: StartDeps = {
  isPaired,
  getDeviceToken,
  createWatchers: defaultWatchers,
  startMcpServer,
  createRunner: (state) =>
    new SyncRunner({
      log: (msg) => state.log(msg),
      onSynced: (summary) => {
        if (summary.synced > 0 || summary.failed > 0) state.markSynced("daemon");
      },
    }),
  untilStopped: untilSignal,
  loadConfig,
  createState: (opts) => new DaemonState(opts),
};

/**
 * Run the daemon until it is asked to stop, then shut it down cleanly and
 * return the exit code. Does not call `process.exit`: the caller owns that.
 */
export async function runStart(
  term: Terminal,
  opts: StartOptions = {},
  deps: StartDeps = realDeps,
): Promise<number> {
  if (!(await deps.isPaired())) {
    printNotPaired(term);
    return EXIT_FAILURE;
  }

  const deviceToken = await deps.getDeviceToken();
  if (!deviceToken) {
    printTokenMissing(term);
    return EXIT_FAILURE;
  }

  const config = await deps.loadConfig();
  const state = deps.createState({ deviceToken, verbose: opts.verbose ?? false });
  const syncRunner = deps.createRunner(state);
  state.syncRunner = syncRunner;

  term.out("agentsofmine-collector starting…\n");

  const watchers = deps.createWatchers(state, syncRunner, config);
  for (const w of watchers) {
    await w.start();
    term.out(`  ${term.paint.green("✓")} ${w.name} watcher active`);
  }

  const mcp = await deps.startMcpServer(state);
  term.out(`  ${term.paint.green("✓")} MCP server listening (stdio)`);

  term.out("\nRunning initial sync…");
  await syncRunner.runNow();

  term.out("\nCollector is running. Watching for changes. Press Ctrl+C to stop.\n");

  await deps.untilStopped();

  term.out("\nShutting down…");
  syncRunner.stop();
  for (const w of watchers) await w.stop();
  mcp.stop();
  return EXIT_OK;
}
