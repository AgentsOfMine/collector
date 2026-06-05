import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Adapter, Cursor } from "../adapter.js";
import type { SessionWithMessages } from "../../core/canonical.js";
import { readJsonlFrom } from "./jsonl-reader.js";
import { createAccumulator, processEvent, finalizeSession } from "./mapper.js";

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

function findJsonlFiles(projectsDir: string): string[] {
  const files: string[] = [];
  if (!existsSync(projectsDir)) return files;
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(projectsDir, d.name));
  } catch {
    return files;
  }
  for (const dir of projectDirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(dir, entry.name));
        }
      }
    } catch {
    }
  }
  return files;
}

export class ClaudeCodeAdapter implements Adapter {
  readonly name = "claude-code";

  private readonly projectsDir: string;

  constructor(
    projectsGlob: string = join(homedir(), ".claude", "projects", "*", "*.jsonl"),
  ) {
    this.projectsDir = join(homedir(), ".claude", "projects");
    void projectsGlob;
  }

  async *listNewSessions(cursor: Cursor): AsyncIterable<SessionWithMessages> {
    const offsets = parseCursor(cursor.value);
    const files = findJsonlFiles(this.projectsDir);

    for (const filePath of files) {
      if (!existsSync(filePath)) continue;
      const fromOffset = offsets[filePath] ?? 0;
      const acc = createAccumulator(filePath);

      let lastOffset = fromOffset;
      try {
        for await (const { line, byteOffset } of readJsonlFrom(filePath, fromOffset)) {
          processEvent(acc, line);
          lastOffset = byteOffset;
        }
      } catch {
        continue;
      }

      if (acc.messageCount > 0 || acc.linesAdded > 0) {
        offsets[filePath] = lastOffset;
        const session = finalizeSession(acc);
        const allMessages = acc.messages;
        const messages = allMessages.length <= 150
          ? allMessages
          : [allMessages[0], ...allMessages.slice(-149)];
        yield { ...session, messages };
      }
    }
  }
}

