import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BASE_DIR = join(homedir(), ".agentsofmine");
const CURSORS_FILE = join(BASE_DIR, "cursors.json");

function ensureDir(): void {
  mkdirSync(BASE_DIR, { recursive: true });
}

function loadFromDisk(): Record<string, string> {
  try {
    const raw = readFileSync(CURSORS_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // file missing or unparseable — start fresh
  }
  return {};
}

function saveToDisk(data: Record<string, string>): void {
  ensureDir();
  const tmp = CURSORS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, CURSORS_FILE);
}

// ---------------------------------------------------------------------------
// In-memory cache — populated lazily on first get(), flushed on every set().
// This avoids N disk reads per sync cycle when multiple adapters call get().
// ---------------------------------------------------------------------------

let cache: Record<string, string> | null = null;

function getCache(): Record<string, string> {
  if (cache === null) {
    cache = loadFromDisk();
  }
  return cache;
}

export const cursorStore = {
  get(adapterName: string): string | null {
    return getCache()[adapterName] ?? null;
  },

  set(adapterName: string, value: string): void {
    const data = getCache();
    data[adapterName] = value;
    saveToDisk(data);
    // cache is already mutated in-place — no need to reset
  },

  /**
   * Explicit write-through flush.
   * Useful if the caller mutates the cache externally or wants to force a disk write.
   */
  flush(): void {
    if (cache !== null) {
      saveToDisk(cache);
    }
  },
};

export type CursorStore = typeof cursorStore;
