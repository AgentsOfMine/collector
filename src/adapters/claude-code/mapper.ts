import { basename, dirname } from "node:path";
import type { CanonicalSession, CanonicalMessage, CanonicalPart } from "../../core/canonical.js";
import { projectFields } from "../../core/project-identity.js";

interface ContentBlockText {
  type: "text";
  text?: string;
}

interface ContentBlockThinking {
  type: "thinking";
  thinking?: string;
}

interface ContentBlockToolUse {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ContentBlockToolResult {
  type: "tool_result";
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

interface ContentBlockImage {
  type: "image";
  source?: {
    type?: string;
    media_type?: string;
    data?: string;
    url?: string;
  };
}

type ContentBlock =
  | ContentBlockText
  | ContentBlockThinking
  | ContentBlockToolUse
  | ContentBlockToolResult
  | ContentBlockImage
  | { type: string };

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

function extractText(content: string | ContentBlock[] | undefined): string | null {
  if (content === undefined) return null;
  if (typeof content === "string") return content;
  for (const block of content) {
    if (block.type === "text") {
      const b = block as ContentBlockText;
      if (typeof b.text === "string") return b.text;
    }
  }
  return null;
}

function toolResultOutput(block: ContentBlockToolResult): string | undefined {
  const { content } = block;
  if (typeof content === "string") return content.slice(0, 500);
  if (Array.isArray(content)) {
    const texts = content
      .filter((c): c is { type: string; text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    return texts.slice(0, 500) || undefined;
  }
  return undefined;
}

function contentBlocksToParts(
  blocks: ContentBlock[],
  toolNameById: Map<string, string>,
): CanonicalPart[] {
  const parts: CanonicalPart[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        const b = block as ContentBlockText;
        if (typeof b.text === "string" && b.text.length > 0) {
          parts.push({ type: "text", text: b.text });
        }
        break;
      }
      case "thinking": {
        const b = block as ContentBlockThinking;
        if (typeof b.thinking === "string" && b.thinking.length > 0) {
          parts.push({ type: "reasoning", text: b.thinking });
        }
        break;
      }
      case "tool_use": {
        const b = block as ContentBlockToolUse;
        if (b.id && b.name) {
          toolNameById.set(b.id, b.name);
          parts.push({
            type: "tool",
            tool: b.name,
            callId: b.id,
            input: b.input,
          });
        }
        break;
      }
      case "tool_result": {
        const b = block as ContentBlockToolResult;
        if (b.tool_use_id) {
          const name = toolNameById.get(b.tool_use_id) ?? "unknown";
          parts.push({
            type: "tool",
            tool: name,
            callId: b.tool_use_id,
            output: toolResultOutput(b),
          });
        }
        break;
      }
      case "image": {
        const b = block as ContentBlockImage;
        const src = b.source;
        if (src) {
          if (src.type === "base64" && src.data) {
            parts.push({
              type: "image_url",
              mediaType: src.media_type,
              imageUrl: `data:${src.media_type ?? "image/png"};base64,${src.data.slice(0, 64)}…`,
            });
          } else if (src.url) {
            parts.push({ type: "image_url", imageUrl: src.url, mediaType: src.media_type });
          }
        }
        break;
      }
    }
  }
  return parts;
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

export function finalizeSession(acc: SessionAccumulator): CanonicalSession {
  const filesChanged = acc.filesChanged.size > 0 ? Array.from(acc.filesChanged) : null;
  return {
    sessionId: acc.sessionId,
    provider: "claude-code",
    ...projectFields(acc.projectPath),
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
