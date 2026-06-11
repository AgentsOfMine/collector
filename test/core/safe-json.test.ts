import { describe, it, expect } from "vitest";
import { safeJsonParse } from "../../src/core/safe-json.js";

describe("safeJsonParse", () => {
  it("parses valid JSON objects", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses valid JSON arrays and primitives", () => {
    expect(safeJsonParse("[1,2]")).toEqual([1, 2]);
    expect(safeJsonParse('"x"')).toBe("x");
    expect(safeJsonParse("42")).toBe(42);
  });

  it("returns null on invalid JSON instead of throwing", () => {
    expect(safeJsonParse("not-json")).toBeNull();
    expect(safeJsonParse("")).toBeNull();
    expect(safeJsonParse("{unclosed")).toBeNull();
  });
});
