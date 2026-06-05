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

export function querySessions(db: Database.Database, cursor: string | null): OpenCodeRow[] {
  const sinceMs = cursor ? new Date(cursor).getTime() : 0;
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
    FROM session s
    LEFT JOIN project p ON p.id = s.project_id
    WHERE s.time_updated > ?
      AND s.parent_id IS NULL
    ORDER BY s.time_updated ASC
    LIMIT 200
  `);
  return stmt.all(sinceMs);
}

export function queryMessages(db: Database.Database, sessionId: string): CanonicalMessage[] {
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
