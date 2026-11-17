/**
 * `aom status` — show sync state and last-synced timestamps.
 */

import { isPaired, getDeviceToken } from "../keychain/index.js";
import { existsSync, readFileSync } from "node:fs";
import { deviceIdFile } from "../core/paths.js";
import { readLastSync } from "../core/last-sync-store.js";

export interface StatusJson {
  paired: boolean;
  deviceId: string | null;
  lastSyncAt: string | null;
  queueDepth: number;
  lastError: { kind: string; message: string } | null;
}

export interface StatusOptions {
  json?: boolean;
}

function readDeviceId(): string | null {
  const file = deviceIdFile();
  if (!existsSync(file)) {
    return null;
  }
  return readFileSync(file, "utf8").trim() || null;
}

function newestSyncTimestamp(map: Record<string, string>): string | null {
  const times = Object.values(map).filter((v) => typeof v === "string");
  if (times.length === 0) {
    return null;
  }
  return times.reduce((newest, ts) =>
    new Date(ts).getTime() > new Date(newest).getTime() ? ts : newest,
  );
}

export async function buildStatus(): Promise<StatusJson> {
  const paired = await isPaired();
  const syncMap = readLastSync();
  return {
    paired,
    deviceId: readDeviceId(),
    lastSyncAt: newestSyncTimestamp(syncMap),
    // queueDepth and lastError are not yet tracked by the collector;
    // emitted as honest placeholders so the JSON contract is stable.
    queueDepth: 0,
    lastError: null,
  };
}

export async function runStatus(options: StatusOptions = {}): Promise<void> {
  if (options.json) {
    const status = await buildStatus();
    console.log(JSON.stringify(status));
    return;
  }

  const paired = await isPaired();

  console.log("\nagentsofmine-collector status\n");
  console.log(`  Paired:        ${paired ? "\x1b[32m✓ yes\x1b[0m" : "\x1b[31m✗ no\x1b[0m"}`);

  if (!paired) {
    console.log("\n  Run \x1b[36maom pair\x1b[0m to pair this machine.\n");
    return;
  }

  // Device ID
  const deviceId = readDeviceId();
  if (deviceId) {
    console.log(`  Device ID:     \x1b[2m${deviceId}\x1b[0m`);
  }

  // Token presence (never print the token itself)
  const token = await getDeviceToken();
  console.log(`  Device token:  ${token ? "\x1b[32m✓ present in keychain\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}`);

  // Last sync timestamps per watcher
  const syncState = readLastSync();
  if (Object.keys(syncState).length > 0) {
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
