import { createPainter } from "../../src/cli/ui.js";
import type { Terminal } from "../../src/cli/terminal.js";

/** A Terminal that records what a command printed, for assertions. */
export interface MemoryTerminal extends Terminal {
  stdout: string[];
  stderr: string[];
  /** Raw `write()` output, concatenated. */
  written: string;
  /** stdout lines joined by newline. */
  text(): string;
  /** stderr lines joined by newline. */
  errText(): string;
}

export function memoryTerminal(color = false): MemoryTerminal {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let written = "";
  return {
    stdout,
    stderr,
    get written() {
      return written;
    },
    out: (line = "") => void stdout.push(line),
    err: (line = "") => void stderr.push(line),
    write: (text) => {
      written += text;
    },
    paint: createPainter(color),
    text: () => stdout.join("\n"),
    errText: () => stderr.join("\n"),
  };
}
