/**
 * The OpenCode v2 cursor is a time watermark, `{"v":2,"w":<ms>}`: every message
 * created at or before `w` has been uploaded. A legacy cursor (the ISO start
 * time of the last session) is read as a watermark too; re-sending a few
 * already-stored messages is harmless because the backend stores each message
 * once.
 */

/** An unfinished trailing assistant message is only treated as abandoned after this long. */
export const STREAMING_GRACE_MS = 120_000;
/** The watermark trails "now" slightly so a row committed mid-query is never skipped. */
export const WATERMARK_MARGIN_MS = 5_000;

export function parseWatermark(raw: string | null): number {
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

export function formatWatermark(w: number): string {
  return JSON.stringify({ v: 2, w });
}

/** What the streaming guard needs to know about one session's messages. */
export interface WatermarkCandidate {
  rowCreatedMs: number;
  finished: boolean;
}

export interface StreamingGuardResult<T extends WatermarkCandidate> {
  /** The messages that are safe to upload now. */
  ready: T[];
  /** If a message was held back, the watermark must stay below this time. */
  holdBeforeMs: number | null;
}

/**
 * Pick the messages of one session that may be uploaded this pass.
 *
 * `all` is every message of the session, oldest first. Only those created after
 * `since` are candidates. The backend never overwrites a stored message, so a
 * trailing assistant message that is still streaming (no `finish`, session
 * touched within the grace period) is held back until it completes; the caller
 * then keeps the watermark just before it.
 */
export function applyStreamingGuard<T extends WatermarkCandidate>(
  all: T[],
  since: number,
  sessionUpdatedMs: number,
  nowMs: number,
): StreamingGuardResult<T> {
  const candidates = all.filter((m) => m.rowCreatedMs > since);
  const last = all[all.length - 1];
  const stillStreaming =
    last !== undefined &&
    !last.finished &&
    candidates.includes(last) &&
    sessionUpdatedMs > nowMs - STREAMING_GRACE_MS;

  if (!stillStreaming) return { ready: candidates, holdBeforeMs: null };
  return { ready: candidates.filter((m) => m !== last), holdBeforeMs: last.rowCreatedMs - 1 };
}

/**
 * Where the cursor may advance to after a pass: never past a held-back message,
 * never ahead of the query start (minus a margin), and never backwards.
 */
export function nextWatermark(since: number, queryStartMs: number, holdBeforeMs: number | null): number {
  return Math.max(since, Math.min(holdBeforeMs ?? Infinity, queryStartMs - WATERMARK_MARGIN_MS));
}
