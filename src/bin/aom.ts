#!/usr/bin/env node
/**
 * `aom` — AgentsOfMine Collector CLI
 *
 * Commands:
 *   aom pair      — one-time device pairing (prints QR, polls, stores token)
 *   aom start     — start the collector daemon (watchers + MCP server)
 *   aom sync      — sync new sessions to the cloud now (one-shot)
 *   aom status    — show sync state and pairing status
 *   aom unpair    — remove device token and clear local state
 */

import { Command } from "commander";
import { createRequire } from "node:module";
import { runPair } from "../cli/pair.js";
import { runStart } from "../cli/start.js";
import { runSyncCommand } from "../cli/sync.js";
import { runStatus } from "../cli/status.js";
import { runUnpair } from "../cli/unpair.js";
import { consoleTerminal } from "../cli/terminal.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

const program = new Command();
const term = consoleTerminal();

/**
 * Run a command and turn its exit code into the process's exit status. This is
 * the only place in the CLI that sets `process.exitCode`; commands just return
 * a number. Setting the code (instead of calling `process.exit`) lets pending
 * output flush and the process end on its own.
 */
function exitWith(command: Promise<number>): Promise<void> {
  return command.then((code) => {
    process.exitCode = code;
  });
}

program
  .name("aom")
  .description(pkg.description)
  .version(pkg.version, "-V, --version");

program
  .command("pair")
  .description("Pair this machine with your AgentsOfMine account (one-time setup)")
  .option("--no-browser", "Skip auto-opening the approval URL in the browser")
  .option("--force", "Re-pair even if this machine is already paired")
  .option("--reset", "Alias for --force: discard the existing pairing and start fresh")
  .option("--api-base-url <url>", "Override API base URL (for development)")
  .action(async (opts: { browser: boolean; force: boolean; reset: boolean; apiBaseUrl?: string }) => {
    await exitWith(
      runPair(term, {
        noBrowser: !opts.browser,
        force: opts.force || opts.reset,
        ...(opts.apiBaseUrl !== undefined ? { apiBaseUrl: opts.apiBaseUrl } : {}),
      }),
    );
  });

program
  .command("start")
  .description("Start the collector daemon (watches your agents' session files and syncs changes)")
  .option("-v, --verbose", "Enable verbose logging")
  .option("--mcp-port <port>", "MCP server port (default: stdio)", parseInt)
  .action(async (opts: { verbose: boolean; mcpPort?: number }) => {
    await exitWith(
      runStart(term, {
        verbose: opts.verbose,
        ...(opts.mcpPort !== undefined ? { mcpPort: opts.mcpPort } : {}),
      }),
    );
  });

program
  .command("sync")
  .description("Sync new sessions to the cloud now (one-shot)")
  .option("-v, --verbose", "Print per-error detail")
  .action(async (opts: { verbose: boolean }) => {
    await exitWith(runSyncCommand(term, { verbose: opts.verbose }));
  });

program
  .command("status")
  .description("Show pairing status and last-synced timestamps")
  .option("--json", "Print machine-readable status as a single JSON object")
  .action(async (opts: { json?: boolean }) => {
    await exitWith(runStatus(term, { json: opts.json }));
  });

program
  .command("unpair")
  .description("Remove device token and clear local collector state")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts: { yes: boolean }) => {
    await exitWith(runUnpair(term, { yes: opts.yes }));
  });

await program.parseAsync(process.argv);
