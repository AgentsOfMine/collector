import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface CodexSession {
  sessionId: string;
  projectPath: string;
  startedAt: string;
  endedAt: string | null;
  commands: string[];
  rawData: unknown;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractCommands(data: unknown): string[] {
  if (typeof data !== "object" || data === null) return [];
  // Try known shapes — codex may store commands in different fields
  const obj = data as Record<string, unknown>;

  const commands: string[] = [];

  // Shape 1: { exec_commands: string[] }
  if (Array.isArray(obj["exec_commands"])) {
    for (const c of obj["exec_commands"]) {
      if (typeof c === "string") commands.push(c);
    }
  }

  // Shape 2: array of events with { type: "exec", command: string }
  if (Array.isArray(obj["events"])) {
    for (const ev of obj["events"] as unknown[]) {
      if (typeof ev === "object" && ev !== null) {
        const event = ev as Record<string, unknown>;
        if (event["type"] === "exec" && typeof event["command"] === "string") {
          commands.push(event["command"] as string);
        }
      }
    }
  }

  return commands;
}

export function readCodexSessions(sessionsDir: string): CodexSession[] {
  if (!existsSync(sessionsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return [];
  }

  const sessions: CodexSession[] = [];

  for (const entry of entries) {
    const filePath = join(sessionsDir, entry);
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const data = tryParseJson(content);
    if (!data) continue;

    const obj = data as Record<string, unknown>;
    const sessionId = entry.replace(/\.json$/, "");
    const startedAt =
      typeof obj["created_at"] === "string"
        ? obj["created_at"]
        : typeof obj["started_at"] === "string"
          ? obj["started_at"]
          : new Date(0).toISOString();

    const endedAt =
      typeof obj["ended_at"] === "string"
        ? obj["ended_at"]
        : typeof obj["updated_at"] === "string"
          ? obj["updated_at"]
          : null;

    const projectPath =
      typeof obj["project_path"] === "string"
        ? obj["project_path"]
        : typeof obj["cwd"] === "string"
          ? obj["cwd"]
          : "/";

    sessions.push({
      sessionId,
      projectPath,
      startedAt,
      endedAt,
      commands: extractCommands(data),
      rawData: data,
    });
  }

  return sessions;
}
