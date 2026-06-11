import { existsSync } from "node:fs";
import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import { openReadOnlyDb, querySessions, queryMessages } from "./sqlite-reader.js";
import { mapRow } from "./mapper.js";
import { deriveFileChanges } from "./file-changes.js";
import { truncateMessages } from "../../core/message-truncation.js";
import { homedir } from "node:os";
import { join } from "node:path";

export class OpenCodeAdapter implements Adapter {
  readonly name = "opencode";

  constructor(
    private readonly dbPath: string = join(homedir(), ".local", "share", "opencode", "opencode.db"),
    private readonly projectPath: string = homedir(),
  ) {}

  async *listNewSessions(cursor: Cursor): AsyncIterable<SyncItem> {
    if (!existsSync(this.dbPath)) return;

    let db: ReturnType<typeof openReadOnlyDb> | undefined;
    try {
      db = openReadOnlyDb(this.dbPath);
      const rows = querySessions(db, cursor.value);
      for (const row of rows) {
        const session = mapRow(row, this.projectPath);
        const allMessages = queryMessages(db, row.id);

        // summary_* DB columns are unpopulated in current OpenCode; derive from tool parts.
        if (session.filesChanged === null || session.filesChanged.length === 0) {
          const derived = deriveFileChanges(allMessages);
          if (derived.filesChanged.length > 0) {
            session.filesChanged = derived.filesChanged;
            session.fileCount = derived.filesChanged.length;
            session.linesAdded = derived.linesAdded;
            session.linesRemoved = derived.linesRemoved;
          }
        }

        const messages = truncateMessages(allMessages);
        yield { session: { ...session, messages }, cursor: session.startedAt };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("SQLITE_BUSY")) throw err;
    } finally {
      db?.close();
    }
  }
}

