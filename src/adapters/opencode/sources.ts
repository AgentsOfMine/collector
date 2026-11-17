import type Database from "better-sqlite3";
import type { Cursor, SyncItem } from "../adapter.js";
import { truncateMessages } from "../../core/message-truncation.js";
import { mapRow } from "./mapper.js";
import { applyDerivedFileChanges } from "./session-files.js";
import { querySessionsV1, queryMessagesV1 } from "./v1-reader.js";
import { queryChangedSessionsV2, queryMessagesV2Detailed } from "./v2-reader.js";
import {
  parseWatermark,
  formatWatermark,
  applyStreamingGuard,
  nextWatermark,
} from "./watermark.js";

/**
 * One way of reading an OpenCode database. `OpenCodeAdapter` picks a source by
 * schema once; everything schema-specific lives behind this interface.
 */
export interface OpenCodeSource {
  read(db: Database.Database, cursor: Cursor, projectPath: string): Iterable<SyncItem>;
}

/** OpenCode 1.x: whole sessions, start-time cursor, a session is sent once. */
export class V1Source implements OpenCodeSource {
  *read(db: Database.Database, cursor: Cursor, projectPath: string): Iterable<SyncItem> {
    for (const row of querySessionsV1(db, cursor.value)) {
      const session = mapRow(row, projectPath);
      const allMessages = queryMessagesV1(db, row.id);
      applyDerivedFileChanges(session, allMessages);
      yield {
        session: { ...session, messages: truncateMessages(allMessages) },
        cursor: session.startedAt,
      };
    }
  }
}

/**
 * OpenCode 2.x: time-watermark cursor. For each session with messages past the
 * watermark, send the session row (counts over ALL its messages) plus only the
 * new messages.
 *
 * Items are emitted with one-item lookahead so that only the final item carries
 * the advanced watermark; earlier items keep the old one, which makes a failure
 * midway safe to retry.
 */
export class V2Source implements OpenCodeSource {
  constructor(private readonly now: () => number = Date.now) {}

  *read(db: Database.Database, cursor: Cursor, projectPath: string): Iterable<SyncItem> {
    const since = parseWatermark(cursor.value);
    const queryStart = this.now();
    const oldCursor = formatWatermark(since);

    let holdBeforeMs: number | null = null;
    let pending: SyncItem | null = null;

    for (const row of queryChangedSessionsV2(db, since)) {
      const session = mapRow(row, projectPath);
      const detailed = queryMessagesV2Detailed(db, row.id);
      applyDerivedFileChanges(
        session,
        detailed.map((d) => d.message).filter((m) => m.parts.length > 0),
      );

      const guard = applyStreamingGuard(detailed, since, row.time_updated, queryStart);
      if (guard.holdBeforeMs !== null) {
        holdBeforeMs = Math.min(holdBeforeMs ?? Infinity, guard.holdBeforeMs);
      }

      const fresh = guard.ready.map((d) => d.message).filter((m) => m.parts.length > 0);
      const isNewSession = row.time_created > since;
      if (fresh.length === 0 && !isNewSession) continue;

      if (pending) yield pending;
      pending = { session: { ...session, messages: truncateMessages(fresh) }, cursor: oldCursor };
    }

    if (pending) {
      yield { ...pending, cursor: formatWatermark(nextWatermark(since, queryStart, holdBeforeMs)) };
    }
  }
}
