import { existsSync } from "node:fs";
import type { Adapter, Cursor } from "../adapter.js";
import type { CanonicalSession } from "../../core/canonical.js";
import { openReadOnlyDb, querySessions } from "./sqlite-reader.js";
import { mapRow } from "./mapper.js";
import { homedir } from "node:os";
import { join } from "node:path";

export class OpenCodeAdapter implements Adapter {
  readonly name = "opencode";

  constructor(
    private readonly dbPath: string = join(homedir(), ".local", "share", "opencode", "opencode.db"),
    private readonly projectPath: string = homedir(),
  ) {}

  async *listNewSessions(cursor: Cursor): AsyncIterable<CanonicalSession> {
    if (!existsSync(this.dbPath)) return;

    let db: ReturnType<typeof openReadOnlyDb> | undefined;
    try {
      db = openReadOnlyDb(this.dbPath);
      const rows = querySessions(db, cursor.value);
      for (const row of rows) {
        yield mapRow(row, this.projectPath);
      }
    } catch (err) {
      // SQLITE_BUSY — skip gracefully
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("SQLITE_BUSY")) throw err;
    } finally {
      db?.close();
    }
  }
}
