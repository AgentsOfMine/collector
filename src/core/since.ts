/**
 * Parse the value of `aom sync --since`.
 *
 *   7d, 12h, 2w   a length of time back from now
 *   2026-06-01    a calendar day (00:00 UTC)
 *   all           everything, however old
 *
 * Returns the cut-off, or a message that says what was wrong. Pure: `now` is passed in.
 */

export type SinceResult = { ok: true; since: Date } | { ok: false; error: string };

const UNIT_MS = { h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
const MAX_COUNT = 36_500;

export function parseSince(input: string, now: Date = new Date()): SinceResult {
  const text = input.trim().toLowerCase();

  if (text === "all") return { ok: true, since: new Date(0) };

  const rel = /^(\d{1,5})([hdw])$/.exec(text);
  if (rel !== null) {
    const count = Number(rel[1]);
    const unit = rel[2] as keyof typeof UNIT_MS;
    if (count === 0 || count > MAX_COUNT) return { ok: false, error: `--since ${input}: use a count from 1 to ${MAX_COUNT}` };
    return { ok: true, since: new Date(now.getTime() - count * UNIT_MS[unit]) };
  }

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day !== null) {
    const date = new Date(`${text}T00:00:00.000Z`);
    const same =
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === Number(day[1]) &&
      date.getUTCMonth() + 1 === Number(day[2]) &&
      date.getUTCDate() === Number(day[3]);
    if (!same) return { ok: false, error: `--since ${input}: not a real date` };
    if (date.getTime() > now.getTime()) return { ok: false, error: `--since ${input}: that date is in the future` };
    return { ok: true, since: date };
  }

  return { ok: false, error: `--since ${input}: use a length such as 7d, 12h or 2w, a date such as 2026-06-01, or "all"` };
}

/** When a session was last active: its end, else its start. `null` when neither parses. */
export function lastActivity(session: { startedAt: string; endedAt: string | null }): Date | null {
  for (const value of [session.endedAt, session.startedAt]) {
    if (value === null) continue;
    const t = new Date(value);
    if (!Number.isNaN(t.getTime())) return t;
  }
  return null;
}
