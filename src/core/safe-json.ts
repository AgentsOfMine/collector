/**
 * Parse JSON, returning `null` instead of throwing on invalid input.
 * For call sites that additionally validate the parsed shape, keep that
 * validation at the call site — this only replaces the bare parse-or-null.
 */
export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
