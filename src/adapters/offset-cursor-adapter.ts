import { existsSync, statSync } from "node:fs";
import type { Adapter, Cursor, SyncItem } from "./adapter.js";
import type { CanonicalMessage, CanonicalSession } from "../core/canonical.js";
import { scanJsonl } from "./claude-code/jsonl-reader.js";
import { truncateMessages } from "../core/message-truncation.js";
import { debugLog } from "../core/debug-log.js";

/** `{ [absoluteFilePath]: byteOffset }` — how far into each file has been uploaded. */
export type OffsetCursor = Record<string, number>;

export function parseOffsetCursor(raw: string | null): OffsetCursor {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as OffsetCursor;
    }
  } catch {
    // malformed cursor — start fresh
  }
  return {};
}

export function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return -1;
  }
}

/** What an adapter must supply for one session file; the rest is shared. */
export interface SessionFileReader {
  /** Feed one parsed JSONL line to the accumulator. */
  apply(line: unknown): void;
  /** Number of messages accumulated so far. */
  messageCount(): number;
  /** Messages accumulated so far, oldest first. */
  messages(): CanonicalMessage[];
  /** The session as the whole file describes it (true start time, title, totals). */
  finalize(): CanonicalSession;
}

/**
 * Base for adapters whose source is one append-only JSONL file per session
 * (Claude Code, Pi). The cursor is a byte offset per file.
 *
 * Each pass reads a file in full so the session fields are the session's real
 * ones, but uploads only the messages at or beyond the saved offset. Nothing is
 * emitted for a file that has not grown, or whose new lines produced no
 * messages. Subclasses only say where the files are and how to read one.
 */
export abstract class OffsetCursorAdapter implements Adapter {
  abstract readonly name: string;

  protected abstract findSessionFiles(): string[];
  protected abstract openReader(filePath: string): SessionFileReader;

  /** Whether a file exists; overridable so tests can fake the filesystem. */
  protected fileExists(filePath: string): boolean {
    return existsSync(filePath);
  }

  async *listNewSessions(cursor: Cursor): AsyncIterable<SyncItem> {
    const offsets = parseOffsetCursor(cursor.value);

    for (const filePath of this.findSessionFiles()) {
      if (!this.fileExists(filePath)) continue;

      const fromOffset = offsets[filePath] ?? 0;
      if (fromOffset > 0 && fileSize(filePath) === fromOffset) continue; // nothing appended since last pass

      const reader = this.openReader(filePath);
      let scan;
      try {
        scan = await scanJsonl(filePath, fromOffset, (line) => reader.apply(line), () => reader.messageCount());
      } catch (err) {
        debugLog(`${this.name}: failed reading ${filePath}`, err);
        continue;
      }

      const newMessages = reader.messages().slice(scan.newMessagesFrom);
      if (newMessages.length === 0) continue;

      offsets[filePath] = scan.endOffset;
      const session = reader.finalize();
      yield {
        session: { ...session, messages: truncateMessages(newMessages) },
        cursor: JSON.stringify(offsets),
      };
    }
  }
}
