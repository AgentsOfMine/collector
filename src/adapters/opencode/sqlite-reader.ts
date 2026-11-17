import Database from "better-sqlite3";
import type { CanonicalMessage, CanonicalPart } from "../../core/canonical.js";

export interface OpenCodeRow {
  id: string;
  project_id: string | null;
  project_worktree: string | null;
  title: string | null;
  model: string | null;
  time_created: number;
  time_updated: number;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
  summary_diffs: string | null;
}

interface RawMessageRow {
  message_id: string;
  session_id: string;
  role: string;
  time_created: number;
  part_data: string;
}

export function openReadOnlyDb(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export type OpenCodeSchema = "v1" | "v2";

/**
 * OpenCode 2.x moved sessions to `session_v2` / `session_message` and stopped
 * writing the legacy `session` / `message` / `part` tables. The v2 tables hold
 * every migrated legacy session too, so when they exist they are the source.
 */
export function detectSchema(db: Database.Database): OpenCodeSchema {
  const rows = db
    .prepare<[], { name?: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all();
  return rows.some((r) => r.name === "session_v2") ? "v2" : "v1";
}

export function querySessions(
  db: Database.Database,
  cursor: string | null,
  schema: OpenCodeSchema = "v1",
): OpenCodeRow[] {
  const sinceMs = cursor ? new Date(cursor).getTime() : 0;
  const table = schema === "v2" ? "session_v2" : "session";
  const stmt = db.prepare<[number], OpenCodeRow>(`
    SELECT
      s.id,
      s.project_id,
      p.worktree  AS project_worktree,
      s.title,
      s.model,
      s.time_created,
      s.time_updated,
      s.summary_additions,
      s.summary_deletions,
      s.summary_files,
      s.summary_diffs
    FROM ${table} s
    LEFT JOIN project p ON p.id = s.project_id
    WHERE s.time_created > ?
      AND s.parent_id IS NULL
    ORDER BY s.time_created ASC
    LIMIT 200
  `);
  return stmt.all(sinceMs);
}

export function queryMessages(
  db: Database.Database,
  sessionId: string,
  schema: OpenCodeSchema = "v1",
): CanonicalMessage[] {
  if (schema === "v2") {
    const v2 = queryMessagesV2(db, sessionId);
    if (v2.length > 0) return v2;
    try {
      return queryMessagesV1(db, sessionId);
    } catch {
      return [];
    }
  }
  return queryMessagesV1(db, sessionId);
}

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

function queryMessagesV2(db: Database.Database, sessionId: string): CanonicalMessage[] {
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

function queryMessagesV1(db: Database.Database, sessionId: string): CanonicalMessage[] {
  const stmt = db.prepare<[string], RawMessageRow>(`
    SELECT
      m.id        AS message_id,
      m.session_id,
      json_extract(m.data, '$.role') AS role,
      m.time_created,
      p.data      AS part_data
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = ?
    ORDER BY m.time_created ASC, p.id ASC
  `);

  const rows = stmt.all(sessionId);

  const byMessage = new Map<string, { role: string; createdAt: string; parts: CanonicalPart[] }>();
  for (const row of rows) {
    if (!byMessage.has(row.message_id)) {
      const rawRole = row.role ?? "";
      const role = rawRole === "user" || rawRole === "assistant" ? rawRole : "assistant";
      byMessage.set(row.message_id, {
        role,
        createdAt: new Date(row.time_created).toISOString(),
        parts: [],
      });
    }
    const part = parsePart(row.part_data);
    if (part) byMessage.get(row.message_id)!.parts.push(part);
  }

  return Array.from(byMessage.entries())
    .map(([messageId, msg]) => ({
      messageId,
      sessionId,
      role: msg.role as "user" | "assistant",
      senderName: msg.role === "user" ? "You" : "OpenCode",
      createdAt: msg.createdAt,
      parts: msg.parts,
    }))
    .filter((msg) => msg.parts.length > 0);
}

function parsePart(raw: string): CanonicalPart | null {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const type = d["type"] as string;
    if (!type) return null;

    switch (type) {
      case "text":
      case "reasoning":
        return { type, text: (d["text"] as string) ?? "" };
      case "tool":
        return {
          type: "tool",
          tool: (d["tool"] as string) ?? "",
          callId: (d["callID"] as string) ?? undefined,
          input: (d["state"] as Record<string, unknown>)?.["input"],
          output: extractToolOutput(d),
        };
      case "step-start":
      case "step-finish":
        return { type };
      default:
        return { type };
    }
  } catch {
    return null;
  }
}

function extractToolOutput(d: Record<string, unknown>): string | undefined {
  const state = d["state"] as Record<string, unknown> | undefined;
  if (!state) return undefined;
  const output = state["output"];
  if (typeof output === "string") return output.slice(0, 500);
  if (output != null) return JSON.stringify(output).slice(0, 500);
  return undefined;
}
