import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { safeJsonParse } from "../../core/safe-json.js";
import type { CanonicalMessage, CanonicalPart } from "../../core/canonical.js";

export interface CodexSession {
  sessionId: string;
  projectPath: string;
  startedAt: string;
  endedAt: string | null;
  title: string | null;
  commands: string[];
  messageCount: number;
  messages: CanonicalMessage[];
  rawData: unknown;
}

interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function findRolloutFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function commandFromExec(payload: Record<string, unknown>): string | null {
  const args = payload["arguments"];
  if (typeof args !== "string") return null;
  const parsed = safeJsonParse(args);
  if (parsed && typeof parsed === "object") {
    const cmd = (parsed as Record<string, unknown>)["cmd"];
    if (typeof cmd === "string") return cmd;
  }
  return null;
}

function messageText(payload: Record<string, unknown>): string {
  const content = payload["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const text = (part as Record<string, unknown>)["text"];
      if (typeof text === "string") out.push(text);
    }
  }
  return out.join("\n");
}

function messageFromPayload(
  payload: Record<string, unknown>,
  sessionId: string,
  index: number,
  createdAt: string,
): CanonicalMessage | null {
  const role = payload["role"];
  if (role !== "user" && role !== "assistant") return null;

  const text = messageText(payload);
  if (!text.trim()) return null;

  const part: CanonicalPart = { type: "text", text };
  return {
    messageId: `${sessionId}:${index}`,
    sessionId,
    role,
    senderName: role === "user" ? "You" : "Codex",
    createdAt,
    parts: [part],
  };
}

function isInjectedContext(text: string): boolean {
  const head = text.trimStart();
  return head.startsWith("#") || head.startsWith("<");
}

function deriveTitle(messages: CanonicalMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
    if (!text || isInjectedContext(text)) continue;

    const title = text.split(/\s+/).slice(0, 10).join(" ");
    return title.length > 80 ? title.slice(0, 80) : title;
  }
  return null;
}

function parseRollout(filePath: string): CodexSession | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  let sessionId = "";
  let projectPath = "/";
  let startedAt = "";
  let lastTimestamp: string | null = null;
  const commands: string[] = [];
  const rawMessages: { payload: Record<string, unknown>; timestamp: string }[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = safeJsonParse(line) as RolloutLine | null;
    if (!parsed || typeof parsed !== "object") continue;

    if (typeof parsed.timestamp === "string") {
      lastTimestamp = parsed.timestamp;
    }

    const payload = parsed.payload ?? {};

    switch (parsed.type) {
      case "session_meta": {
        if (typeof payload["id"] === "string") sessionId = payload["id"];
        if (typeof payload["timestamp"] === "string") startedAt = payload["timestamp"];
        else if (typeof parsed.timestamp === "string") startedAt = parsed.timestamp;
        if (typeof payload["cwd"] === "string") projectPath = payload["cwd"];
        break;
      }
      case "turn_context": {
        if (projectPath === "/" && typeof payload["cwd"] === "string") {
          projectPath = payload["cwd"];
        }
        break;
      }
      case "response_item": {
        if (payload["type"] === "function_call" && payload["name"] === "exec_command") {
          const cmd = commandFromExec(payload);
          if (cmd) commands.push(cmd);
        } else if (payload["type"] === "message") {
          rawMessages.push({ payload, timestamp: parsed.timestamp ?? lastTimestamp ?? "" });
        }
        break;
      }
      default:
        break;
    }
  }

  if (!sessionId) return null;
  if (!startedAt) startedAt = lastTimestamp ?? new Date(0).toISOString();

  const messages: CanonicalMessage[] = [];
  rawMessages.forEach((m, i) => {
    const msg = messageFromPayload(m.payload, sessionId, i, m.timestamp || startedAt);
    if (msg) messages.push(msg);
  });

  return {
    sessionId,
    projectPath,
    startedAt,
    endedAt: lastTimestamp,
    title: deriveTitle(messages),
    commands,
    messageCount: messages.length,
    messages,
    rawData: null,
  };
}

export function readCodexSessions(sessionsDir: string): CodexSession[] {
  if (!existsSync(sessionsDir)) return [];

  const sessions: CodexSession[] = [];
  for (const file of findRolloutFiles(sessionsDir)) {
    const session = parseRollout(file);
    if (session) sessions.push(session);
  }
  return sessions;
}
