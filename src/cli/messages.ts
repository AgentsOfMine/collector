import type { Terminal } from "./terminal.js";

/** Shown by every command that needs a paired machine. */
export function printNotPaired(term: Terminal): void {
  term.err(`✗ This machine is not paired yet.`);
  term.err(`  Run ${term.paint.cyan("aom pair")} first.`);
}

export function printTokenMissing(term: Terminal): void {
  term.err(`✗ Device token missing — run ${term.paint.cyan("aom pair")} again.`);
}
