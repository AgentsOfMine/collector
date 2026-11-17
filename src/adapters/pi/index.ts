import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { piSessionsDir } from "../../core/paths.js";
import { OffsetCursorAdapter, type SessionFileReader } from "../offset-cursor-adapter.js";
import { createAccumulator, processEntry, finalizeSession } from "./mapper.js";

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

export class PiAdapter extends OffsetCursorAdapter {
  readonly name = "pi";

  private readonly sessionsDir: string;

  constructor(sessionsDir: string = piSessionsDir()) {
    super();
    this.sessionsDir = sessionsDir;
  }

  protected findSessionFiles(): string[] {
    return findJsonlFiles(this.sessionsDir);
  }

  protected openReader(filePath: string): SessionFileReader {
    const acc = createAccumulator(filePath);
    return {
      apply: (line) => processEntry(acc, line),
      messageCount: () => acc.messages.length,
      messages: () => acc.messages,
      finalize: () => finalizeSession(acc),
    };
  }
}
