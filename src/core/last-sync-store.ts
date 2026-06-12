import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".agentsofmine");
const LAST_SYNC_FILE = join(STATE_DIR, "last-sync.json");

export type LastSyncMap = Record<string, string>;

export function readLastSync(): LastSyncMap {
  try {
    const parsed: unknown = JSON.parse(readFileSync(LAST_SYNC_FILE, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as LastSyncMap;
    }
  } catch {
    // missing or unparseable — treat as empty
  }
  return {};
}

/**
 * Stamp `source` with the current time in last-sync.json. Read-merge-write so
 * concurrent writers (the daemon and a one-shot `aom sync`) don't clobber each
 * other's entries.
 */
export function recordLastSync(source: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const data = readLastSync();
  data[source] = new Date().toISOString();
  const tmp = LAST_SYNC_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, LAST_SYNC_FILE);
}
