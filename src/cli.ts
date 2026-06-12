#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function getVersion(): string {
  try {
    const pkgPath = join(fileURLToPath(new URL(".", import.meta.url)), "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printUsage(): void {
  console.log(`
AgentsOfMine Collector CLI

Usage:
  aom --version        Print version and exit
  aom version          Print version and exit
  aom start            Start the MCP server
  aom pair [--reset]   Run the device pairing flow
  aom unpair [-y]      Remove the device token and clear local state
  aom status           Print last sync status as JSON
  aom sync             Trigger one sync cycle across all providers
`.trim());
}

const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand === "--version" || subcommand === "version") {
  const version = getVersion();
  console.log(`AgentsOfMine collector v${version}`);
  process.exit(0);
}

if (subcommand === "start") {
  // Import and run the MCP server inline — same as running `node dist/index.js`.
  // Dynamic import so index.ts stays the canonical MCP entry point.
  await import("./index.js");
  // index.js connects to MCP transport and runs forever — no exit here.

} else if (subcommand === "pair") {
  const { runPair } = await import("./cli/pair.js");
  await runPair({
    force: args.includes("--force") || args.includes("--reset"),
    noBrowser: args.includes("--no-browser"),
  });

} else if (subcommand === "unpair") {
  const { runUnpair } = await import("./cli/unpair.js");
  await runUnpair({ yes: args.includes("-y") || args.includes("--yes") });
  process.exit(0);

} else if (subcommand === "status") {
  const { getStatusPayload } = await import("./mcp-tools/status.js");
  const payload = getStatusPayload();
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);

} else if (subcommand === "sync") {
  const { runSyncCommand } = await import("./cli/sync.js");
  const verbose = args.includes("-v") || args.includes("--verbose");
  await runSyncCommand({ verbose });
  process.exit(0);

} else {
  printUsage();
  process.exit(1);
}
