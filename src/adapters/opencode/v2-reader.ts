import type Database from "better-sqlite3";
import type { CanonicalMessage, CanonicalPart } from "../../core/canonical.js";
import type { OpenCodeRow } from "./sqlite-reader.js";

/** OpenCode 2.x tables: `session_v2` and `session_message` (content in JSON `data`). */

interface RawV2MessageRow {
  id: string;
  type: string;
  seq: number;
  time_created: number;
  data: string;
}

export interface V2Message {
  message: CanonicalMessage;
  seq: number;
  /** `session_message.time_created` in ms — the incremental-sync watermark clock. */
  rowCreatedMs: number;
  /** Assistant messages are filled in while streaming; `finish` is set at the end. */
  finished: boolean;
}

export function queryMessagesV2Detailed(db: Database.Database, sessionId: string): V2Message[] {
  const rows = db
    .prepare<[string], RawV2MessageRow>(
      `SELECT id, type, seq, time_created, data
       FROM session_message
       WHERE session_id = ? AND type IN ('user', 'assistant')
       ORDER BY seq ASC`,
    )
    .all(sessionId);

  const out: V2Message[] = [];
  for (const row of rows) {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const parts: CanonicalPart[] = [];
    if (row.type === "user") {
      const text = d["text"];
      if (typeof text === "string" && text !== "") parts.push({ type: "text", text });
    } else {
      const content = d["content"];
      if (Array.isArray(content)) {
        for (const block of content) {
          const part = parseV2Block(block);
          if (part) parts.push(part);
        }
      }
    }

    const created = (d["time"] as { created?: unknown } | undefined)?.created;
    const createdMs = typeof created === "number" ? created : row.time_created;
    out.push({
      message: {
        messageId: row.id,
        sessionId,
        role: row.type === "user" ? "user" : "assistant",
        senderName: row.type === "user" ? "You" : "OpenCode",
        createdAt: new Date(createdMs).toISOString(),
        parts,
      },
      seq: row.seq,
      rowCreatedMs: row.time_created,
      finished: row.type === "user" || (d["finish"] !== undefined && d["finish"] !== null),
    });
  }
  return out;
}

export function queryMessagesV2(db: Database.Database, sessionId: string): CanonicalMessage[] {
  return queryMessagesV2Detailed(db, sessionId)
    .map((m) => m.message)
    .filter((m) => m.parts.length > 0);
}

/**
 * Top-level v2 sessions that are new or have messages newer than `sinceMs`.
 * Messages are immutable once written, so a session is "changed" exactly when
 * it has a message past the watermark.
 */
export function queryChangedSessionsV2(db: Database.Database, sinceMs: number): OpenCodeRow[] {
  return db
    .prepare<[number, number], OpenCodeRow>(
      `SELECT
         s.id,
         s.project_id,
         p.worktree AS project_worktree,
         s.title,
         s.model,
         s.time_created,
         s.time_updated,
         s.summary_additions,
         s.summary_deletions,
         s.summary_files,
         s.summary_diffs
       FROM session_v2 s
       LEFT JOIN project p ON p.id = s.project_id
       WHERE s.parent_id IS NULL
         AND (
           s.time_created > ?
           OR s.id IN (
             SELECT session_id FROM session_message
             WHERE time_created > ? AND type IN ('user', 'assistant')
           )
         )
       ORDER BY s.time_created ASC`,
    )
    .all(sinceMs, sinceMs);
}

function parseV2Block(block: unknown): CanonicalPart | null {
  if (typeof block !== "object" || block === null) return null;
  const b = block as Record<string, unknown>;
  switch (b["type"]) {
    case "text":
    case "reasoning":
      return { type: b["type"], text: typeof b["text"] === "string" ? b["text"] : "" };
    case "tool": {
      const state = (b["state"] ?? {}) as Record<string, unknown>;
      return {
        type: "tool",
        tool: typeof b["name"] === "string" ? b["name"] : "",
        callId: typeof b["id"] === "string" ? b["id"] : undefined,
        input: state["input"],
        output: extractV2ToolOutput(state),
      };
    }
    default:
      return null;
  }
}

function extractV2ToolOutput(state: Record<string, unknown>): string | undefined {
  const content = state["content"];
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
    .filter((t) => t !== "")
    .join("\n");
  return text === "" ? undefined : text.slice(0, 500);
}

