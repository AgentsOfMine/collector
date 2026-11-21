import { describe, it, expect } from "vitest";
import { parseSince, lastActivity } from "../../src/core/since.js";

const NOW = new Date("2026-11-21T12:00:00.000Z");
const ok = (input: string) => {
  const r = parseSince(input, NOW);
  if (!r.ok) throw new Error(r.error);
  return r.since.toISOString();
};

describe("parseSince", () => {
  it("reads lengths of time back from now", () => {
    expect(ok("7d")).toBe("2026-11-14T12:00:00.000Z");
    expect(ok("12h")).toBe("2026-11-21T00:00:00.000Z");
    expect(ok("2w")).toBe("2026-11-07T12:00:00.000Z");
  });

  it("ignores case and surrounding space", () => {
    expect(ok(" 7D ")).toBe("2026-11-14T12:00:00.000Z");
  });

  it("reads a calendar day as 00:00 UTC", () => {
    expect(ok("2026-06-01")).toBe("2026-06-01T00:00:00.000Z");
  });

  it("reads all as the beginning of time", () => {
    expect(ok("all")).toBe("1970-01-01T00:00:00.000Z");
  });

  it.each(["", "7", "d", "7 d", "7days", "-3d", "0d", "99999d", "1.5d", "yesterday", "2026-6-1", "2026-13-01", "2026-02-30", "2027-01-01"])(
    "refuses %j with a message that names the flag",
    (input) => {
      const r = parseSince(input, NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("--since");
    },
  );
});

describe("lastActivity", () => {
  it("prefers the end of the session, then the start", () => {
    expect(lastActivity({ startedAt: "2026-06-01T00:00:00Z", endedAt: "2026-06-02T00:00:00Z" })?.toISOString()).toBe("2026-06-02T00:00:00.000Z");
    expect(lastActivity({ startedAt: "2026-06-01T00:00:00Z", endedAt: null })?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("falls back to the start when the end does not parse, and gives null when nothing does", () => {
    expect(lastActivity({ startedAt: "2026-06-01T00:00:00Z", endedAt: "garbage" })?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(lastActivity({ startedAt: "garbage", endedAt: null })).toBeNull();
  });
});
