import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import { scanJsonl } from "./jsonl-reader.js";
import { createAccumulator, processEvent, finalizeSession } from "./mapper.js";
import { truncateMessages } from "../../core/message-truncation.js";
import { debugLog } from "../../core/debug-log.js";
import { claudeProjectsGlob, claudeProjectsDirFromGlob } from "../../core/paths.js";

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

function sizeOf(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return -1;
  }
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
    projectsGlob: string = claudeProjectsGlob(),
    fs: FsReader = defaultFsReader,
  ) {
    this.projectsDir = claudeProjectsDirFromGlob(projectsGlob);
    this.fs = fs;
  }

  async *listNewSessions(cursor: Cursor): AsyncIterable<SyncItem> {
    const offsets = parseCursor(cursor.value);
    const files = findJsonlFiles(this.projectsDir, this.fs);

    for (const filePath of files) {
      if (!this.fs.existsSync(filePath)) continue;
      const fromOffset = offsets[filePath] ?? 0;
      if (fromOffset > 0 && sizeOf(filePath) === fromOffset) continue; // nothing appended since last pass
      const acc = createAccumulator(filePath);

      let scan;
      try {
        scan = await scanJsonl(filePath, fromOffset, (line) => processEvent(acc, line), () => acc.messages.length);
      } catch (err) {
        debugLog(`claude-code: failed reading ${filePath}`, err);
        continue;
      }

      // The accumulator saw the whole file, so the session fields are the
      // session's real ones; only messages from the unsynced tail are sent.
      const newMessages = acc.messages.slice(scan.newMessagesFrom);
      if (newMessages.length === 0) continue;

      offsets[filePath] = scan.endOffset;
      const session = finalizeSession(acc);
      yield { session: { ...session, messages: truncateMessages(newMessages) }, cursor: JSON.stringify(offsets) };
    }
  }
}

