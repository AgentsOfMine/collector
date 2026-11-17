import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { stateDir, lastSyncFile } from "./paths.js";

export type LastSyncMap = Record<string, string>;

export function readLastSync(): LastSyncMap {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lastSyncFile(), "utf8"));
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
  mkdirSync(stateDir(), { recursive: true });
  const data = readLastSync();
  data[source] = new Date().toISOString();
  const file = lastSyncFile();
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}
