import { basename, dirname } from "node:path";
import type { CanonicalMessage } from "../../core/canonical.js";
import {
  contentBlocksToParts,
  extractText,
  type ContentBlock,
  type ContentBlockToolUse,
  type ContentBlockToolResult,
} from "./content-blocks.js";

interface MessagePayload {
  role?: string;
  content?: string | ContentBlock[];
  model?: string;
  id?: string;
}

interface JsonlEvent {
  type?: string;
  uuid?: string;
  timestamp?: string;
  message?: MessagePayload;
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
  pendingToolUse: Map<string, { linesAdded: number; linesRemoved: number; filePath: string }>;
  messages: CanonicalMessage[];
  toolNameById: Map<string, string>;
}

export function createAccumulator(filePath: string): SessionAccumulator {
  const sessionId = basename(filePath, ".jsonl");
  const projectPath = dirname(dirname(filePath));
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
    messages: [],
    toolNameById: new Map(),
  };
}

export function processEvent(acc: SessionAccumulator, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const event = raw as JsonlEvent;

  const ts = (raw as Record<string, unknown>)["timestamp"];
  if (typeof ts === "string") {
    if (acc.startedAt === null) acc.startedAt = ts;
    acc.endedAt = ts;
  }

  const msg = event.message;
  if (!msg) return;

  if (typeof msg.model === "string" && acc.modelLine === null) {
    acc.modelLine = msg.model;
  }

  const role = msg.role;
  if (role !== "user" && role !== "assistant") return;

  const rawContent = msg.content;
  const blocks: ContentBlock[] =
    typeof rawContent === "string"
      ? [{ type: "text", text: rawContent }]
      : Array.isArray(rawContent)
        ? (rawContent)
        : [];

  for (const block of blocks) {
    if (block.type === "tool_use") {
      const b = block as ContentBlockToolUse;
      if (!b.id || !b.input) continue;
      if (b.name === "Edit" || b.name === "str_replace_editor") {
        const filePath = typeof b.input["file_path"] === "string" ? b.input["file_path"] : null;
        const newString = typeof b.input["new_string"] === "string" ? b.input["new_string"] : "";
        const oldString = typeof b.input["old_string"] === "string" ? b.input["old_string"] : "";
        if (filePath) {
          acc.pendingToolUse.set(b.id, {
            linesAdded: newString.split("\n").length,
            linesRemoved: oldString.split("\n").length,
            filePath,
          });
        }
      } else if (b.name === "Write" || b.name === "write_file") {
        const filePath = typeof b.input["file_path"] === "string" ? b.input["file_path"] : null;
        const content = typeof b.input["content"] === "string" ? b.input["content"] : "";
        if (filePath) {
          acc.pendingToolUse.set(b.id, {
            linesAdded: content.split("\n").length,
            linesRemoved: 0,
            filePath,
          });
        }
      }
    }

    if (block.type === "tool_result") {
      const b = block as ContentBlockToolResult;
      if (!b.tool_use_id) continue;
      const pending = acc.pendingToolUse.get(b.tool_use_id);
      if (!pending) continue;
      acc.pendingToolUse.delete(b.tool_use_id);
      if (b.is_error === true) continue;
      acc.linesAdded += pending.linesAdded;
      acc.linesRemoved += pending.linesRemoved;
      acc.filesChanged.add(pending.filePath);
    }
  }

  const parts = contentBlocksToParts(blocks, acc.toolNameById);
  if (parts.length === 0) return;

  acc.messageCount++;

  if (role === "user" && acc.title === null) {
    const text = extractText(rawContent);
    if (text) acc.title = text.trim().slice(0, 80);
  }

  const messageId = typeof event.uuid === "string" ? event.uuid : `${acc.sessionId}-${acc.messageCount}`;
  const createdAt = typeof ts === "string" ? ts : new Date(0).toISOString();

  acc.messages.push({
    messageId,
    sessionId: acc.sessionId,
    role: role === "user" ? "user" : "assistant",
    senderName: role === "user" ? "You" : "Claude Code",
    createdAt,
    parts,
  });
}
