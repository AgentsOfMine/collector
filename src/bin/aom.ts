#!/usr/bin/env node
/**
 * `aom` — AgentsOfMine Collector CLI
 *
 * Commands:
 *   aom pair      — one-time device pairing (prints QR, polls, stores token)
 *   aom start     — start the collector daemon (watchers + MCP server)
 *   aom status    — show sync state and pairing status
 *   aom unpair    — remove device token and clear local state
 */

import { Command } from "commander";
import { createRequire } from "node:module";
import { runPair } from "../cli/pair.js";
import { runStart } from "../cli/start.js";
import { runStatus } from "../cli/status.js";
import { runUnpair } from "../cli/unpair.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

const program = new Command();

program
  .name("aom")
  .description(pkg.description)
  .version(pkg.version, "-V, --version");

program
  .command("pair")
  .description("Pair this machine with your AgentsOfMine account (one-time setup)")
  .option("--no-browser", "Skip auto-opening the approval URL in the browser")
  .option("--force", "Re-pair even if this machine is already paired")
  .option("--api-base-url <url>", "Override API base URL (for development)")
  .action(async (opts: { browser: boolean; force: boolean; apiBaseUrl?: string }) => {
    await runPair({
      noBrowser: !opts.browser,
      force: opts.force,
      ...(opts.apiBaseUrl !== undefined ? { apiBaseUrl: opts.apiBaseUrl } : {}),
    });
  });

program
  .command("start")
  .description("Start the collector daemon (file watchers + MCP server)")
  .option("-v, --verbose", "Enable verbose logging")
  .option("--mcp-port <port>", "MCP server port (default: stdio)", parseInt)
  .action(async (opts: { verbose: boolean; mcpPort?: number }) => {
    await runStart({
      verbose: opts.verbose,
      ...(opts.mcpPort !== undefined ? { mcpPort: opts.mcpPort } : {}),
    });
  });

program
  .command("status")
  .description("Show pairing status and last-synced timestamps")
  .action(async () => {
    await runStatus();
  });

program
  .command("unpair")
  .description("Remove device token and clear local collector state")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts: { yes: boolean }) => {
    await runUnpair({ yes: opts.yes });
  });

await program.parseAsync(process.argv);
