/**
 * `aom status` — show sync state and last-synced timestamps.
 */

import { isPaired, getDeviceToken } from "../keychain/index.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".agentsofmine");
const DEVICE_ID_FILE = join(STATE_DIR, "device-id");
const LAST_SYNC_FILE = join(STATE_DIR, "last-sync.json");

export async function runStatus(): Promise<void> {
  const paired = await isPaired();

  console.log("\nagentsofmine-collector status\n");
  console.log(`  Paired:        ${paired ? "\x1b[32m✓ yes\x1b[0m" : "\x1b[31m✗ no\x1b[0m"}`);

  if (!paired) {
    console.log("\n  Run \x1b[36maom pair\x1b[0m to pair this machine.\n");
    return;
  }

  // Device ID
  if (existsSync(DEVICE_ID_FILE)) {
    const deviceId = readFileSync(DEVICE_ID_FILE, "utf8").trim();
    console.log(`  Device ID:     \x1b[2m${deviceId}\x1b[0m`);
  }

  // Token presence (never print the token itself)
  const token = await getDeviceToken();
  console.log(`  Device token:  ${token ? "\x1b[32m✓ present in keychain\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}`);

  // Last sync timestamps per watcher
  if (existsSync(LAST_SYNC_FILE)) {
    const raw = readFileSync(LAST_SYNC_FILE, "utf8");
    const syncState = JSON.parse(raw) as Record<string, string>;
    console.log("\n  Last synced:");
    for (const [watcher, ts] of Object.entries(syncState)) {
      const ago = formatAgo(new Date(ts));
      console.log(`    ${watcher.padEnd(16)} ${ago}`);
    }
  } else {
    console.log("\n  No sessions synced yet.");
    console.log("  Run \x1b[36maom start\x1b[0m to begin syncing.");
  }

  console.log();
}

function formatAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
