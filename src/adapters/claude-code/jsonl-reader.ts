import { createReadStream, statSync } from "node:fs";

export interface JsonlLine {
  filePath: string;
  byteOffset: number;
  parsed: unknown;
}

export interface JsonlCursor {
  filePath: string;
  byteOffset: number;
}

export interface JsonlRecord {
  line: unknown;
  /** Byte offset of the first byte of this line. */
  byteOffset: number;
  /** Byte offset just past this line (and its newline, when it has one). */
  endOffset: number;
}

const NEWLINE = 0x0a;

/**
 * Stream the parsed JSON lines of a JSONL file starting at `fromOffset`.
 *
 * - Blank and unparseable complete lines are skipped (never crash on bad JSONL).
 * - A final line with no trailing newline is only yielded if it already parses
 *   as JSON. A half-written line is left alone, so `endOffset` of the last
 *   yielded record is always a safe place to resume from.
 * - If the file is now shorter than `fromOffset` it was replaced; restart at 0.
 */
export async function* readJsonlFrom(filePath: string, fromOffset: number): AsyncIterable<JsonlRecord> {
  const stat = statSync(filePath);
  if (stat.size < fromOffset) fromOffset = 0;

  const stream = createReadStream(filePath, { start: fromOffset });

  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let lineStart = fromOffset;

  const take = (): string => {
    const text = Buffer.concat(pending, pendingBytes).toString("utf8");
    pending = [];
    pendingBytes = 0;
    return text;
  };

  const parse = (text: string): { ok: true; value: unknown } | { ok: false } => {
    if (text.trim() === "") return { ok: false };
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false };
    }
  };

  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    let from = 0;
    for (;;) {
      const nl = buf.indexOf(NEWLINE, from);
      if (nl === -1) {
        if (from < buf.length) {
          const rest = buf.subarray(from);
          pending.push(rest);
          pendingBytes += rest.length;
        }
        break;
      }
      const head = buf.subarray(from, nl);
      pending.push(head);
      pendingBytes += head.length;
      const lineBytes = pendingBytes;
      const result = parse(take().replace(/\r$/, ""));
      const endOffset = lineStart + lineBytes + 1;
      if (result.ok) yield { line: result.value, byteOffset: lineStart, endOffset };
      lineStart = endOffset;
      from = nl + 1;
    }
  }

  if (pendingBytes > 0) {
    const lineBytes = pendingBytes;
    const result = parse(take());
    if (result.ok) yield { line: result.value, byteOffset: lineStart, endOffset: lineStart + lineBytes };
  }
}

export interface ScanResult {
  /** Offset just past the last complete line in the file; safe to resume from. */
  endOffset: number;
  /** Index into the caller's message list where messages from the new region begin. */
  newMessagesFrom: number;
  /** True when at least one complete line lay at or beyond the resume offset. */
  sawNewLines: boolean;
}

/**
 * Read a whole session file so the caller's accumulator sees the session as it
 * really is (true start time, title, totals, edits still waiting for a result),
 * while remembering where the not-yet-synced part begins.
 *
 * `messageCount()` must return the length of the accumulator's message list.
 */
export async function scanJsonl(
  filePath: string,
  resumeOffset: number,
  apply: (line: unknown) => void,
  messageCount: () => number,
): Promise<ScanResult> {
  const resumeFrom = statSync(filePath).size < resumeOffset ? 0 : resumeOffset;
  let endOffset = 0;
  let newMessagesFrom: number | null = null;
  for await (const { line, endOffset: end, byteOffset } of readJsonlFrom(filePath, 0)) {
    if (newMessagesFrom === null && byteOffset >= resumeFrom) newMessagesFrom = messageCount();
    apply(line);
    endOffset = end;
  }
  return { endOffset, newMessagesFrom: newMessagesFrom ?? messageCount(), sawNewLines: newMessagesFrom !== null };
}
