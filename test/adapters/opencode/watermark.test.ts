import { describe, it, expect } from "vitest";
import {
  parseWatermark,
  formatWatermark,
  applyStreamingGuard,
  nextWatermark,
  STREAMING_GRACE_MS,
  WATERMARK_MARGIN_MS,
  type WatermarkCandidate,
} from "../../../src/adapters/opencode/watermark.js";

describe("parseWatermark / formatWatermark", () => {
  it("is 0 for null, empty and unparseable input", () => {
    expect(parseWatermark(null)).toBe(0);
    expect(parseWatermark("")).toBe(0);
    expect(parseWatermark("{not json")).toBe(0);
    expect(parseWatermark("garbage")).toBe(0);
  });

  it("round-trips a v2 cursor", () => {
    expect(parseWatermark(formatWatermark(1_800_000_000_000))).toBe(1_800_000_000_000);
    expect(formatWatermark(5)).toBe('{"v":2,"w":5}');
  });

  it("reads a legacy ISO cursor as a watermark", () => {
    expect(parseWatermark("2026-09-27T13:42:54.605Z")).toBe(Date.parse("2026-09-27T13:42:54.605Z"));
  });

  it("ignores a v2 cursor whose w is not a number", () => {
    expect(parseWatermark('{"v":2,"w":"soon"}')).toBe(0);
    expect(parseWatermark('{"v":2}')).toBe(0);
  });
});

describe("applyStreamingGuard", () => {
  const NOW = 1_000_000;
  const msg = (rowCreatedMs: number, finished: boolean): WatermarkCandidate => ({ rowCreatedMs, finished });

  it("returns only messages created after the watermark", () => {
    const all = [msg(100, true), msg(200, true), msg(300, true)];
    const r = applyStreamingGuard(all, 150, NOW - 10 * STREAMING_GRACE_MS, NOW);
    expect(r.ready).toEqual([all[1], all[2]]);
    expect(r.holdBeforeMs).toBeNull();
  });

  it("holds back a trailing unfinished message in a recently active session", () => {
    const all = [msg(100, true), msg(900_000, false)];
    const r = applyStreamingGuard(all, 50, NOW - 1_000, NOW);
    expect(r.ready).toEqual([all[0]]);
    expect(r.holdBeforeMs).toBe(900_000 - 1);
  });

  it("sends an unfinished trailing message once the session has been idle past the grace period", () => {
    const all = [msg(100, true), msg(200, false)];
    const r = applyStreamingGuard(all, 50, NOW - STREAMING_GRACE_MS - 1, NOW);
    expect(r.ready).toEqual(all);
    expect(r.holdBeforeMs).toBeNull();
  });

  it("does not hold back an unfinished message that is already behind the watermark", () => {
    const all = [msg(100, true), msg(200, false)];
    const r = applyStreamingGuard(all, 500, NOW - 1_000, NOW);
    expect(r.ready).toEqual([]);
    expect(r.holdBeforeMs).toBeNull();
  });

  it("only the LAST message can be held back; an unfinished one in the middle is sent", () => {
    const all = [msg(100, false), msg(200, true)];
    const r = applyStreamingGuard(all, 0, NOW - 1_000, NOW);
    expect(r.ready).toEqual(all);
    expect(r.holdBeforeMs).toBeNull();
  });

  it("handles a session with no messages", () => {
    expect(applyStreamingGuard([], 0, NOW, NOW)).toEqual({ ready: [], holdBeforeMs: null });
  });
});

describe("nextWatermark", () => {
  it("trails the query start by the safety margin", () => {
    expect(nextWatermark(0, 1_000_000, null)).toBe(1_000_000 - WATERMARK_MARGIN_MS);
  });

  it("stops before a held-back message", () => {
    expect(nextWatermark(0, 1_000_000, 500_000)).toBe(500_000);
  });

  it("never moves backwards", () => {
    expect(nextWatermark(2_000_000, 1_000_000, null)).toBe(2_000_000);
    expect(nextWatermark(2_000_000, 1_000_000, 10)).toBe(2_000_000);
  });
});
