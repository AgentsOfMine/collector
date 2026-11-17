import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { OffsetCursorAdapter, type SessionFileReader } from "../offset-cursor-adapter.js";
import { createAccumulator, processEvent, finalizeSession } from "./mapper.js";
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

export class ClaudeCodeAdapter extends OffsetCursorAdapter {
  readonly name = "claude-code";

  private readonly projectsDir: string;
  private readonly fs: FsReader;

  constructor(
    projectsGlob: string = claudeProjectsGlob(),
    fs: FsReader = defaultFsReader,
  ) {
    super();
    this.projectsDir = claudeProjectsDirFromGlob(projectsGlob);
    this.fs = fs;
  }

  protected findSessionFiles(): string[] {
    return findJsonlFiles(this.projectsDir, this.fs);
  }

  protected override fileExists(filePath: string): boolean {
    return this.fs.existsSync(filePath);
  }

  protected openReader(filePath: string): SessionFileReader {
    const acc = createAccumulator(filePath);
    return {
      apply: (line) => processEvent(acc, line),
      messageCount: () => acc.messages.length,
      messages: () => acc.messages,
      finalize: () => finalizeSession(acc),
    };
  }
}
