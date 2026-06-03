import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";

export interface JsonlLine {
  filePath: string;
  byteOffset: number;
  parsed: unknown;
}

export interface JsonlCursor {
  filePath: string;
  byteOffset: number;
}

export async function* readJsonlFrom(
  filePath: string,
  fromOffset: number,
): AsyncIterable<{ line: unknown; byteOffset: number }> {
  const stat = statSync(filePath);
  if (stat.size < fromOffset) {
    // File shrank — restart from 0
    fromOffset = 0;
  }

  const stream = createReadStream(filePath, {
    start: fromOffset,
    encoding: "utf8",
  });

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let offset = fromOffset;

  for await (const rawLine of rl) {
    const lineBytes = Buffer.byteLength(rawLine, "utf8") + 1; // +1 for newline
    if (rawLine.trim() === "") {
      offset += lineBytes;
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(rawLine);
      yield { line: parsed, byteOffset: offset };
    } catch {
      // Skip unparseable lines — never crash on bad JSONL
    }
    offset += lineBytes;
  }
}
