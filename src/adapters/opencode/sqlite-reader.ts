import Database from "better-sqlite3";

export interface OpenCodeRow {
  id: string;
  project_id: string | null;
  title: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
  patch: string | null;
}

export function openReadOnlyDb(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export function querySessions(db: Database.Database, cursor: string | null): OpenCodeRow[] {
  const since = cursor ?? "1970-01-01T00:00:00.000Z";
  const stmt = db.prepare<[string], OpenCodeRow>(`
    SELECT
      id,
      project_id,
      title,
      model,
      created_at,
      updated_at,
      summary_additions,
      summary_deletions,
      summary_files,
      patch
    FROM session
    WHERE updated_at > ?
    ORDER BY updated_at ASC
    LIMIT 200
  `);
  return stmt.all(since);
}
