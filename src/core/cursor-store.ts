import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BASE_DIR = join(homedir(), ".agentsofmine");
const CURSORS_FILE = join(BASE_DIR, "cursors.json");

function ensureDir(): void {
  mkdirSync(BASE_DIR, { recursive: true });
}

function load(): Record<string, string> {
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

function saveSync(data: Record<string, string>): void {
  ensureDir();
  const tmp = CURSORS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, CURSORS_FILE);
}

export const cursorStore = {
  get(adapterName: string): string | null {
    const data = load();
    return data[adapterName] ?? null;
  },

  set(adapterName: string, value: string): void {
    const data = load();
    data[adapterName] = value;
    saveSync(data);
  },
};

export type CursorStore = typeof cursorStore;
