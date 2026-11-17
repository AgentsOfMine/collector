import { existsSync } from "node:fs";
import type { Adapter, Cursor, SyncItem } from "../adapter.js";
import {
  openReadOnlyDb,
  querySessions,
  queryMessages,
  detectSchema,
  queryChangedSessionsV2,
  queryMessagesV2Detailed,
} from "./sqlite-reader.js";
import { mapRow } from "./mapper.js";
import { deriveFileChanges } from "./file-changes.js";
import { truncateMessages } from "../../core/message-truncation.js";
import { debugLog } from "../../core/debug-log.js";
import { homedir } from "node:os";
import { opencodeDbPath } from "../../core/paths.js";

type DbOpener = typeof openReadOnlyDb;

/** An unfinished trailing assistant message is only treated as abandoned after this long. */
const STREAMING_GRACE_MS = 120_000;
/** The watermark trails "now" slightly so a row committed mid-query is never skipped. */
const WATERMARK_MARGIN_MS = 5_000;

/**
 * v2 cursors are `{"v":2,"w":<ms>}`: every message created at or before `w` has
 * been uploaded. A legacy cursor (ISO session start time) is read as a watermark
 * too; re-sending a few already-stored messages is harmless (the backend stores
 * each message once).
 */
function parseWatermark(raw: string | null): number {
  if (!raw) return 0;
  if (raw.startsWith("{")) {
    try {
      const w = (JSON.parse(raw) as { w?: unknown }).w;
      return typeof w === "number" ? w : 0;
    } catch {
      return 0;
    }
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

function watermarkCursor(w: number): string {
  return JSON.stringify({ v: 2, w });
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
      const schema = detectSchema(db);
      if (schema === "v2") {
        yield* this.listChangedV2(db, cursor);
        return;
      }
      const rows = querySessions(db, cursor.value, schema);
      for (const row of rows) {
        const session = mapRow(row, this.projectPath);
        const allMessages = queryMessages(db, row.id, schema);

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

  /**
   * Incremental v2 sync: for every session with messages past the watermark,
   * send the session row (counts derived from ALL its messages) plus only the
   * new messages. Items are emitted with one-item lookahead so that only the
   * final item carries the advanced watermark; earlier items keep the old one,
   * which makes a mid-run failure safe to retry.
   */
  private async *listChangedV2(db: ReturnType<DbOpener>, cursor: Cursor): AsyncIterable<SyncItem> {
    const since = parseWatermark(cursor.value);
    const queryStart = Date.now();
    const oldCursor = watermarkCursor(since);
    const rows = queryChangedSessionsV2(db, since);

    let holdUntil: number | null = null;
    let pending: SyncItem | null = null;

    for (const row of rows) {
      const session = mapRow(row, this.projectPath);
      const detailed = queryMessagesV2Detailed(db, row.id);
      const allMessages = detailed.map((d) => d.message).filter((m) => m.parts.length > 0);

      if (session.filesChanged === null || session.filesChanged.length === 0) {
        const derived = deriveFileChanges(allMessages);
        if (derived.filesChanged.length > 0) {
          session.filesChanged = derived.filesChanged;
          session.fileCount = derived.filesChanged.length;
          session.linesAdded = derived.linesAdded;
          session.linesRemoved = derived.linesRemoved;
        }
      }

      let candidates = detailed.filter((d) => d.rowCreatedMs > since);
      const last = detailed[detailed.length - 1];
      if (
        last &&
        !last.finished &&
        candidates.includes(last) &&
        row.time_updated > queryStart - STREAMING_GRACE_MS
      ) {
        // Still streaming: the backend never overwrites a stored message, so
        // wait until it is complete and keep the watermark just before it.
        candidates = candidates.filter((d) => d !== last);
        holdUntil = Math.min(holdUntil ?? Infinity, last.rowCreatedMs - 1);
      }

      const fresh = candidates.map((d) => d.message).filter((m) => m.parts.length > 0);
      const isNewSession = row.time_created > since;
      if (fresh.length === 0 && !isNewSession) continue;

      const messages = truncateMessages(fresh);
      if (pending) yield pending;
      pending = { session: { ...session, messages }, cursor: oldCursor };
    }

    if (pending) {
      const newWatermark = Math.max(since, Math.min(holdUntil ?? Infinity, queryStart - WATERMARK_MARGIN_MS));
      yield { ...pending, cursor: watermarkCursor(newWatermark) };
    }
  }
}
