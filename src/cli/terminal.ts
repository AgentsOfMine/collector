/**
 * The seam between a CLI command and the terminal.
 *
 * Commands receive a `Terminal` and return an exit code. They never call
 * `console.*`, `process.stdout`, or `process.exit()` themselves, so each one can
 * be driven from a test with an in-memory terminal. Only `bin/aom.ts` turns an
 * exit code into the process's exit status.
 */

import { colorEnabled, createPainter, type Painter } from "./ui.js";

export interface Terminal {
  /** A line on stdout. */
  out(line?: string): void;
  /** A line on stderr. */
  err(line?: string): void;
  /** Raw text on stdout with no newline, for spinners and prompts. */
  write(text: string): void;
  paint: Painter;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;

export function consoleTerminal(): Terminal {
  return {
    out: (line = "") => console.log(line),
    err: (line = "") => console.error(line),
    write: (text) => {
      process.stdout.write(text);
    },
    paint: createPainter(colorEnabled()),
  };
}
