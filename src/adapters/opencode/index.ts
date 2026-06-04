import { existsSync } from "node:fs";
import type { Adapter, Cursor } from "../adapter.js";
import type { SessionWithMessages } from "../../core/canonical.js";
import { openReadOnlyDb, querySessions, queryMessages } from "./sqlite-reader.js";
import { mapRow } from "./mapper.js";
import { homedir } from "node:os";
import { join } from "node:path";

export class OpenCodeAdapter implements Adapter {
  readonly name = "opencode";

  constructor(
    private readonly dbPath: string = join(homedir(), ".local", "share", "opencode", "opencode.db"),
    private readonly projectPath: string = homedir(),
  ) {}

  async *listNewSessions(cursor: Cursor): AsyncIterable<SessionWithMessages> {
    if (!existsSync(this.dbPath)) return;

    let db: ReturnType<typeof openReadOnlyDb> | undefined;
    try {
      db = openReadOnlyDb(this.dbPath);
      const rows = querySessions(db, cursor.value);
      for (const row of rows) {
        const session = mapRow(row, this.projectPath);
        const allMessages = queryMessages(db, row.id);
        const messages = allMessages.length <= 150
          ? allMessages
          : [allMessages[0], ...allMessages.slice(-149)];
        yield { ...session, messages };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("SQLITE_BUSY")) throw err;
    } finally {
      db?.close();
    }
  }
}

