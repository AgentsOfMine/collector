/**
 * Best-effort debug logging for silent degradation paths.
 *
 * Writes to STDERR only — never stdout — because the collector runs as an MCP
 * stdio server where stdout carries the JSON-RPC protocol stream; a stray
 * stdout write would corrupt it. Output is gated behind the AOM_DEBUG env var
 * so normal operation stays completely silent and the "never fail sync"
 * degradation behaviour is preserved; setting AOM_DEBUG makes otherwise-swallowed
 * errors (corrupt DB, permission failures, unparseable sessions) observable.
 */
export function debugLog(context: string, err: unknown): void {
  if (!process.env["AOM_DEBUG"]) return;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[aom] ${context}: ${message}`);
}
