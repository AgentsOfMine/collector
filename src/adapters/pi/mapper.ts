import { basename, dirname } from "node:path";
import type { CanonicalSession, CanonicalMessage, CanonicalPart } from "../../core/canonical.js";
import { projectFields } from "../../core/project-identity.js";

interface PiTextContent {
  type: "text";
  text?: string;
}

interface PiThinkingContent {
  type: "thinking";
  thinking?: string;
}

interface PiToolCall {
  type: "toolCall";
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface PiImageContent {
  type: "image";
  data?: string;
  mimeType?: string;
}

type PiContent =
  | PiTextContent
  | PiThinkingContent
  | PiToolCall
  | PiImageContent
  | { type: string };

interface PiMessage {
  role?: string;
  content?: string | PiContent[];
  provider?: string;
  model?: string;
  toolCallId?: string;
  toolName?: string;
  details?: { patch?: string; diff?: string };
  isError?: boolean;
}

interface PiEntry {
  type?: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  message?: PiMessage;
}

interface DiffCounts {
  added: number;
  removed: number;
}

function countPatchLines(patch: string): DiffCounts {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

function normalizeContent(content: string | PiContent[] | undefined): PiContent[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content;
  return [];
}

function firstText(content: string | PiContent[] | undefined): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block.type === "text" && typeof (block as PiTextContent).text === "string") {
      return (block as PiTextContent).text ?? null;
    }
  }
  return null;
}

function contentToParts(content: PiContent[], toolNameById: Map<string, string>): CanonicalPart[] {
  const parts: CanonicalPart[] = [];
  for (const block of content) {
    switch (block.type) {
      case "text": {
        const b = block as PiTextContent;
        if (typeof b.text === "string" && b.text.length > 0) {
          parts.push({ type: "text", text: b.text });
        }
        break;
      }
      case "thinking": {
        const b = block as PiThinkingContent;
        if (typeof b.thinking === "string" && b.thinking.length > 0) {
          parts.push({ type: "reasoning", text: b.thinking });
        }
        break;
      }
      case "toolCall": {
        const b = block as PiToolCall;
        if (b.id && b.name) {
          toolNameById.set(b.id, b.name);
          parts.push({ type: "tool", tool: b.name, callId: b.id, input: b.arguments });
        }
        break;
      }
      case "image": {
        const b = block as PiImageContent;
        if (b.data) {
          parts.push({
            type: "image_url",
            mediaType: b.mimeType,
            imageUrl: `data:${b.mimeType ?? "image/png"};base64,${b.data.slice(0, 64)}…`,
          });
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
  pendingEdit: Map<string, string>;
  messages: CanonicalMessage[];
  toolNameById: Map<string, string>;
}

/**
 * Pi puts the session UUID in the filename (`<ts>_<uuid>.jsonl`, unambiguous)
 * and the cwd in the parent dir (`--<cwd>--` with `/`→`-`, LOSSY to reverse).
 * Deriving identity from the path keeps it stable when an incremental sync
 * resumes mid-file and never re-reads the in-band `session` header; the header
 * `id`/`cwd` override these structurally-derived values when observed.
 */
const PI_UUID_RE = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function sessionIdFromFilePath(filePath: string): string | null {
  const stem = basename(filePath, ".jsonl");
  const match = PI_UUID_RE.exec(stem);
  return match?.[1] ?? null;
}

export function cwdFromSessionDir(filePath: string): string | null {
  const dir = basename(dirname(filePath));
  if (!dir.startsWith("--") || !dir.endsWith("--") || dir.length <= 4) return null;
  const inner = dir.slice(2, -2);
  return "/" + inner.replace(/-/g, "/");
}

export function createAccumulator(filePath: string): SessionAccumulator {
  return {
    sessionId: sessionIdFromFilePath(filePath) ?? filePath,
    projectPath: cwdFromSessionDir(filePath) ?? filePath,
    title: null,
    modelLine: null,
    startedAt: null,
    endedAt: null,
    messageCount: 0,
    linesAdded: 0,
    linesRemoved: 0,
    filesChanged: new Set(),
    pendingEdit: new Map(),
    messages: [],
    toolNameById: new Map(),
  };
}

function recordEdit(acc: SessionAccumulator, call: PiToolCall): void {
  if (!call.id || !call.arguments) return;
  const path = typeof call.arguments["path"] === "string" ? call.arguments["path"] : null;
  if (!path) return;

  if (call.name === "write") {
    const fileContent = typeof call.arguments["content"] === "string" ? call.arguments["content"] : "";
    acc.linesAdded += fileContent.length > 0 ? fileContent.split("\n").length : 0;
    acc.filesChanged.add(path);
  } else if (call.name === "edit") {
    acc.pendingEdit.set(call.id, path);
  }
}

function applyEditResult(acc: SessionAccumulator, msg: PiMessage): void {
  const callId = msg.toolCallId;
  if (!callId) return;
  const path = acc.pendingEdit.get(callId);
  if (!path) return;
  acc.pendingEdit.delete(callId);
  if (msg.isError === true) return;

  const patch = typeof msg.details?.patch === "string" ? msg.details.patch : null;
  if (patch) {
    const { added, removed } = countPatchLines(patch);
    acc.linesAdded += added;
    acc.linesRemoved += removed;
  }
  acc.filesChanged.add(path);
}

export function processEntry(acc: SessionAccumulator, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const entry = raw as PiEntry;

  if (entry.type === "session") {
    if (typeof entry.id === "string") acc.sessionId = entry.id;
    if (typeof entry.cwd === "string") acc.projectPath = entry.cwd;
    if (typeof entry.timestamp === "string" && acc.startedAt === null) {
      acc.startedAt = entry.timestamp;
    }
    return;
  }
  if (entry.type !== "message" || !entry.message) return;

  const ts = entry.timestamp;
  if (typeof ts === "string") {
    if (acc.startedAt === null) acc.startedAt = ts;
    acc.endedAt = ts;
  }

  const msg = entry.message;

  if (typeof msg.model === "string" && acc.modelLine === null) {
    acc.modelLine = msg.provider ? `${msg.provider}/${msg.model}` : msg.model;
  }

  if (msg.role === "toolResult") {
    applyEditResult(acc, msg);
    const output = firstText(msg.content);
    // A toolResult is the outcome of an earlier toolCall, not a new tool
    // invocation. Render its message as text (e.g. "Successfully replaced 2
    // block(s) in …") rather than a second, input-less tool card that would
    // show as a bare "edit"/"read" row with no file path.
    if (output && output.trim().length > 0) {
      pushMessage(acc, entry, "assistant", "Pi", [
        { type: "text", text: output.slice(0, 500) },
      ]);
    }
    return;
  }

  if (msg.role !== "user" && msg.role !== "assistant") return;

  const content = normalizeContent(msg.content);
  for (const block of content) {
    if (block.type === "toolCall") recordEdit(acc, block as PiToolCall);
  }

  const parts = contentToParts(content, acc.toolNameById);
  if (parts.length === 0) return;

  if (msg.role === "user" && acc.title === null) {
    const text = firstText(msg.content);
    if (text) acc.title = text.trim().slice(0, 80);
  }

  pushMessage(acc, entry, msg.role, msg.role === "user" ? "You" : "Pi", parts);
}

function pushMessage(
  acc: SessionAccumulator,
  entry: PiEntry,
  role: "user" | "assistant",
  senderName: string,
  parts: CanonicalPart[],
): void {
  if (parts.length === 0) return;
  acc.messageCount++;
  const sessionId = acc.sessionId;
  const messageId = typeof entry.id === "string" ? entry.id : `${sessionId}-${acc.messageCount}`;
  const createdAt = typeof entry.timestamp === "string" ? entry.timestamp : new Date(0).toISOString();
  acc.messages.push({ messageId, sessionId, role, senderName, createdAt, parts });
}

export function finalizeSession(acc: SessionAccumulator): CanonicalSession {
  const filesChanged = acc.filesChanged.size > 0 ? Array.from(acc.filesChanged) : null;
  return {
    sessionId: acc.sessionId,
    provider: "pi",
    ...projectFields(acc.projectPath),
    agentName: "Pi",
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
