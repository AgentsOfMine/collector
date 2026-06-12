import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import { readJsonlFrom } from "./jsonl-reader.js";
import { createAccumulator, processEvent, finalizeSession } from "./mapper.js";
import { truncateMessages } from "../../core/message-truncation.js";
import { debugLog } from "../../core/debug-log.js";

/**
 * Filesystem seam for discovering `.jsonl` session files. Injectable so file
 * discovery is testable without a real `~/.claude/projects` tree. Mirrors the
 * `GitRunner` DI pattern in `core/git-identity.ts`. The default reads the real
 * filesystem.
 */
export interface FsReader {
  existsSync(path: string): boolean;
  readdirSync(path: string): Dirent[];
}

const defaultFsReader: FsReader = {
  existsSync,
  readdirSync: (path) => readdirSync(path, { withFileTypes: true }),
};

interface ClaudeCodeCursor {
  [filePath: string]: number;
}

function parseCursor(raw: string | null): ClaudeCodeCursor {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed as ClaudeCodeCursor;
  } catch {
    // ignore
  }
  return {};
}

function findJsonlFiles(projectsDir: string, fs: FsReader): string[] {
  const files: string[] = [];
  if (!fs.existsSync(projectsDir)) return files;
  let projectDirs: string[];
  try {
    projectDirs = fs
      .readdirSync(projectsDir)
      .filter((d) => d.isDirectory())
      .map((d) => join(projectsDir, d.name));
  } catch {
    return files;
  }
  for (const dir of projectDirs) {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(dir, entry.name));
        }
      }
    } catch {
      // Unreadable directory (permissions, race) — skip; best-effort discovery.
    }
  }
  return files;
}

export class ClaudeCodeAdapter implements Adapter {
  readonly name = "claude-code";

  private readonly projectsDir: string;
  private readonly fs: FsReader;

  constructor(
    projectsGlob: string = join(homedir(), ".claude", "projects", "*", "*.jsonl"),
    fs: FsReader = defaultFsReader,
  ) {
    this.projectsDir = projectsGlob
      .replace(/[/\\]\*[/\\]\*\.jsonl$/, "")
      .replace(/[/\\]\*\.jsonl$/, "");
    this.fs = fs;
  }

  async *listNewSessions(cursor: Cursor): AsyncIterable<SyncItem> {
    const offsets = parseCursor(cursor.value);
    const files = findJsonlFiles(this.projectsDir, this.fs);

    for (const filePath of files) {
      if (!this.fs.existsSync(filePath)) continue;
      const fromOffset = offsets[filePath] ?? 0;
      const acc = createAccumulator(filePath);

      let lastOffset = fromOffset;
      try {
        for await (const { line, byteOffset } of readJsonlFrom(filePath, fromOffset)) {
          processEvent(acc, line);
          lastOffset = byteOffset;
        }
      } catch (err) {
        debugLog(`claude-code: failed reading ${filePath}`, err);
        continue;
      }

      if (acc.messageCount > 0 || acc.linesAdded > 0) {
        offsets[filePath] = lastOffset;
        const session = finalizeSession(acc);
        const messages = truncateMessages(acc.messages);
        yield { session: { ...session, messages }, cursor: JSON.stringify(offsets) };
      }
    }
  }
}

