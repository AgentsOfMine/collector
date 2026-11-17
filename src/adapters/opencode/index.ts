import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import { debugLog } from "../../core/debug-log.js";
import { opencodeDbPath } from "../../core/paths.js";
import { openReadOnlyDb, detectSchema } from "./sqlite-reader.js";
import { V1Source, V2Source, type OpenCodeSource } from "./sources.js";

type DbOpener = typeof openReadOnlyDb;

function sourceFor(schema: ReturnType<typeof detectSchema>): OpenCodeSource {
  return schema === "v2" ? new V2Source() : new V1Source();
}

export class OpenCodeAdapter implements Adapter {
  readonly name = "opencode";

  constructor(
    private readonly dbPath: string = opencodeDbPath(),
    private readonly projectPath: string = homedir(),
    private readonly openDb: DbOpener = openReadOnlyDb,
  ) {}

  async *listNewSessions(cursor: Cursor): AsyncIterable<SyncItem> {
    if (!existsSync(this.dbPath)) return;

    let db: ReturnType<DbOpener> | undefined;
    try {
      db = this.openDb(this.dbPath);
      yield* sourceFor(detectSchema(db)).read(db, cursor, this.projectPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("SQLITE_BUSY")) {
        debugLog("opencode: db read failed", err);
        throw err;
      }
      // SQLITE_BUSY: DB is locked by an active OpenCode write — skip this sync
      // cycle and retry next tick. Never fail the sync; just make it observable.
      debugLog("opencode: db busy, skipping this cycle", err);
    } finally {
      db?.close();
    }
  }
}
