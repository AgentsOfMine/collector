import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import type { CanonicalSession } from "../../core/canonical.js";

// Minimal shape of events we care about
interface BaseEvent {
  type?: string;
  role?: string;
  model?: string;
}

interface ToolUseEvent extends BaseEvent {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  tool_use_id?: string;
  is_error?: boolean;
}

interface ContentBlock {
  type?: string;
  text?: string;
}

interface MessageEvent extends BaseEvent {
  role: "human" | "assistant";
  content?: string | ContentBlock[];
}

function projectId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

function extractText(content: string | ContentBlock[] | undefined): string | null {
  if (content === undefined) return null;
  if (typeof content === "string") return content;
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }
  return null;
}

export interface SessionAccumulator {
  sessionId: string;
  projectPath: string;
  title: string | null;
  modelLine: string | null;
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: Set<string>;
  // Maps tool_use_id → { linesAdded, linesRemoved, filePath } — pending until result arrives
  pendingToolUse: Map<string, { linesAdded: number; linesRemoved: number; filePath: string }>;
}

export function createAccumulator(filePath: string): SessionAccumulator {
  // Derive session ID from file name (strip .jsonl)
  const sessionId = basename(filePath, ".jsonl");
  const projectPath = dirname(dirname(filePath)); // ~/.claude/projects/<project>/session.jsonl → ~/.claude/projects/<project>
  return {
    sessionId,
    projectPath,
    title: null,
    modelLine: null,
    startedAt: null,
    endedAt: null,
    messageCount: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesChanged: new Set(),
    pendingToolUse: new Map(),
  };
}

export function processEvent(acc: SessionAccumulator, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const event = raw as BaseEvent;

  // Capture timestamps from any timestamp field
  const ts = (raw as Record<string, unknown>)["timestamp"];
  if (typeof ts === "string") {
    if (acc.startedAt === null) acc.startedAt = ts;
    acc.endedAt = ts;
  }

  // Capture model
  if (typeof event.model === "string" && acc.modelLine === null) {
    acc.modelLine = event.model;
  }

  if (event.type === "tool_use") {
    const tu = event as ToolUseEvent;
    if (!tu.id || !tu.input) return;

    if (tu.name === "Edit" || tu.name === "str_replace_editor") {
      const input = tu.input;
      const filePath = typeof input["file_path"] === "string" ? input["file_path"] : null;
      const newString = typeof input["new_string"] === "string" ? input["new_string"] : "";
      const oldString = typeof input["old_string"] === "string" ? input["old_string"] : "";
      if (filePath) {
        acc.pendingToolUse.set(tu.id, {
          linesAdded: newString.split("\n").length,
          linesRemoved: oldString.split("\n").length,
          filePath,
        });
      }
    } else if (tu.name === "Write" || tu.name === "write_file") {
      const input = tu.input;
      const filePath = typeof input["file_path"] === "string" ? input["file_path"] : null;
      const content = typeof input["content"] === "string" ? input["content"] : "";
      if (filePath) {
        acc.pendingToolUse.set(tu.id, {
          linesAdded: content.split("\n").length,
          linesRemoved: 0,
          filePath,
        });
      }
    }
    return;
  }

  if (event.type === "tool_result") {
    const tr = event as ToolResultEvent;
    if (!tr.tool_use_id) return;
    const pending = acc.pendingToolUse.get(tr.tool_use_id);
    if (!pending) return;
    acc.pendingToolUse.delete(tr.tool_use_id);

    // Only count if successful (is_error is false or absent)
    if (tr.is_error === true) return;

    acc.linesAdded += pending.linesAdded;
    acc.linesRemoved += pending.linesRemoved;
    acc.filesChanged.add(pending.filePath);
    return;
  }

  // Human/assistant messages
  if (event.role === "human" || event.role === "assistant") {
    acc.messageCount++;
    const msg = event as MessageEvent;
    if (event.role === "human" && acc.title === null) {
      const text = extractText(msg.content);
      if (text) {
        acc.title = text.trim().slice(0, 80);
      }
    }
  }
}

export function finalizeSession(acc: SessionAccumulator): CanonicalSession {
  const filesChanged = acc.filesChanged.size > 0 ? Array.from(acc.filesChanged) : null;
  return {
    sessionId: acc.sessionId,
    provider: "claude-code",
    projectId: projectId(acc.projectPath),
    projectPath: acc.projectPath,
    agentName: "Claude Code",
    title: acc.title,
    modelLine: acc.modelLine,
    startedAt: acc.startedAt ?? new Date(0).toISOString(),
    endedAt: acc.endedAt,
    messageCount: acc.messageCount > 0 ? acc.messageCount : null,
    fileCount: acc.filesChanged.size > 0 ? acc.filesChanged.size : null,
    linesAdded: acc.linesAdded > 0 ? acc.linesAdded : null,
    linesRemoved: acc.linesRemoved > 0 ? acc.linesRemoved : null,
    filesChanged,
    filesChangedApproximate: false,
    extensions: {},
  };
}
