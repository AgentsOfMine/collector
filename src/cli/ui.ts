/**
 * Terminal presentation for the CLI: colors and the few symbols the commands
 * share. Commands never write escape codes themselves; they build lines with
 * these helpers, and `bin/aom.ts` prints them.
 *
 * Colors are dropped when output is not a terminal or `NO_COLOR` is set, so
 * piped output (`aom sync | tee log`) stays clean.
 */

export interface Painter {
  green(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  bold(s: string): string;
  dim(s: string): string;
  underline(s: string): string;
}

const codes = {
  green: ["\x1b[32m", "\x1b[0m"],
  red: ["\x1b[31m", "\x1b[0m"],
  yellow: ["\x1b[33m", "\x1b[0m"],
  cyan: ["\x1b[36m", "\x1b[0m"],
  bold: ["\x1b[1m", "\x1b[0m"],
  dim: ["\x1b[2m", "\x1b[0m"],
  underline: ["\x1b[4m", "\x1b[0m"],
} as const;

export function createPainter(enabled: boolean): Painter {
  const wrap = (name: keyof typeof codes) => (s: string) =>
    enabled ? `${codes[name][0]}${s}${codes[name][1]}` : s;
  return {
    green: wrap("green"),
    red: wrap("red"),
    yellow: wrap("yellow"),
    cyan: wrap("cyan"),
    bold: wrap("bold"),
    dim: wrap("dim"),
    underline: wrap("underline"),
  };
}

export function colorEnabled(
  stream: { isTTY?: boolean } = process.stdout,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  return stream.isTTY === true;
}

/** "3s ago", "5m ago", "2h ago", "4d ago". */
export function formatAgo(date: Date, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
