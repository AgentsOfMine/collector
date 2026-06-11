import type { SessionWithMessages } from "../core/canonical.js";

export interface Cursor {
  value: string | null;
}

export interface SyncItem {
  session: SessionWithMessages;
  /** Opaque cursor value valid to persist AFTER this session is accepted. */
  cursor: string;
}

export interface Adapter {
  readonly name: string;
  listNewSessions(cursor: Cursor): AsyncIterable<SyncItem>;
}
