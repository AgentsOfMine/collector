import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { COLLECTOR_VERSION, readVersion } from "../../src/core/version.js";

describe("collector version", () => {
  it("matches the version in package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(COLLECTOR_VERSION).toBe(pkg.version);
    expect(COLLECTOR_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reads the version from the given package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "aom-ver-"));
    try {
      const file = join(dir, "package.json");
      writeFileSync(file, JSON.stringify({ name: "x", version: "9.8.7" }));
      expect(readVersion(pathToFileURL(file))).toBe("9.8.7");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a clear error when package.json has no version", () => {
    const dir = mkdtempSync(join(tmpdir(), "aom-ver-"));
    try {
      const file = join(dir, "package.json");
      writeFileSync(file, JSON.stringify({ name: "x" }));
      expect(() => readVersion(pathToFileURL(file))).toThrow(/no version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
