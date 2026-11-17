/**
 * `aom status` — show sync state and last-synced timestamps.
 */

import { isPaired, getDeviceToken } from "../keychain/index.js";
import { existsSync, readFileSync } from "node:fs";
import { deviceIdFile } from "../core/paths.js";
import { readLastSync } from "../core/last-sync-store.js";
import { EXIT_OK, type Terminal } from "./terminal.js";
import { formatAgo } from "./ui.js";

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

export function readDeviceId(): string | null {
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

export function buildStatusFrom(
  paired: boolean,
  deps: Pick<StatusDeps, "readDeviceId" | "readLastSync">,
): StatusJson {
  return {
    paired,
    deviceId: deps.readDeviceId(),
    lastSyncAt: newestSyncTimestamp(deps.readLastSync()),
    // queueDepth and lastError are not yet tracked by the collector;
    // emitted as honest placeholders so the JSON contract is stable.
    queueDepth: 0,
    lastError: null,
  };
}

export async function buildStatus(): Promise<StatusJson> {
  return buildStatusFrom(await isPaired(), { readDeviceId, readLastSync });
}

export interface StatusDeps {
  isPaired: () => Promise<boolean>;
  getDeviceToken: () => Promise<string | null>;
  readDeviceId: () => string | null;
  readLastSync: () => Record<string, string>;
  now: () => number;
}

const realDeps: StatusDeps = { isPaired, getDeviceToken, readDeviceId, readLastSync, now: Date.now };

export async function runStatus(
  term: Terminal,
  options: StatusOptions = {},
  deps: StatusDeps = realDeps,
): Promise<number> {
  const paired = await deps.isPaired();

  if (options.json) {
    term.out(JSON.stringify(buildStatusFrom(paired, deps)));
    return EXIT_OK;
  }

  const { paint } = term;
  term.out("\nagentsofmine-collector status\n");
  term.out(`  Paired:        ${paired ? paint.green("✓ yes") : paint.red("✗ no")}`);

  if (!paired) {
    term.out(`\n  Run ${paint.cyan("aom pair")} to pair this machine.\n`);
    return EXIT_OK;
  }

  const deviceId = deps.readDeviceId();
  if (deviceId) term.out(`  Device ID:     ${paint.dim(deviceId)}`);

  // Token presence (never print the token itself)
  const token = await deps.getDeviceToken();
  term.out(`  Device token:  ${token ? paint.green("✓ present in keychain") : paint.red("✗ missing")}`);

  const syncState = deps.readLastSync();
  if (Object.keys(syncState).length > 0) {
    term.out("\n  Last synced:");
    for (const [watcher, ts] of Object.entries(syncState)) {
      term.out(`    ${watcher.padEnd(16)} ${formatAgo(new Date(ts), deps.now())}`);
    }
  } else {
    term.out("\n  No sessions synced yet.");
    term.out(`  Run ${paint.cyan("aom start")} to begin syncing.`);
  }

  term.out();
  return EXIT_OK;
}
