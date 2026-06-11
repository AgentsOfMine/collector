import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readJsonlFrom } from "../../../src/adapters/claude-code/jsonl-reader.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aom-jsonl-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function collect(filePath: string, offset: number): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const { line } of readJsonlFrom(filePath, offset)) {
    out.push(line);
  }
  return out;
}

describe("readJsonlFrom", () => {
  it("parses each valid JSON line", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, '{"a":1}\n{"b":2}\n');
    const lines = await collect(f, 0);
    expect(lines).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips blank lines", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, '{"a":1}\n\n{"b":2}\n');
    expect(await collect(f, 0)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips unparseable lines without crashing", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, '{"a":1}\nnot-json\n{"b":2}\n');
    expect(await collect(f, 0)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("yields byteOffset that advances per line", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, '{"a":1}\n{"b":2}\n');
    const offsets: number[] = [];
    for await (const { byteOffset } of readJsonlFrom(f, 0)) {
      offsets.push(byteOffset);
    }
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(8); // '{"a":1}\n' = 8 bytes
  });

  it("restarts from 0 when file shrank below the cursor offset", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, '{"a":1}\n');
    const lines = await collect(f, 9999);
    expect(lines).toEqual([{ a: 1 }]);
  });

  it("resumes from a mid-file offset", async () => {
    const f = join(dir, "s.jsonl");
    writeFileSync(f, '{"a":1}\n{"b":2}\n');
    const lines = await collect(f, 8);
    expect(lines).toEqual([{ b: 2 }]);
  });
});
