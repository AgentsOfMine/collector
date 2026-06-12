import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import { readJsonlFrom } from "./jsonl-reader.js";
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
      const acc = createAccumulator(filePath);

      let lastOffset = fromOffset;
      try {
        for await (const { line, byteOffset } of readJsonlFrom(filePath, fromOffset)) {
          processEntry(acc, line);
          lastOffset = byteOffset;
        }
      } catch {
        continue;
      }

      if (acc.messageCount > 0) {
        offsets[filePath] = lastOffset;
        const session = finalizeSession(acc);
        const messages = truncateMessages(acc.messages);
        yield { session: { ...session, messages }, cursor: JSON.stringify(offsets) };
      }
    }
  }
}
