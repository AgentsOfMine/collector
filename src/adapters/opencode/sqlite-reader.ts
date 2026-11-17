import Database from "better-sqlite3";

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
