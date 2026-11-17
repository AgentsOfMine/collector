import { describe, it, expect } from "vitest";
import { createPainter, colorEnabled, formatAgo } from "../../src/cli/ui.js";

describe("createPainter", () => {
  it("wraps text in ANSI codes when enabled", () => {
    const p = createPainter(true);
    expect(p.green("ok")).toBe("\x1b[32mok\x1b[0m");
    expect(p.red("no")).toBe("\x1b[31mno\x1b[0m");
    expect(p.cyan("aom pair")).toBe("\x1b[36maom pair\x1b[0m");
    expect(p.dim("x")).toBe("\x1b[2mx\x1b[0m");
    expect(p.underline("u")).toBe("\x1b[4mu\x1b[0m");
    expect(p.bold("b")).toBe("\x1b[1mb\x1b[0m");
    expect(p.yellow("y")).toBe("\x1b[33my\x1b[0m");
  });

  it("returns text unchanged when disabled", () => {
    const p = createPainter(false);
    for (const f of [p.green, p.red, p.yellow, p.cyan, p.bold, p.dim, p.underline]) {
      expect(f("plain")).toBe("plain");
    }
  });
});

describe("colorEnabled", () => {
  it("is on for a TTY", () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
  });

  it("is off when output is piped", () => {
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
    expect(colorEnabled({}, {})).toBe(false);
  });

  it("is off when NO_COLOR is set, even on a TTY", () => {
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
  });

  it("ignores an empty NO_COLOR", () => {
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: "" })).toBe(true);
  });
});

describe("formatAgo", () => {
  const now = Date.parse("2026-11-17T12:00:00.000Z");
  const ago = (ms: number) => formatAgo(new Date(now - ms), now);

  it("uses the largest whole unit", () => {
    expect(ago(0)).toBe("0s ago");
    expect(ago(59_000)).toBe("59s ago");
    expect(ago(60_000)).toBe("1m ago");
    expect(ago(59 * 60_000)).toBe("59m ago");
    expect(ago(3_600_000)).toBe("1h ago");
    expect(ago(23 * 3_600_000)).toBe("23h ago");
    expect(ago(24 * 3_600_000)).toBe("1d ago");
    expect(ago(140 * 24 * 3_600_000)).toBe("140d ago");
  });

  it("never goes negative for a timestamp slightly in the future", () => {
    expect(formatAgo(new Date(now + 5_000), now)).toBe("0s ago");
  });
});
