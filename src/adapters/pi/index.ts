import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import { scanJsonl } from "./jsonl-reader.js";
import { createAccumulator, processEntry, finalizeSession } from "./mapper.js";
import { truncateMessages } from "../../core/message-truncation.js";

interface PiCursor {
  [filePath: string]: number;
}

function parseCursor(raw: string | null): PiCursor {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed as PiCursor;
  } catch {
    // ignore — malformed cursor, start fresh
  }
  return {};
}

function sizeOf(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return -1;
  }
}

function findJsonlFiles(rootDir: string): string[] {
  const files: string[] = [];
  if (!existsSync(rootDir)) return files;

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  };

  walk(rootDir);
  return files;
}

export class PiAdapter implements Adapter {
  readonly name = "pi";

  private readonly sessionsDir: string;

  constructor(sessionsDir: string = join(homedir(), ".pi", "agent", "sessions")) {
    this.sessionsDir = sessionsDir;
  }

  async *listNewSessions(cursor: Cursor): AsyncIterable<SyncItem> {
    const offsets = parseCursor(cursor.value);
    const files = findJsonlFiles(this.sessionsDir);

    for (const filePath of files) {
      if (!existsSync(filePath)) continue;
      const fromOffset = offsets[filePath] ?? 0;
      if (fromOffset > 0 && sizeOf(filePath) === fromOffset) continue; // nothing appended since last pass
      const acc = createAccumulator(filePath);

      let scan;
      try {
        scan = await scanJsonl(filePath, fromOffset, (line) => processEntry(acc, line), () => acc.messages.length);
      } catch {
        continue;
      }

      const newMessages = acc.messages.slice(scan.newMessagesFrom);
      if (newMessages.length === 0) continue;

      offsets[filePath] = scan.endOffset;
      const session = finalizeSession(acc);
      yield { session: { ...session, messages: truncateMessages(newMessages) }, cursor: JSON.stringify(offsets) };
    }
  }
}
