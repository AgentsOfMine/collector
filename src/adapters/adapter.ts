import type { SessionWithMessages } from "../core/canonical.js";

export interface Cursor {
  value: string | null;
}

export interface Adapter {
  readonly name: string;
  listNewSessions(cursor: Cursor): AsyncIterable<SessionWithMessages>;
}
